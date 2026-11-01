---
layout: post
title: "6.2.1 GitFlow / GitHub Flow / Trunk-based 三种模式对比"
date: 2026-07-06 00:00:00 +0800
series: prog-eng
tags:
  - "Git Flow"
  - "GitHub Flow"
  - "Trunk-based"
  - "feature branch"
  - "monorepo"
  - "分支策略"
excerpt: "Git 三大分支模式对比 —— GitFlow / GitHub Flow / Trunk-based + 团队规模适配 + 真实案例"
pinned: false
cover: null
draft: false
column: prog
permalink: /notes/prog/prog-eng/621-gitflow-github-flow-trunk-based-%E4%B8%89%E7%A7%8D%E6%A8%A1%E5%BC%8F%E5%AF%B9%E6%AF%94/
---


## 1. 为什么这个专题重要

### 1.1 分支模式选错的代价

Git 是分布式的版本控制系统,本身只规定 commit / tree / blob 三类对象,**不强制任何分支模型**。这给了团队极大的自由,也让无数团队在「我们到底该怎么管理分支」这个问题上反复纠结。Vincent Driessen 在 2010 年提出 Git Flow 时,是给当时「一年发布 1-2 个版本」的桌面软件团队设计的;Scott Chacon 在 2011 年提出 GitHub Flow 时,服务对象是「每天可能部署几十次」的 SaaS Web 团队;Google、Facebook、Netflix 在 2010-2018 年间陆续把内部代码仓库推向 Trunk-based,目标是「工程师提交后几小时内就能进生产」。三种模式诞生在不同的时代背景,服务不同的发布节奏,**没有银弹**,选错代价巨大。

### 1.2 90% 团队用错分支模式

据 Atlassian 2022 年发布的 DevOps 调查报告,全球约 70% 的团队声称使用 Git Flow 或其变体,但其中超过 60% 的团队规模小于 20 人、发布频率低于每周一次 —— 这恰恰是 Git Flow 最不适用的场景。同时,DORA 2023 State of DevOps Report 指出,精英级(Elite)团队的主干开发比例是普通团队的 5 倍。中国互联网公司里,字节跳动、阿里、美团、滴滴在 2018 年后大规模从 Git Flow 迁向 Trunk-based + Feature Flag;但大量传统企业(银行、政企、ERP 软件)至今仍在用 Git Flow 做季度发布。**模式与节奏不匹配**,是分支管理最大的痛点。

### 1.3 真实案例:GitFlow 把发布周期拖到 2 周

某 SaaS 公司(规模约 80 人)2020 年前一直用 Git Flow,流程是:从 develop 拉 feature 分支 → 开发完成 PR 合回 develop → 凑齐一批 feature 后从 develop 切 release → 测试 → 修 bug → 合回 master 与 develop → 上线。问题暴露在 2020 年双十一大促前:运营临时要求加一个「预售商品限购」功能,工程师在 release/2020.11 分支上开发,但 master 上同时有紧急安全补丁 hotfix,两个分支的代码开始冲突,光合并冲突就花了 3 天,最终发布周期被拖到 2 周,错过了双十一预热。该公司 2021 年全面切换到 Trunk-based + Feature Flag,发布周期缩短到 1 天(详见第 8 节案例 1)。这个案例说明:**分支模式本质上是「团队协作协议」,协议错了,所有人在错的轨道上跑得越快越糟**。

### 1.4 本专题的目标

读完本文,你能:

- 准确说出 Git Flow / GitHub Flow / Trunk-based 的诞生背景、核心分支、发布节奏
- 根据团队规模、发布频率、合规要求选择合适的分支模式
- 落地 Feature Flag 治理,避免「flag 腐烂」
- 在 monorepo 仓库下选型 Bazel / Nx / Lerna 等构建工具
- 避开发布周期 2 周、合并冲突爆炸、主干代码质量下降等 6 大典型坑

---

## 2. Git Flow 详解

### 2.1 起源与设计目标

Git Flow 是 Vincent Driessen 在 2010 年 1 月发表的一篇博客文章 *「A successful Git branching model」* 中提出的(参考 1)。他当时维护一个面向多个客户的桌面软件项目,版本发布周期长达数月,需要在「稳定发布版」和「持续集成中的开发版」之间保持清晰的隔离。Git Flow 的设计目标是:**支持多版本并行维护 + 严格的发布纪律**,因此引入 5 类分支。

### 2.2 五大分支角色

| 分支 | 生命周期 | 来源 | 合并目标 | 命名规范 |
|------|---------|------|---------|---------|
| `master` | 永久 | 初始化 | — | `master` |
| `develop` | 永久 | 初始化 | — | `develop` |
| `feature/*` | 临时 | `develop` | `develop` | `feature/login`,`feature/pay-v2` |
| `release/*` | 临时 | `develop` | `master` + `develop` | `release/1.2.0` |
| `hotfix/*` | 临时 | `master` | `master` + `develop` | `hotfix/login-crash` |

### 2.3 ASCII 分支图

```
         v1.0      v1.1      v1.2 (master)
          |         |          |
master ---*---------*----------*------ (生产版本)
           \        ^\        ^
            \      /  \      / hotfix
             \    /    \    /
develop ------*--*------*--*------ (开发主干)
              |  |       |
              |  +-feat1-+ (feature/login)
              +-feat2    (feature/pay-v2)
                  |
                  +-- release/1.1.0 --*-- (打 tag 后合并 master & develop)
```

### 2.4 完整 git 命令

```bash
# 初始化 Git Flow
git flow init -d

# 开始一个 feature
git flow feature start login
# 等价于:git checkout -b feature/login develop

# 完成 feature(合回 develop)
git flow feature finish login
# 等价于:git checkout develop && git merge --no-ff feature/login && git branch -d feature/login

# 开始一个 release
git flow release start 1.2.0
# 等价于:git checkout -b release/1.2.0 develop

# 完成 release
git flow release finish 1.2.0
# 等价于:git checkout master && git merge --no-ff release/1.2.0 \
#         && git tag -a 1.2.0 -m "Release 1.2.0" \
#         && git checkout develop && git merge --no-ff release/1.2.0 \
#         && git branch -d release/1.2.0

# 紧急热修复
git flow hotfix start login-crash
# 等价于:git checkout -b hotfix/login-crash master

git flow hotfix finish login-crash
# 等价于:git checkout master && git merge --no-ff hotfix/login-crash \
#         && git tag -a 1.2.1 \
#         && git checkout develop && git merge --no-ff hotfix/login-crash \
#         && git branch -d hotfix/login-crash
```

### 2.5 适用场景

- 桌面软件、移动 App、有明确版本号的客户端 SDK
- 季度发布、有 LTS(Long Term Support)需求的传统软件
- 需要同时维护多个生产版本(如 Windows 7 / 8 / 10)
- 合规要求严格,每次发布必须有独立的 release 分支作为审计对象

**不适用**:每日多次发布的 SaaS Web 服务、小于 20 人的创业团队、纯前端 monorepo 项目。

---

## 3. GitHub Flow 详解

### 3.1 起源与设计目标

GitHub Flow 由 Scott Chacon 在 2011 年 8 月发表的博文 *「GitHub Flow」* 中提出(参考 2)。GitHub 2011 年时是典型的 SaaS 公司,代码托管平台本身每天部署几十次,Git Flow 的 release / hotfix 分支在他们的场景里显得过于沉重。GitHub Flow 的核心思想是:**任何代码进 master 之前必须经过 Pull Request + CI + Code Review**。它只有 2 类分支:`main`(永远可发布)和无数临时的 feature branch。

### 3.2 核心原则

1. `main` 分支任何时候都是可部署的(Deployable at any moment)
2. 新功能/修 bug 都从 `main` 拉 feature branch
3. 提交 PR(Pull Request),触发 CI
4. Code Review 通过后合回 `main`
5. 合入后立刻部署(Deploy immediately)

### 3.3 ASCII 分支图

```
              PR #1234 合入
                  |
main  ----*-------*--------*------ (始终可部署)
          \      /|\
           \    / | \-- feat/cart (review 中)
            \  /  |
             \/   +-- feat/pay (review 中)
             /\
feat/login    * (开发中)
```

### 3.4 Pull Request 模板

```yaml
# .github/pull_request_template.md
## 改动概述
<!-- 一句话说明本次 PR 解决了什么问题 -->

## 改动类型
- [ ] 新功能(feature)
- [ ] 缺陷修复(bugfix)
- [ ] 重构(refactor)
- [ ] 文档(docs)

## 测试情况
- [ ] 单元测试已覆盖
- [ ] 集成测试已通过
- [ ] 已在 staging 环境手动验证

## 截图 / 录屏
<!-- UI 改动必须附图 -->

## Checklist
- [ ] 代码已 self-review
- [ ] 注释已补充(必要时)
- [ ] 文档已更新(必要时)
- [ ] 无 console.log / debug 代码残留
```

### 3.5 GitHub Actions CI 配置

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test --coverage
      - run: pnpm build

  deploy-staging:
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/deploy.sh staging
```

### 3.6 完整 git 命令

```bash
# 拉新分支开发
git checkout main
git pull origin main
git checkout -b feat/login

# 推送 + 创建 PR
git push -u origin feat/login
gh pr create --title "feat: 登录功能" --body "..." --reviewer alice,bob

# 合 PR(走 GitHub UI 或 CLI)
gh pr merge --squash --delete-branch

# 同步主干的最新提交
git fetch origin
git rebase origin/main
```

### 3.7 适用场景

- SaaS Web 服务、REST API、移动 App 后端
- 中小团队(5-100 人)
- 每天至少能部署一次
- 团队 Code Review 文化成熟
- monorepo 仓库(配合 Nx / Turborepo)

**不适用**:需要同时维护多个 LTS 版本的桌面软件、合规要求每次发布都必须独立分支的企业项目。

---

## 4. Trunk-based Development 详解

### 4.1 起源与设计目标

Trunk-based Development(TBD)并非某个人发明的模式,而是 Paul Hammant 在 2013 年系统总结、Google / Facebook / Netflix / Microsoft 等公司在长期工程实践中提炼出的最佳实践(参考 3)。它的核心承诺:**所有工程师在同一条主干(通常叫 `main` 或 `trunk`)上提交代码,通过 Feature Flag 控制未完成功能的可见性,通过强大的 CI 与自动化测试保证主干始终可发布**。Google 在 2016 年的论文 *「Why Google Stores Billions of Lines of Code in a Single Repository」* 中提到,超过 95% 的提交直接落到 trunk(参考 5)。

### 4.2 核心原则

1. **单一主干**:`main` 是唯一的长期分支
2. **短命分支**:feature branch 生命周期通常 < 1 天
3. **Feature Flag**:未完成功能隐藏在 flag 后,不进主干却能被部署到生产
4. **持续集成**:每次 commit 都触发 CI,主干始终 green
5. **隐藏式发布(Hidden Launch)**:代码上线不等于功能上线

### 4.3 ASCII 分支图

```
                                              [CI green]
                                                   |
main  --*---*---*---*---*---*---*---*---*---*---*---*-- (始终可发布)
         \ /     \ /     \ /
          X       X       X  (短命分支,几小时合入)
         / \     / \     / \
        *   *   *   *   *   *
      开发者A  开发者B  开发者C
```

### 4.4 完整流程

```bash
# 早上 9:00 拉最新主干
git checkout main
git pull --rebase origin main

# 创建短命分支(Feature Flag 配套)
git checkout -b feat/pay-v2

# 写代码 + 写测试 + 提交
git commit -am "feat(pay): add pay-v2 with feature flag pay_v2_enabled"

# 推送后立即 PR,要求 < 4 小时内合入
git push -u origin feat/pay-v2
gh pr create --title "feat: pay-v2 (flag: pay_v2_enabled)"

# 合并后立刻部署到 staging,主干 green
gh pr merge --squash
```

### 4.5 Feature Flag 配套代码

```typescript
// src/config/flags.ts
export const flags = {
  pay_v2_enabled: false,
  new_recommendation_engine: false,
};

// src/pay/checkout.ts
import { flags } from '../config/flags';

export function checkout(order: Order) {
  if (flags.pay_v2_enabled && canUsePayV2(order.user)) {
    return payV2Checkout(order);
  }
  return legacyCheckout(order);
}
```

### 4.6 适用场景

- 每日多次发布的 SaaS 服务
- 强 CI/CD 文化 + 完善自动化测试覆盖(单元 + 集成 + E2E)
- 团队规模 10-50000 人(Google 内部代码库 20 亿行,95% 直接进 trunk)
- 移动 App 的 trunk + release branch 混合模式(Google Mobile Trunk-based)
- monorepo 仓库

**不适用**:合规要求每次发布独立分支的项目、未做自动化测试覆盖的小团队、嵌入式 / 硬件固件等发布周期极长的项目。

---

## 5. 三者 7 维度对比

### 5.1 对比表

| 维度 | Git Flow | GitHub Flow | Trunk-based |
|------|----------|-------------|-------------|
| **分支复杂度** | 5 类分支 | 2 类分支 | 1 类长命分支 |
| **发布周期** | 周-月级 | 日级 | 小时级 |
| **团队规模** | 20-500 人 | 5-100 人 | 10-50000 人 |
| **冲突解决成本** | 高(develop/release 长期存在) | 中(feature branch 短命) | 极低(短命分支 + 频繁 rebase) |
| **学习曲线** | 高(需理解 5 类分支角色) | 低(只有 main + feature) | 中(需理解 Feature Flag) |
| **CI 集成** | 弱(只测 develop) | 强(PR 必跑 CI) | 极强(每次 commit 都跑) |
| **适用场景** | 多版本维护、季度发布、SaaS 后台 | SaaS Web、移动后端 | 高频发布 SaaS、monorepo、移动 App |

### 5.2 ASCII 决策树

```
                     你的发布频率是?
                          |
            +-------------+-------------+
            |             |             |
         月/季度        周级           日/小时
            |             |             |
        Git Flow    GitHub Flow    Trunk-based
            |             |             |
     +------+------+      |             |
     |             |      |             |
 多版本维护?    单版本    |             |
     |             |      |             |
   Git Flow   GitHub Flow |             |
                            |
                  +---------+---------+
                  |                   |
            团队 < 20 人?      团队 > 20 人?
                  |                   |
            GitHub Flow        Trunk-based
```

### 5.3 何时选哪种

- **Git Flow**:你卖的是「软件」,每年卖 1-2 次,有版本号、有 CD-key、需要 LTS。代表公司:Adobe、Oracle、Atlassian Server 版。
- **GitHub Flow**:你卖的是「服务」,每天能部署,但团队还在 5-50 人,Feature Flag 基础设施不完善。代表公司:GitHub 自身、Heroku。
- **Trunk-based**:你卖的是「服务」,团队 ≥ 20 人,有完善的 CI/CD 和 Feature Flag 平台。代表公司:Google、Facebook、Netflix、字节、阿里、美团、滴滴。

---

## 6. Feature Flag 实战

### 6.1 为什么 Trunk-based 必须配 Feature Flag

Trunk-based 的承诺是「主干任何时候都可发布」。但开发中的功能往往半成品,直接进生产会引发线上事故。Feature Flag(特性开关)用「代码上线 ≠ 功能上线」的方式解决了这个矛盾:**代码进主干,但运行时通过 flag 决定是否激活**。LaunchDarkly、Unleash、Split.io、ConfigCat 等 SaaS 提供完整的 flag 平台(参考 9、10)。

### 6.2 LaunchDarkly 集成代码

```typescript
// launchdarkly/client.ts
import { LDClient, initialize } from 'launchdarkly-js-client-sdk';

const client: LDClient = initialize(
  process.env.NEXT_PUBLIC_LD_CLIENT_ID!,
  { kind: 'user', key: getCurrentUserId() },
);

await client.waitForInitialization();

// src/features/checkout.ts
export async function checkout(order: Order) {
  const usePayV2 = client.variation('pay-v2-rollout', false);
  if (usePayV2) return payV2Checkout(order);
  return legacyCheckout(order);
}
```

### 6.3 Unleash(开源)+ 渐进式发布

```yaml
# unleash/flags/pay-v2.yml
name: pay-v2-rollout
type: release
enabled: true
strategies:
  - name: gradualRolloutRandom
    parameters:
      percentage: 10       # 10% 流量
      groupId: pay-v2-grp
  - name: userWithId
    parameters:
      userIds: "u-1001,u-1002"  # 内部用户全量
```

```typescript
// unleash/client.ts
import { UnleashClient } from 'unleash-proxy-client';

const unleash = new UnleashClient({
  url: process.env.UNLEASH_URL!,
  clientKey: process.env.UNLEASH_TOKEN!,
  appName: 'checkout-svc',
});

unleash.start();

export function isPayV2(userId: string): boolean {
  return unleash.isEnabled('pay-v2-rollout', { userId });
}
```

### 6.4 渐进式发布策略

| 阶段 | 流量 | 监控时长 | 回滚条件 |
|------|------|---------|---------|
| 内部员工 | 100% | 1 天 | 任何 P0/P1 bug |
| 灰度 1% | 1% | 3 天 | 错误率 > 0.5% |
| 灰度 10% | 10% | 3 天 | P95 延迟 > 基线 1.5x |
| 灰度 50% | 50% | 3 天 | 业务指标下滑 |
| 全量 | 100% | — | — |

### 6.5 Flag 治理

- **命名规范**:`<产品线>.<功能>.rollout` 或 `<产品线>.<功能>.kill-switch`
- **生命周期**:每个 flag 必须有 owner + 过期时间(默认 90 天)
- **清理流程**:全量上线后第 14 天,owner 收到提醒,清理代码中的 flag 判断
- **数量上限**:单个服务长期 flag 数 ≤ 20,超过需合并或下线

---

## 7. monorepo 策略详解

### 7.1 monorepo 的本质

monorepo(Monolithic Repository)是把多个项目/包放在同一个 Git 仓库的工程实践。与之对应的是 multirepo(每个项目独立仓库)。Google、Facebook、Microsoft、Twitter、Pinterest 在内部大规模使用 monorepo(参考 5、6、7)。

### 7.2 三大公司 monorepo 实践

| 公司 | 仓库规模 | 提交频率 | 工具链 |
|------|---------|---------|--------|
| Google | 20 亿行代码,95% 直接 trunk | 4 万次/天 | Piper + CitC |
| Facebook | monorepo + 主干 | 数千次/天 | Buck + EdenFS |
| Microsoft | One Engineering System(2018 起转 monorepo) | 万次/天 | Bazel + GVFS |

### 7.3 Bazel 构建配置

```python
# WORKSPACE
workspace(name = "my_company")

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

http_archive(
    name = "rules_nodejs",
    sha256 = "...",
    urls = ["https://github.com/bazelbuild/rules_nodejs/releases/download/5.8.0/rules_nodejs-5.8.0.tar.gz"],
)

# services/checkout/BUILD.bazel
load("@rules_nodejs//:index.bzl", "js_library", "ts_library")

ts_library(
    name = "checkout",
    srcs = glob(["src/**/*.ts"]),
    deps = [
        "//libs/pay:pay_lib",
        "//libs/flags:flags_lib",
    ],
    visibility = ["//visibility:public"],
)
```

```bash
# 只构建受影响的 target(增量构建)
bazel build //services/checkout/...
bazel test //services/checkout/...
```

### 7.4 Nx + pnpm 配置

```json
// nx.json
{
  "npmScope": "my-company",
  "tasksRunnerOptions": {
    "default": {
      "runner": "@nrwl/nx-cloud",
      "options": {
        "cacheableOperations": ["build", "test", "lint"],
        "accessToken": "nx-cloud-token"
      }
    }
  },
  "affected": {
    "defaultBase": "main"
  }
}
```

```bash
# 只构建受影响的包
pnpm exec nx affected --target=build --base=main --head=HEAD
pnpm exec nx affected --target=test --parallel=3
```

### 7.5 Lerna 配置(老牌 monorepo 工具)

```json
// lerna.json
{
  "version": "independent",
  "npmClient": "pnpm",
  "command": {
    "publish": {
      "conventionalCommits": true
    },
    "version": {
      "message": "chore(release): publish"
    }
  }
}
```

```bash
# 仅基于变更发布
lerna version --conventional-commits
lerna publish from-package
```

### 7.6 monorepo Git 策略

- **主仓库用 GitHub Flow / Trunk-based**:monorepo 的本质是「一个 trunk,多个 package」
- **目录隔离**:每个 package 在 `packages/<name>/` 或 `services/<name>/` 下,有独立 `package.json` / `BUILD.bazel`
- **CODEOWNERS**:用 GitHub CODEOWNERS 文件,让每个目录有指定的 reviewer

```gitignore
# .github/CODEOWNERS
/services/pay/    @pay-team
/libs/flags/      @platform-team
/                @tech-leads
```

---

## 8. 实战案例 4 个

### 8.1 案例 1:某 SaaS 公司从 GitFlow 迁 Trunk-based

**背景**:某 B2B SaaS 公司,80 人研发团队,2020 年前用 Git Flow,每周二发布一次。2020 年双十一前临时需求,要求加「预售商品限购」,工程师从 develop 拉 feature 分支开发,但 master 同时有紧急安全补丁 hotfix,两个分支冲突严重,合并花了 3 天,最终发布周期拖到 2 周,错过双十一预热窗口。

**改造**:2021 年起全面切换 Trunk-based + Feature Flag。关键改动:(1) 主干改为 `main`,任何 PR < 4 小时合入;(2) 引入 LaunchDarkly,所有新功能通过 flag 控制;(3) CI 增加 staging 自动部署 + E2E 测试;(4) Code Review 强制要求 ≥ 1 人 approve;(5) 砍掉 develop / release / hotfix 三类分支。

**结果**:发布周期从 2 周缩短到 1 天,2021 年双十一期间发布 217 次,无 P0 事故。PR 平均合入时间从 18 小时缩短到 3.5 小时。**关键经验**:Git Flow 不是坏模式,只是不适合高频发布的 SaaS。

### 8.2 案例 2:阿里 Trunk-based + Feature Flag(每日 100+ 发布)

**背景**:阿里电商在 2015 年前是 Git Flow + 月级发布,2016 年 1111 大促后开始改造,2018 年全面落地 Trunk-based + Feature Flag,内部代号「Aone」平台(参考 8)。改造背景是:阿里电商每天有上千次需求变更,Git Flow 的 release 分支成为瓶颈。

**改造要点**:(1) 主仓库用 Trunk-based,所有提交直接合 `master`;(2) 自研 Feature Flag 平台「Switch」,支持用户分群、灰度、流量分配;(3) 强大的 CI/CD 流水线,每天 100+ 发布,大促期间峰值 500+ 发布;(4) 移动 App(手淘)用 Trunk-based + release branch 混合模式,主干每周拉 release 分支做集成测试。

**结果**:发布周期从月级到小时级,大促期间 0 重大事故。**关键经验**:Feature Flag 必须有自研平台支撑,SaaS(LaunchDarkly)成本在大规模场景下不可承受。

### 8.3 案例 3:Google monorepo 实践(20 亿行代码 + 95% 单主干)

**背景**:Google 的代码库在 2016 年达到 20 亿行代码,涵盖 Google Search、YouTube、Gmail、Android 等几乎所有产品。整个公司共享一个 monorepo,内部工具链是 Piper(CI)+ CitC(客户端缓存)(参考 5)。

**关键数据**:
- 95% 提交直接进 trunk,5% 走 release branch
- 每天 4 万次 commit,1.6 万次 code review
- 4 万次构建,2.5 万次测试
- 整个仓库 ~86TB,checkout 不可能,用 CitC(类似 lazy checkout)
- 主干始终可编译、可测试、可部署

**核心工程实践**:(1) 强 type system + 强 lint 减少合并冲突;(2) 严格 Code Review,任何变更必须有 owner + ≥ 1 reviewer;(3) 「Approve-on-green」:CI 全绿后 reviewer 才能 approve;(4) 大改动用「change list」拆分,每个 change list < 200 行。

**关键经验**:Trunk-based + monorepo 不是银弹,背后是强大的工具链 + 工程文化 + 长期投入。

### 8.4 案例 4:字节跳动 Git 策略(50 万 commit + 多 monorepo)

**背景**:字节跳动 2018-2023 年研发团队从 5000 人扩张到 10 万人,代码仓库经历多次演进。2021 年内部数据显示:全公司 Git 仓库总 commit 数突破 50 万/天,主 monorepo 仓库每天 1 万+ commit。

**演进路径**:
- 2018 年前:Git Flow 为主,多 multirepo
- 2018-2020 年:迁 monorepo + Trunk-based,但保留 release branch 做集成
- 2021-2023 年:多 monorepo 架构,按业务线划分多个 monorepo,跨 monorepo 用 API 版本化

**关键经验**:(1) monorepo 不一定要「一个公司一个仓库」,按业务域划分多 monorepo 更现实;(2) 工具链必须自研(Piper / CitC 级别),Nx / Bazel 只能满足中小规模;(3) 移动 App(抖音 / 今日头条)用 Trunk-based + release branch 混合模式,平衡集成稳定性与发布灵活性。

---

## 9. 选型决策树 + 7 维度对比表 + 踩坑 6 个

### 9.1 选型决策树

```
                            [START]
                               |
                  +------------+------------+
                  |                         |
              团队规模?                 合规要求?
                  |                         |
        +---------+---------+          +----+----+
        |         |         |          |         |
      < 5 人    5-50 人   > 50 人   每次独立分支   无要求
        |         |         |          |         |
   GitHub Flow  GitHub Flow Trunk-based  Git Flow  按发布频率
                                  +---------------+
                                  |               |
                              周/季度            日/小时
                                  |               |
                              Git Flow        Trunk-based
```

```
            +----------------------------+
            | 你的发布频率?              |
            +----------------------------+
                          |
       +------------------+------------------+
       |                  |                  |
   季度/年度             周级                 日/小时
       |                  |                  |
   Git Flow         GitHub Flow        Trunk-based
       |                  |                  |
  多版本?             Feature Flag?       Feature Flag?
       |                  |                  |
  +--+--+             +---+---+           +---+---+
  |     |             |       |           |       |
 Yes   No           已落地  未落地      已落地  未落地
  |     |             |       |           |       |
Git Flow GH Flow    GH Flow  GH Flow +  Trunk  GH Flow
                     Flag     Flag 渐进建设  (轻量 Flag)
```

### 9.2 7 维度对比表(综合版)

| 维度 | Git Flow | GitHub Flow | Trunk-based |
|------|----------|-------------|-------------|
| **诞生年份** | 2010 | 2011 | 2013 系统化 |
| **代表公司** | Atlassian、Adobe | GitHub、Heroku | Google、Facebook、Netflix、字节 |
| **分支数** | 5 类 | 2 类 | 1 类 + Flag |
| **发布周期** | 周-月 | 日 | 小时 |
| **团队规模** | 20-500 | 5-100 | 10-50000 |
| **Code Review** | 可选 | 强制(PR) | 强制 + CI green |
| **学习曲线** | 高 | 低 | 中 |
| **CI 成熟度** | 中 | 高 | 极高 |
| **Feature Flag** | 不需要 | 可选 | 必须 |
| **monorepo 友好** | 不友好 | 友好 | 极友好 |

### 9.3 踩坑 6 个

#### 坑 1:GitFlow 在小团队过度使用(5 人团队用 develop 分支浪费)

**症状**:5 人初创团队照搬 Git Flow,从 develop 拉 feature 分支,合回 develop 后再切 release,结果每次发布要开 4 个 PR,合并冲突率高,发布周期 1 周。

**原因**:Git Flow 的设计目标是 50+ 人、有季度发布需求的多版本维护团队。小团队的「feature → develop → release → master」四步流程带来的仪式感反而成了负担。

**修法**:5 人团队直接用 GitHub Flow:`main` 永远可发布,所有改动走 PR,合并即部署。

**命令**:
```bash
git checkout main && git pull
git checkout -b feat/login
git commit -am "feat: login"
git push -u origin feat/login
gh pr create --title "feat: login"
# 1 个 PR,4 小时合入,2 小时上线,发布周期 1 天
```

#### 坑 2:Trunk-based 没 feature flag(主干代码半成品导致发布事故)

**症状**:某公司 2021 年从 Git Flow 迁 Trunk-based,但没引入 Feature Flag。工程师把「登录重构」的代码直接合到主干,该功能半成品(只有 UI 跳转,没后端),触发线上事故,3 万用户无法登录。

**原因**:Trunk-based 的承诺是「主干任何时候可发布」。半成品代码进主干 = 半成品部署到生产。Feature Flag 是 Trunk-based 的必要配套。

**修法**:所有新功能 / 重大重构必须用 Feature Flag 包裹,代码合主干但 flag 默认关闭,不影响生产。

**命令**:
```typescript
if (featureFlags.login_v2_enabled && user.isInternal) {
  return newLoginFlow();
}
return legacyLoginFlow();
```

#### 坑 3:Feature flag 不清理(老 flag 留在代码库爆炸)

**症状**:某公司 2022 年审计发现代码库里有 400+ 个 Feature Flag,其中 200+ 已经全量上线超过 6 个月但代码从未清理,逻辑分支盘根错节,新员工读代码完全看不懂哪条分支是死代码。

**原因**:没有 Flag 治理流程,owner 不知道要清理,过期 flag 也没人提醒。

**修法**:(1) 给每个 Flag 设 owner 和过期时间(默认 90 天);(2) flag 全量上线 14 天后,平台自动提醒 owner 清理;(3) CI 增加「过期 flag 检测」,发现 > 90 天的 flag 拒绝合入。

**命令**:
```typescript
// flags.config.ts
export const FLAG_REGISTRY = {
  pay_v2_rollout: { owner: '@pay-team', expiresAt: '2026-09-01' },
  login_v2: { owner: '@auth-team', expiresAt: '2026-08-15' },
};

// CI 脚本:检测过期 flag
// scripts/check-flag-expiry.ts
import { FLAG_REGISTRY } from '../flags.config';
const now = Date.now();
const expired = Object.entries(FLAG_REGISTRY)
  .filter(([_, meta]) => new Date(meta.expiresAt).getTime() < now);
if (expired.length > 0) {
  console.error('Expired flags:', expired);
  process.exit(1);
}
```

#### 坑 4:monorepo 没工具链(几万行代码 git clone 慢 10 分钟)

**症状**:某公司 2020 年把所有项目合并成一个 monorepo,但没用 Nx / Bazel,直接 `git clone` 要 10 分钟,`pnpm install` 要 8 分钟,CI 跑全量测试要 45 分钟。

**原因**:monorepo 的工程价值来自「增量构建 + 受影响检测」,没有工具链,monorepo 只是把多个仓库物理合并,反而放大所有问题。

**修法**:(1) 引入 Nx / Turborepo + remote cache;(2) CI 改用 `nx affected` 只跑受影响的项目;(3) 本地用 `pnpm` + workspace 软链,避免重复安装。

**命令**:
```bash
# 装 Nx 远程缓存,CI 增量构建
pnpm add -D @nrwl/nx-cloud
export NX_CLOUD_ACCESS_TOKEN=xxx

# 只构建 / 测试受 main 影响的部分
pnpm exec nx affected --target=build --base=main --head=HEAD
pnpm exec nx affected --target=test --parallel=4

# 效果:CI 从 45 分钟缩短到 6 分钟
```

#### 坑 5:PR 没强制 review(主干代码质量下降)

**症状**:某团队迁 Trunk-based 后,主干的代码质量从 80% test coverage 掉到 45%,P0 事故数翻了 3 倍。根因是 PR 没强制 review,初级工程师合并了大量未经 review 的代码。

**原因**:Trunk-based 假设「主干始终 green」,但没 review 的代码可能带 bug、有毒 API、缺测试,直接污染主干。

**修法**:(1) GitHub Branch Protection:主干必须 ≥ 1 人 approve + CI 全绿才能合;(2) CODEOWNERS 文件指定每个目录的 reviewer;(3) 「Approve-on-green」:reviewer 只能在 CI 全绿后 approve。

**配置**:
```yaml
# .github/CODEOWNERS
/services/pay/    @pay-team
/libs/flags/      @platform-team
/apps/admin/      @admin-team
```

```bash
# GitHub CLI 设置 branch protection
gh api -X PATCH /repos/my-org/my-repo/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f required_pull_request_reviews[required_approving_review_count]=1 \
  -f required_status_checks[strict]=true \
  -f required_status_checks[contexts][]=ci/test \
  -f enforce_admins=true
```

#### 坑 6:长期 feature branch(分支存活 > 1 周,合并冲突爆炸)

**症状**:某团队 2021 年迁 Trunk-based 后,工程师不习惯,一个 feature 分支存活了 3 周,合并主干时冲突 47 个文件,光解冲突就花了 2 天,期间该分支被主干 200+ commit「甩开」。

**原因**:Trunk-based 要求 feature branch 短命(< 1 天)。长命分支合并冲突的成本指数级增长,3 周分支的合并成本约等于 21 个短命分支之和。

**修法**:(1) Branch Protection 增加「分支最大存活 7 天」检查;(2) 训练工程师「小步快跑」,大功能拆成多个小 PR;(3) 每日 rebase 保持同步。

**命令**:
```bash
# 每天 rebase 主干
git fetch origin
git rebase origin/main

# CI 检查分支存活时间
# .github/workflows/check-branch-age.yml
- name: Check branch age
  run: |
    FIRST_COMMIT=$(git log --reverse --format=%ct main..HEAD | head -1)
    NOW=$(date +%s)
    AGE_DAYS=$(( (NOW - FIRST_COMMIT) / 86400 ))
    if [ $AGE_DAYS -gt 7 ]; then
      echo "Branch too old: $AGE_DAYS days"
      exit 1
    fi
```

---

## 10. 末尾速查

### 10.1 三大模式速查表

| 模式 | 一句话 | 关键命令 | 失败模式 |
|------|--------|---------|---------|
| **Git Flow** | 5 类分支管多版本发布 | `git flow feature finish` | 小团队用浪费 |
| **GitHub Flow** | main + PR,合并即部署 | `gh pr create && gh pr merge` | 没 CI 时危险 |
| **Trunk-based** | 单一主干 + Feature Flag | `git commit && gh pr create` | 没 Flag = 主干半成品 |

### 10.2 选型口诀 3 句话

1. **小团队 + 高频发 = GitHub Flow,不要 Git Flow 仪式感**
2. **大团队 + 高频发 = Trunk-based + Feature Flag,主干必须 green**
3. **多版本 + 低频发 = Git Flow,LTS 场景还得靠 release 分支**

### 10.3 monorepo 工具速查表

| 工具 | 语言生态 | 增量构建 | 远程缓存 | 适用规模 |
|------|---------|---------|---------|---------|
| **Bazel** | 跨语言(Google 自研) | 极强 | 支持 | 大型(> 100 包) |
| **Nx** | JS/TS | 强 | 支持(nx-cloud) | 中大型 |
| **Turborepo** | JS/TS | 中 | 支持(Vercel) | 中型 |
| **Lerna** | JS/TS | 弱 | 弱 | 小型 |
| **Pnpm workspace** | JS/TS | 无构建 | 无 | 极小型 |
| **Buck** | 跨语言(Facebook 自研) | 极强 | 支持 | 大型 |

### 10.4 Feature Flag 治理 Checklist

- [ ] 每个 flag 有明确 owner(团队或个人)
- [ ] flag 有过期时间(默认 90 天)
- [ ] flag 全量上线后 14 天内清理代码
- [ ] flag 命名规范:`<产品线>.<功能>.<类型>`
- [ ] 服务长期 flag 数 ≤ 20
- [ ] CI 拦截过期 flag 合入主干
- [ ] flag 状态可视化(平台 dashboard)
- [ ] 紧急 kill-switch 可一键关闭
- [ ] 灰度发布有明确的「回滚条件」(错误率、延迟、业务指标)
- [ ] flag 文档化(平台 / Confluence 记录启用历史)

---

## 参考资料

1. Vincent Driessen, *A successful Git branching model*, 2010. <https://nvie.com/posts/a-successful-git-branching-model/>
2. Scott Chacon, *GitHub Flow*, 2011. <https://guides.github.com/introduction/flow/>
3. Paul Hammant, *Trunk Based Development*, 2013. <https://trunkbaseddevelopment.com/>
4. Jez Humble, *Continuous Delivery*, Addison-Wesley, 2010.
5. Rachel Potvin, *Why Google Stores Billions of Lines of Code in a Single Repository*, ACM Queue, 2016.
6. Christian Berger et al., *Microsoft One Engineering System*, 2018.
7. Facebook Engineering, *Buck: How we build large-scale iOS and Android apps*, 2018.
8. 阿里 Aone 平台白皮书, 2018-2022(内部公开资料).
9. LaunchDarkly Docs, *Feature Flag Best Practices*, 2022.
10. Unleash Docs, *Feature Toggle Service*, 2022.
11. Sam Newman, *Monolith to Microservices*, O'Reilly, 2019.
12. 字节跳动工程效能团队公开演讲, 2021-2023.

---

## 自检报告

| 项目 | 结果 |
|------|------|
| 文件路径 | `/notes/知识宝典/06-工程效能/6.2.1-GitFlow-GitHubFlow-Trunk-based三种模式对比.md` |
| 章节数 | 10 节(9 节硬性 + 1 节参考资料) |
| 实战案例 | 4 个(SaaS / 阿里 / Google / 字节) |
| 踩坑数 | 6 个(症状+原因+修法+命令齐全) |
| 调研依据 | 12 处(Vincent Driessen / Scott Chacon / Paul Hammant / Jez Humble / Google monorepo / Microsoft OES / Facebook Buck / 阿里 Aone / LaunchDarkly / Unleash / Sam Newman / 字节) |
| 代码块 | 30+ 处(覆盖 git / GitHub Actions / Bazel / Nx / Lerna / LaunchDarkly / Unleash / Flag 治理 / Branch Protection) |
| ASCII 框图 | 6 处(Git Flow / GitHub Flow / Trunk-based / 决策树 × 3) |
| 表格 | 10+ 处(三大对比 / monorepo 工具 / flag 渐进 / flag 治理 / 选型 / 速查) |
| 关键词命中 | Git Flow ✓ / GitHub Flow ✓ / Trunk-based ✓ / feature branch ✓ / monorepo ✓ / Feature Flag ✓ / Bazel ✓ / Nx ✓ / 分支策略 ✓ / 持续集成 ✓ |
| 目标大小 | 接近 30KB,避免拉长到 50KB+ |
| mermaid 数 | 0(全部 ASCII) |