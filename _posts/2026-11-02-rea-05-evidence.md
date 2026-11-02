---
layout: post
slug: rea-05-evidence
title: 证据：账本、指纹与未知
date: 2026-11-02 16:35:00 +0800
column: rea
series: rea-internals
tags:
  - 源码分析
  - 证据模型
  - 可复现性
excerpt: 在 REA 里，"我看到"必须变成一条带内容哈希、权威来源、覆盖度和未知项的记录。模型可以犯错，但记录不能悄悄改口。
pinned: false
cover: null
draft: false
permalink: /notes/rea/rea-internals/rea-05-evidence/
---

# 证据：账本、指纹与未知

一个 Agent 说"这个函数会校验许可证"，和一份记录说"在地址 0x100012340 的伪代码里出现了许可证校验分支，覆盖范围限于该函数，调用者未解析"——后者不一定更正确，但它可以被复查。

REA 的 Evidence 就是为这句话设计的。

## 一条记录长什么样

把字段精简后，大概是这样：

```json
{
  "evidence_id": "ev_3f9c…",
  "subject": {
    "name": "Target",
    "digest": { "sha256": "9a1c…" },
    "local_path": "/Users/me/Target.app/Contents/MacOS/Target"
  },
  "provider": { "id": "ghidra", "name": "Ghidra", "version": "<引擎版本>" },
  "analysis_profile": { "digest": "5b2e…", "parameters": { } },
  "operation": "analyze_function",
  "parameters": { "address": "0x100012340" },
  "raw_result": null,
  "normalized_result": { "pseudocode": "…", "callers": [] },
  "confidence": "observed",
  "authority": "shipped-artifact",
  "environment": {
    "platform": "darwin", "architecture": "arm64", "isolation": "process"
  },
  "limitations": ["Caller coverage is partial."],
  "relationship_coverage": { "status": "partial", "limited_directions": ["callers"] },
  "locations": [{ "kind": "address", "address": "0x100012340" }],
  "evidence_links": ["ev_…"]
}
```

几个字段值得单独说。

**`confidence` 只有三档**：`observed`、`derived`、`inferred`。`observed` 不是"正确"，而是"这次工具直接观测到了"；`derived` 是算出来的；`inferred` 是推测。它描述的是获取方式，不是可信度评分。

**`authority` 有五种**：`shipped-artifact`、`controlled-replay`、`historical-reference`、`external-service`、`analyst-inference`。它回答的是"这份材料从哪来"：随包发布的二进制、受控重放、历史参考、外部服务，还是分析者自己的推断。置信度和权威是两条轴，不能互相替代。

**`limitations` 和 `relationship_coverage` 是必填的。** 覆盖度只有 `complete`、`partial`、`unknown` 三态；partial 还要说明是 callers 还是 callees 方向不全。没有"默认完整"这种选项。

## ID 是内容哈希，不是自增号

```ts
const computeEvidenceId = (evidence) =>
  `ev_${digestCanonicalValue(evidenceSemanticContent(evidence), "Evidence")}`;
```

`evidenceSemanticContent` 包含 subject、provider、profile、operation、parameters、raw_result、normalized_result、confidence、authority、environment、limitations、coverage、locations、links——唯独不含 `evidence_id` 自己，也不含本地展示用的路径元数据。

解析时会把 ID 重算一遍，对不上就拒绝。这意味着：

- 改一个 `limitations` 字段，ID 就变了。
- 把 `confidence` 从 `inferred` 改成 `observed`，ID 也变了。
- 从另一个会话导入一条记录，只要内容一致，ID 就一致，引用可以跨进程复原。

这是一种"防篡改"，不是"防伪造"：任何人都能造一条新记录，但没法在保留原 ID 的前提下改内容。

## 未知项是一等对象

多数工具把"不知道"写在自然语言里。REA 把它做成 `ResidualUnknown`：

- `unknown_id` 由问题、领域、作用域摘要生成，同一个问题在不同会话里得到同一个 ID。
- 每次修改产生一个 revision，带 `previous_revision_digest` 和 `revision_digest`，形成一条可验证的修订链。
- 状态有五种：`open`、`investigating`、`blocked`、`contradicted`、`resolved`。
- 可以声明"要回答它，需要什么权威、什么置信度、什么运行环境"。
- 支持/反驳它的 Evidence ID 都要登记；`contradicted` 状态必须至少有一条反驳证据。
- `resolved` 必须带 resolution，`verified` 的 resolution 至少要有一条 Evidence。

还有一个容易忽略的细节：**记录未知项这个动作本身也会生成 Evidence**。`unknownMutationEvidence` 把 `record_unknown` / `update_unknown` 写成 `rea.residual-unknown-mutation` 记录，并附上"这只是分析者意图，不是答案的证明"的 limitation。

这样一来，"我宣布这个未知项解决了"也要留下痕迹。

## 账本：有上限，但不丢分析

`EvidenceLedger` 保存两类东西：不可变的 Evidence 记录，和未知项的修订历史。它的内存上限不是固定值，而是当前 V8 可用堆的四分之一：

```ts
policy.maximumRepresentationBytes ??
  Math.floor(getHeapStatistics().total_available_size / 4)
```

超过上限时，不是静默丢最旧的记录，而是返回资源约束错误，让调用方导出或分页。整个调查可以导出成一个 bundle，在新进程里导入；导入时会校验每条记录的 ID 和未知项的修订链，冲突就拒绝，而不是覆盖。

这里有一个很重要的边界：**账本不是持久化存储**。它只保证"同一个 MCP 连接内"的引用有效；要跨会话，必须显式导出。REA 不假装自己记得住。

## 这一层解决了什么

它没有让模型更聪明，也没有让反编译更准确。它做的是把"结论"拆成三样东西：

1. **观测**：哪个工具、在哪个目标、用什么配置、看到了什么。
2. **推断**：从观测到结论之间，哪一步是算出来的，哪一步是猜的。
3. **未知**：还有哪些问题没有答案，需要什么条件才能回答。

模型仍然可能把 `inferred` 说成 `observed`，但那是模型的错，不是记录的错。记录已经把两者分开了。

下一篇看这些记录如何继续往上走：从"证据"变成"重建欠账"，也就是一个功能到底算不算被复刻完成。
