---
layout: post
slug: fine-tuning-behavior
title: 微调改的是行为，不是知识
date: 2026-10-31 00:00:00 +0800
column: model-review
series: llm-principles
tags:
  - 大模型
  - 微调
  - LoRA
  - SFT
excerpt: 微调最容易被误解的一点：它通常不是给模型灌知识，而是改它的输出分布。知道这一点，很多“要不要微调”的问题就不用问了。
pinned: false
cover: null
draft: false
permalink: /notes/model-review/llm-principles/fine-tuning-behavior/
---

微调最容易被误解的一点：它通常不是给模型灌知识，而是改它的输出分布。

## SFT 在学什么

监督微调（SFT）就是拿“输入 → 理想输出”的配对，继续做 next-token 预测。它教的是格式、语气、步骤、拒答方式，不是把新事实写进权重。

LIMA 用 1,000 条精心挑选的样本微调 65B LLaMA，没有 RLHF，人类评估里 43% 的回答与 GPT-4 相当或更好。结论很直接：知识大部分在预训练里，SFT 主要教“怎么回答”。[LIMA](https://arxiv.org/abs/2305.11206)

所以，如果失败样本是“不知道”，先上检索；如果是“知道但不说人话/不按格式”，才轮到微调。

## 全参微调与 LoRA

全参微调更新所有权重，效果上限高，但显存、存储、部署都贵。LoRA 冻结原权重，只给注意力/FFN 加一对低秩矩阵：

`W' = W + BA`

`B` 是 `d×r`，`A` 是 `r×k`，`r` 远小于 `d`。GPT-3 175B 上，LoRA 把可训练参数减少 10,000 倍、显存降 3 倍，推理时把 `BA` 合并回 `W`，没有额外延迟。[LoRA](https://arxiv.org/abs/2106.09685)

QLoRA 再进一步：把基座量化成 4-bit NF4，冻结后在前向/反向里反量化，只训 LoRA；加上双重量化和 paged optimizer，65B 模型能在单张 48GB GPU 上微调。[QLoRA](https://arxiv.org/abs/2305.14314)

DoRA 把权重拆成“幅度”和“方向”，用 LoRA 只更新方向、单独学幅度，缩小与全参微调的差距，推理仍然没有额外开销。[DoRA](https://arxiv.org/abs/2402.09353)

## LoRA 不是免费的全参

LoRA 的“学得少”既是缺点也是优点。在编程和数学两个域上，标准低秩配置的 LoRA 明显不如全参微调；但它在目标域之外的任务上遗忘更少，生成多样性也更好。作者测出全参微调的扰动秩比典型 LoRA 高 10–100 倍，这解释了能力差距。[LoRA Learns Less and Forgets Less](https://arxiv.org/abs/2405.09673)

所以选型不是“LoRA 更先进”，而是：

- 要极限领域性能、数据足、算力够：全参。
- 要低成本多租户、快速迭代、保留通用能力：LoRA/QLoRA。
- 要缩小 LoRA 与全参的差距：DoRA、提高秩、覆盖更多层。

## 一个被低估的风险

微调会破坏安全对齐。Qi 等人的红队实验里，只用 10 条对抗样本、不到 0.2 美元，就绕过了 GPT-3.5 Turbo 的安全护栏；即使是用良性的常用数据集微调，对齐也会退化。[Fine-tuning breaks safety](https://arxiv.org/abs/2310.03693)

这意味着：微调不是“本地操作”。对外提供微调能力的产品，必须把安全评估和权限控制一起设计。

## 决策表

| 需求 | 优先方案 | 原因 |
|---|---|---|
| 加新事实、更新知识 | 检索/RAG | 权重不适合存事实 |
| 改格式、语气、流程 | SFT/LoRA | 行为问题 |
| 学复杂推理策略 | RL + 可验证奖励 | SFT 容易记轨迹 |
| 降成本、上端侧 | 蒸馏 + 量化 | 先压能力，再压精度 |
| 多租户定制 | LoRA/QLoRA | 一个基座，多个适配器 |

一句话：微调是改习惯，不是换大脑。大脑里的知识，主要靠预训练和检索。
