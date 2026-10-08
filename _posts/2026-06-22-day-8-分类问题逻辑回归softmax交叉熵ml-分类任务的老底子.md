---
layout: post
title: "Day 8｜分类问题:逻辑回归、Softmax、交叉熵,ML 分类任务的「老底子」（AI 学习笔记 · 经典机器学习周 · 第 8 篇）"
date: 2026-06-22 00:00:00 +0800
series: "AI 学习笔记"
excerpt: ""
pinned: false
cover: null
draft: false
---


从 Day 6 的线性回归学到的是「连续值预测」,但工业界 80% 的 ML 任务其实是「分类」——这封邮件是不是垃圾邮件、这个用户会不会点击、这张图片是猫还是狗。逻辑回归是二分类的基线模型,Softmax 是它在多分类场景的推广,交叉熵是把二者统一在「最大似然」框架下的损失函数。今天这三件套是后面所有深度学习分类模型(CNN 末层、RNN 末层、GPT 末层)的「老底子」。

---

## 1. 逻辑回归:线性回归 + Sigmoid

### 1.1 为什么需要 Sigmoid

线性回归输出 z = w^T x + b 是任意实数,而概率必须落在 [0, 1]。Sigmoid 函数把这个实数「压」到 (0, 1):

```math
\sigma(z) = \frac{1}{1 + e^{-z}}
```

性质:

- 单调递增,关于原点对称
- σ(0) = 0.5
- σ(±∞) → 1 / 0
- 导数 σ'(z) = σ(z)·(1 − σ(z)),最大值 0.25 在 z = 0

### 1.2 逻辑回归定义

给定输入 x,预测「正类」概率:

```math
\hat{p} = \sigma(z) = \sigma(w^T x + b)
```

预测规则:`ŷ = 1 if p ≥ 0.5 else 0`,等价于 `w^T x + b ≥ 0` 时预测正类。

### 1.3 几何直觉:线性决策边界

逻辑回归学的是「线性超平面」:`w^T x + b = 0` 把特征空间切成两半。一侧预测正,另一侧预测负。所以逻辑回归只能解「线性可分」的问题——XOR 这种必须升维或换非线性模型。

### 1.4 优缺点对比

|| 优点 | 缺点 |
|:---|:---|:---|
| 训练快、推理 O(d) | 只能学线性边界 |
| 概率输出,可调阈值 | 特征需手动构造交互项 |
| 可解释(系数即特征贡献) | 对非线性关系束手无策 |
| 多任务扩展容易(OvR、Softmax) | 类别不平衡需调阈值/加权 |

### 1.5 为什么叫「回归」却做分类

历史命名:逻辑回归拟合的是「对数几率」(log-odds):

```math
\log\frac{p}{1-p} = w^T x + b
```

左边是对数几率,右边是线性函数。模型在对数几率空间做线性回归,在概率空间做分类。「回归」指对数几率的回归,「分类」指输出阈值的离散化。

---

## 2. Softmax 回归:多分类的推广

### 2.1 二分类到 K 分类

K 类分类需要 K 个分数,且必须归一化成「和为 1 的概率分布」。Softmax 把 K 个 logits 转换成一个 K 维概率向量:

```math
\text{Softmax}(z_i) = \frac{e^{z_i}}{\sum_{j=1}^{K} e^{z_j}}
```

- 每个输出 ∈ (0, 1)
- 全部输出之和 = 1
- 一个分数变大,其他分数必然变小(互斥)

### 2.2 K 类 Softmax 回归模型

```math
z = W^T x + b, \quad W \in \mathbb{R}^{d \times K}, \quad b \in \mathbb{R}^{K}
```

```math
\hat{p}_i = \text{Softmax}(z_i)
```

预测 `ŷ = argmax_i p_i`。

### 2.3 数值稳定性:Numerical Stability

直接算 `e^{z_i}` 在 z_i 很大时会溢出(超过 float64 上限)。工程做法:

```python
z_shifted = z - z.max(dim=-1, keepdim=True).values
softmax = z_shifted.exp() / z_shifted.exp().sum(dim=-1, keepdim=True)
```

减去最大值后,最大指数项变成 e^0 = 1,其他都是 ≤ 1。数学上等价(分子分母同除 e^{max}),但数值安全。

### 2.4 与 OvR 的对比

多分类两种常见策略:

|| 策略 | 训练 | 推理 | 适用 |
|:---|:---|:---|:---|
| **Softmax** | 一次训 K 类互斥 | 单次前向,argmax | 类别互斥(首选) |
| **OvR** | 训 K 个二分类器 | K 次前向,取最高 | 类别非互斥、异常检测 |

OvR 让每个类「独立打擂」,Softmax 让 K 个分数「互相竞争」。

### 2.5 手算例子

3 个 logits z = [2.0, 1.0, 0.1]:

```math
e^z = [7.39, 2.72, 1.11]
```

```math
\text{sum} = 11.22
```

```math
\text{Softmax}(z) = [0.659, 0.242, 0.099]
```

预测类别 = 0(概率 0.659 最高)。

---

## 3. 交叉熵:从最大似然推导

### 3.1 二元交叉熵(Binary Cross-Entropy)

逻辑回归的训练目标:最大化对数似然。等价于最小化二元交叉熵:

```math
L = -\frac{1}{N}\sum_{i=1}^{N}\left[y_i \log \hat{p}_i + (1 - y_i)\log(1 - \hat{p}_i)\right]
```

推导:每个样本属于伯努利分布 y ~ Bernoulli(p̂),对数似然为 `y·log p̂ + (1−y)·log(1−p̂)`,最大化 → 最小化负值。

### 3.2 多元交叉熵(Categorical Cross-Entropy)

K 类 Softmax 训练:

```math
L = -\frac{1}{N}\sum_{i=1}^{N}\sum_{k=1}^{K} y_{i,k} \log \hat{p}_{i,k}
```

y 是 one-hot 标签,只有正确类那一项 y_{i,k}=1,其余为 0,所以简化为:

```math
L = -\frac{1}{N}\sum_{i=1}^{N} \log \hat{p}_{i, \text{true class}}
```

直观:模型对正确类的预测概率越高,loss 越低。

### 3.3 为什么不用 MSE

| 损失 | 分类任务上的问题 |
|:---|:---|
| **MSE** | 与 Sigmoid 组合时,梯度为 `σ'(z)·(σ(z)−y)`,σ'(z) 最大 0.25 → 梯度小 + 预测错很离谱时梯度更小 → 「梯度饱和」,训练极慢 |
| **Cross-Entropy** | 梯度为 `p − y`,直接是「预测 − 真实」,与 σ' 无关 → 训练快、远点梯度大 |

数字例子:预测置信度 0.01 但真实是 1,交叉熵 loss ≈ 4.6,远大于置信度 0.5 时的 0.69 —— 错得越离谱,惩罚指数级加大。

### 3.4 KL 散度与信息论视角

交叉熵 = 熵 + KL 散度:

```math
H(p, q) = H(p) + D_{\text{KL}}(p \,\|\, q)
```

训练时最小化交叉熵,等价于最小化预测分布 q 与真实分布 p 的 KL 散度(p 的熵是常数)。KL 散度衡量「两个分布有多不像」,非负,完全相等时为 0。

### 3.5 多分类 vs 二分类的 API

```python
# 二分类:输入 (N, 1) logit,Sigmoid 内置
nn.BCEWithLogitsLoss()

# 多分类:输入 (N, K) logits,Softmax 内置
nn.CrossEntropyLoss()
```

两者都自带数值稳定的 log-sum-exp 技巧,不要自己加 Softmax 再传 BCE / NLL,否则数值可能溢出。

---

## 4. PyTorch 实战

### 4.1 从零手写二分类逻辑回归

```python
import numpy as np
import torch
import matplotlib.pyplot as plt
from sklearn.datasets import make_classification
from sklearn.model_selection import train_test_split

torch.manual_seed(42)

# 合成数据:2 类,2 维特征
X, y = make_classification(n_samples=500, n_features=2, n_redundant=0,
                           n_informative=2, n_clusters_per_class=1, random_state=42)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

X_train_t = torch.from_numpy(X_train).float()
y_train_t = torch.from_numpy(y_train).float().unsqueeze(1)
X_test_t = torch.from_numpy(X_test).float()
y_test_t = torch.from_numpy(y_test).float().unsqueeze(1)


class LogisticRegression:
    def __init__(self, n_features, lr=0.1):
        self.W = torch.randn(n_features, 1, requires_grad=True)
        self.b = torch.zeros(1, requires_grad=True)
        self.lr = lr

    def forward(self, X):
        return torch.sigmoid(X @ self.W + self.b)  # (N, 1)

    def loss(self, y_hat, y):
        # 数值稳定的 BCE: -[y log p + (1-y) log(1-p)]
        eps = 1e-8
        p = torch.clamp(y_hat, eps, 1 - eps)
        return -(y * torch.log(p) + (1 - y) * torch.log(1 - p)).mean()

    def fit(self, X, y, epochs=200):
        losses = []
        for epoch in range(epochs):
            y_hat = self.forward(X)
            loss = self.loss(y_hat, y)
            losses.append(loss.item())

            loss.backward()
            with torch.no_grad():
                self.W -= self.lr * self.W.grad
                self.b -= self.lr * self.b.grad
                self.W.grad.zero_()
                self.b.grad.zero_()
        return losses


model = LogisticRegression(n_features=2, lr=0.5)
losses = model.fit(X_train_t, y_train_t, epochs=300)

# 评估
with torch.no_grad():
    y_pred = (model.forward(X_test_t) >= 0.5).float()
    acc = (y_pred == y_test_t).float().mean()
print(f"Test accuracy: {acc.item():.4f}")  # ~ 0.95
```

预期:`Test accuracy ≈ 0.94~0.96`,loss 曲线从 ~0.69 单调下降到 ~0.15。

### 4.2 nn.Module 版 Softmax 回归 + MNIST

```python
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import datasets, transforms
from torch.utils.data import DataLoader

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize((0.1307,), (0.3081,)),
])
train_loader = DataLoader(datasets.MNIST('data', train=True, download=True, transform=transform),
                          batch_size=64, shuffle=True)
test_loader = DataLoader(datasets.MNIST('data', train=False, transform=transform),
                         batch_size=256)


class SoftmaxRegression(nn.Module):
    """输入 784 -> 输出 10,中间无隐藏层(纯线性多分类)"""
    def __init__(self):
        super().__init__()
        self.fc = nn.Linear(784, 10)

    def forward(self, x):
        x = x.view(x.size(0), -1)
        return self.fc(x)  # CrossEntropyLoss 内含 log_softmax


model = SoftmaxRegression().to(device)
opt = torch.optim.SGD(model.parameters(), lr=0.1, momentum=0.9)

for epoch in range(3):
    model.train()
    for x, y in train_loader:
        x, y = x.to(device), y.to(device)
        opt.zero_grad()
        logits = model(x)
        loss = F.cross_entropy(logits, y)  # CrossEntropyLoss 等价
        loss.backward()
        opt.step()

# 评估
model.eval()
correct = 0
with torch.no_grad():
    for x, y in test_loader:
        x, y = x.to(device), y.to(device)
        correct += (model(x).argmax(1) == y).sum().item()
print(f"MNIST test acc: {correct / 10000:.4f}")  # ~ 0.92
```

预期:无隐藏层的 Softmax 回归 3 epoch 即可达 ~92%(线性模型在 MNIST 已足够强,因为手写数字基本线性可分)。

### 4.3 sklearn baseline 对比

```python
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score

clf = LogisticRegression(max_iter=1000, multi_class='multinomial')  # Softmax
clf.fit(X_train, y_train)
acc_sklearn = accuracy_score(y_test, clf.predict(X_test))
print(f"sklearn LogisticRegression acc: {acc_sklearn:.4f}")
```

预期与手写版本误差 ≤ 1e-3(同一最优化问题)。

### 4.4 类别不平衡下的阈值调整

```python
import numpy as np
from sklearn.datasets import make_classification

# 1:99 严重不平衡数据
X, y = make_classification(n_samples=10000, n_classes=2,
                            weights=[0.99, 0.01], random_state=42)
from sklearn.model_selection import train_test_split
X_tr, X_te, y_tr, y_te = train_test_split(X, y, stratify=y, test_size=0.2)

from sklearn.linear_model import LogisticRegression
clf = LogisticRegression(class_weight='balanced').fit(X_tr, y_tr)

proba = clf.predict_proba(X_te)[:, 1]

# 默认阈值 0.5:几乎所有都预测为负类,recall 极低
print("threshold=0.5:", (proba >= 0.5).sum(), "/", len(proba))

# 调低阈值:让更多样本被判为正类
from sklearn.metrics import precision_recall_curve
p, r, t = precision_recall_curve(y_te, proba)
# 在 PR 曲线上找 F1 最大点对应的阈值
f1 = 2 * p * r / (p + r + 1e-8)
best_threshold = t[f1[:-1].argmax()]
print(f"最佳阈值: {best_threshold:.4f}, F1 = {f1.max():.4f}")
```

直觉:类先验 1:99 时,贝叶斯最优阈值不再是 0.5,而是 `p_1 / p_0` 的对数比。

---

## 5. vs 其他分类方法

### 5.1 三大分类模型对比

| 维度 | 逻辑回归 / Softmax | SVM | 决策树 / RF |
|:---|:---|:---|:---|
| 决策边界 | 线性 | 线性 / 核非线性 | 轴对齐分段 |
| 训练目标 | 交叉熵(概率) | 最大间隔(几何) | 最小不纯度 |
| 输出 | 概率 | 类别(可校准) | 类别(可校准) |
| 训练复杂度 | O(Nd) | O(N²~N³) | O(Nd log N) |
| 推理复杂度 | O(d) | O(支持向量数) | O(树深度) |
| 可解释性 | 中(系数) | 中(支持向量) | 高(if-else) |
| 类别不平衡处理 | class_weight / 阈值 | class_weight | class_weight / 采样 |
| 特征规模 | 中小 d | 中等 d | 中大 d 都能行 |
| 多分类 | 原生 | OvO / OvR | 原生 |

### 5.2 交叉熵 vs Hinge Loss vs 0/1 Loss

|| 损失 | 数学 | 优点 | 缺点 |
|:---|:---|:---|:---|:---|
| **0/1 Loss** | [ŷ ≠ y] | 简单,直接优化准确率 | 不可导,无优化 |
| **Hinge(SVM)** | max(0, 1 − y·f(x)) | 最大间隔,稀疏解 | 不输出概率 |
| **Cross-Entropy** | −y log p | 概率输出,梯度简洁 | 对噪声标签敏感 |

### 5.3 一句话决策树

| 场景 | 首选 |
|:---|:---|
| 需要概率输出 / 阈值可调 | 逻辑回归 / Softmax |
| 类别中等,边界非线性 | SVM + 核 |
| 表格数据 + 需要可解释 | 决策树 / RF |
| 数据量大、特征多 | 神经网络末层 + Softmax |
| 类别严重不平衡 | 逻辑回归 + class_weight + 阈值调优 |

---

## 6. 常见坑

### 6.1 多分类输出层加了 Softmax 又传 NLLLoss
**症状**:loss 接近 0 或 NaN,训练崩坏
**原因**:`nn.NLLLoss` 期望 log_softmax 输入,模型再 softmax 一次 = log(p·p) 错位
**修法**:用 `nn.CrossEntropyLoss`(内部含 log_softmax),模型输出直接给 logits

### 6.2 Sigmoid 输出做多分类
**症状**:概率和 ≠ 1,语义错(把 10 类当成 10 个独立二分类)
**修法**:多分类用 Softmax(Sum=1)或 K 个独立 Sigmoid(类别不互斥时,如多标签分类)

### 6.3 类别不平衡直接用 0.5 阈值
**症状**:正类 recall < 10%,模型「装死」全预测负类
**修法**:① `class_weight='balanced'` 加权;② PR 曲线找最佳阈值;③ F1/ROC-AUC 作评估指标,不只看 accuracy

### 6.4 交叉熵手动写时没加 eps
**症状**:log(0) → NaN,loss 炸
**修法**:`p = torch.clamp(p, eps, 1-eps)`,或者直接用 `F.binary_cross_entropy_with_logits`(数值稳定)

### 6.5 标签忘了 one-hot
**症状**:`RuntimeError: 1D target tensor expected, multi-target not supported`
**修法**:CrossEntropyLoss 期望整数标签 `(N,)` 而不是 one-hot `(N, K)`;如果硬要 one-hot,改用 `F.cross_entropy` 配合 `F.one_hot`

### 6.6 Softmax 数值溢出
**症状**:z 较大时 `e^z = inf`,loss = NaN
**修法**:实现里先 `z - z.max()`,或者直接用 `nn.CrossEntropyLoss`(内部已处理)

### 6.7 特征未标准化
**症状**:loss 难收敛,系数尺度差异巨大
**修法**:训练前 `StandardScaler().fit_transform(X)`,梯度下降对特征尺度敏感

### 6.8 学习率过大,loss 震荡
**症状**:loss 曲线剧烈波动不下降
**修法**:降到 1e-3 ~ 1e-1 区间试;逻辑回归通常 lr=0.1 ~ 1,Softmax 多分类可适当降到 0.01

### 6.9 把概率当置信度直接用
**症状**:模型说 0.9 实际可能只有 0.7 的把握,上线后效果差
**修法**:用 `sklearn.calibration.CalibratedClassifierCV` 做概率校准,或用 Platt Scaling

### 6.10 多分类误用 OvR 决策
**症状**:Softmax 应该 K 个类互斥,OvR 让它们各自独立,选出的「最高」不一定最优
**修法**:类别互斥时首选 Softmax;类别可重叠(多标签)用 K 个独立 Sigmoid + BCE

---

## 7. 自检三问

**A. 为什么逻辑回归用交叉熵损失而不用 MSE?从「梯度饱和」和「概率解释」两个角度答。**

要点:① 梯度饱和:MSE 配合 Sigmoid 时梯度 = σ'(z)·(σ(z)−y),σ'(z) 最大仅 0.25,且预测错误越离谱 σ'(z) 越小 → 远处梯度消失,训练极慢;交叉熵梯度 = p − y,直接是「预测 − 真实」,不经过 σ',训练快。② 概率解释:交叉熵 = 负对数似然,直接最大化「预测分布与真实分布的拟合度」;MSE 假设高斯噪声,与伯努利输出语义不匹配。详见 §3.3。

**B. Softmax 公式中为什么用 e(自然指数)而不用别的正数?换成 2^z 行不行?**

要点:用 e 不是任意选择,而是为了让「梯度简洁」——交叉熵对 z_i 的梯度 = p_i − y_i,不依赖 σ 函数本身的复杂求导。这个简洁性来自 Softmax + Cross-Entropy 的组合属于「指数族 + 充分统计量」的天然搭配。换成 2^z 也能得到概率分布(和 = 1),但梯度不再简洁,且 e 是「自然对数」的底,与 cross-entropy 中 log 配对最自然。详见 §3.3 + §2.1。

**C. 逻辑回归的输出经过 Sigmoid 后,为什么 0.5 是天然决策阈值?类别先验不均衡(1:99)时阈值应该怎么调?**

要点:① 0.5 阈值对应「P(y=1|x)=0.5」,即两类的后验概率相等——这是类别先验 1:1 + 误判代价相等时的贝叶斯最优。② 不均衡(1:99)时,贝叶斯最优阈值 = P(y=1)/P(y=0) = 0.01,远低于 0.5;实际工程中应该用 PR 曲线找 F1 最大,或最小化业务定义的加权误判代价。详见 §4.4。

---

## 8. 推荐资源

### 视频
- **3Blue1Brown《深度学习:分类》**—— Softmax + 交叉熵直觉
- **Andrew Ng《Machine Learning Specialization》Week 3**—— 二分类逻辑回归 + 正则化
- **StatQuest《Logistic Regression》《Cross-Entropy》合集**—— 图解最直观
- **李宏毅《机器学习》Logistic Regression 章节**—— 中文讲解

### 教科书
- **《动手学深度学习》(D2L)** 第 3-4 章—— Softmax 回归 + 交叉熵从零实现
- **《机器学习》(周志华,西瓜书)** 第 3 章—— 对数几率回归
- **《统计学习方法》(李航)** 第 6 章—— 逻辑回归最大熵
- **《Deep Learning》(Goodfellow)** 第 4 章—— 数值计算 + 交叉熵

### 论文
- **Cox 1958《The Regression Analysis of Binary Sequences》**—— 逻辑回归起源
- **Verhulst 1838 / 1845 人口增长模型**—— Sigmoid 函数最早提出
- **Bridle 1990《Training Stochastic Model Recognition Algorithms as Networks can Lead to Maximum Mutual Information Estimation of Parameters》**—— Softmax + Cross-Entropy 配对理论
- **Niculescu-Mizil & Caruana 2005《Predicting Good Probabilities With Supervised Learning》**—— 概率校准

### 博客 / 课程
- **《机器学习基石》(林轩田)》—— 逻辑回归推导
- **Lilian Weng《Classification Loss Functions》**—— 损失函数全景
- **CS229(Stanford)Logistic Regression 笔记**—— 数学推导最严谨
- **PyTorch 官方 tutorial on Logistic Regression**—— 工程实现

### 代码
- **sklearn.linear_model.LogisticRegression**—— 工业级实现(solver=lbfgs/saga)
- **PyTorch nn.CrossEntropyLoss / nn.BCEWithLogitsLoss**—— 数值稳定
- **XGBoost / LightGBM**—— 表格数据 Softmax 多分类扩展
- **LightGBM focal_loss**—— 不平衡数据加权交叉熵

---

## 9. 本节要点

- **逻辑回归** = 线性回归 + Sigmoid,输出 (0, 1) 概率;学的是线性决策边界,只能解线性可分问题。
- **Sigmoid** σ(z) = 1/(1+e^{-z}),把任意实数压到 (0, 1);σ'(z) = σ(1−σ),最大值 0.25。
- **Softmax** 把 K 个 logits 归一化成「和 = 1 的概率分布」,多分类首选;实现时减最大值保数值稳定。
- **交叉熵** = 负对数似然,梯度 = p − y 极简;MSE 在分类上有「梯度饱和」问题,训练慢。
- **vs MSE / Hinge**:MSE 训练慢但输出概率,Hinge 间隔大但不输出概率;交叉熵兼得。
- **OvR vs Softmax**:类别互斥 → Softmax;类别可重叠(多标签)→ K 个独立 Sigmoid + BCE。
- **不平衡处理**:class_weight 加权 + 调阈值(PR 曲线找 F1 最大)+ 用 PR-AUC 评估。

---

## 10. 下一节:Day 9 · 决策树与随机森林

主题:从「白盒可解释」的决策树出发,理解信息增益 / Gini 系数如何选特征;再进入 Bagging 集成的随机森林,用「多棵树投票」把方差降下来,获得远超单棵树的泛化能力。覆盖:
- 决策树学习算法:ID3(信息增益,对多值特征偏心)、C4.5(增益率,归一化)、CART(Gini,工业默认)
- 不纯度度量:信息熵 H = −Σ p log p、信息增益、Gini = 1 − Σ p² 的几何含义
- 剪枝策略:预剪枝(max_depth / min_samples_leaf)vs 后剪枝(cost-complexity pruning)
- 随机森林:Bagging + column subsampling,OOB 估计免费 CV,两种特征重要性(MDI / Permutation)
- vs 单棵决策树:方差下降 + 不可解释性代价

产出物:① 手写一棵 CART 决策树并对比 sklearn 的 tree 结构;② 用 RandomForest 在 Titanic 数据集上跑出 OOB 分数 + 画出 Top-10 特征重要性条形图。

---

**作者**:林馨予 + 林晓月
**最后更新**:2026-07-04
**版权**:CC BY-NC-SA 4.0