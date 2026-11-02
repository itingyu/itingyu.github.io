---
layout: post
slug: rea-06-reconstruction
title: 重建：从"看懂了"到"可验收"
date: 2026-11-02 16:40:00 +0800
column: rea
series: rea-internals
tags:
  - 源码分析
  - 重建
  - 验收
excerpt: 让 Agent 复刻一个功能不难，难的是证明它复刻对了。REA 把"完成"拆成一张欠账清单：每条义务都要有唯一实现、对应用例、通过验证的证明。
pinned: false
cover: null
draft: false
permalink: /notes/rea/rea-internals/rea-06-reconstruction/
---

# 重建：从"看懂了"到"可验收"

让 Agent 写一个"类似的功能"很容易：给它反编译代码，它就能生成一份看起来合理的实现。难的是回答：这份实现和原程序的行为，到底哪些地方对上了，哪些地方还没对上？

REA 的答案是一张欠账清单：`build_reconstruction_obligation_ledger`。

## 输入不是代码，是证据

这个工作流的输入有三块：

```json
{
  "evidence_bundle": { "records": [], "unknowns": [] },
  "reviewed_obligations": [],
  "manifest": { "bindings": [], "contradictions": [] }
}
```

- `evidence_bundle`：一次调查导出的全部 Evidence 和未知项。
- `reviewed_obligations`：人工补充的、证据里没有自动覆盖到的义务。
- `manifest`：实现侧的绑定，包括 owner、用例、验证器和依赖。

输出不是一段总结，而是一个有 schema 的 `ReconstructionObligationLedger`：每条义务带状态、证据引用、覆盖范围和失败诊断，整个账本有一个 `closure_digest`。

## 一条义务长什么样

以"CLI 拒绝非法配置项"为例，一条义务至少要说清楚：

```json
{
  "obligation_id": "cli.config.invalid-option",
  "obligation_version": 1,
  "application_layer": "cli",
  "family": "argument-parsing",
  "required": true,
  "required_case_kinds": ["positive", "negative", "malformed"],
  "required_original_authority": "process",
  "required_fixture_authority": "packaged-process",
  "required_verifier_authority": "packaged-process",
  "requires_parser_type": true,
  "dependency_obligation_ids": [],
  "residual_unknown_ids": []
}
```

几个字段值得解释：

- `required_case_kinds`：不是"跑一个 demo 就算过"，而是要求正例、反例、畸形输入，协议类还可能要求取消和 teardown。
- 三种 authority：原始观测、fixture、verifier 各自的权威等级。验证器的权威不能低于原始观测，否则"验证"本身没有分量。
- `requires_parser_type`：如果这个功能依赖解析器或 schema，实现里必须出现对应的类型，不能靠字符串匹配糊过去。
- `residual_unknown_ids`：这张欠账和哪些未知项绑定；未知项没关，义务也不能算关。

## 关闭规则：唯一、完整、可验证

文档里把关闭条件写得很克制：

> A required obligation closes only when one manifest binding supplies a unique owner, any required parser/schema/domain type, every required case fixture, and a passing verifier whose authority is comparable to the original observation.

翻成中文是四个"必须"：

1. **唯一 owner**：一个义务只能绑定一个实现 owner。两个实现都声称负责，不算关闭，算冲突。
2. **必需类型齐全**：parser、schema、domain type 该有的都要有。
3. **用例齐全**：`required_case_kinds` 里的每一类都要有 fixture。
4. **验证器通过且权威可比**：验证器必须枚举 obligation ID，结果必须出现在输入 bundle 里；fixture 和 verifier 的证明还要绑定到 owner 的实现摘要和义务版本。

任何一条不满足，义务保持 `open`；出现矛盾、重复定义、缺依赖、未知项未关，账本会变成 `failed` 或 `unknown`。

## 账本状态是算出来的

整个账本的状态不是人填的，而是从义务推导：

```ts
if (obligations.length === 0) return "unknown";
const requiredOpen = obligations.filter(
  ({ required, status }) => required && status !== "verified",
);
// 简化：实际还会检查 verifier-failed / fixture-failed 诊断
if (requiredOpen.some(({ status }) => status === "contradicted")) return "failed";
if (limitations.length > 0) return "unknown";
if (requiredOpen.some(({ status }) => status === "unknown")) return "unknown";
return requiredOpen.length === 0 ? "ready" : "open";
```

四个状态的含义很清楚：

- `ready`：所有必需义务都 verified，且没有限制。
- `open`：还有必需义务没关，但没有失败。
- `failed`：出现矛盾，或 fixture/verifier 失败。
- `unknown`：没有义务，或覆盖不完整，或存在未解决的 unknown。

注意第一条：**没有义务不等于完成，等于 unknown**。空账本永远不能声称 closure，这是对"没找到问题"最诚实的处理。

## 验证不是"再跑一遍"

`verify_reconstruction` 接受一份有限的、带类型的规格，逐条判断"声明的可比主张"是否成立。它明确不证明全局等价：一次 pass 只覆盖规格里写出来的那些 claim。

同理，其他比较工具也各自带着边界：

- `compare_functions` 只比较显式给出的函数档案，不做全库模糊匹配。
- `compare_artifacts` 要求双方覆盖范围一致，页面耗尽不等于完整。
- `build_call_path` 的前沿不完整时，缺失的调用关系是 unknown，不是"没有"。
- `correlate_static_and_runtime` 的匹配只是假设，不是因果。
- `find_changed_behavior` 的静态差异是候选，不是行为变化的证明。

这些限制看起来是在"泼冷水"，实际上是让"完成"这个词有定义。没有这些限制，Agent 很容易把"我写了代码，测试过了"当成"复刻完成"。

## 这一层的意义

大多数 Agent 工作流的终点是"生成了一份东西"。REA 把终点往后推了一步：生成之后，还要把"凭什么说它对"拆成可检查的义务。

这对逆向尤其重要，因为原程序往往没有源码、没有测试、没有文档。你唯一能依靠的，是一组被证据绑定的观测，以及一套不接受"差不多"的验收规则。

下一篇换个角度：这么多证据、这么多大结果，REA 怎么把它们塞进有限的上下文窗口，而不偷偷截断。
