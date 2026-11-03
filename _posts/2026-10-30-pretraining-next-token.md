---
layout: post
slug: pretraining-next-token
title: 预训练：下一 token 预测怎么变成能力
date: 2026-10-30 00:00:00 +0800
column: model-review
series: llm-principles
tags:
  - 大模型
  - 预训练
  - 缩放定律
  - 数据
excerpt: 预训练的目标函数只有一句话：给定前文，预测下一个 token。能力不是被“教”进去的，是在压缩语料的过程中长出来的。
pinned: false
cover: null
draft: false
permalink: /notes/model-review/llm-principles/pretraining-next-token/
---

预训练的目标函数只有一句话：给定前文，预测下一个 token。

`L = -Σ log P(x_t | x_<t)`

没有人工标签，没有任务定义。语料本身就是标签：每个位置的下一个 token，都是监督信号。

## tokenizer 先把世界切碎

文本先被切成 token。主流是 BPE：从字符开始，反复合并高频片段。词表大了，序列短、推理快，但 embedding 和输出层更贵；词表小了，序列长，稀有语言容易被切碎。

Qwen3 的词表覆盖 119 种语言和方言，预训练 36T token；它不是只吃英文网页，而是在多语言语料上重新配比。[Qwen3](https://arxiv.org/abs/2505.09388)

## 数据决定上限

预训练不是“把互联网倒进去”。要过滤、去重、分类、配比，还要决定代码、数学、多语言、长文各占多少。

- Llama 3：约 15T 多语言 token，405B 模型用了 3.8×10²⁵ FLOPs。[Llama 3](https://arxiv.org/abs/2407.21783)
- DeepSeek-V3：14.8T token，671B 总参数、37B 激活，FP8 训练，2.788M H800 GPU 小时。[DeepSeek-V3](https://arxiv.org/abs/2412.19437)
- Qwen3：36T token，分三阶段——30T 通用、STEM/代码、长上下文；上下文从 4K 扩到 32K。[Qwen3](https://arxiv.org/abs/2505.09388)

合成数据已经是常规配方。Qwen3 用 Qwen2.5-VL 从 PDF 抽文本，用数学/代码模型生成合成数据；Phi-4 更是把数据质量当成核心变量。[Phi-4](https://arxiv.org/abs/2412.08905)

## 缩放定律是经验公式

Kaplan 发现损失随参数、数据、算力呈幂律下降；Chinchilla 进一步给出算力最优配比：模型和数据同步翻倍，约 20 token/参数。[Kaplan](https://arxiv.org/abs/2001.08361) [Chinchilla](https://arxiv.org/abs/2203.15556)

但缩放定律不是物理定律。它依赖数据分布、架构、优化器和精度。最新的一条修正是“精度感知”：低精度训练会降低有效参数量，量化后的退化会随着训练 token 数增加而放大；在某些区间，继续加数据反而有害。[Scaling Laws for Precision](https://arxiv.org/abs/2411.04330)

## 架构只是骨架

主流是 decoder-only Transformer：RMSNorm、SwiGLU、RoPE、因果注意力。变化集中在三处：

- **注意力**：GQA/MLA 降低 KV cache；滑动窗口、线性注意力、稀疏注意力处理长上下文。
- **FFN**：dense 或 MoE。MoE 把总参数和激活参数拆开，DeepSeek-V3 是 671B/37B，Qwen3-235B-A22B 是 235B/22B。
- **位置编码**：RoPE 仍是默认；长上下文靠改 base、YaRN、DCA，或者干脆在部分层用 NoPE。

## 训练稳定性是工程核心

万亿参数训练最先遇到的不是显存，是 loss spike。常见手段：梯度裁剪、z-loss、QK-clip、精细的初始化、FP8/FP4 的 per-block scaling、Muon 这类新优化器。

DeepSeek-V3 的报告里有一句很重的话：整个训练过程没有出现不可恢复的 loss spike，也没有回滚。[DeepSeek-V3](https://arxiv.org/abs/2412.19437) 这比“用了多少卡”更能说明工程成熟度。

## 并行与成本

一张卡放不下，就把矩阵切到多卡：数据并行、张量并行、流水并行、专家并行；显存不够，再加 ZeRO/FSDP 做分片。Llama 3 405B 在 16K H100 上训练；DeepSeek-V3 用 2.788M H800 小时，按当时价格约 557.6 万美元。[Llama 3](https://arxiv.org/abs/2407.21783) [DeepSeek-V3](https://arxiv.org/abs/2412.19437)

预训练结束，你得到的是一个 base model：它会续写，但不会听指令。把它变成助手，是下一篇的事。
