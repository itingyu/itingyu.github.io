---
layout: post
slug: large-vs-small-models
title: 大模型与小模型：差的不只是参数
date: 2026-10-29 00:00:00 +0800
column: model-review
series: llm-principles
tags:
  - 大模型
  - 小模型
  - 缩放定律
  - 推理成本
excerpt: 参数量买到的是通用性，不是所有任务上的绝对优势。Chinchilla 之后，推理成本又把“多大模型才划算”改写了一遍。
pinned: false
cover: null
draft: false
permalink: /notes/model-review/llm-principles/large-vs-small-models/
---

一个 4B 模型在固定任务上接近 70B，不是魔法。参数量的边际收益，取决于你把模型放在哪里用。

## 参数买到的是什么

缩放定律最早回答的是“更大的模型会不会更差”。Kaplan 等人的结论是：交叉熵损失随模型规模、数据量、算力呈幂律下降，架构细节（宽度、深度）在很大范围内影响很小。[Scaling Laws](https://arxiv.org/abs/2001.08361)

但“更大”不等于“更划算”。Chinchilla 把问题改写成：固定算力下，模型和数据应该同步翻倍；当时的大模型普遍训练不足。按它的估计，每个参数大约配 20 个 token，70B 的 Chinchilla 用 1.4T token，打败了 280B 的 Gopher。[Chinchilla](https://arxiv.org/abs/2203.15556)

这还不是终点。Chinchilla 只算训练账，不算推理账。把部署后的请求量加进去，结论会反过来：如果预期有约 10 亿次请求，应该把模型训得更小、更久；在极端情况下，token/参数比可以拉到 10,000。[Beyond Chinchilla-Optimal](https://arxiv.org/abs/2401.00448)

Llama 3 8B 就是这条逻辑的产物：8B 参数吃了 15T token，token/参数比接近 1,900，远高于 Chinchilla 的 20。它不是“训练过度”，而是在用训练算力换推理成本。[Llama 3](https://arxiv.org/abs/2407.21783)

## 小模型为什么变强了

三条路同时在起作用。

**数据质量。** Phi-4 只有 14B，训练配方围绕数据质量重写，大量使用合成数据；它在 STEM QA 上超过了自己的教师模型。架构几乎没变，变的是数据和课程。[Phi-4](https://arxiv.org/abs/2412.08905)

**从旗舰蒸馏。** Qwen3 从 0.6B 到 235B 全系列一起发，官方明确说小模型借助旗舰模型的知识，明显降低了训练算力。小模型不是从零长出来的，是旗舰能力的压缩版。[Qwen3](https://arxiv.org/abs/2505.09388)

**部署经济性。** 小模型的显存、延迟、批处理成本都低；在 Agent 系统里，大量调用是“重复、窄、低变异”的子任务，不需要通用对话能力。NVIDIA 的 position paper 直接把 SLM 称作 Agent 的未来：通用对话用大模型，子任务用异构的小模型。[Small LMs for Agentic AI](https://arxiv.org/abs/2506.02153)

参数账本还分总参数和激活参数。MoE 把容量和每 token 计算拆开：Qwen3-235B-A22B 总参数 235B，但每 token 只激活 22B。拿它和 dense 235B 比，等于拿“仓库大小”和“每次搬运量”混为一谈。比较模型时，先把总参数、激活参数、精度、KV 大小分开。

## 怎么选

| 维度 | 大模型 | 小模型 |
|---|---|---|
| 任务宽度 | 长尾、开放、跨领域 | 窄、固定、高频 |
| 推理成本 | 高 | 低 |
| 延迟/端侧 | 难 | 容易 |
| 微调/蒸馏 | 成本高 | 成本低 |
| 主要风险 | 贵、慢 | 泛化差、知识少 |

一个实用的判断顺序：先问任务是否窄到可以用固定流程；再问失败样本是否集中在“缺知识”（用检索）还是“缺行为”（用微调）；最后才算单位任务成本。模型大小是成本曲线上的一个点，不是能力等级。
