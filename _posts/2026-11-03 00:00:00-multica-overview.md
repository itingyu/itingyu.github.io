---
layout: post
slug: multica-overview
title: 把 agent 当同事：Multica 的架构全貌
date: 2026-11-03 00:00:00 +0800
column: multica
series: multica-code
tags:
  - Multica
  - 架构
  - Agent
excerpt: 一个 issue 被分配给 agent 之后，究竟发生了什么？沿着这条路径，先看清 Multica 的组件边界和它做的三个取舍。
pinned: false
cover: null
draft: false
permalink: /notes/multica/multica-code/multica-overview/
---

# 把 agent 当同事：Multica 的架构全貌

如果你已经在用 Claude Code、Codex 或 Cursor，大概熟悉这种状态：每个 agent 各占一个终端标签，会话结束就失忆，换个人接手要把上下文重新讲一遍。Multica 想解决的就是这件事——把这些 agent 放进一个和人类同事共用的工作区，让它们像同事一样领 issue、报进度、交结果。

这篇文章面向后端或平台工程师，不需要用过 Multica，也不要求读过它的代码。读完之后，你应该能判断两件事：这套架构值不值得借鉴；如果要自托管或二次开发，应该从哪几个边界切入。

## 一、共同接口不是聊天，是 issue

多数 agent 产品把对话当主界面：你提问，它回答。Multica 把 issue 当主界面：你分配，它执行。

这个选择决定了后面的所有设计。issue 有状态（`backlog`、`todo`、`in_progress`、`in_review`、`done` 等）、有 assignee（`member` 或 `agent` 多态）、有评论时间线、有验收标准。agent 不是一个聊天机器人，而是一个可以被指派、被追问、被要求返工的参与者。

代码里这条边界很硬。`issue` 表初始的 `assignee_type` 只允许 `member` 或 `agent`，后来为了支持小队加了 `squad`；评论的 `author_type` 也从两种扩到 `member`、`agent`、`system`、`plugin`。但不管枚举怎么扩，"人"和"agent"始终共用同一套字段、同一张时间线。前端不用为 agent 单独做一套页面，通知、订阅、活动流也不需要第二条链路。

## 二、五个组件，三条边界

仓库是一个 pnpm monorepo 加一个 Go 服务端，实际运行时有五个角色：

**API 服务端**（`server/`）。Go 编写，Chi 路由，sqlc 生成查询，pgx 连 PostgreSQL，Redis 做缓存与跨副本中继。它同时承担三件事：面向人和 agent 的 REST API、面向 daemon 的控制面、面向浏览器的 WebSocket 推送。`cmd/server/router.go` 里注册了 479 条路由，`r.Route("/api/daemon", ...)` 这一组是 daemon 专用协议。

**Daemon**（`server/internal/daemon/`）。一个跑在用户机器上的 Go 二进制。它探测本机装了哪些 agent CLI、把每个 provider 注册成一个 runtime、领取任务、准备执行环境、拉起 CLI、解析输出、回传结果。它不调用模型 API，只负责"让已有的 CLI 在受控环境里跑起来"。

**三端界面**。Web 是 Next.js（`apps/web`），桌面是 Electron（`apps/desktop`），移动端是 Expo/React Native（`apps/mobile`）。三者共享 `packages/core` 的无头逻辑、`packages/views` 的页面组件、`packages/ui` 的基础组件。这是第三条边界：业务逻辑与平台能力分离，后面会单独用一篇讲。

**共享包**。`core` 管 API 客户端、TanStack Query hooks、Zustand store；`views` 管页面与业务组件；`ui` 只管视觉原语。依赖方向是 `views -> core + ui`，`core` 和 `ui` 互不依赖。

**外部依赖**。PostgreSQL 存业务数据，Redis 做可选的实时中继与缓存，对象存储放附件。自托管的最小拓扑就是 Postgres + backend + frontend 三个容器，`docker-compose.selfhost.yml` 里默认只绑定 `127.0.0.1`，要求前面加反向代理。

这五个角色里，真正有别于普通 SaaS 的是 daemon：它把"执行"放到了用户的机器上，服务端只做编排。

## 三、一次任务的旅程

把一条 issue 分配给 agent，到结果回到 issue 上，中间经过这些状态：

1. **入队**。`IssueService.Create` 或 assignee 变更触发 `TaskService.EnqueueTaskForIssue`，在 `agent_task_queue` 里插入一行，状态 `queued`。入队会同步失效该 runtime 的"空队列"缓存，并尝试通过 WebSocket 唤醒 daemon。
2. **领取**。daemon 调 `POST /api/daemon/tasks/claim`，服务端 `ClaimTasksForRuntimes` 在候选行上做条件更新，把状态改成 `dispatched`，同时写 `dispatched_at` 和租约。一次最多领 32 个。
3. **准备**。daemon 在 `~/multica_workspaces` 下为这个任务建独立目录，写入 issue 上下文、仓库信息、skill 文件，必要时创建 git worktree。准备时间超过 45 秒可以续租，避免被误回收。
4. **启动**。daemon 调 `POST /api/daemon/tasks/{id}/start`，服务端把状态推到 `running`。这一步是带条件的：只有仍持有该任务租约的 daemon 才能成功，旧投递会被拒绝。
5. **执行**。daemon 拉起对应 provider 的 CLI，边跑边上报进度、消息、token 用量。用户可以在界面上看到每一次工具调用；也可以在中途插话，消息会进入当前 run。
6. **收尾**。成功走 `complete`，失败走 `fail`，用户取消走 `cancel`。结果写回 `agent_task_queue.result`，同时发评论、更新 issue 状态、写活动流、推 WebSocket 事件。交付物是一段 diff、一个分支或一个 PR，仍然要人点合并。

这条链路里有两个容易忽略的设计。第一，**状态推进是服务端条件更新，不是 daemon 自报**。daemon 只能"申请"开始，不能直接宣布自己 running。第二，**租约贯穿始终**：领取有 90 秒的响应恢复窗口，准备有 45 秒的租约，心跳新鲜度是 150 秒。这些数字不是拍脑袋，后面讲调度时会拆开。

## 四、三个取舍

**不自带模型，驱动已有 CLI。** README 列了 26 种 provider：Claude Code、Codex、Cursor Agent、Copilot CLI、Kimi、Qoder、Qwen Code……Multica 不代理模型请求，也不管理 API key，它把 CLI 当成可替换的执行器。好处是切换 provider 只是下拉框，用户已有的订阅和登录态直接复用；代价是每个 CLI 的参数、输出格式、会话恢复方式都不一样，daemon 里为此写了大量 provider 适配代码。

**执行留在用户机器。** runtime 是一个具体环境：你的笔记本、一台云主机，或者桌面端自动注册的本机。代码不离开这台机器，服务端只拿任务元数据、日志和结果。这让自托管变得有意义，也让"agent 能碰到什么"这件事可以被机器边界解释，而不是靠服务端沙箱承诺。

**交付权留给人。** agent 把工作推进到 `in_review`，不会自动合并。review gate 是产品默认值，不是可选项。代码里 `issue` 状态机和 PR 自动化是分开的：可以配置自动完成，但默认路径仍然要人确认。

## 五、地形与规模

把仓库摊开，会看到这样的体量：

- Go 代码约 66.3 万行，其中测试 35.4 万行，占 53%；非测试代码 30.9 万行。
- TypeScript/TSX 约 56.6 万行，其中测试约 20.5 万行。
- 数据库迁移 632 个 `up` 文件，覆盖 585 个编号，最大编号 607；迁移历史里出现过 150 张不同的表。
- 服务端 479 条路由，`internal/handler` 下有 505 个 Go 文件。
- 最大的单文件是 `internal/daemon/daemon.go`，11137 行；`internal/service/task.go` 8427 行。

这些数字说明它不是一个周末项目，也说明它背上了相应的复杂度。后面的文章不会平均分配篇幅，而是挑那些**在别处也能用上的机制**：迁移怎么在线的做、任务怎么避免双领、prompt 怎么保住缓存、三端怎么共享业务逻辑。

## 小结

Multica 的架构可以压缩成一句话：**用 issue 作为人和 agent 的共同接口，用 daemon 把执行放回用户机器，用服务端做状态与权限的唯一事实源。**

这句话里最值得注意的是"唯一事实源"。daemon 很聪明，会探测、会自愈、会重试，但它不拥有状态；它只是不断地向服务端申请下一步。下一篇文章从数据模型开始，看看这个事实源是怎么用 632 个迁移长出来的。
