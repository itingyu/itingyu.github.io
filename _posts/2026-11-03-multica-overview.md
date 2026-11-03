---
layout: post
slug: multica-overview
title: Multica 架构：issue 接口、daemon 执行与状态归属
date: 2026-11-03 09:00:00 +0800
column: multica
series: multica-code
tags:
  - Multica
  - 架构
  - Agent
excerpt: Multica 以 issue 为人和 agent 的共同接口，daemon 在用户机器上执行任务，服务端持有状态与权限。文章覆盖组件边界、任务生命周期与设计取舍。
pinned: false
cover: null
draft: false
permalink: /notes/multica/multica-code/multica-overview/
---

# Multica 架构：issue 接口、daemon 执行与状态归属

Multica 把 issue 作为人和 agent 的共同接口：任务被分配、执行、验收，状态由服务端统一持有，daemon 只负责在用户机器上执行。

范围是组件边界、任务生命周期和三个取舍，不涉及部署与容量数据。

## 共同接口：issue

多数 agent 产品把对话当主界面，用户提问、产品回答。Multica 把 issue 当主界面：分配任务，agent 执行。

这个选择决定了后面的所有设计。issue 有状态（`backlog`、`todo`、`in_progress`、`in_review`、`done` 等）、有 assignee（`member` 或 `agent` 多态）、有评论时间线、有验收标准。agent 不是一个聊天机器人，而是一个可以被指派、被追问、被要求返工的参与者。

代码里这条边界是显式的。`issue` 表初始的 `assignee_type` 只允许 `member` 或 `agent`，后来为了支持小队加了 `squad`；评论的 `author_type` 也从两种扩到 `member`、`agent`、`system`、`plugin`。但不管枚举怎么扩，「人」和「agent」始终共用同一套字段、同一张时间线。前端不用为 agent 单独做一套页面，通知、订阅、活动流也不需要第二条链路。

## 五个组件，三条边界

仓库是一个 pnpm monorepo 加一个 Go 服务端，实际运行时有五个角色：

**API 服务端**（`server/`）。Go 编写，Chi 路由，sqlc 生成查询，pgx 连 PostgreSQL，Redis 做缓存与跨副本中继。它同时承担三件事：面向人和 agent 的 REST API、面向 daemon 的控制面、面向浏览器的 WebSocket 推送。`cmd/server/router.go` 里注册了 479 条路由，`r.Route("/api/daemon", ...)` 这一组是 daemon 专用协议。

**Daemon**（`server/internal/daemon/`）。一个跑在用户机器上的 Go 二进制。它探测本机装了哪些 agent CLI、把每个 provider 注册成一个 runtime、领取任务、准备执行环境、拉起 CLI、解析输出、回传结果。它不调用模型 API，只负责「让已有的 CLI 在受控环境里跑起来」。

**三端界面**。Web 是 Next.js（`apps/web`），桌面是 Electron（`apps/desktop`），移动端是 Expo/React Native（`apps/mobile`）。三者共享 `packages/core` 的无头逻辑、`packages/views` 的页面组件、`packages/ui` 的基础组件。这是第三条边界：业务逻辑与平台能力分离，后面会单独用一篇讲。

**共享包**。`core` 管 API 客户端、TanStack Query hooks、Zustand store；`views` 管页面与业务组件；`ui` 只管视觉原语。依赖方向是 `views -> core + ui`，`core` 和 `ui` 互不依赖。

**外部依赖**。PostgreSQL 存业务数据，Redis 做可选的实时中继与缓存，对象存储放附件。自托管的最小拓扑就是 Postgres + backend + frontend 三个容器，`docker-compose.selfhost.yml` 里默认只绑定 `127.0.0.1`，要求前面加反向代理。

这五个角色里，daemon 是其中唯一把执行放在用户机器上的组件：它把「执行」放到了用户的机器上，服务端只做编排。

## 一次任务的生命周期

把一条 issue 分配给 agent，到结果回到 issue 上，中间经过这些状态：

1. **入队**。`IssueService.Create` 或 assignee 变更触发 `TaskService.EnqueueTaskForIssue`，在 `agent_task_queue` 里插入一行，状态 `queued`。入队会同步失效该 runtime 的「空队列」缓存，并尝试通过 WebSocket 唤醒 daemon。
2. **领取**。daemon 调 `POST /api/daemon/tasks/claim`，服务端 `ClaimTasksForRuntimes` 在候选行上做条件更新，把状态改成 `dispatched`，同时写 `dispatched_at` 和租约。一次最多领 32 个。
3. **准备**。daemon 在 `~/multica_workspaces` 下为这个任务建独立目录，写入 issue 上下文、仓库信息、skill 文件，必要时创建 git worktree。准备时间超过 45 秒可以续租，避免被误回收。
4. **启动**。daemon 调 `POST /api/daemon/tasks/{id}/start`，服务端把状态推到 `running`。这一步是带条件的：只有仍持有该任务租约的 daemon 才能成功，旧投递会被拒绝。
5. **执行**。daemon 拉起对应 provider 的 CLI，边跑边上报进度、消息、token 用量。用户可以在界面上看到每一次工具调用；也可以在中途插话，消息会进入当前 run。
6. **收尾**。成功走 `complete`，失败走 `fail`，用户取消走 `cancel`。结果写回 `agent_task_queue.result`，同时发评论、更新 issue 状态、写活动流、推 WebSocket 事件。交付物是一段 diff、一个分支或一个 PR，仍然要人点合并。

这条链路里有两个容易忽略的设计。第一，**状态推进是服务端条件更新，不是 daemon 自报**。daemon 只能「申请」开始，不能直接宣布自己 running。第二，**租约贯穿始终**：领取有 90 秒的响应恢复窗口，准备有 45 秒的租约，心跳新鲜度是 150 秒。这些数字的统计口径见文末。

## 设计取舍

**不自带模型，驱动已有 CLI。** README 列了 26 种 provider：Claude Code、Codex、Cursor Agent、Copilot CLI、Kimi、Qoder、Qwen Code……Multica 不代理模型请求，也不管理 API key，它把 CLI 当成可替换的执行器。好处是切换 provider 只是下拉框，用户已有的订阅和登录态直接复用；代价是每个 CLI 的参数、输出格式、会话恢复方式都不一样，daemon 里为此写了大量 provider 适配代码。

**执行留在用户机器。** runtime 是一个具体环境：用户的笔记本、一台云主机，或者桌面端自动注册的本机。代码不离开这台机器，服务端只拿任务元数据、日志和结果。这让自托管变得有意义，也让「agent 能碰到什么」这件事可以被机器边界解释，而不是靠服务端沙箱承诺。

**交付权留给人。** agent 把工作推进到 `in_review`，不会自动合并。review gate 是产品默认值，不是可选项。代码里 `issue` 状态机和 PR 自动化是分开的：可以配置自动完成，但默认路径仍然要人确认。

## 代码规模

把仓库摊开，会看到这样的体量：

- Go 代码 88.2 万行，其中测试 49.1 万行，占 55.7%；非测试代码 39.0 万行。
- TypeScript/TSX 约 56.6 万行，其中测试约 20.5 万行。
- 数据库迁移 632 个 `up` 文件，覆盖 585 个编号，最大编号 607；迁移历史里出现过 150 张不同的表。
- 服务端 479 条路由，`internal/handler` 下有 505 个 Go 文件。
- 最大的单文件是 `internal/daemon/daemon.go`，11137 行；`internal/service/task.go` 8427 行。

这些数字说明它不是一个周末项目，也说明它背上了相应的复杂度。后面的文章不会平均分配篇幅，而是挑那些**在别处也能用上的机制**：迁移怎么在线的做、任务怎么避免双领、prompt 怎么保住缓存、三端怎么共享业务逻辑。

## 边界

issue 是共同接口，执行在用户机器上，状态与权限只由服务端持有。daemon 不拥有状态，每一步都要向服务端申请。并发扩容与多区域部署不在讨论范围内。
