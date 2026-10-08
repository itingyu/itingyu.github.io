---
layout: post
title: "Day 10｜梯度提升:XGBoost 与 LightGBM,表格数据的「默认基线」（AI 学习笔记 · 经典机器学习周 · 第 10 篇）"
date: 2026-06-24 00:00:00 +0800
series: "AI 学习笔记"
excerpt: ""
pinned: false
cover: null
draft: false
column: AI学习笔记
---


梯度提升(Gradient Boosting)是 Boosting 家族的代表,用「串行训练 + 拟合残差」的策略把若干棵弱决策树拼成一个强学习器;XGBoost 给它加上二阶展开与正则化,LightGBM 再从工程层面把直方图、GOSS、EFB 三件套拉满——这两个名字到今天仍是 Kaggle 表格赛和工业 CTR 风控的默认起点。

---

## 1. 加法模型与前向分步

### 1.1 加法模型定义

梯度提升的目标是把一个强学习器写成若干弱学习器的加权和:

```math
F_M(x) = \sum_{m=1}^{M} \gamma_m \cdot h_m(x)
```

- `h_m(x)` 是第 m 棵弱学习器(决策树)
- `γ_m` 是第 m 棵树的权重(也叫步长 / 学习率贡献)
- `M` 是树的总数

**前向分步算法**:从 `F_0(x) = 0` 开始,每一步只训练一个新弱学习器 `h_m` 去拟合「当前模型还解释不了的部分」:

```math
F_m(x) = F_{m-1}(x) + \gamma_m \cdot h_m(x)
```

训练结束,模型就是这 M 棵树的累加。

### 1.2 为什么叫「梯度提升」

把损失函数 `L(y, F(x))` 在当前预测 `F_{m-1}(x)` 处做一阶 Taylor 展开,可得负梯度方向恰好就是回归残差(对 MSE 损失)或对数几率残差(对 LogLoss 损失):

```math
r_{i,m} = -\left[ \frac{\partial L(y_i, F(x_i))}{\partial F(x_i)} \right]_{F = F_{m-1}}
```

让新树 `h_m` 拟合这些「伪残差」,就相当于沿损失函数的最速下降方向走一步。Boosting = 沿函数空间的梯度下降。

| 概念 | 类比 | 角色 |
|:---|:---|:---|
| 学习率 η | 步长 | 控制每棵树贡献,小步慢走更稳 |
| 树的深度 | 步数 | 单棵树的复杂度 |
| 子样本比例 | 随机梯度 | 注入随机性、降方差 |
| 正则项 | 步长惩罚 | 防止单棵树过度拟合 |

---

## 2. GBDT 核心:串行 + 残差近似

### 2.1 GBDT 算法伪代码

```
输入:训练集 D = {(x_i, y_i)}, i=1..N
参数:树数 M, 学习率 η, 深度 d

F_0(x) = 初始值(回归=均值;分类=log odds)
for m = 1..M:
    # 1. 算负梯度(伪残差)
    r_im = -∂L(y_i, F(x_i)) / ∂F(x_i)   (在 F_{m-1} 处)
    # 2. 用回归树拟合 r_im → 得 h_m(x)
    h_m = DecisionTree(r_im, depth=d)
    # 3. 沿叶子节点求最优步长 γ_m
    γ_m = argmin_γ  Σ L(y_i, F_{m-1}(x_i) + γ · h_m(x_i))
    # 4. 更新模型
    F_m(x) = F_{m-1}(x) + η · γ_m · h_m(x)
```

### 2.2 与随机森林的关键区别

| 维度 | 随机森林 (Bagging) | GBDT (Boosting) |
|:---|:---|:---|
| 训练方式 | 并行 | 串行 |
| 拟合目标 | 原始 y | 残差 / 负梯度 |
| 子模型权重 | 等权平均 | 加权和(后续权重更大) |
| 主要降什么 | 方差 | 偏差 |
| 单棵树深度 | 深(完全生长) | 浅(3~8 层) |
| 对异常值 | 鲁棒 | 敏感(平方损失放大) |

**核心直觉**:Bagging 用并行+平均降方差,Boosting 用串行+残差降偏差。

### 2.2.1 偏差-方差分解视角

对泛化误差做偏差-方差分解:

```math
\mathbb{E}[(y - \hat{F}(x))^2] = \underbrace{(\mathbb{E}[\hat{F}(x)] - F^*(x))^2}_{\text{Bias}^2}
                                 + \underbrace{\mathbb{V}[\hat{F}(x)]}_{\text{Variance}}
                                 + \underbrace{\sigma^2}_{\text{Noise}}
```

- 单棵决策树是低偏差高方差(树越深越容易拟合训练集,但对数据抖动敏感)
- Bagging 通过 m 棵独立树的平均把方差降到 1/m
- Boosting 通过逐步拟合残差把偏差拉到接近零(每棵树都在纠前一次的错)
- 这就是为什么 RF 用完全生长的深树,GBDT 用 3~8 层的浅树——RF 要降方差,GBDT 要降偏差

### 2.3 为什么新树拟合「残差」等价于负梯度

对平方损失 `L = ½(y - F)²`:

```math
∂L/∂F = -(y - F) = -残差
```

所以 `-∂L/∂F = 残差`,新树拟合残差 = 沿 MSE 负梯度走一步。

对 LogLoss `L = -y log p - (1-y) log (1-p)`(p = σ(F)):

```math
∂L/∂F = p - y = -(y - p)
```

所以拟合 `(y - p)` 这种「概率残差」,等价于沿 LogLoss 负梯度走一步。这就是 GBDT 既能做回归也能做分类的统一视角。

---

## 3. XGBoost:二阶展开 + 正则化

### 3.1 目标函数

XGBoost 在 GBDT 基础上对损失函数做二阶 Taylor 展开,并显式加正则项:

```math
\mathcal{L}^{(m)} = \sum_i L(y_i, F_{m-1}(x_i) + f_m(x_i))
                    + \Omega(f_m)
```

其中正则项:

```math
\Omega(f) = \gamma T + \frac{1}{2} \lambda \sum_{j=1}^{T} w_j^2
```

- `T` = 叶子节点数
- `w_j` = 第 j 片叶子的输出权重
- `γ` 控制叶子数惩罚,`λ` 控制叶子权重大小惩罚

### 3.2 二阶展开

把 `L` 在 `F_{m-1}` 处 Taylor 展开,保留到二阶:

```math
\mathcal{L}^{(m)} \approx \sum_i \left[ L_i + g_i f_m(x_i) + \frac{1}{2} h_i f_m(x_i)^2 \right] + \Omega(f_m)
```

- `g_i = ∂L/∂F` 一阶梯度
- `h_i = ∂²L/∂F²` 二阶梯度(Hessian)
- 移除常数项 `L_i`,得到

```math
\tilde{\mathcal{L}}^{(m)} = \sum_i \left[ g_i f_m(x_i) + \frac{1}{2} h_i f_m(x_i)^2 \right]
                           + \gamma T + \frac{1}{2} \lambda \sum_j w_j^2
```

按叶子求和得:

```math
\tilde{\mathcal{L}}^{(m)} = \sum_{j=1}^{T} \left[ G_j w_j + \frac{1}{2}(H_j + \lambda) w_j^2 \right] + \gamma T
```

其中 `G_j = Σ_{i∈leaf_j} g_i`,`H_j = Σ_{i∈leaf_j} h_i`。对 `w_j` 求导令为 0,得:

```math
w_j^* = -\frac{G_j}{H_j + \lambda}
```

代回得叶子 j 的最优目标值:

```math
\text{Obj}_j = -\frac{1}{2} \frac{G_j^2}{H_j + \lambda} + \gamma
```

### 3.3 分裂增益

把样本集合 `I` 切成左右两份 `I_L` 和 `I_R` 后的增益:

```math
\text{Gain} = \frac{1}{2} \left[ \frac{G_L^2}{H_L + \lambda} + \frac{G_R^2}{H_R + \lambda} - \frac{(G_L+G_R)^2}{H_L+H_R + \lambda} \right] - \gamma
```

三部分含义:左叶子贡献 + 右叶子贡献 - 父节点贡献 - 分裂成本(γ)。增益为正则分裂,否则保留叶节点。

### 3.4 缺失值自动方向

XGBoost 在每次分裂时,枚举「缺失值走左 vs 走右」两种方向,选 gain 最大的方向作为默认方向——训练时不需要先 impute。

### 3.5 特征重要性三种口径

| 口径 | 定义 | 直观 |
|:---|:---|:---|
| weight | 特征被用作分裂点的次数 | 用得多不多 |
| gain | 用该特征分裂带来的平均 gain | 分得好不好 |
| cover | 该特征分裂时涉及的样本数 | 影响范围 |

---

## 4. LightGBM:三件套工程优化

### 4.1 直方图算法(Histogram)

XGBoost 的精确分裂要枚举每个特征的所有可能切分点,O(data)。LightGBM 把连续特征离散化成 k 个 bin(默认 256),分裂时只查 bin 边界——单特征从 O(N) 降到 O(bins)。

代价:精度损失(同一 bin 内不可分),但实际经验里几乎不影响最终指标。

### 4.2 GOSS(Gradient-based One-Side Sampling)

直觉:梯度大的样本是「难样本」,梯度小的样本已经学得差不多。GOSS 保留所有大梯度样本 + 随机采样小梯度样本,再用一个常数乘子补偿小梯度的权重分布偏差。

```math
\text{GOSS 权重} = \begin{cases}
1 & \text{大梯度样本} \\
\frac{1-a}{b} & \text{被采到的小梯度样本}
\end{cases}
```

其中 a = 大梯度比例,b = 小梯度采样比例。

### 4.3 EFB(Exclusive Feature Bundling)

稀疏矩阵里很多特征互斥(同时为非零的概率极低,如 one-hot 后的类别特征)。EFB 把互斥特征捆绑成一列,特征数从 d 降到 d',计算量减少近 `d/d'` 倍。

判定「互斥」用图着色:特征为顶点,有交集的特征连边,着色后的每种颜色 = 一个 bundle。

### 4.4 leaf-wise vs level-wise

| 生长方式 | 描述 | 优点 | 缺点 |
|:---|:---|:---|:---|
| level-wise(XGBoost 默认) | 按层生长,深度均衡 | 训练快、易并行 | 同样深度可能多算无用叶 |
| leaf-wise(LightGBM 默认) | 每次选 gain 最大的叶子分裂 | 精度高、收敛快 | 深、易过拟合,需 `max_depth`/`num_leaves` |

**手动约束**:`num_leaves ≤ 2^max_depth` 是 leaf-wise 的近似等效设置。

---

## 5. PyTorch / sklearn 实战

### 5.1 XGBoost 端到端(回归 + 早停)

```python
import numpy as np
from sklearn.datasets import fetch_california_housing
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, r2_score
import xgboost as xgb

X, y = fetch_california_housing(return_X_y=True)
X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42)

dtrain = xgb.DMatrix(X_tr, label=y_tr)
dtest  = xgb.DMatrix(X_te, label=y_te)

params = {
    "objective": "reg:squarederror",
    "eta": 0.05,                  # 学习率
    "max_depth": 6,
    "subsample": 0.8,             # 行采样
    "colsample_bytree": 0.8,      # 列采样
    "lambda": 1.0,                # L2 正则
    "alpha": 0.0,                 # L1 正则
    "tree_method": "hist",        # 直方图加速
    "eval_metric": "rmse",
}
bst = xgb.train(
    params, dtrain, num_boost_round=2000,
    evals=[(dtest, "test")],
    early_stopping_rounds=50,
    verbose_eval=100,
)
pred = bst.predict(dtest, iteration_range=(0, bst.best_iteration + 1))
print("RMSE:", np.sqrt(mean_squared_error(y_te, pred)))
print("R2  :", r2_score(y_te, pred))
```

### 5.2 LightGBM 多分类 + 类别特征直传

```python
import lightgbm as lgb
from sklearn.datasets import load_wine
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.metrics import accuracy_score

X, y = load_wine(return_X_y=True)
X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2,
                                          stratify=y, random_state=42)

dtrain = lgb.Dataset(X_tr, label=y_tr)
dvalid = lgb.Dataset(X_te, label=y_te, reference=dtrain)

params = {
    "objective": "multiclass",
    "num_class": 3,
    "learning_rate": 0.05,
    "num_leaves": 31,
    "max_depth": -1,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "min_data_in_leaf": 20,
    "lambda_l1": 0.1,
    "lambda_l2": 0.1,
    "verbose": -1,
}

model = lgb.train(
    params, dtrain, num_boost_round=1500,
    valid_sets=[dvalid],
    callbacks=[lgb.early_stopping(50), lgb.log_evaluation(100)],
)
pred = model.predict(X_te, num_iteration=model.best_iteration).argmax(axis=1)
print("Acc:", accuracy_score(y_te, pred))
```

### 5.3 三模型对比(同数据)

```python
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score
import time, xgboost as xgb, lightgbm as lgb

sk = GradientBoostingClassifier(n_estimators=200, max_depth=3, learning_rate=0.05)
t0 = time.time(); sk.fit(X_tr, y_tr); t_sk = time.time() - t0
acc_sk = accuracy_score(y_te, sk.predict(X_te))

dtrain = lgb.Dataset(X_tr, y_tr); dvalid = lgb.Dataset(X_te, y_te, reference=dtrain)
t0 = time.time()
mdl_lgb = lgb.train({"objective": "multiclass", "num_class": 3, "verbose": -1},
                    dtrain, 200, valid_sets=[dvalid],
                    callbacks=[lgb.early_stopping(20, verbose=False)])
t_lgb = time.time() - t0
acc_lgb = accuracy_score(y_te, mdl_lgb.predict(X_te).argmax(axis=1))

print(f"sklearn GBDT  acc={acc_sk:.4f}  time={t_sk:.2f}s")
print(f"LightGBM      acc={acc_lgb:.4f}  time={t_lgb:.2f}s")
```

经验结果:LightGBM 在 1k~1M 行规模的表格数据上,通常比 sklearn GBDT 快 5~50 倍,精度持平或略优。

### 5.4 XGBoost 调参路线图(实战模板)

```python
import optuna

def objective(trial):
    params = {
        "objective": "binary:logistic",
        "eval_metric": "auc",
        "tree_method": "hist",
        "learning_rate": trial.suggest_float("lr", 0.01, 0.3, log=True),
        "max_depth":    trial.suggest_int("max_depth", 3, 10),
        "subsample":    trial.suggest_float("subsample", 0.6, 1.0),
        "colsample_bytree": trial.suggest_float("colsample", 0.6, 1.0),
        "min_child_weight": trial.suggest_int("mcw", 1, 20),
        "reg_lambda":   trial.suggest_float("lambda", 1e-3, 10.0, log=True),
        "reg_alpha":    trial.suggest_float("alpha", 1e-3, 10.0, log=True),
        "gamma":        trial.suggest_float("gamma", 0.0, 5.0),
    }
    dtr = xgb.DMatrix(X_tr, label=y_tr)
    dva = xgb.DMatrix(X_te, label=y_te)
    bst = xgb.train(params, dtr, 3000, evals=[(dva, "val")],
                    early_stopping_rounds=50, verbose_eval=False)
    return -bst.best_score  # 最小化

study = optuna.create_study()
study.optimize(objective, n_trials=50, show_progress_bar=False)
print(study.best_params)
```

---

## 6. XGBoost vs LightGBM vs CatBoost

| 维度 | XGBoost | LightGBM | CatBoost |
|:---|:---|:---|:---|
| 切分算法 | 精确 / hist | 直方图(必) | 对称树 + Oblivious |
| 生长策略 | level-wise | leaf-wise | 对称(每层同结构) |
| 类别特征 | 需手动编码 | `categorical_feature` 参数直传 | 内部 Target Encoding,开箱即用 |
| 缺失值 | 自动方向 | 自动方向(NaN 安全) | 内部处理 |
| 速度(N 大) | 中 | 最快 | 中 |
| 速度(类别多) | 慢 | 中 | 最快 |
| GPU 支持 | 有 | 有(MPI) | 有,体验最好 |
| 文本/嵌入特征 | 一般 | 一般 | 支持 |
| 调参难度 | 中 | 中(小心 `num_leaves`) | 低(默认稳) |
| 工业界 CTR | 主流 | 主流 | 头部厂商常用 |

---

## 7. 常见坑

### 7.1 学习率与树的棵数没联动
**症状**:训 1000 棵树 loss 还在缓慢下降;改大 learning_rate 后突然过拟合。
**原因**:总更新量 = `η × M`,固定 M 改 η 等于移动总步长。
**修法**:`η × M` 视为一个整体;典型组合 `η=0.05, M=2000` 或 `η=0.1, M=500`,先固定一个再调另一个。

### 7.2 类别特征被 LabelEncoder 直接喂进去
**症状**:模型把类别编码当成有序数值,学到「类别 5 比类别 2 大」的伪序。
**修法**:LightGBM 走 `categorical_feature` 参数;XGBoost 用 one-hot / target encoding(后者注意 K 折防泄漏)。

### 7.3 数据没做 Stratified K-Fold
**症状**:线下 CV 分数高、线上提交跌 5 个百分点。
**原因**:类别不平衡时,某折验证集可能全是少数类。
**修法**:用 `StratifiedKFold`(分类) / KFold(回归);早停监测折内平均分数。

### 7.4 leaf-wise 忘设 num_leaves
**症状**:LightGBM 训得飞快但 val_loss 后期飙升,过拟合。
**原因**:leaf-wise 沿最大 gain 不停分裂,深度失控。
**修法**:`num_leaves = 31~63`,配合 `max_depth=6~10` 双重保险。

### 7.5 早停监测指标写错
**症状**:val_loss 已经涨了但训练继续,以为没收敛。
**修法**:LightGBM 用 `metric='binary_logloss' / 'multi_logloss' / 'rmse'`;XGBoost 用 `eval_metric='logloss' / 'auc'` 与 `metric` 对齐;`early_stopping_rounds=50` 是常见稳妥值。

### 7.6 训练/测试分布不一致
**症状**:train acc 99%、test acc 70%。
**修法**:检查特征分布漂移(KS / PSI);用 `domain adaptation` 或增加训练样本覆盖测试分布;类别特征要确保测试集出现的类别在训练集出现过(否则 LightGBM 会抛错)。

### 7.7 类别不平衡没设 scale_pos_weight
**症状**:召回率极低,模型全预测负类。
**修法**:XGBoost 设 `scale_pos_weight = neg/pos`;LightGBM 设 `is_unbalance=True` 或 `scale_pos_weight`;评价指标改用 F1 / AUC 而不是 accuracy。

### 7.8 用 train RMSE 选最佳迭代
**症状**:选到过拟合的树。
**修法**:必须用验证集 RMSE,且配合 `early_stopping_rounds`;最终预测用 `iteration_range=(0, best_iteration+1)`。

---

## 8. 自检三问

**A. GBDT 里「残差」在数学上对应什么?为什么说拟合残差 = 沿函数空间的负梯度方向走一步?**

要点:对平方损失 `L = ½(y-F)²`,`∂L/∂F = F - y`,所以 `-∂L/∂F = y - F` 就是普通残差;对 LogLoss,`∂L/∂F = p - y`,负梯度是「概率残差」。Boosting 的本质就是沿函数空间的梯度下降——每棵新树拟合的是负梯度方向。详见 §2.3。

**B. XGBoost 相比 GBDT 原版引入的二阶展开带来什么具体收益?能否写出叶子节点的最优权重 `w_j*`?**

要点:一阶梯度只告诉你「往哪走」,二阶梯度还告诉你「这一带的地形有多陡」。对叶子 j 极小化损失后 `w_j* = -G_j / (H_j + λ)`,分裂增益公式 `½·[G_L²/(H_L+λ) + G_R²/(H_R+λ) - (G_L+G_R)²/(H_L+H_R+λ)] - γ`,二阶项的存在让 XGBoost 在叶子少时也能用更准确的近似。详见 §3.2-3.3。

**C. LightGBM 的 GOSS 和 EFB 分别解决什么场景的问题?在你的数据上应该用哪些 sanity check 决定要不要开?**

要点:GOSS 解决「梯度大多很小,采样会破坏分布」——大梯度全留 + 小梯度按比例采;数据量大、梯度分布极不均衡时收益最大。EFB 解决「稀疏 one-hot 特征太多,直方图构建开销大」——稀疏度高、互斥特征多时收益最大。Sanity check:对 GOSS,关掉 vs 打开看验证分数和速度;对 EFB,统计互斥特征对比例,>30% 才划算。详见 §4.2-4.3。

---

## 9. 推荐资源

### 视频
- **StatQuest《Gradient Boosting》** —— Josh Starmer 用图把 GBDT/XGBoost 拆给你看
- **李宏毅《机器学习》Gradient Boosting 章节** —— 中文推导完整
- **Aarshay Jain《XGBoost 实战指南》** —— Kaggle 视角,工程化范例

### 教科书
- **《动手学机器学习》(D2L)》第 11 章** —— 集成学习系统讲解
- **《统计学习导论》(ISLR)** 第 8 章 —— Bagging / Boosting / RF 理论根基
- **《The Elements of Statistical Learning》(ESL)** 第 10 章 —— 数学最完整

### 论文
- **Friedman 2001《Greedy Function Approximation: A Gradient Boosting Machine》** —— GBDT 原论文
- **Chen & Guestrin 2016《XGBoost: A Scalable Tree Boosting System》** —— KDD 最佳论文
- **Ke et al. 2017《LightGBM: A Highly Efficient Gradient Boosting Decision Tree》** —— NIPS
- **Prokhorenkova et al. 2018《CatBoost: Unbiased Boosting with Categorical Features》** —— NeurIPS

### 博客 / 课程
- **《XGBoost 文档》** —— 直方图算法 + 工程实现细节
- **《LightGBM 文档》** —— 参数表 + 调参指南
- **《Kaggle Learn: Intro to Machine Learning》** —— 端到端短流程
- **Rakshith Vasudev《Gradient Boosting from scratch》** —— 10 行 Python 实现 GBDT

### 代码
- **XGBoost GitHub** —— `examples/` 下覆盖分类 / 回归 / 排序
- **LightGBM GitHub** —— 官方 Python / R / 命令行三种接口
- **CatBoost GitHub** —— 文本 / 嵌入特征教程
- **dmlc/xgboost 教程合集** —— `tutorials/` 适合精读

---

## 10. 本节要点

- **GBDT** 是加法模型 + 前向分步:每棵新树拟合当前模型的负梯度(回归上是残差),串行降低偏差。
- **XGBoost 三件宝**:目标函数加正则(叶子数 γ + 叶子权重 L2 λ)、二阶 Taylor 展开同时用 g_i 和 h_i、缺失值自动方向学习;分裂增益公式 `½[G_L²/(H_L+λ) + G_R²/(H_R+λ) - (G_L+G_R)²/(H_L+H_R+λ)] - γ`。
- **LightGBM 三件套**:Histogram 把单特征分裂从 O(N) 降到 O(bins)、GOSS 保留大梯度样本 + 采小梯度、EFB 把互斥稀疏特征捆绑成一列;默认 leaf-wise 高精度但易过拟合,需 `num_leaves` / `max_depth` 约束。
- **vs 随机森林**:Bagging 并行降方差,Boosting 串行降偏差;单棵树深度、是否拟合残差、子模型权重都不同。
- **实战心法**:`learning_rate × n_estimators` 视为一个整体;先 `num_leaves=31~63` / `max_depth=6~10` / `subsample=colsample=0.8` 起步;再开 `early_stopping_rounds=50` 配合 K 折 CV。
- **类别特征**:LightGBM 用 `categorical_feature` 直传,CatBoost 内部 Target Encoding 体验最好;XGBoost 需手动 one-hot 或 K 折 target encoding。
- **不平衡**:`scale_pos_weight = neg/pos`、指标用 F1 / AUC 而不是 accuracy;早停必须看验证集,不能看训练集。

---

## 11. 下一节:Day 11 · SVM 与核方法

主题:最大间隔分类、对偶问题、KKT 条件、核函数(RBF / 多项式)、SMO 算法。覆盖:
- 几何直觉:为什么 SVM 偏好「最胖的那条分割线」,决策边界只由支持向量决定
- 软间隔 vs 硬间隔:松弛变量 ξ 和惩罚参数 C 如何平衡「间隔最大化」与「误分类容忍」
- 核技巧:`K(x,z) = ⟨φ(x), φ(z)⟩` 隐式映射到高维,无需显式计算 φ
- SMO:把大 QP 问题拆成两变量子问题,工业级 SVM 库(LIBSVM / sklearn)的求解器骨架

产出物:`sklearn.svm.SVC` 在鸢尾花 + 合成月牙数据集上对比线性核 / RBF 核,网格搜索 `(C, γ)`,画出决策边界。

---

**作者**:林馨予 + 林晓月
**最后更新**:2026-07-04
**版权**:CC BY-NC-SA 4.0