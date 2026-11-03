---
layout: post
slug: multica-realtime
title: WebSocket 推送：作用域、鉴权与多副本广播
date: 2026-11-03 09:50:00 +0800
column: multica
series: multica-code
tags:
  - Multica
  - WebSocket
  - 实时系统
excerpt: 实时推送需要处理连接鉴权、作用域路由与多副本广播。文章说明七个作用域、权限校验位置、Redis Stream 中继与去重表。
pinned: false
cover: null
draft: false
permalink: /notes/multica/multica-code/multica-realtime/
---

# WebSocket 推送：作用域、鉴权与多副本广播

实时推送分三层：连接鉴权、作用域路由、跨副本广播。Multica 定义了七个作用域，用 `workspace_member` 处理跨工作区的成员事件，用 Redis Stream 在每个作用域上做多副本中继。

七个作用域、投递前的权限校验、一条按作用域切分的 Redis Stream，是这套实现的三个部件。

Multica 的界面几乎每个面板都依赖实时事件：issue 看板要显示 agent 正在处理哪一条，任务详情要滚出每一次工具调用，收件箱要弹出「需要你决定」，成员被移出工作区要立刻断开。这些事件如果都靠轮询，成本和延迟都不可接受。

## 三个层次的实时

不是所有事件都同等紧急。系统里大致分三层：

**状态级**：issue 状态变了、任务进入 running、agent 上线。前端收到后更新看板的一格。

**流式级**：agent 正在执行的工具调用、命令输出、进度百分比。频率高，只在任务详情页需要。

**信号级**：收件箱新条目、成员被移除、daemon 被唤醒。数据很小，但必须准确送达特定对象。

三层的共同点是「服务端主动推」，不同点是扇出范围。把它们都塞进「广播给整个 workspace」，会让一台机器上的所有浏览器都收到无关的任务日志。所以第一件事是把「房间」划细。

## 连接鉴权

WebSocket 端点挂在 `/ws`。握手阶段做几件事：

1. 从 cookie 或 `Authorization` 头解析 JWT / PAT；
2. 校验 `Origin`，只允许配置过的前端域名；
3. 查 `X-Workspace-ID`（或 slug）对应的成员关系；
4. 把连接注册进 hub，自动加入 `workspace:{id}`、`user:{id}`、`workspace_member:{ws}:{user}` 三个房间。

成员关系不是握手时查一次就完事。`DisconnectMember` 是提交后的信号，但它明确写着「post-commit signal, not an authorization cache」：收到信号后要重新查当前成员关系，避免一个延迟到达的移除信号把刚重新加入的成员踢掉。

每条连接加入房间时都要过权限：`workspace` 和 `user` 是隐式的，只允许订阅与连接身份一致的那个 id；`task` 和 `chat` 必须显式订阅，并经过一次资源归属校验——这个 task 属不属于当前 workspace，这个 chat 是不是当前用户创建的。正结果可以缓存，避免热路径打库。

这套设计的顺序是：**先建立最小身份，再按需申请更细的可见性**。连接一开始只能看 workspace 级事件；要看某个 task 的日志，得显式订阅并证明自己有权看。成员关系的变化则由独立的移除信号处理，不依赖连接时的快照。

## 七个作用域

`internal/realtime/broadcaster.go` 里定义了七种作用域：

```go
ScopeWorkspace      = "workspace"
ScopeUser           = "user"
ScopeTask           = "task"
ScopeChat           = "chat"
ScopeWorkspaceMember = "workspace_member"
ScopeDaemonRuntime  = "daemon_runtime"
ScopeWecomOutbound  = "wecom_outbound"
```

前四个是给浏览器客户端的。`workspace_member` 是一个很细的设计：它表示「某个用户在这个 workspace 下的连接」。为什么不用 `user`？

因为同一个用户可以同时在多个 workspace 里。`user:{id}` 房间里的连接可能属于 A 工作区，也可能属于 B 工作区。一条只该给 A 工作区看的私有事件（比如这个人在 A 的个人视图偏好），如果发到 `user`，会同时出现在 B 的界面上。

`workspace_member` 的每条连接在写入前都会按该 workspace 重新授权，所以一旦成员被移出，投递立刻停止，哪怕他还连着别的 workspace。注释里说得很清楚：这个房间只在连接时加入，客户端不能自行订阅。

## 投递前的权限校验

聊天是最典型的私有资源。`chat_session` 是创建者私有的，事件里带 `ChatSessionOwnerID`。投递层的规则是：

- 有 owner：只发给这个用户在该 workspace 的连接；
- owner 为空：直接丢弃，**不回退到 workspace 广播**。

第二条是重点。很多系统在「找不到具体收件人」时会退化成广播，结果把私有内容泄漏给整个团队。这里选择丢弃：宁可少一条通知，也不能多一个读者。

成员移除也走类似的路径。`member:removed` 事件不是广播给所有人，而是只发给被移除者的连接；发送前重新确认成员关系，避免误踢。移除后还要清理该用户在这个 workspace 的所有房间订阅，否则后续事件还会往一个已经不该收的连接里写。

## 多副本：每个作用域一条 Redis Stream

单机 Hub 只能把消息发给连在自己进程上的客户端。生产环境有多个 API 副本，用户在 A 副本，事件在 B 副本产生，必须跨进程转发。

Multica 的实现是「按作用域分片的 Redis Stream」：

- 每个 `(scopeType, scopeID)` 对应一个 stream：`ws:scope:{type}:{id}:stream`。
- 只有当本节点第一次出现该作用域的订阅者时，才启动一个 `XREADGROUP` 循环；最后一个订阅者离开，循环停止。
- 节点在 `ws:node:{id}:heartbeat` 里维持心跳，TTL 90 秒，30 秒刷新一次。
- 消息带 `event_id`（ULID），消费组按节点分片，读到的消息再交给本地 Hub 扇出。
- 流有保留窗口，重连的节点可以补一段最近的事件。

「按需订阅」决定了连接数量。一个 workspace 可能有几百个 task，但用户只看其中一个；如果每个节点都订阅所有 scope 的 stream，Redis 连接数和内存都会被吃光。按本地订阅者数量启停，把成本压到与实际活跃度成正比。

`REALTIME_RELAY_MODE` 支持 `sharded`、`dual`、`legacy` 三种模式，说明这套机制是渐进迁移过来的：先双写观察，再切主路径，保留回退。

## 双写去重：每个连接记 128 个 id

本地快路径和 Redis 回放可能把同一条事件送到同一个客户端两次：一次是本节点直接扇出，一次是从 stream 读回来。如果不处理，界面会出现重复消息、重复通知。

Hub 给每个 `Client` 维护一个 128 条的环形去重表：

```go
const dedupCapacity = 128

func (c *Client) markSeen(eventID string) bool {
    // 已见过 -> false（丢弃）；第一次 -> true（投递）
}
```

128 不算大，但足够覆盖「本地快路径 + 回放」的时间窗。事件 id 是 ULID，单调递增，不需要布隆过滤器那种概率结构。

另一个细节是慢客户端。扇出时如果某个客户端的发送缓冲满了，Hub 不会阻塞整个房间，而是把它踢掉：

```go
if len(slow) > 0 {
    h.evictSlow(slow)
}
```

被踢的客户端会重连，重连后重新订阅并拉快照。这是「保护多数人」的选择：一个卡住的浏览器不应该拖慢整个 workspace 的实时性。

## 跨副本的定向路由

有些事件不是「广播给一群人」，而是「必须由某一台机器处理」。

**daemon 唤醒**：任务入队后，服务端要把「可能有活」的提示发给持有该 runtime 的 daemon 连接。这个连接可能在任何副本上。于是事件走 `daemon_runtime:{runtimeID}` 这个作用域，通过 Redis relay 找到持有连接的那个节点。

**企微回复**：企业微信的 outbound 没有 REST 路径，回复只能从持有 aibot WebSocket 的进程发出。而 `chat:done` 事件由处理 daemon 回调的那个副本发布，是负载均衡决定的。两者可能不在同一台机器上。`ScopeWecomOutbound` 用 installation id 做 scope，把回复路由到持有 socket 的副本。

注释里记了两个事故编号（GH #7215、#6890）：早期没有这条路由，off-lease 的回复会被直接丢弃，只有在单副本部署下才正常。这类问题只在多副本环境出现，单机开发不复现。

## 代价

- **两套投递路径**。本地扇出快，但要和 Redis 回放去重；Redis 路径能跨副本，但多一次序列化和网络往返。
- **权限校验散在多个点**。握手校验一次、订阅校验一次、写入前再校验一次。任何一处漏掉，都可能把私有事件发给不该看的人。
- **调试困难**。一条事件没到，可能是发布端没发、relay 没订阅、消费组没 ack、客户端被踢、去重表误判。指标里必须分别计数，否则只能靠猜。

## 排障

两套投递路径、分散在三处的权限校验、128 条去重表，换来了跨副本的实时性，也拉长了排障链路：一条事件没到，可能是发布、订阅、消费、客户端或去重中的任意一环。
