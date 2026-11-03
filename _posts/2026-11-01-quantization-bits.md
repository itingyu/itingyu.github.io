---
layout: post
slug: quantization-bits
title: 量化：省的是带宽，丢的是精度
date: 2026-11-01 00:00:00 +0800
column: model-review
series: llm-principles
tags:
  - 大模型
  - 量化
  - FP8
  - 推理优化
excerpt: 量化不是把 16 位四舍五入成 8 位。它改变数值表示、异常值分布和硬件的乘加路径；省下来的主要是带宽，不只是显存。
pinned: false
cover: null
draft: false
permalink: /notes/model-review/llm-principles/quantization-bits/
---

量化不是把 16 位四舍五入成 8 位。它改变数值表示、异常值分布和硬件的乘加路径。

## 先搞清楚省的是什么

推理的瓶颈通常不是算力，是显存带宽。每生成一个 token，都要把权重和 KV cache 从显存搬到计算单元。权重从 FP16 压到 INT4，字节数降到 1/4，搬运时间也降到 1/4；算力只有在 batch 很大、矩阵乘足够密时才成为瓶颈。

所以量化的收益顺序是：权重带宽 > KV cache 带宽 > 算力。端侧和单卡部署先看权重，长上下文服务先看 KV。

## 基本形式

把浮点 `x` 映射到整数：

`q = round(x / s) + z`

`s` 是 scale，`z` 是 zero-point。对称量化令 `z=0`；非对称量化保留零点。粒度可以是 per-tensor、per-channel、per-group；粒度越细，精度越好，元数据越多。

按对象分：weight-only（只压权重）、W8A8（权重和激活都压）、KV cache 量化。按时机分：训练后量化（PTQ）和量化感知训练（QAT）。

## PTQ 的四件套

**LLM.int8()** 发现激活里有系统性异常值：不到 0.1% 的维度数值极大。它把大部分矩阵乘做成 INT8，异常维度单独走 FP16，175B 模型显存减半、质量不降。[LLM.int8](https://arxiv.org/abs/2208.07339)

**SmoothQuant** 处理 W8A8 的激活异常：用等价变换把激活的量化难度迁移到权重，W8A8 下 1.56× 加速、2× 显存下降，530B 模型能塞进单节点。[SmoothQuant](https://arxiv.org/abs/2211.10438)

**GPTQ** 用近似二阶信息逐层量化，175B 模型约 4 个 GPU 小时压到 3–4 bit，精度接近原模型，端到端 3.25–4.5× 加速。[GPTQ](https://arxiv.org/abs/2210.17323)

**AWQ** 发现只有约 1% 的关键权重通道重要，按激活分布放大这些通道再做等价缩放；不依赖反向传播，4-bit 下泛化好，70B 模型能上移动 GPU。[AWQ](https://arxiv.org/abs/2306.00978)

## QAT 与 FP4

PTQ 是“先训好，再压”。QAT 在训练时插入伪量化，让模型学会在低精度下更新；它更贵，但能把 4-bit 甚至更低做到可用。

DeepSeek V4 把 MoE 专家权重和 indexer 的 QK 路径做成 FP4，其余参数用 FP8；官方说 FP4×FP8 的峰值算力与 FP8×FP8 相同，下一代硬件上理论上还能再省三分之一。[DeepSeek-V4](https://arxiv.org/abs/2606.19348)

更激进的是 BitNet b1.58：权重只有 {-1, 0, 1}，同规模、同 token 数下与 FP16 Transformer 的困惑度和下游表现相当。[BitNet b1.58](https://arxiv.org/abs/2402.17764) 但它需要从训练开始就用三值化，不是把现成模型压到 1.58 bit。

## KV cache 是长上下文的主战场

长上下文服务里，KV cache 往往比权重更占显存。KIVI 的发现是：Key 应该按通道量化，Value 应该按 token 量化；2-bit KV 下，Llama/Falcon/Mistral 几乎保持原质量，峰值显存降 2.6×，batch 可放大 4×，吞吐提升 2.35–3.47×。[KIVI](https://arxiv.org/abs/2402.02750)

## 精度不是免费的

Dettmers 的大规模实验给出一个经验：在“总比特数 vs 零样本精度”的权衡里，4-bit 几乎普遍最优；30B 的 8-bit 和 60B 的 4-bit 可能总比特相同，但精度差很多。[4-bit scaling](https://arxiv.org/abs/2212.09720)

更近的“精度感知缩放定律”补了一刀：低精度训练会降低有效参数量；模型训练 token 越多，后训练量化的退化越明显，极端情况下继续加预训练数据反而有害。[Scaling Laws for Precision](https://arxiv.org/abs/2411.04330)

## 落地规则

1. 先量化权重到 4-bit，再评估；不要一上来动 KV。
2. 长上下文服务优先做 KV 量化，收益比权重更大。
3. 量化后必须跑自己的任务集，尤其是数学、代码、长文检索；平均困惑度会掩盖推理退化。
4. 端侧看 4-bit 权重 + 2-bit KV；云端看 FP8/FP4 的硬件支持，不支持的格式只是省显存，不一定加速。

量化的终点不是 4 bit，是每瓦 token。
