---
layout: post
slug: multica-engineering
title: 53% 的代码是测试：这个仓库的工程纪律
date: 2026-11-03 00:00:00 +0800
column: multica
series: multica-code
tags:
  - Multica
  - 工程实践
  - 测试
excerpt: 66 万行 Go、56 万行 TypeScript、632 个迁移，靠什么不塌？答案不在某个框架，而在几条被写进仓库、能被 CI 执行的规矩。
pinned: false
cover: null
draft: false
permalink: /notes/multica/multica-code/multica-engineering/
---

# 53% 的代码是测试：这个仓库的工程纪律

这篇写给 tech lead、平台工程师，或者任何一个要维护"会长期长大的代码库"的人。你不需要读过 Multica 的业务，但最好在意测试、迁移和代码边界。读完可以挑几条，带回自己的仓库试。

先摊开数字：

| 指标 | 数量 |
|:--|:--|
| Go 代码 | 66.3 万行 |
| 其中测试 | 35.4 万行（53%） |
| TypeScript/TSX | 56.6 万行 |
| 其中测试 | 20.5 万行 |
| Go 测试文件 | 1065 个 |
| TS 测试文件 | 905 个 |
| 数据库迁移 | 632 个 `up` 文件 |
| 迁移历史中出现过的表 | 150 张 |
| HTTP 路由 | 479 条 |

这些数字不能证明代码好，但能说明一件事：这个项目的维护成本被认真对待过。下面拆五条具体做法。

## 一、测试不是附录，是主要代码

超过一半的 Go 代码是测试。这不是"测试覆盖率崇拜"，而是几种具体组织方式的结果。

**表驱动是默认写法。** 一个函数的行为边界、错误分支、并发交错，通常用一个 `[]struct{name, input, want}` 覆盖。读测试的人能一眼看到所有情况，而不是在十几个 `TestXxx` 函数之间跳。

**集成测试和单元测试分开。** 需要 Postgres 的测试用 `DATABASE_URL` 判断，没有就 `t.Skip`。CI 里起服务容器跑全套；本地开发只跑不需要外部依赖的部分。`cmd/migrate` 里甚至有专门的迁移测试，在临时表上重放历史迁移，验证约束行为。

**真实 agent CLI 的测试单独打标签。** `agentintegration` 标签下的测试会真的拉起 Claude Code、Codex 这些 CLI。CI 不跑它们（没有登录态、太慢），但会跑 `go vet -tags agentintegration ./...` 来保证它们至少能编译。注释里解释了为什么：不编译的话，一次普通重命名就能让这些测试悄悄腐烂，而所有未打标签的 job 仍然全绿。

这条很值得抄：**不能执行的测试，至少要被类型检查覆盖**。否则它们不是测试，是注释。

**前端测试按包分片。** `packages/views` 的测试在 CI 里拆成两个 runner 并行跑，用 `--shard=1/2` 和 `--shard=2/2`。测试多到单机跑不完时，分片比优化单个测试更直接。

## 二、迁移也要有 lint

632 个迁移文件，靠人 review 不现实。仓库里有一组针对迁移本身的测试：

```go
func TestMigrationNumericPrefixesAreUnique(t *testing.T) {
    // 从 129 号开始，编号必须唯一
}

func TestMigrationFilesHaveMatchingDirections(t *testing.T) {
    // 每个 .up.sql 必须有对应的 .down.sql
}
```

第一条规则有个历史豁免：128 号之前的迁移存在重复编号，从 129 开始才要求唯一。这种"承认历史、冻结存量、约束增量"的做法，比一次性清理所有历史迁移现实得多。

第二条规则保证可回滚。不是所有团队都要求 down migration，但一旦要求，就必须机器检查，否则总会有人只写 up。

迁移执行器本身也有防护：条件迁移即使跳过也会记进 `schema_migrations`；并发索引失败会留下 invalid 索引，runner 会检测并清理；`cmd/migrate/README.md` 为每个大表索引写了手工预热和验证步骤。这些都不是"框架自带"，是踩过坑之后补的。

## 三、把边界写成合同

`AGENTS.md` 是一份给 AI coding agent 看的仓库说明，但它的价值不止于此。它实际上是一份**可执行的架构合同**：

- **包边界**：`core` 不许碰 UI 库和 `localStorage`；`ui` 不许 import `core`；`views` 不许定义 store；`apps/web` 才能用 `next/*`。
- **状态规则**：TanStack Query 管服务端数据，Zustand 管客户端状态；只有 auth/workspace store 可以直接调 `api.*`。
- **API 兼容**：UI 消费的 JSON 必须过 zod schema 和 `parseWithFallback`，不许 `as T` 强转；新增字段要有默认值。
- **数据库规则**：不加外键和级联；每个迁移索引单独一个文件、必须 `CONCURRENTLY`。
- **UUID 规则**：handler 里区分"UUID 或人类可读 ID"、"纯 UUID 输入"、"可信内部 round-trip"，分别用不同的解析函数。

这份文档的好处是：**规则和代码在同一个仓库，改代码时会被看到**。它不需要背下来，review 时对照即可。坏处是它必须持续维护，否则会变成过时教条。仓库的做法是把"为什么"写进注释，把"做什么"写进 AGENTS.md，两者互相引用。

## 四、注释解释"为什么"，而且带证据

这个仓库的注释密度高得罕见，但大多数不是"这个函数做什么"，而是"为什么必须这样"。

几个例子：

- `claimResponseRecoveryWindow` 的注释：必须大于 daemon 的 30 秒 HTTP 超时加 30 秒 start 超时，再留调度余量；更长的准备由 45 秒的 prepare lease 保护。
- `RuntimeClaimFreshnessSeconds` 的注释：150 秒 = 60 秒数据库心跳 + 15 秒 daemon 心跳 + 30 秒调度 tick，再留 45 秒缓冲。
- `EmptyClaimCache` 的注释：用版本号关闭"慢 claim 在入队之后写入空结果"的竞态，并画了一个 T1/T2/T3 的时序图。
- env root 的注释：早期用 UUIDv7 前缀做路径，会擦掉同目录活任务的工作区（#7326），现在改用随机尾并证明所有权。

这些注释的共同点是：**给出数字的推导过程，或给出事故编号**。读者不需要相信作者的权威，可以自己验算。半年后有人想改这个常量，会先看到改动的代价。

这是对"注释会过期"的一种回应：不写"做了什么"（代码已经写了），写"为什么"和"什么时候可以改"。

## 五、工具补工具的盲区

仓库用 knip 查死代码和幽灵依赖。但 knip 有一个结构性盲区：`packages/ui` 的 `package.json` 用了四个通配导出：

```json
"./components/ui/*": "./components/ui/*.tsx",
"./components/common/*": "./components/common/*.tsx",
"./markdown/*": "./markdown/*.tsx",
"./hooks/*": "./hooks/*.ts"
```

每个通配符都把目录下所有文件注册成入口，于是 knip 永远看不到"这个组件没人用"。之前清理掉的 16 个死组件，正好住在这个盲区里。

仓库的解法是写一个专门的脚本 `check-ui-wildcard-exports.mjs`，解析真实 import 关系，按导入文件所在目录解析 specifier，而不是按 basename 匹配。注释里还记了一个细节：59 个受检文件里有 17 个和别的文件重名（`button`、`card`、`input`……），按文件名匹配会漏报。

这件事的意义不在脚本本身，而在态度：**当标准工具看不见你的问题时，补一个能看见的检查，并把它接进 CI**。同类检查还有 `check-ui-radius-tokens.mjs`（只允许设计 token 里的圆角值）和一个 bash 测试来保证脚本自己没坏。

## 六、CI 按路径裁剪，按耗时拆分

CI 不是"所有 job 每次都跑"。`scripts/ci-scope.mjs` 先判断改动落在前端、后端还是文档，再决定跑哪些 job：

- 只改 `apps/mobile`，不跑 Web/Desktop 的 typecheck；
- 只改文档，跳过 Go 测试；
- 后端改动才起 Postgres 服务容器。

耗时大的部分单独拆：

- `packages/views` 的测试分两个 runner；
- `pkg/agent` 从 `backend-tests` 里拆出来，单独一个 runner，因为它的子进程测试对计时敏感，和 race build 抢 CPU 会超时；
- Go build cache 只保留本次 run 的条目，避免缓存无限膨胀。

这些优化不改变代码质量，但决定了"改一行要等多久"。一个 66 万行的仓库，如果 CI 要跑 40 分钟，再好的纪律也会被绕过。

## 七、代价

这套纪律不是白来的：

- **单文件仍然巨大**。`daemon.go` 11137 行、`task.go` 8427 行。测试和注释缓解了理解成本，但没有消除它。新功能还在往这些文件里加。
- **迁移数量成为负担**。632 个文件，新人要读很久才能拼出 schema 全貌。仓库用 `sqlc` 生成类型、用迁移测试兜底，但没有一份"当前 schema 总览"。
- **规则靠人守**。`AGENTS.md` 写得再细，也会有例外；lint 能查格式，查不了"这个抽象是否合理"。
- **测试慢**。53% 的测试代码意味着 CI 分钟数不低，分片和缓存只是把痛感延后。

## 小结

如果只从这个仓库带走五条，我会选：

1. **不能执行的测试，至少要被编译覆盖**；
2. **迁移要有 lint，历史可以豁免，增量必须守规矩**；
3. **把架构边界写成仓库里的合同，而不是 wiki 里的愿景**；
4. **注释写"为什么"和"什么时候可以改"，并给出数字或事故编号**；
5. **标准工具看不见的地方，补一个自己的检查，接进 CI**。

这五条都不新鲜，难的是同时做到，并且在第 632 个迁移、第 66 万行代码时还继续做。这个专栏拆了 Multica 的调度、运行时、prompt、实时和多端，最后发现真正撑住这些设计的，是这种不太上镜的工程纪律。
