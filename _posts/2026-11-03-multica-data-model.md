---
layout: post
slug: multica-data-model
title: 632 个迁移：数据模型如何长大
date: 2026-11-03 09:10:00 +0800
column: multica
series: multica-code
tags:
  - Multica
  - PostgreSQL
  - 数据建模
excerpt: 从 13 张表的初始 schema 到 150 张表、632 个迁移，Multica 的数据库演进里有三条硬规则：外键退场、索引并发建、状态先分类再扩展。
pinned: false
cover: null
draft: false
permalink: /notes/multica/multica-code/multica-data-model/
---

# 632 个迁移：数据模型如何长大

这篇写给维护过生产库 schema 的后端工程师。你不需要读过 Multica，但最好熟悉 PostgreSQL 的 DDL、锁和索引。读完可以判断一件事：当业务从"一个想法"长到"几十个模块"时，哪些 schema 规则值得提前定死。

先看数字：仓库里有 632 个 `.up.sql` 迁移文件，覆盖 585 个不同编号，最大编号 607；当前 schema 里出现过 150 张不同的表。而第一天，只有 13 张表。

## 一、起点：一个朴素得近乎教科书的设计

`001_init.up.sql` 只有 177 行，模型非常直白：

```sql
CREATE TABLE issue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    assignee_type TEXT CHECK (assignee_type IN ('member', 'agent')),
    assignee_id UUID,
    status TEXT NOT NULL DEFAULT 'backlog'
        CHECK (status IN ('backlog','todo','in_progress','in_review','done','blocked','cancelled')),
    ...
);

CREATE TABLE agent_task_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    issue_id UUID NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','dispatched','running','completed','failed','cancelled')),
    dispatched_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    result JSONB,
    ...
);
```

13 张表：`user`、`workspace`、`member`、`agent`、`issue`、`issue_label`、`issue_to_label`、`issue_dependency`、`comment`、`inbox_item`、`agent_task_queue`、`daemon_connection`、`activity_log`。

有意思的是，这个初始模型已经包含了后来所有设计的种子：assignee 是 `(type, id)` 多态、任务队列用状态加时间戳、结果放 JSONB。后面 600 多个迁移，大多是围绕这些种子长出来的枝干，而不是推翻重来。

比如 `004_agent_runtime_loop.up.sql` 引入了 `agent_runtime`：一个 daemon 可以承载多个 provider，每个 provider 一个 runtime，运行时因此成为比"连接"更稳定的实体。迁移里顺手把旧 `agent.runtime_config` 的数据回填进新表，但 `daemon_connection` 没有被删——它作为早期表留在 schema 里，只在删除 workspace 时被一并清理。这是典型的渐进式改造：新表先建、数据回填、代码切换、旧表保留。

## 二、表为什么会长到 150 张

功能扩张是最直接的原因。除了 issue 和 task，后来长出了：

- 协作：`squad`、`squad_member`、`agent_invocation_target`
- 自动化：`autopilot`、`autopilot_trigger`、`issue_wakeup`
- 集成：`github_pull_request`、`channel_*`、`plugin_*`
- 组织：`workspace_share_link`、`member_delegation_day`、`seat_capacity`
- 可观测：`task_usage_hourly`、`activity_log`、`search_index_change`

一个值得注意的模式是**拆表而不是加列**。比如 issue 的自定义状态没有塞进 `issue.status` 的枚举，而是单独建 `issue_status` 目录表；权限没有塞进 `member` 的 JSONB，而是建 `agent_invocation_target`。代价是 join 变多，收益是约束和索引能落在正确的粒度上。

这也解释了为什么迁移数量远大于表数量：大量迁移是在已有表上补索引、补约束、补回填，或者清理历史遗留。

## 三、第一条硬规则：外键退场

`AGENTS.md` 里有一条很显眼的规则：

> Do not add foreign keys, cascading deletes, or cascading updates. Validate relationships and clean up dependents in application code, using a transaction when the operation must be atomic.

不是"不建议"，是"不要"。这条规则不是一开始就有的，而是被生产事故推出来的。

`118_agent_task_queue_initiator_user_id_drop_fk.up.sql` 的注释写得很清楚：

> The FK to the hot "user" table is what made 117 time out on a busy deploy, and the column only feeds a best-effort name/email lookup at claim time, so the constraint is not needed.

翻译一下：`agent_task_queue` 是热表，`user` 也是热表，给前者加一个指向后者外键，会在部署时锁住两张表，直接超时。而这个字段只用于领取任务时查一下发起人姓名，属于"有最好、没有也能跑"的信息。

后续还有 `173_remove_resource_label_foreign_keys.up.sql` 和 `193_issue_property_drop_workspace_fk.up.sql`，都是同一类清理：把早期版本建过的外键删掉，统一交给应用层。

这个选择的代价很实在：**数据库不再保证引用完整性**。删一个 workspace，得由应用按已知的依赖顺序清理；漏掉一处，就会留下孤儿行。代码里的对策是把清理逻辑集中到少数几个入口，比如 `deleteWorkspaceTasks` 明确列出所有需要处理的表，并在注释里写清楚为什么 `agent_task_queue` 没有 `workspace_id`、必须绕道 `agent_id` 和 `runtime_id` 删除。

对读者的启示不是"外键没用"，而是：**外键的成本和表的写入热度成正比**。在一个高频写入的队列表上，级联约束带来的锁竞争，往往比它省下的清理代码更贵。

## 四、第二条硬规则：索引必须并发建

PostgreSQL 的 `CREATE INDEX` 默认会锁写。表一大，这条语句就是一次小型停机。Multica 的做法是把"建索引"拆成三个迁移：

```sql
-- 332: 建表，不内联主键
CREATE TABLE issue_status (...);

-- 333: 单独一个文件，单条语句，CONCURRENTLY
CREATE UNIQUE INDEX CONCURRENTLY issue_status_pkey_uidx
    ON issue_status (id);

-- 334: 把索引挂成主键
ALTER TABLE issue_status
    ADD CONSTRAINT issue_status_pkey PRIMARY KEY USING INDEX issue_status_pkey_uidx;
```

`332` 的注释解释了为什么不在 `CREATE TABLE` 里写 `PRIMARY KEY`：内联主键会隐式建索引，拿不到 `CONCURRENTLY`；拆开之后，索引可以在不阻塞写入的情况下建完，再挂约束。

仓库里 632 个 `up` 迁移中，有 268 个包含 `CONCURRENTLY`。这不是风格偏好，是上线纪律：迁移在服务启动时跑，启动探针只给十分钟，任何一次全表扫描式的 DDL 都可能把部署拖死。

`cmd/migrate/README.md` 甚至为一个大表索引写了专门的操作手册：先手工 `CREATE INDEX CONCURRENTLY` 预热，确认 `indisvalid`、`indisready`、`indislive` 都为真，再让迁移变成一个快速 no-op；如果并行建到一半失败，留下 invalid 索引，要先并发 drop 再重试。迁移执行器也内置了 invalid index 清理。

## 五、状态机：先分类，再扩展

issue 状态是最能看出克制的地方。

产品需要自定义状态（每个团队的工作流不一样），但平台行为又依赖固定语义（哪些算"未开始"、哪些算"已开始"、哪些算"完成"）。直接放开字符串，所有 `WHERE status = 'todo'` 都会失效；直接锁死枚举，又无法满足自定义。

最终模型是：**7 个内置状态映射到 4 个生命周期类别**，自定义状态只继承类别，不继承具体行为。

```text
unstarted: backlog, todo
started:   in_progress, in_review, blocked
done:      done
closed:    cancelled
```

`332_issue_status.up.sql` 的注释说得很直白：自定义状态"names a category and inherits that canonical's platform behavior wholesale"，不存在"只继承一半行为"的中间态。`issue.status` 仍然是权威的 TEXT 列，存的是目录里的 key，所以历史查询一行都不用改，也不需要双写。

迁移本身也体现了在线变更的克制。`492_issue_status_category_contract.up.sql` 先设锁超时：

```sql
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

ALTER TABLE issue_status
    ADD CONSTRAINT issue_status_category_check
    CHECK (category IN ('unstarted','started','done','closed')) NOT VALID;
```

`NOT VALID` 让加约束只改元数据、不扫表；下一个迁移再 `VALIDATE CONSTRAINT`，这时只拿较弱的锁。锁超时 2 秒则保证：一旦拿不到锁，迁移快速失败，而不是把整个启动流程挂住。

## 六、迁移文件本身就是文档

读这个仓库的迁移，会发现注释密度高得不像 SQL：每条都写"为什么"，还带 issue 编号。

- `118`：外键让 117 在繁忙部署中超时（MUL-2645）
- `469`：状态分类合并，明确"迁移不得触发 agent run"（MUL-7240）
- `492`：所有写入方必须已经发出生命周期类别，因此可以加约束

这种写法解决了一个常见问题：半年后没人记得某个字段为什么存在。代码可以重构，迁移不能改；把决策写进迁移，等于把"当时的约束"永久存档。

## 七、代价与适用边界

这套做法不是免费的：

- **迁移数量膨胀**。632 个文件里，很多只是加一个索引。好处是每一步都可回滚、可审计；坏处是新人要读很久才能拼出全貌。
- **应用层要补数据库的课**。没有外键，就得自己保证清理顺序；没有级联，就得自己写事务。
- **迁移器要自己造**。`cmd/migrate` 是一个上千行的自研 runner，支持条件迁移、pre-hook、并发索引重试、invalid index 清理。用现成工具（如 golang-migrate）也能跑，但这些边界得另外补。

如果团队规模小、表不多、写入量低，外键和普通 `CREATE INDEX` 完全够用，不必照搬。真正值得提前定死的是两条：**热表上的约束要算锁成本；大表上的 DDL 要能在不阻塞写入的前提下执行**。这两条越晚补，代价越高。

## 小结

Multica 的数据模型不是一次设计出来的，而是 632 次小步修改的结果。能这样长而不乱，靠的不是预言未来，而是三条可执行的规则：外键让位于写入热度，索引让位于在线可用性，状态扩展让位于固定语义。

下一篇进入运行时，看这些表里的一行 `agent_task_queue` 是怎么被 daemon 抢走的——以及为了不丢、不重、不空转，调度器在 SQL 和 Redis 之间做了哪些取舍。
