---
layout: post
title: "Day 07|第 1 周复盘与 Kaggle Titanic 实战:把 6 天零件拼成第一个完整 Pipeline（AI 学习笔记 · 基础筑基周 · 第 7 篇）"
date: 2026-06-21 00:00:00 +0800
series: "AI 学习笔记"
tags:
  - "周复盘"
  - "Titanic"
  - "Kaggle"
  - "特征工程"
  - "Pipeline"
excerpt: ""
pinned: false
cover: null
draft: false
column: AI学习笔记
---


机器学习的最小实战不是「手写一个模型」,而是「把数据读进来、清洗好、喂给模型、把结果写出去」这四步走完。Week 1 用 6 天分别安装了 numpy、线性代数、梯度、概率、pandas/sklearn、线性回归这六块零件;今天用 Kaggle Titanic 这个有 891 行真实脏数据的入门赛,把零件拼成一条端到端的 Pipeline,跑出第一份提交,拿到 Public LB 上的第一个分数。

---

## 1. Week 1 全景回顾:6 天学了什么、用在哪里

### 1.1 七天主题串联表

| Day | 主题 | 核心技能(1 行) | 关键概念 / 产物 |
|:---|:---|:---|:---|
| Day 01 | Python 基础速通 | 列表/字典/函数/类,能用 numpy 向量化运算替代 for 循环 | 切片、推导式、广播、`np.dot` vs `*` |
| Day 02 | 线性代数核心 | 用向量表样本、矩阵表批量样本、点积表相似度 | 点积 / 矩阵乘法 / 特征值 = 数据主轴 |
| Day 03 | 微积分与梯度 | 偏导数 + 链式法则 + 沿负梯度方向迭代更新 | $\nabla L$、梯度下降、学习率 $\eta$ |
| Day 04 | 概率统计基础 | 用分布刻画数据、用贝叶斯用证据更新信念 | 期望、方差、$P(A\mid B)$、MLE |
| Day 05 | 工具链 | Jupyter 交互 + pandas 表格清洗 + matplotlib 可视化 + sklearn 一行调用 | `df.info()`、`df.describe()`、`fit/predict` |
| Day 06 | 第一个 ML 模型 | 从零拼出 $h(x)=w^\top x+b$ + MSE + 梯度下降的最小闭环 | 假设 / 损失 / 梯度 / 更新四件套 |
| **Day 07** | **周复盘 + Titanic** | **把上面六块零件拼成完整 Pipeline,产出一份 Kaggle 提交** | **EDA → 预处理 → 特征工程 → LR → submit.csv** |

### 1.2 一句话串起 6 天

Day 1 给 Python 工具箱;Day 2-3 给数学语言(向量、矩阵、梯度)用来描述「模型如何学习」;Day 4 给概率语言用来回答「模型为什么这么学」;Day 5 把所有工具装到 Jupyter + pandas + sklearn;Day 6 用这些工具亲手写出一个会收敛的线性回归;Day 7 把同一个线性回归塞进一个真实比赛,让它从教科书例子变成「读脏数据 → 出预测」的工业雏形。

### 1.3 最小 Pipeline 长什么样

把 6 天零件拆成 4 步 Pipeline,每一步对应一周内某一天学的内容:

```text
[原始 CSV] → 读 (Day 5 pandas)
           → 查 (Day 1 Python + Day 5 pandas 缺失值)
           → 改 (Day 2 矩阵化 + Day 6 特征工程)
           → 喂 (Day 6 线性回归 / sklearn)
           → 出 (Day 5 pd.DataFrame.to_csv)
```

每一步的失败模式都不同:**读错了** 是路径 / 编码问题;**查漏了** 是均值 / 中位数 / 业务默认值选错;**改错了** 是类别变量没编码或泄露了未来信息;**喂错了** 是特征矩阵 shape 对不上;**出错了** 是列名错(提交要 `PassengerId,Survived` 而不是 `id,pred`)。

---

## 2. 关键概念回顾:6 个零件每个 1 段

### 2.1 numpy:向量化运算

numpy 把 Python 列表封装成 $N$ 维数组,**通用函数**(ufunc)是逐元素操作的向量化实现。`(100,3) + (3,)` 通过 broadcasting 规则把 `(3,)` 自动扩展到 `(100,3)`,无需显式 `tile` 或 `repeat`。点积区分两种:`A * B` 是逐元素乘(Hadamard),`A @ B` 或 `np.dot(A,B)` 是矩阵乘(线性组合),Titanic 里 `X @ w + b` 就是矩阵乘。Day 1 的广播规则在 Day 6 的梯度下降里成为标配——`w -= lr * grad` 中 `w` 和 `grad` 都是 `(n_features,)` 形状,broadcasting 自动对齐。

### 2.2 矩阵 / 向量:样本的紧凑表达

一个数据集如果有 $N$ 个样本、$n$ 个特征,可以写成一个 $X \in \mathbb{R}^{N \times n}$ 矩阵,每行一个样本。线性回归的预测就是 $\hat y = X w + b$ —— 一次矩阵乘算出全部 $N$ 个预测,而不是循环 $N$ 次。Day 2 的矩阵乘法是 Day 6 `pred = X @ w + b` 的理论来源;Titanic 里把 `train_df[['Pclass','Sex','Age','Fare']]` 转成 numpy 矩阵就是这一步的具体落地。

### 2.3 梯度下降:参数如何学

损失 $L(w)$ 对参数 $w$ 的偏导数 $\nabla L$ 指向「最陡上升方向」,反方向就是「最陡下降」。Day 3 学了链式法则把多层复合函数的梯度拆成局部梯度相乘,Day 6 用它推出了线性回归的梯度公式:

```math
\frac{\partial L}{\partial w} = \frac{2}{N} X^\top (\hat y - y),\quad \frac{\partial L}{\partial b} = \frac{2}{N} \sum_i (\hat y_i - y_i)
```

更新规则 $w \leftarrow w - \eta \nabla_w L$ 把参数沿负梯度方向推一小步。Titanic 不需要手写梯度——sklearn 的 `LogisticRegression` 内部用更高级的优化器(L-BFGS / SAG),但原理相同。

### 2.4 概率:为什么是 MSE / Cross-Entropy

Day 4 学的极大似然估计把「选损失函数」变成「选数据分布」。假设残差 $\epsilon \sim \mathcal{N}(0,\sigma^2)$,最大化似然等价于最小化 MSE(Day 6)。Titanic 是**二分类**任务——目标服从伯努利分布 $y \sim \text{Bernoulli}(p)$,对应的损失是**交叉熵**(Binary Cross-Entropy),将在 Day 8 推导。今天只需记住:Titanic 用 MSE 是错的,要用对数损失 / 交叉熵族。

### 2.5 pandas:表格式数据操作

DataFrame 是带行列索引的二维表,Titanic 里 80% 的时间花在 `df` 上。常用操作:

| 操作 | 代码 | 用途 |
|:---|:---|:---|
| 看结构 | `df.info()` | 列类型 + 非空计数 |
| 看分布 | `df.describe()` | 数值列的均值/分位数 |
| 缺失值计数 | `df.isnull().sum()` | 找 Age/Cabin/Embarked 缺口 |
| 选择列 | `df[['Pclass','Sex']]` | 切出特征矩阵 |
| 条件筛选 | `df[df.Age > 60]` | 探索性分析 |
| 分组聚合 | `df.groupby('Sex').Survived.mean()` | EDA 求分组存活率 |
| 类别编码 | `pd.get_dummies(df, columns=['Sex'])` | one-hot 编码 |

### 2.6 线性回归:Week 1 的「完成态」

Day 6 写的线性回归 $\hat y = X w + b$ 只能预测**连续值**;Titanic 要预测的是 0/1(是否生还),所以今天先用 sklearn 的 `LogisticRegression`(它的内部是 sigmoid + 交叉熵 + L-BFGS),下周 Day 8 再从零手写一遍。Linear Regression 是 Week 1 的句号,Logistic Regression 是 Week 2 的开场。

### 2.7 Week 1 知识地图(纵向串联)

把 6 天内容放到一张「任务流」地图上看:

```text
Day 1-2  (Python + 线性代数) → 把数据写成矩阵 X ∈ R^{N×n}
Day 3    (梯度)              → 写出 ∂L/∂w,决定 w 怎么更新
Day 4    (概率)              → 选 L(w) 的形状(MSE vs Cross-Entropy)
Day 5    (工具)              → 用 pandas/sklearn 把上面写成 10 行代码
Day 6    (回归)              → 把所有零件拼成一条最小闭环
Day 7    (实战)              → 把闭环嵌入真实脏数据,产出一份可提交结果
```

每一层都是下一层的前置条件——Day 3 学梯度时大量调用 Day 2 的矩阵乘,Day 5 的 `LogisticRegression` 内部用了 Day 4 的 MLE 推导,Day 6 手写线性回归又把 Day 1 的 numpy 广播用得淋漓尽致。任何一环没学扎实,Day 7 的 Pipeline 就会在某一步卡壳(常见卡壳点:广播报错 / 损失函数不收敛 / one-hot 漏列)。

---

## 3. Kaggle Titanic 完整流程:5 步跑通端到端

### 3.1 比赛简介与数据

Kaggle Titanic 是「入门赛」,任务是预测泰坦尼克号 891 位乘客中每位是否生还(测试集 418 位)。数据字典(精简):

| 列 | 类型 | 含义 | 备注 |
|:---|:---|:---|:---|
| `PassengerId` | int | 乘客编号 | 提交时要原样带回 |
| `Survived` | int (0/1) | 是否生还 | **只有 train 有**,test 没 |
| `Pclass` | int (1/2/3) | 客舱等级 | 1=头等,3=三等 |
| `Name` | str | 姓名 | 含 Mr/Mrs/Master 等称谓 |
| `Sex` | str | 性别 | male/female |
| `Age` | float | 年龄 | 缺 ~20% |
| `SibSp` | int | 兄弟姐妹配偶数 | 同船 |
| `Parch` | int | 父母子女数 | 同船 |
| `Ticket` | str | 票号 | 高基数,通常不用 |
| `Fare` | float | 票价 | 缺 ~1 个 |
| `Cabin` | str | 客舱号 | 缺 ~77% |
| `Embarked` | str | 登船港口 | C/Q/S,缺 2 个 |

Public LB 用 50% 测试集打分,Private LB 用另外 50%(比赛结束时定榜)。新手只看 Public 容易过拟合到它的特定分布,**周复盘阶段只求 Public LB ≥ 0.75 即可**。

### 3.2 步骤一:EDA(探索性数据分析)

```python
import pandas as pd
train = pd.read_csv('/kaggle/input/titanic/train.csv')
test  = pd.read_csv('/kaggle/input/titanic/test.csv')

print(train.shape, test.shape)   # (891, 12) (418, 11)
print(train.info())
print(train.isnull().sum())
# Age       177
# Cabin     687
# Embarked    2

print(train.groupby('Sex').Survived.mean())   # female 0.742, male 0.188
print(train.groupby('Pclass').Survived.mean()) # 1: 0.63, 2: 0.47, 3: 0.24
```

EDA 阶段只读不改,目的是回答三个问题:**目标分布**(Survived 0/1 各占多少)、**列类型**(连续 / 类别 / 缺失)、**分组差异**(Sex / Pclass 与 Survived 的关系)。Titanic 的关键洞察是:**女性 + 头等舱** 存活率远超平均,**男性 + 三等舱** 几乎全灭。

### 3.3 步骤二:缺失值处理

| 列 | 缺失率 | 修法 | 原因 |
|:---|:---|:---|:---|
| `Age` | ~20% | 用 `Pclass` 和 `Sex` 的中位数分组填充 | 整体中位数会忽略阶层差异 |
| `Cabin` | ~77% | 缺失太多,丢列或只取首字母 `C85 → C` | 填空会引入大量噪声 |
| `Embarked` | 0.2% | 用众数 `'S'` 填充 | 仅 2 个,业务上合理 |
| `Fare`(test) | 0.2% | 用中位数填充 | 同上 |

**常见误区**:用「整个训练集的均值」填缺失值,会丢失 Pclass/Sex 分组信息;用「测试集自身的统计量」填测试集会造成轻微的数据泄露(影响很小,但原则上是错的——用 train 的统计量填 test)。

### 3.3.1 缺失值处理的 3 个原则

1. **缺失率 < 5%** → 用 train 的中位数 / 众数填充,业务影响极小
2. **缺失率 5%-40%** → 考虑分组填充或用「是否缺失」作为新特征
3. **缺失率 > 40%** → 直接丢列,强填会引入大量噪声

Titanic 三列缺失刚好覆盖三个区间:`Embarked` < 5% 用众数填,`Age` ~20% 用分组中位数填,`Cabin` ~77% 丢列。记住这三档阈值,任何数据集的缺失值都能在 5 秒内决定处理策略。

```python
# Age 缺失用 Pclass × Sex 分组中位数
train['Age'] = train.groupby(['Pclass', 'Sex'])['Age'].transform(
    lambda s: s.fillna(s.median())
)
test['Age']  = test.groupby(['Pclass', 'Sex'])['Age'].transform(
    lambda s: s.fillna(s.median())
)
train['Embarked'].fillna('S', inplace=True)
test['Fare'].fillna(test['Fare'].median(), inplace=True)
train.drop(columns=['Cabin'], inplace=True)   # 缺太多直接丢
test.drop(columns=['Cabin'], inplace=True)
```

---

## 3.4 步骤三:特征工程

**one-hot 编码**把字符串类别变成 0/1 列:

```python
# 类别编码
train = pd.get_dummies(train, columns=['Sex', 'Embarked'], drop_first=True)
test  = pd.get_dummies(test,  columns=['Sex', 'Embarked'], drop_first=True)
# drop_first=True 避免完全共线(冗余):Sex_male 出现时 Sex_female 必然不出现
```

**派生特征**(domain knowledge):

```python
for df in (train, test):
    df['FamilySize'] = df['SibSp'] + df['Parch'] + 1   # +1 是本人
    df['IsAlone']    = (df['FamilySize'] == 1).astype(int)
    # 姓名称谓(Mr/Mrs/Master/Miss)能区分性别 + 年龄 + 社会地位
    df['Title'] = df['Name'].str.extract(r' ([A-Za-z]+)\.')
    df['Title'] = df['Title'].replace(
        ['Lady','Countess','Capt','Col','Don','Dr','Major',
         'Rev','Sir','Jonkheer','Dona'], 'Rare')
    df['Title'] = df['Title'].replace({'Mlle':'Miss','Ms':'Miss','Mme':'Mrs'})
```

**特征选择**:丢掉对预测无帮助的列(`PassengerId`,`Name`,`Ticket`,理论上 `PassengerId` 要保留到提交时再用)。

### 3.5 步骤四:建模与本地评估

```python
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score

y = train['Survived']
X = train.drop(columns=['Survived', 'PassengerId', 'Name', 'Ticket', 'Title'])

model = LogisticRegression(max_iter=1000, C=1.0)
scores = cross_val_score(model, X, y, cv=5, scoring='accuracy')
print(scores.mean(), scores.std())   # ~0.80 ± 0.02
```

5 折交叉验证给出 ±0.02 的本地分数,这就是上 Kaggle 之前的「沙盘推演」——比直接拿全部数据训练再评估更可信。`C=1.0` 是正则化强度的倒数,值越大正则化越弱。

### 3.6 步骤五:训练 + 预测 + 提交

```python
model.fit(X, y)
X_test = test.drop(columns=['PassengerId', 'Name', 'Ticket', 'Title'])
pred   = model.predict(X_test)

submission = pd.DataFrame({
    'PassengerId': test['PassengerId'],
    'Survived':    pred.astype(int),
})
submission.to_csv('submission.csv', index=False)
```

`index=False` 一定要加,否则 pandas 会把 DataFrame 索引写成第一列,Kaggle 报列数错误。提交后页面会立刻给出 Public LB 分数,新手第一次跑通常在 0.75-0.80 之间。

### 3.7 提交格式铁律

| 项 | 要求 | 错的后果 |
|:---|:---|:---|
| 文件名 | `submission.csv` | 别的名字会被识别成「无效提交」 |
| 列名 | 必须含 `PassengerId` 和 `Survived` | 评分脚本读不到 |
| 行数 | 与 test 一致(418) | 多/少都报错 |
| `Survived` 类型 | int(0/1),不是 float 或 str | 报错或分数极低 |
| 索引列 | 不要写入(默认 `index=False`) | 多出一列导致对齐失败 |

---

## 4. PyTorch / sklearn 完整 Pipeline 代码

下面是一份**端到端可运行**的 Mini-Pipeline,涵盖「数据加载 → 预处理 → 训练 → 交叉验证 → 预测 → 提交」全流程,可以直接粘到 Kaggle Notebook 跑。

### 4.1 sklearn 版本(主用)

```python
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

# ---------- 1. 加载 ----------
train = pd.read_csv('/kaggle/input/titanic/train.csv')
test  = pd.read_csv('/kaggle/input/titanic/test.csv')
y = train['Survived'].values
test_id = test['PassengerId']

# ---------- 2. 预处理 ----------
def preprocess(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    # 缺失值
    df['Age'] = df.groupby(['Pclass','Sex'])['Age']\
        .transform(lambda s: s.fillna(s.median()))
    df['Embarked'].fillna('S', inplace=True)
    df['Fare'].fillna(df['Fare'].median(), inplace=True)
    # 派生特征
    df['FamilySize'] = df['SibSp'] + df['Parch'] + 1
    df['IsAlone']    = (df['FamilySize'] == 1).astype(int)
    # 类别编码
    df = pd.get_dummies(df, columns=['Sex','Embarked'], drop_first=True)
    # 丢弃
    return df.drop(columns=['PassengerId','Name','Ticket','Cabin'],
                   errors='ignore')

X_train_df = preprocess(train)
X_test_df  = preprocess(test)

# 对齐列:确保 test 跟 train 同样的列
X_test_df = X_test_df.reindex(columns=X_train_df.columns, fill_value=0)

X_train = X_train_df.values.astype(np.float32)
X_test  = X_test_df.values.astype(np.float32)

# ---------- 3. Pipeline(标准化 + 模型) ----------
pipe = Pipeline([
    ('scaler', StandardScaler()),
    ('clf',    LogisticRegression(max_iter=1000, C=1.0)),
])

# ---------- 4. 本地评估 ----------
scores = cross_val_score(pipe, X_train, y, cv=5, scoring='accuracy')
print(f'CV acc: {scores.mean():.4f} ± {scores.std():.4f}')
# 预期输出: CV acc: 0.80 ± 0.02

# ---------- 5. 全量训练 + 预测 + 提交 ----------
pipe.fit(X_train, y)
pred = pipe.predict(X_test)

pd.DataFrame({'PassengerId': test_id, 'Survived': pred.astype(int)})\
  .to_csv('submission.csv', index=False)
```

**预期输出**:CV acc 约 0.80±0.02;Public LB 约 0.77-0.79。这是「线性分类器 + 基础特征工程」的天花板区间,再要提分需要换模型(RandomForest / XGBoost,Week 2-Day 9/10)。

### 4.2 PyTorch 版本(可对照)

Logistic Regression 在 PyTorch 里就是一个 **无隐藏层的单层网络**,本质等价于 sklearn 版本:

```python
import torch
import torch.nn as nn

torch.manual_seed(0)

X_t = torch.from_numpy(X_train)
y_t = torch.from_numpy(y.astype(np.float32)).unsqueeze(1)
X_test_t = torch.from_numpy(X_test)

model     = nn.Linear(X_train.shape[1], 1)
loss_fn   = nn.BCEWithLogitsLoss()      # 自带 sigmoid + 交叉熵
optimizer = torch.optim.SGD(model.parameters(), lr=0.05, momentum=0.9)

for epoch in range(300):
    logits = model(X_t)
    loss   = loss_fn(logits, y_t)
    optimizer.zero_grad()
    loss.backward()
    optimizer.step()

with torch.no_grad():
    logits_test = model(X_test_t)
    pred = (logits_test > 0).int().squeeze(1).numpy()
```

`BCEWithLogitsLoss` 比手写 `sigmoid + BCE` 数值更稳(内部用 log-sum-exp 技巧)。300 轮 SGD 在 Titanic 上收敛到与 sklearn 接近的 0.80。PyTorch 版本主要用来对照「梯度下降 + 反向传播」的工程实现,真正上分还是用 sklearn / XGBoost。

### 4.3 跑通后的最小验证

| 检查项 | 期望 |
|:---|:---|
| `submission.csv` 行数 | 418 |
| `submission.csv` 列 | `PassengerId,Survived` |
| `Survived` 取值 | 仅 0 / 1 |
| `PassengerId` 与 test 一一对应 | 是 |
| CV 分数 | ≥ 0.78 |
| Public LB 分数 | ≥ 0.75 |

---

## 5. Week 1 vs Week 2:难度与心智模型对比

| 维度 | Week 1(基础筑基) | Week 2(经典机器学习) |
|:---|:---|:---|
| 数学 | 线性代数 + 微积分 + 概率(都是单变量 / 矩阵层面) | 概率图模型 + 信息论 + 优化理论 |
| 工具 | numpy 手写梯度下降 | sklearn 全家桶,几乎不手写 |
| 任务类型 | 单输出回归(连续值) | 分类(SVM/树/集成)+ 聚类 + 降维 |
| 评估指标 | MSE / $R^2$ | Accuracy / F1 / AUC / Silhouette |
| 数据维度 | 通常 < 10 特征 | 可能数百特征,要降维 / 特征选择 |
| 调参量 | 学习率 + epoch | 正则化 + 树的深度 + 核函数 + K 值 |
| 抽象层级 | 「这个公式在算什么」 | 「这个模型在拟合什么分布」 |
| 失败模式 | 数值发散 / 不收敛 | 过拟合 / 类别不平衡 / 维度灾难 |
| 产出物 | 一个会收敛的回归器 | 多个模型对比的 Leaderboard |
| 核心心智 | 「梯度下降在沿最陡方向下山」 | 「不同模型对应不同归纳偏置」 |

Week 2 的难度跃迁点:① 损失函数从 MSE 变成 Cross-Entropy / Hinge / Gini;② 模型从「一条直线」变成「一片决策边界」;③ 评估从「单数字」变成「多条 ROC 曲线 / 多类别 F1 表」。Week 1 学会的「Pipeline 思维」(读 → 查 → 改 → 喂 → 出)在 Week 2 不变,**变的是中间那一步——模型本身**。

---

## 6. 常见坑(7 条,Titanic 实战典型)

### 6.1 提交后 Public LB 分数比本地 CV 低 0.05+

**症状**:本地 5 折 CV 显示 0.82,提交后 Public LB 只有 0.76。
**原因**:测试集分布与训练集有偏差(Pclass 比例不同 / 年龄段缺失方式不同);Public LB 只用 50% 测试集,样本量小、方差大。
**修法**:① 反复提交会「过拟合 Public LB」,Kaggle 把它当作弊;② 用本地 CV 作为主要决策依据,Public LB 只做最后定榜参考;③ 引入 Cross-Validation 多次随机种子平均,降低本地分数方差。

### 6.2 训练时数据泄露:用 test 的统计量填 test 的缺失值

**症状**:本地 CV 看起来正常,但 LB 分数波动大、跨数据集会崩。
**原因**:`test['Fare'].fillna(test['Fare'].median())` 中,test 的中位数在推理时只能「理论存在」,真实场景新数据进来时没有这个统计量。
**修法**:缺失值填充一律用「训练集统计量」——`fillna(train['Fare'].median())` 或者更稳的 sklearn `SimpleImputer(strategy='median')` 在 Pipeline 里 fit on train only。

### 6.3 类别变量没编码,直接喂给 LogisticRegression

**症状**:`ValueError: could not convert string to float: 'male'`
**原因**:模型只能吃数字,字符串列必须转成 0/1 或整数索引。
**修法**:`pd.get_dummies(df, columns=['Sex','Embarked'], drop_first=True)`;如果是高基数类别(如 Ticket),用 `TargetEncoder` 或 `FrequencyEncoder`,不要用 LabelEncoder 直接喂 LR。

### 6.4 训练 / 测试列对不上,预测全是 NaN

**症状**:`pred` 全是 NaN,提交后 LB 分数接近 0。
**原因**:train 做了 one-hot 后多了 `Sex_male` 列,test 没有(因为某性别在 test 全是同一性别);或者 test 多了 `Title_Rare` 但 train 没。
**修法**:`X_test = X_test.reindex(columns=X_train.columns, fill_value=0)` 强制对齐;在 preprocess 函数里确保 train / test 用完全相同的编码逻辑,不要分两个函数写。

### 6.5 过拟合到 Public LB,Private LB 大幅下跌

**症状**:Public LB 0.81,Private LB 0.74,排名腰斩。
**原因**:每天提交多次,根据 Public LB 反馈调模型,等于把 Public 当训练集做了几十次「训练」。
**修法**:限制每日提交次数(≤ 2);用本地 CV 作为主要决策;只在最终版本提交一次。

### 6.6 用线性回归跑分类,LB 分数卡在 0.65

**症状**:`LinearRegression().fit(X, y).predict(X_test)` 输出含负数和 > 1 的小数,提交后 LB 0.65。
**原因**:线性回归对二分类目标是无界的连续输出,阈值 0.5 是后置硬切的,数学上不对。
**修法**:换 `LogisticRegression`(输出是概率)或 `RidgeClassifier`(输出是 0/1);Day 8 会从零推导为什么 sigmoid + cross-entropy 是对的。

### 6.7 Cabin 缺失 77% 还硬填,引入噪声

**症状**:把 `Cabin` 缺失填成 `'U'`(Unknown)再 one-hot,模型分数反而下降。
**原因**:77% 缺失不是「随机缺失」,是「三等舱乘客根本没登记 Cabin」——缺失本身是信号。
**修法**:把「缺失」当成一个新的类别 `Cabin_known=0/1`,或干脆丢列;不要用均值 / 中位数填补高基数字符串列。

---

## 7. 自检三问

**A. 为什么 Titanic 不能直接用线性回归,必须用 LogisticRegression?**

要点:目标 `Survived` 是 0/1 二分类标签,假设标签服从伯努利分布 $y \sim \text{Bernoulli}(p)$,极大似然对应的损失是交叉熵(负对数似然),不是 MSE;线性回归输出无界(可能 < 0 或 > 1),无法解释为概率;LogisticRegression 用 sigmoid $\sigma(z)=\frac{1}{1+e^{-z}}$ 把线性输出压到 $(0,1)$ 当概率,再用交叉熵做优化——数学上自洽,数值上稳定。

**B. 缺失值处理时,为什么「用训练集的均值填测试集」是对的,而「用测试集自己的均值」是错的?**

要点:训练 / 测试划分模拟「未来数据」,推理时只有训练统计量可用;用 test 自己的统计量等于偷偷看了答案(轻微泄露),在小数据集上影响不大但原则错误;在 Pipeline 里用 `SimpleImputer` 只 fit on train,transform on both 是工程上的标准做法。

**C. 5 折交叉验证的 0.80 和 Public LB 的 0.78 哪个更可信?为什么?**

要点:本地 5 折 CV 更可信——它在 891 个有标签样本上做 5 次完整训练,每次用 712 训 / 179 验,样本量充分、方差可估计;Public LB 只用 209 个样本(418 的 50%),样本量小、分布偏、单次方差大;但 LB 是真实分布,可以校准 CV 是否有系统性偏差(若 CV 0.82 / LB 0.78 长期出现,说明本地 CV 存在轻度过拟合,可能是用了对 test 有信息泄露的特征工程)。

---

## 8. 推荐资源(5 类)

### 视频
- **Kaggle Learn · Intro to ML**(免费,4 小时):用 Titanic 当教学案例,讲 train/test split + 简单模型
- **StatQuest · Logistic Regression**(YouTube):用图形讲清 sigmoid + cross-entropy 的几何直觉
- **Andrew Ng · Machine Learning Specialization · Course 1 Week 2**:线性 / Logistic 回归的数学推导

### 教科书 / 文档
- **《动手学深度学习》d2l.ai 第 3 章**:线性回归与 softmax 的统一框架,中文免费
- **scikit-learn 官方文档 · User Guide 1.1~1.9**:Linear/Logistic Regression、Pipelines、Cross-Validation
- **Kaggle Learn · Intermediate ML**:缺失值、类别编码、交叉验证、Pipeline

### 实战项目 / 代码
- **Kaggle Titanic · "Megan Risdal" 经典 EDA Notebook**:业界流传最广的 Titanic 教学 notebook
- **Kaggle Titanic · "Best Titanic Notebook" Top-10 Leaderboard 公开方案**:看高分手怎么特征工程
- **Hands-on ML (Aurélien Géron) 第 4 章 end-to-end 项目模板**:把 Pipeline 概念落实到工业级代码

### 博客
- **Towards Data Science · "Titanic Challenge: A Beginner's Guide"**:从注册到提交全流程图文
- **Chris Albon · Machine Learning Flashcards**:每张卡片解释一个 ML 概念,Titanic 用到的都覆盖

### 论文 / 标准
- **Cox 1958 · "The Regression Analysis of Binary Sequences"**:Logistic Regression 的原始论文
- **Kaggle Competition 官方规则页**:Public/Private LB 划分机制、数据使用条款

---

## 9. 本节要点

- **要 1**:Week 1 的 6 天零件(数据 / 矩阵 / 梯度 / 概率 / 工具 / 回归)在 Day 7 拼成了一条完整 Pipeline,顺序是「读 → 查缺失 → 改特征 → 喂模型 → 出 csv」
- **要 2**:Titanic 是二分类任务,损失函数是交叉熵不是 MSE,模型用 `LogisticRegression`(内部 sigmoid + cross-entropy)
- **要 3**:缺失值处理必须 fit on train,transform on both;高基数 / 高缺失率(如 Cabin 77%)列直接丢或转成「是否已知」二值
- **要 4**:类别列必须 `pd.get_dummies(..., drop_first=True)` 避免完全共线,且 train / test 必须用相同编码逻辑后 `reindex` 对齐
- **要 5**:5 折 CV 是本地主要决策依据,Public LB 只用于最终定榜参考;每天提交 ≤ 2 次避免过拟合 LB
- **要 6**:提交文件铁律——文件名 `submission.csv`、两列 `PassengerId,Survived`、`Survived` 是 int、`index=False`
- **要 7**:Pipeline 思维(读 → 查 → 改 → 喂 → 出)是 Week 1 的最大收获,Week 2 学的所有模型都嵌在这条管道里

---

## 10. 下一节:Day 08 · 分类问题与逻辑回归

主题:把 Day 6 的「回归连续值」思路,迁移到「分类离散标签」——sigmoid 把线性输出压到 (0,1) 当概率,Cross-Entropy 衡量两个伯努利分布的距离。

覆盖:
- 逻辑回归的假设函数 $\hat p = \sigma(w^\top x + b)$,其中 $\sigma(z) = \frac{1}{1+e^{-z}}$
- 二分类交叉熵损失 $L = -\frac{1}{N}\sum_i [y_i \log \hat p_i + (1-y_i)\log(1-\hat p_i)]$
- Softmax 拓展到 K 分类,推导 $\nabla L$ 并用手写梯度下降复现 sklearn `LogisticRegression` 的等价收敛

产出物:从零手写一个 `LogisticRegression` 类,fit 一个玩具二分类数据集并画出决策边界;再用 sklearn 验证权重一致——完成 Week 2 的「第二个从零实现」。