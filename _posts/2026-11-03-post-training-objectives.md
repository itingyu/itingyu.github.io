---
layout: post
slug: post-training-objectives
title: 后训练：从会说话到会做事
date: 2026-11-03 00:00:00 +0800
column: model-review
series: llm-principles
tags:
  - 大模型
  - 后训练
  - RLHF
  - 强化学习
excerpt: 预训练模型会续写，后训练模型才会办事。SFT 教格式，RLHF 教偏好，GRPO/RLVR 教推理。
pinned: false
cover: null
draft: false
permalink: /notes/model-review/llm-principles/post-training-objectives/
---

预训练模型会续写，后训练模型才会办事。

## SFT：教格式

SFT 就是在“指令 → 回答”的示范上做交叉熵。它最擅长教格式、语气、工具调用协议；对复杂推理，SFT 容易记住轨迹，换一个分布就失效。

[LIMA](https://arxiv.org/abs/2305.11206) 给了一个极端例子：1,000 条精选示范，就能让 65B 模型在 43% 的对比里达到或超过 GPT-4。数据质量比数量更重要。

## RLHF：教偏好

InstructGPT 用人类偏好训练奖励模型，再用 PPO 优化策略。1.3B 的 InstructGPT 在人类评估里优于 175B 的 GPT-3，说明对齐比参数更直接影响“好不好用”。[InstructGPT](https://arxiv.org/abs/2203.02155)

RLHF 的问题是复杂：奖励模型、PPO、价值网络、超参，一样都不少。

## DPO：把 RL 变成分类

DPO 绕开奖励模型和 PPO，直接在“偏好对”上优化策略，损失是一个带参考模型的分类目标。它稳定、便宜，效果接近 RLHF。[DPO](https://arxiv.org/abs/2305.18290)

但 DPO 是离线方法：它只学偏好数据里出现过的比较，不会主动探索。需要新能力时，还是要回到在线 RL。

## GRPO：去掉 critic

GRPO 用同一 prompt 的一组采样，算组内相对优势，不再单独训价值网络。显存和计算都省，DeepSeekMath 用它做数学推理。[GRPO](https://arxiv.org/abs/2402.03300)

RLVR 则把奖励换成可验证的信号：答案对不对、测试过不过、格式合不合规。Tulu 3 用 RLVR 在多任务上训练，70B 级模型超过了 Llama 3.1 Instruct。[Tulu 3](https://arxiv.org/abs/2411.15124)

可验证奖励的好处是便宜、可扩展；坏处是模型会找捷径——测试能过，但方法不对。奖励设计比算法更容易决定成败。

## 纯 RL 能长出推理

DeepSeek-R1 做了两件事：先证明不用人类思维链，纯 RL 也能让模型自发出现长链推理、自我验证和回溯；再把 R1 的推理轨迹蒸馏到小模型。R1 在 AIME 2024 上从 15.6% 升到 71.0%，多数投票 86.7%，与 OpenAI o1-1217 持平。[DeepSeek-R1](https://arxiv.org/abs/2501.12948)

这改变了后训练的分工：SFT 负责“会按格式说话”，RL 负责“在分布外做对”。

SFT 与 RL 的差异有实验支持：SFT 在分布内表现好，RL 在分布外泛化更好；但去掉 SFT，RL 连输出格式都学不会。[SFT Memorizes, RL Generalizes](https://arxiv.org/abs/2501.17161)

## 测试时计算

后训练不只改权重，也改推理策略。Snell 等人发现：在“小模型已有非零成功率”的题目上，给小模型更多测试时计算，可能打败大 14 倍的模型；最优分配取决于题目难度，而不是一律多想。[Test-Time Compute](https://arxiv.org/abs/2408.03314)

这就是“思考档位”的理论基础：同一套权重，可以按任务难度分配推理预算。

## 边界

后训练最容易掩盖的问题是环境。奖励可验证，不代表环境正确；模型会利用测试漏洞、奖励模型偏差、评测污染。Anthropic 在 Opus 5.5 的发布文里把“有缺陷的 RL 环境”列为 misaligned 行为的主要来源，这不是危言耸听。[Opus 5.5](https://www.anthropic.com/claude-opus-5-5)

后训练不是加知识，是加目标函数。目标函数写错，模型会非常高效地做错事。
