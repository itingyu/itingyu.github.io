---
layout: post
slug: multica-scheduler
title: 抢任务：调度器如何避免丢、重、空转
date: 2026-11-03 00:00:00 +0800
column: multica
series: multica-code
tags:
  - Multica
  - 调度
  - 分布式系统
excerpt: 一个 agent 任务从入队到开跑，要穿过 Redis 缓存、PostgreSQL 行锁和一条可能断开的 WebSocket。调度器真正难的，是三种失败：丢任务、双领、空转。
pinned: false
cover: null
draft: false
permalink: /notes/multica/multica-code/multica-scheduler/
---

# 抢任务：调度器如何避免丢、重、空转

这篇写给做过后台任务、消息队列或分布式 worker 的工程师。你不需要了解 Multica 的产品，但要知道租约、行锁、至少一次投递这些概念。读完可以判断：当"消费者"是用户机器上不可控的进程时，领取协议应该怎么设计。

Multica 的任务队列叫 `agent_task_queue`。一行记录代表"某个 agent 要在某个 runtime 上处理某条 issue（或某个 chat）"。daemon 主动来领，服务端不推送任务本体，只推送"可能有活了"的提示。

这个不对称很关键：**服务端拥有状态，daemon 只申请下一步**。所有并发问题都围绕这条边界展开。

## 一、队列不是消息队列

第一眼看上去，这就是个标准队列：`queued -> dispatched -> running -> completed/failed/cancelled`，带 `priority` 和 `created_at` 排序。

但它和 Kafka、RabbitMQ 有三点不同：

1. **消费者是机器，不是进程**。一个 daemon 可能承载多个 runtime（每个 provider 一个），一个 runtime 同时能跑几个任务由 `max_concurrent_tasks` 决定。
2. **任务有业务约束**。同一条 issue 上，同一个 agent 不能同时跑两个任务；否则两次执行会互相覆盖工作目录、重复发评论。这是"队列"之外的一层串行化。
3. **任务会被人中途改变**。用户可能取消、插话、改派，状态推进必须能被服务端单方面否决。

所以这里不是"投递一条消息、消费完 ack"那么简单，而是"领一个租约、在租约内推进状态、失败可回收"。

## 二、领取：一条 UPDATE 的六个前置条件

核心 SQL 在 `pkg/db/queries/agent.sql`，生成的 `ClaimAgentTask` 是一条带子查询的 `UPDATE ... RETURNING`：

```sql
UPDATE agent_task_queue
SET status = 'dispatched',
    dispatched_at = now(),
    prepare_lease_expires_at = now() + make_interval(secs => $1)
WHERE id = (
    SELECT atq.id FROM agent_task_queue atq
    WHERE atq.agent_id = $2
      AND atq.runtime_id = $3
      AND atq.status = 'queued'
      AND ...  -- runtime 在线且心跳新鲜
      AND NOT EXISTS (  -- 同一 issue / chat / autopilot 没有在跑的任务
          SELECT 1 FROM agent_task_queue active
          WHERE active.agent_id = atq.agent_id
            AND active.status IN ('dispatched','running','waiting_local_directory')
            AND ...
      )
    ORDER BY atq.priority DESC, atq.created_at ASC, atq.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING ...;
```

一条语句同时做了五件事：筛选可领任务、保证 runtime 新鲜、保证同一业务对象串行、按优先级取一条、用 `SKIP LOCKED` 让并发领取者不互相阻塞。`RETURNING` 把领取结果直接带回，不需要再查一次。

`FOR UPDATE SKIP LOCKED` 是这里的关键。多个 daemon 同时来领，谁先锁到哪一行就是谁的，其他人跳过，不会排队等锁。这是 PostgreSQL 做队列的标准姿势，但前提是"锁的范围足够小"——所以子查询只取 `LIMIT 1`。

还有一个容易被忽略的细节：`ORDER BY atq.priority DESC, atq.created_at ASC, atq.id ASC` 的最后一项是 `id`。UUIDv7 的 id 本身按时间有序，加上它只是为了在 `created_at` 相同时给出确定性顺序，避免不同副本看到不同的"第一条"。

## 三、空转：只缓存否定的答案

如果每个空闲 daemon 每秒都来查一次库，几万台机器就能把 PostgreSQL 打成筛子。Multica 的解法是 `EmptyClaimCache`：**只缓存"这个 runtime 当前没有可领任务"这个否定结论**。

正向结果不缓存。原因写在注释里：正向结果必须回数据库重新竞争，否则缓存会让某个 daemon 以为自己一直有活，破坏公平性。

否定结论也有风险：刚缓存"空"，就有人入队了，daemon 会继续睡。为此缓存值带一个版本号：

```text
T1 claim:   v0 := GET version
            SELECT ... -> empty
            （慢，比如 GC 停顿）
T2 enqueue: INSERT row
            INCR version  (-> v1)
            唤醒 daemon
T1 claim:   SET empty = v0
T3 claim:   GET version (== v1)
            GET empty (== v0) -> 版本不匹配，视为未命中 -> 重新 SELECT
```

没有版本号，T3 会命中 T1 写下的过期"空"，刚入队的任务就要等到 TTL 过期才被发现。有了版本号，最坏情况只是多一次 SELECT，不会把任务饿死。

参数也值得记：`EmptyClaimCacheTTL` 是 3 分钟，版本键 TTL 24 小时（每次读写滑动续期），每次 Redis 调用限时 250 毫秒。`EmptyClaimCache` 的零值安全：没有 Redis 时所有方法退化为未命中，单机开发不需要额外配置。

## 四、双领：连接断开时最危险的选择

领取请求走两条通道：HTTP，以及 daemon 与服务端之间那条复用的 WebSocket。WebSocket 更快，也更容易出问题。

设想这个顺序：

1. daemon 通过 WebSocket 发出 `tasks.claim`。
2. 服务端收到，把任务标成 `dispatched`，提交事务。
3. 响应还没发回，连接断了。

daemon 这时知道"请求发出去了"，但不知道"服务端有没有提交"。如果它按常规容错逻辑回退到 HTTP 重领，就可能领到同一批任务——而第一批其实已经派发出去了。结果是同一个任务被两个执行槽跑，工作目录互相踩。

代码里专门区分了两种错误：

```go
// errWSRPCUnavailable: 没有可用连接，可以安全回退 HTTP
// errWSRPCUncertain:   帧已发出但结果未知，禁止回退
var errWSRPCUncertain = errors.New("ws rpc: sent but outcome unknown (connection lost)")
```

遇到 `errWSRPCUncertain`，daemon 不重试、不回退，直接放弃这一轮，等服务端的回收逻辑处理。服务端有 `ReclaimStaleDispatchedTasksForRuntimes`：超过恢复窗口仍是 `dispatched` 的任务，会被重新放回可领状态。

这就是"宁可少领，不可双领"。在一个会写文件、会发评论、会推分支的系统里，重复执行的代价远高于晚几十秒。

## 五、丢任务：三段时间与租约

"不丢"不是靠一次 ack，而是靠三个时间窗口接力。

**领取后的响应窗口：90 秒。** `claimResponseRecoveryWindow` 必须大于 daemon 的 HTTP 超时（30 秒）加上 `start` 请求的超时（30 秒），再留调度余量。超过 90 秒还没 start，服务端认为这次投递丢了，任务可以回收。

**准备阶段的租约：45 秒。** 建目录、拉仓库、装 skill 可能超过 90 秒。daemon 可以调 `prepare-lease` 续租，续一次管 45 秒。这样"准备得慢"不会被误判成"投递失败"。

**运行时的新鲜度：150 秒。** 服务端只接受心跳足够新的 runtime 来领任务。150 秒的构成写在注释里：60 秒的数据库心跳落盘间隔 + 15 秒的 daemon 心跳 + 30 秒的批量调度 tick，再留 45 秒缓冲。低于这个值，正常抖动会被误判成离线；高于这个值，任务可能派给一台已经关机的机器。

三个数字对应三种不同的失败：投递丢失、准备超时、机器失联。把它们混成一个超时，是这类系统最常见的错误。

## 六、后台作业：用一张表做分布式锁

除了用户任务，服务端自己还有一批周期作业：autopilot 的 cron 触发、issue wakeup 扫描、搜索索引裁剪、token 用量小时汇总、插件 hook 调度。

这些作业跑在多个 API 副本上，必须保证同一时刻只有一个副本执行同一个计划。Multica 没有引入额外的分布式锁组件，而是用 `sys_cron_executions` 表：

- 唯一键是 `(job_name, scope_kind, scope_id, plan_time)`。
- 每个副本都按同样的节奏 tick，插入或抢占同一行，只有一个能成功。
- 行里记录 `lease_token`、`stale_after`、`attempt`、`status`。
- 长任务定期 heartbeat 续租；租约过期后，另一个副本可以 steal。
- 失败按 `JobSpec.RetryBackoff` 重试，超过 `MaxAttempts` 停在 FAILED。

`JobSpec` 把策略显式化：`CatchUpMode` 决定补不补错过的计划，`CatchUpWindow` 限制补多久，`AllowStaleReentry` 决定非幂等作业能不能被抢。`PlansForScope` 甚至允许作业自己算计划时间——autopilot 的 cron 就是这样绕开固定 cadence 的。

这套设计的优点是：锁、审计、重试、补偿共用一张表，不需要额外的协调服务；缺点是所有作业共享同一张热表，清理和索引要单独设计。对中等规模的自托管部署，这是很划算的交换。

## 七、代价

- **状态机复杂**。`queued` 之外还有 `deferred`（延迟到某个时间）、`waiting_local_directory`（等用户目录锁），实际状态比初始 schema 的 6 个多。
- **回收逻辑必须幂等**。任务可能被回收多次，`start` 必须带租约校验，旧投递的 `fail` 回调不能杀掉新持有者。代码里用 `errStartClaimRejected` 专门处理这种"过期投递"。
- **可观测性成本高**。每次领取失败都有 `recordClaimDecision` 记录原因：`empty_cache_hit`、`empty_db`、`reclaimed_dispatched`、`error_promote_deferred`……不记录这些，线上只能看到"任务没跑"，看不到为什么。

## 小结

调度器真正解决的不是"怎么取任务"，而是"取不到、取重了、取空了分别怎么办"。

三条原则可以带走：**否定结果才缓存，并且带版本号**；**结果不确定时禁止重试，把决定权交回服务端**；**用不同长度的租约对应不同阶段的失败**。下一篇文章进入 daemon，看它在拿到任务之后，如何把二十多种互不兼容的 agent CLI 塞进同一套执行模型。
