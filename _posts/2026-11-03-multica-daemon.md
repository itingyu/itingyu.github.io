---
layout: post
slug: multica-daemon
title: Daemon：CLI 探测、任务隔离与结果回收
date: 2026-11-03 09:30:00 +0800
column: multica
series: multica-code
tags:
  - Multica
  - Daemon
  - 运行时
excerpt: daemon 探测本机 agent CLI，为每个任务建立隔离目录，拉起进程并回传结果。文章说明路径漂移、目录撞车与进程失联的处理方式。
pinned: false
cover: null
draft: false
permalink: /notes/multica/multica-code/multica-daemon/
---

# Daemon：CLI 探测、任务隔离与结果回收

daemon 运行在用户机器上：探测本机安装的 agent CLI，把每个 provider 注册成 runtime，领取任务后准备隔离目录、拉起进程、解析输出并回传。

探测、隔离、工作目录、执行、连接与收尾，每一段都有自己的失败模式。

Multica 的 daemon 是一个 Go 二进制，跑在用户机器上，通过 `multica daemon start` 启动。它不调用模型 API，也不管理 API key，只做四件事：发现本机有哪些 agent CLI、把它们注册成 runtime、领取任务、在隔离环境里把 CLI 拉起来并汇报结果。

它的结构接近一个受控的 `subprocess` 执行器，难点是二十多种互不兼容的 CLI 和无法完全控制的机器。

## Runtime：机器与 provider 的组合

服务端的 `agent_runtime` 表有一行定义：

```sql
UNIQUE (workspace_id, daemon_id, provider)
```

同一个 daemon 在同一 workspace 里，每个 provider 注册一个 runtime。Claude Code 一个、Codex 一个、Cursor Agent 一个。这样任务可以精确地派给「这台机器上的这个 CLI」，而不是笼统地派给「这台机器」。

runtime 状态只有 `online` / `offline`，靠心跳维持。daemon 默认每 15 秒发一次心跳，服务端按批落库（约 60 秒一次），领取任务时会检查 `last_seen_at` 是否在 150 秒内。这三个数字的配合在调度那篇讲过，这里不重复。

注册不是一次性的。机器上装了新 CLI、版本升级、路径变化、profile 切换，daemon 都会重新探测并同步。`applyRegisterResponseInPlace` 会对比新旧 runtime 集合，新增的记下来、消失的标成 offline，而不是把整个集合删掉重建——后者会让正在跑的任务失去归属。

## 探测：路径漂移

`resolveAgentEntryWithHeal` 这个名字里的 「heal」 不是修辞。真实场景里，用户可能：

- 用 nvm / fnm 切换了 Node 版本，`claude` 的绝对路径变了；
- 用 Homebrew 升级，二进制从 `/opt/homebrew/bin` 换到了别处；
- 在 CI 镜像里，PATH 在登录 shell 和非登录 shell 下不一样；
- 手动删了又重装，inode 变了。

daemon 保存的是「上次解析到的路径 + 版本」。每次启动任务前，它会重新解析；如果解析失败或版本不符，就走自愈：重新在 PATH 里找、核对 `--version`、更新记录，并把新路径回报给服务端。

`agents_probe.go` 里为每个 provider 写了探测逻辑：可执行文件名、版本参数、输出解析。有的 CLI 版本号在 stderr，有的要加子命令，有的启动很慢需要单独的超时。这些琐碎的适配，构成了「支持 26 种 provider」的大部分工作量。

## 隔离：每任务目录与所有权

标准模式下，一个任务的执行环境长这样：

```text
~/multica_workspaces/
  <workspace-slug>-<id 尾>/
    <issue-key>-<id 尾>/
      workdir/          # agent 的工作目录
      output/           # 交付物
      logs/             # 运行日志
      multica-config/   # 任务级配置，权限 0700
```

agent 在 `workdir` 里启动，环境变量指向任务级配置。仓库不预克隆，agent 需要时自己跑 `multica repo checkout <url>`。这样做的好处是：不用的仓库不占磁盘，checkout 哪个由 agent 根据任务决定。

目录隔离的设计来自一次事故。早期版本用 task id 的 UUIDv7 前缀做路径段。UUIDv7 的时间戳高位每 65 秒左右才变一次，于是同一时段创建的两个任务，路径前缀可能相同。结果是一个任务启动时 `resetEnvRootContents` 把另一个正在运行的任务的工作目录清空了。

修复分两层：

1. 路径段改用 id 的随机尾部，让碰撞概率足够低。
2. `claimEnvRoot` 在清空目录前先原子地取得所有权：创建锁文件、校验 owner、再重置内容。注释写得很直白：

> A task that refuses to start is recoverable; one that deletes a running sibling's uncommitted work is not.

这是隔离设计的一条通用原则：**不要假设路径唯一，要证明所有权**。哈希碰撞、时间戳精度、大小写不敏感的文件系统，都会让「看起来唯一」的键失效。

## 两种工作目录

如果任务关联的是用户本地的代码目录（`local_directory` 资源），有两种执行模式。

**原地模式（LocalWorkDir）**：agent 直接在用户的目录里工作。好处是所见即所得，坏处是同一个目录同时只能跑一个任务，daemon 要拿一把按路径的互斥锁。用户没提交的改动也在，agent 可能误改。

**Worktree 模式（LocalWorktree）**：在 daemon 的 env root 里为这个任务建一个 git worktree，agent 在里面工作，结束后把改动提交成一个分支，交回用户仓库。同一目录可以并发跑多个任务。

worktree 的实现有三条明确保证，写在文件开头：

1. **agent 看到的就是用户看到的**。直接 `git worktree add` 会 checkout HEAD，把用户未提交的改动藏起来。所以它先把用户目录做一次快照（已跟踪的修改 + 未跟踪文件），再回放到 worktree 里。
2. **绝不动用户的目录**。worktree 里的一切都是可丢弃的；留在用户仓库里的只有一个分支，以及一个记录归属的隐藏 ref。
3. **不静默丢弃**。agent 结束时没提交的改动，会先提交到分支；用户自己的改动如果合并失败，下一轮会再提供一次，而不是假装已经交付。

这三条其实是同一个原则的三个面：**执行环境可以脏，但用户的仓库不能**。

## 执行与收尾

`handleTask` 拿到任务后，先做一串前置检查：runtime 是否还在、本地目录锁能否拿到、env root 是否能解析。然后进入 `runTask`：

1. 准备环境（或复用上一次的 workdir）。
2. 调 `start`，服务端确认租约后才启动。
3. 构造 prompt，拉起 provider 对应的 CLI。
4. 边跑边解析输出：工具调用、命令、错误、token 用量。
5. 监听取消信号。daemon 每 5 秒轮询一次任务状态，服务端说取消就杀进程树。
6. 收尾：把 output、分支名、session id、workdir 一起回报。

第 5 步是杀进程树。agent CLI 会 fork 子进程（测试、构建、语言服务器），只杀父进程会留下孤儿。daemon 里有专门的 `processtree` 包，按平台处理进程组；容器里还要考虑 PID 命名空间。

第 6 步保存 session id，用于续跑。同一个 issue 的下一轮任务，会带着上一轮的 session id 启动，CLI 据此恢复对话；如果 session 丢了，prompt 里会插入一段「连续性提示」，告诉 agent 它失去了什么、去哪里重新读上下文。这个设计在 prompt 那篇展开。

## 连接：唤醒与轮询

daemon 不能只靠轮询。几万台机器每 5 秒查一次库，成本不可接受。所以主路径是 WebSocket：

- daemon 建立 `/api/daemon/ws`，服务端在有新任务时发一个「可能有活」的提示。
- daemon 收到提示后，通过同一条连接发 `tasks.claim` RPC，直接把任务领回来。
- 连接断了，退化为 HTTP 轮询；重连按 1 秒到 30 秒指数退避，带 ±20% 抖动。

这条连接同时承载心跳和小型 RPC。读上限设成 64 MiB，因为一个 claim 响应最多包含 32 个完整任务，每个任务都带 issue 描述、评论、仓库和 skill 引用。早期 64 KiB 的上限会导致「服务端已提交、daemon 却读不下响应」的尴尬局面，随后被当成投递失败回收。

WS 和 HTTP 双通道也带来了双领风险。调度那篇讲过 `errWSRPCUncertain`：请求已发出但连接断了，daemon 不许回退 HTTP。这里补一个实现细节——发送帧带 `sent` / `canceled` 状态，调用方超时放弃时，如果帧还没写进 socket，就取消它；一旦写进去了，就不能再假装没发。这个原子状态机是为了避免「Backpressure 队列里排着一个过期的 claim，重连后又被发出去」。

## 崩溃恢复：结果落盘

daemon 可能被 kill -9、断电、系统休眠。任务结果不能只存在内存里。

`terminal_report_queue` 是一个落盘的待上报队列：任务完成或失败时，先把结果写进 `~/.multica/.../pending-terminal-reports`，再尝试上报；上报失败就留在队列里，下次启动重试。这样即使服务端短暂不可用，结果也不会丢。

服务端侧有对应的 `RecoverOrphanedTasks`：daemon 重启后，可以查询「这个 runtime 上还有哪些 dispatched/running 但没有对应执行记录」的任务，把它们回收或标记失败。

磁盘侧还有 GC。`~/.multica_workspaces` 下的任务目录，完成后默认保留一段时间供排查；超过 `GCOrphanTTL`（默认 72 小时）且没有 `.gc_meta.json` 的目录，会被当成孤儿清理。GC 和正在运行的任务之间用引用计数保护：任务启动时 `markActiveEnvRoot`，结束时 `unmark`，GC 不会碰有活跃引用的目录。

## 代价

- **平台适配是长尾**。二十多种 CLI，每种都有自己的参数、输出格式、会话恢复方式、退出码语义。代码里为此散落着大量 provider 分支，`execenv` 一个包就有五万多行。
- **单文件过大**。`daemon.go` 11137 行，`handleTask` 一个函数就近千行。注释密度很高，但改动时仍然需要很强的上下文。
- **本地环境不可控**。用户的 shell、PATH、权限、磁盘空间、杀毒软件，都会变成支持工单。daemon 能做的是快速失败、留下清晰日志，而不是假装自己能修复一切。

## 限制

二十多种 CLI 的参数与输出差异、本地环境的不可控，是 daemon 无法消除的两类问题。它的处理方式是快速失败、留下日志、结果先落盘。
