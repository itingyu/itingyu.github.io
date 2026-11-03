---
layout: post
slug: distillation-capability
title: 蒸馏：把能力搬进小模型
date: 2026-11-02 00:00:00 +0800
column: model-review
series: llm-principles
tags:
  - 大模型
  - 蒸馏
  - 知识蒸馏
  - 小模型
excerpt: 蒸馏不是复制权重，是复制函数。教师给的不只是答案，还有“哪些错答案看起来像对的”这一层信息。
pinned: false
cover: null
draft: false
permalink: /notes/model-review/llm-principles/distillation-capability/
---

蒸馏不是复制权重，是复制函数。

## 软标签里的暗知识

Hinton 的经典做法是：教师输出一个概率分布，学生不只学正确类别，还学“错误类别之间的相对关系”。比如数字 3 的图片，教师可能给 7 一点概率、给 8 更少；这些相对大小就是暗知识。[Hinton et al.](https://arxiv.org/abs/1503.02531)

用温度 `T` 把 softmax 拉平，放大这些小概率，再让学生去拟合。损失通常是“软标签的 KL + 硬标签的交叉熵”。

对语言模型，这套做法要改：输出空间是词表，序列是自回归生成的，不能只对一个位置的分布做匹配。

## 序列级蒸馏

最直接的做法：教师生成答案，学生拿这些答案做 SFT。这叫 sequence-level KD。

它便宜、稳定，但有两个问题：

- **曝光偏差**：训练时学生只看教师的完美前缀，推理时看到自己的错误前缀，一步错、步步错。
- **只学结果，不学过程**：教师的分布里有“为什么排除另一个答案”，SFT 的硬标签把这部分扔了。

## 同策略蒸馏

GKD 的改法是：让学生自己生成序列，再让教师对这些“学生走过的状态”给 token 级反馈。这样训练分布和推理分布对齐，曝光偏差小。[GKD](https://arxiv.org/abs/2306.13649)

MiniLLM 进一步把前向 KL 换成反向 KL。前向 KL 会让学生高估教师的低概率区域，生成时容易跑偏；反向 KL 更保守，学生宁可少覆盖，也不乱采样。它用 on-policy 优化来学这个目标，120M 到 13B 都验证过。[MiniLLM](https://arxiv.org/abs/2306.08543)

DistiLLM 用 skew KL 做插值，并设计自适应 off-policy 策略，比近期 KD 方法快 4.3×。[DistiLLM](https://arxiv.org/abs/2402.03898)

## 推理蒸馏

DeepSeek-R1 的路线是：先用纯 RL 训出长链推理，再把 R1 的推理轨迹蒸馏到小模型。小模型没参与 RL，但学到了“自我检查、验证、换策略”的模式，数学和代码成绩明显提升。[DeepSeek-R1](https://arxiv.org/abs/2501.12948)

这类蒸馏的关键不是答案，是轨迹：中间步骤、回溯、验算，都是监督信号。代价是 token 变多，小模型的推理成本可能反而上升。

## 跨代与多专家蒸馏

2026 年的旗舰把蒸馏用成了常规工序：

- DeepSeek V4：数学、代码、Agent、指令各训领域专家，再用 reverse-KL on-policy distillation 合成一个统一模型。[DeepSeek-V4](https://arxiv.org/abs/2606.19348)
- Kimi K3：多档 effort 分别 RL，再合并成一个模型，API 只暴露一个权重、多个思考档位。[Kimi K3](https://arxiv.org/abs/2607.24653)
- GPT-6：OpenAI 称其大量借鉴早期模型做监督，跨代蒸馏已经是旗舰训练的一部分。[InfoQ](https://www.infoq.cn/article/mKGb7ZiPRlAiFDZCWK0v)

## 什么时候值得

Distillation Scaling Laws 给了一个可操作的判断：

- 教师已存在，或者要训很多学生：蒸馏在相当大的算力范围内优于从头监督训练，收益随学生规模可预测。
- 只训一个学生，而且教师也要从头训：通常不如直接监督训练。[Distillation Scaling Laws](https://arxiv.org/abs/2502.08606)

换句话说，蒸馏的性价比来自“教师被复用”。只蒸一个学生，还要先造教师，账不一定划算。

## 边界

蒸馏会继承教师的偏见、盲区和安全边界；学生容量不够时，可能只学到“像推理的语气”，没学到推理本身。评估不能只看 benchmark 分数，要看 OOD、长链稳定性和安全行为。

蒸馏买的是时间，不是免费的能力。
