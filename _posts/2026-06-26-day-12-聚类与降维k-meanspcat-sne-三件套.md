---
layout: post
title: "Day 12｜聚类与降维:K-Means、PCA、t-SNE 三件套（AI 学习笔记 · 经典机器学习周 · 第 12 篇）"
date: 2026-06-26 00:00:00 +0800
series: "AI 学习笔记"
excerpt: ""
pinned: false
cover: null
draft: false
column: AI学习笔记
---


无监督学习的两个核心任务是「找中心」(聚类)和「找主成分」(降维):K-Means 把样本分到 K 个簇,PCA 把高维数据压扁到方差最大的方向,t-SNE 再压到 2D 让人类能「看见」簇——三件套职责清晰,实战里基本是流水线组合使用。

---

## 1. K-Means:最小化簇内平方和

### 1.1 算法定义

把 n 个样本分到 K 个簇 `{C_1, ..., C_K}`,最小化簇内平方和(WCSS / Inertia):

```math
J = \sum_{k=1}^{K} \sum_{x \in C_k} \|x - \mu_k\|^2
```

其中 `μ_k` 是簇 `C_k` 的质心。算法本质是 Lloyd 算法(EM 的硬指派版本):

```
输入:样本 X (n, d), 簇数 K
1. 初始化 K 个质心 μ_1, ..., μ_K
2. repeat until 收敛:
    (a) 指派步:对每个 x_i, 把它分给最近的质心
        c_i = argmin_k  ‖x_i - μ_k‖²
    (b) 更新步:对每个簇, 重算质心为簇内均值
        μ_k = mean({x_i : c_i = k})
3. return c_1, ..., c_n, μ_1, ..., μ_K
```

### 1.2 K-Means 三种性质

| 性质 | 表现 | 影响 |
|:---|:---|:---|
| 局部最优 | 不同初始化会得到不同结果 | 必须 K-Means++ + 多 n_init |
| 凸簇偏好 | 对非凸(如月牙)切不动 | 改用谱聚类 / DBSCAN |
| 等方差假设 | 默认所有簇方差相当 | 改用 GMM(概率版 K-Means) |

### 1.3 K-Means++ 初始化

随机初始化容易把两个质心放到同一簇里。K-Means++ 让「后选的质心」离已有质心越远越好:

```math
P(x \text{ 选为下一个质心}) = \frac{D(x)^2}{\sum_{x'} D(x')^2}
```

其中 `D(x)` 是 x 到最近已有质心的距离。这把 O(log K) 的近似最优解从纯随机的 0.0% 抬到 ~95%。

---

## 2. 选 K:肘部法则 + 轮廓系数

### 2.1 肘部法则(Elbow)

画 `K` vs `J(K)`(簇内平方和)。K 增大 J 单调下降,但拐点之后下降变缓——拐点就是「再加簇收益已经很小」的最优 K。

```python
inertias = []
for k in range(1, 11):
    km = KMeans(n_clusters=k, n_init=10, random_state=42).fit(X)
    inertias.append(km.inertia_)
plt.plot(range(1, 11), inertias, 'bx-')
plt.xlabel('K'); plt.ylabel('Inertia'); plt.show()
```

### 2.2 轮廓系数(Silhouette)

样本 i 的轮廓系数:

```math
s(i) = \frac{b(i) - a(i)}{\max(a(i), b(i))}
```

- `a(i)` = i 到同簇其他点的平均距离(簇内紧密度)
- `b(i)` = i 到最近异簇所有点的平均距离(簇间分离度)
- `s(i) ∈ [-1, +1]`,接近 1 表示分得对,接近 0 表示边界样本,-1 表示分错簇

最佳 K 是平均轮廓系数最大的 K。

| 指标 | 范围 | 越大越好 | 是否需要标签 |
|:---|:---|:---|:---|
| Inertia | [0, ∞) | 是(单调下降) | 否 |
| Silhouette | [-1, 1] | 是 | 否 |
| Davies-Bouldin | [0, ∞) | 否 | 否 |
| Calinski-Harabasz | [0, ∞) | 是 | 否 |
| ARI / NMI | [-1, 1] | 是 | 是 |

---

## 3. PCA:方差最大化的线性投影

### 3.1 直观:找数据最「胖」的方向

把 d 维数据投影到 k 维子空间,希望保留最大方差。数学形式:找正交基 `w_1, ..., w_k`,最大化:

```math
\max_{W^T W = I} \ \text{tr}(W^T \Sigma W) \quad \text{其中 } \Sigma = \frac{1}{n} X^T X
```

### 3.2 三种等价推导

1. **最大方差** = 数据投影后方差最大
2. **最小重构误差** = 投影后重建回原空间的 MSE 最小
3. **协方差矩阵对角化** = 新基下协方差矩阵是对角阵

三者在数学上完全等价。解法都是 `Σ` 的特征值分解:

```math
\Sigma v_i = \lambda_i v_i
```

- 特征向量 `v_i` = 第 i 主成分(投影方向)
- 特征值 `λ_i` = 第 i 主成分的方差
- 按 λ 从大到小排列,前 k 个组成新基

### 3.3 算法步骤

```
输入:X (n, d), 目标维度 k
1. 中心化: X ← X - X.mean(axis=0)
2. (推荐) 标准化: X ← X / X.std(axis=0)
3. 计算协方差矩阵 Σ = X.T @ X / (n - 1)
4. 特征值分解: eigvals, eigvecs = eigh(Σ)
5. 取前 k 大特征值对应的特征向量 V_k (d, k)
6. 投影: Z = X @ V_k   (n, k)
```

### 3.4 解释方差比与选 k

```math
\text{Explained Variance Ratio}_i = \frac{\lambda_i}{\sum_j \lambda_j}
```

累计解释方差比:

```math
\text{Cumulative EVR}(k) = \frac{\sum_{i=1}^{k} \lambda_i}{\sum_{j=1}^{d} \lambda_j}
```

工程经验:`Cumulative EVR ≥ 95%` 或画 scree plot 看拐点。

### 3.5 PCA 的边界

- **线性**:只能捕捉线性结构,流形数据需 KernelPCA / t-SNE / UMAP
- **正交**:主成分相互正交,可能错过非正交重要方向(ICA)
- **方差≠信息**:对监督任务,小方差方向反而可能包含关键判别信息

---

## 4. t-SNE:非线性可视化

### 4.1 核心思想

在高维空间,计算样本两两相似度(用高斯分布);在低维空间,用 Student-t 分布匹配这个相似度;通过 KL 散度优化低维坐标。

### 4.2 高维相似度

```math
p_{j|i} = \frac{\exp(-\|x_i - x_j\|^2 / 2\sigma_i^2)}{\sum_{k \neq i} \exp(-\|x_i - x_k\|^2 / 2\sigma_i^2)}
```

`σ_i` 由 perplexity 控制:每个点的「有效邻居数」。对称化:

```math
p_{ij} = \frac{p_{j|i} + p_{i|j}}{2n}
```

### 4.3 低维相似度(Student-t)

```math
q_{ij} = \frac{(1 + \|y_i - y_j\|^2)^{-1}}{\sum_{k \neq l} (1 + \|y_k - y_l\|^2)^{-1}}
```

t 分布重尾 → 缓解「拥挤问题」(高维距离聚集到中距离,低维需要更夸张的差异才能区分)。

### 4.4 KL 散度优化

```math
\mathcal{L} = \sum_{i \neq j} p_{ij} \log \frac{p_{ij}}{q_{ij}}
```

梯度下降更新 `y_i`,训练结束得到 2D/3D 嵌入坐标。

### 4.5 perplexity 参数

| perplexity | 效果 |
|:---|:---|
| 太小(1~5) | 太局部,假簇 |
| 推荐(30~50) | 全局+局部平衡 |
| 太大(>100) | 太全局,丢失精细结构 |

### 4.6 t-SNE 的「不能」

- **簇间距离失真**:A 簇和 B 簇在 t-SNE 图上的远近不代表真实距离
- **簇大小失真**:簇在图上的大小不代表真实密度
- **不可用于下游**:t-SNE 是可视化工具,不是特征提取器;真要用低维特征做分类,选 PCA / UMAP
- **不可重复**:不同 random_state 出来的图不一样(局部一致,全局不一致)

### 4.7 UMAP: t-SNE 的现代替代

UMAP 同样是非线性流形学习方法,但有几大优势:

| 维度 | t-SNE | UMAP |
|:---|:---|:---|
| 理论基础 | 概率分布匹配 | Riemann几何 + 代数拓扑 |
| 训练速度 | O(n²) | O(n log n) 或近似线性 |
| 支持 transform | 无 | 有(可对新样本嵌入) |
| 全局结构 | 弱(簇间距离失真) | 较强(保留拓扑) |
| 簇大小 | 失真 | 接近真实 |
| 大数据(>100k) | 慢 | 快 |
| 实现库 | sklearn / openTSNE | umap-learn |

```python
import umap
reducer = umap.UMAP(n_components=2, n_neighbors=15, min_dist=0.1, random_state=42)
Z_umap = reducer.fit_transform(X)        # 训练
Z_new = reducer.transform(X_new)         # 新样本(可用)
```

`n_neighbors` 对应 t-SNE 的 perplexity,`min_dist` 控制簇内紧凑度。

### 4.8 PCA / t-SNE / UMAP 怎么选

| 场景 | 推荐 |
|:---|:---|
| 只想快速看 2D 分布 | t-SNE (perplexity=30) |
| 需要 transform / 上线 | UMAP |
| 超大数据(>1M) | UMAP / openTSNE |
| 需要可解释的主成分 | PCA |
| 下游任务用低维特征 | PCA / UMAP |
| 流形结构(如 Swiss roll) | UMAP / Isomap / LLE |

---

## 5. PyTorch / sklearn 实战

### 5.1 K-Means + 选 K 全流程

```python
import numpy as np
from sklearn.datasets import load_iris
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
import matplotlib.pyplot as plt

X = load_iris().data
X = StandardScaler().fit_transform(X)

# 1. 选 K
Ks = range(2, 11)
sil = []
for k in Ks:
    km = KMeans(n_clusters=k, n_init=10, random_state=42).fit(X)
    sil.append(silhouette_score(X, km.labels_))
best_k = list(Ks)[np.argmax(sil)]
print(f"Best K by silhouette: {best_k}, score: {max(sil):.3f}")

# 2. 最终聚类
km = KMeans(n_clusters=best_k, n_init=10, random_state=42).fit(X)
print("Inertia:", km.inertia_)
print("Centroid shape:", km.cluster_centers_.shape)  # (best_k, d)

# 3. 2D 可视化
plt.figure(figsize=(12, 4))
plt.subplot(1, 2, 1); plt.plot(Ks, sil, 'bx-'); plt.xlabel('K'); plt.ylabel('Silhouette')
plt.subplot(1, 2, 2); plt.scatter(X[:, 0], X[:, 1], c=km.labels_, cmap='viridis', s=20)
plt.title(f'K-Means (K={best_k})')
plt.show()
```

### 5.2 PCA 降到 95% 方差 + 反变换误差

```python
from sklearn.decomposition import PCA

pca = PCA(n_components=0.95, random_state=42)  # 自动选 k
Z = pca.fit_transform(X)
print("降到", Z.shape[1], "维")
print("各主成分 EVR:", pca.explained_variance_ratio_)
print("累计 EVR:", pca.explained_variance_ratio_.sum())

# 反变换回原空间,看信息损失
X_rec = pca.inverse_transform(Z)
mse = np.mean((X - X_rec) ** 2)
print(f"Reconstruction MSE: {mse:.4f}")
```

### 5.3 t-SNE 可视化 MNIST

```python
from sklearn.datasets import fetch_openml
from sklearn.manifold import TSNE
import time

# 取 MNIST 子集
mnist = fetch_openml('mnist_784', version=1, as_frame=False)
X, y = mnist.data[:5000], mnist.target[:5000].astype(int)
X = X / 255.0  # 归一化到 [0,1]

t0 = time.time()
Z = TSNE(n_components=2, perplexity=30, n_iter=1000,
         random_state=42, init='pca', learning_rate='auto').fit_transform(X)
print(f"t-SNE 用时 {time.time()-t0:.1f}s, Z shape: {Z.shape}")

plt.figure(figsize=(8, 6))
plt.scatter(Z[:, 0], Z[:, 1], c=y, cmap='tab10', s=5, alpha=0.7)
plt.colorbar(); plt.title('MNIST t-SNE'); plt.show()
```

### 5.4 「PCA → t-SNE」标准流水线

```python
# 套路:先 PCA 降到 50 维降噪,再 t-SNE 降到 2D
Xp = PCA(n_components=50, random_state=42).fit_transform(X)
Z = TSNE(n_components=2, perplexity=30, init='pca').fit_transform(Xp)
# 这样比直接对 784 维做 t-SNE 快 5~10 倍,效果几乎一样
```

### 5.5 MiniBatchKMeans 大数据聚类

```python
from sklearn.cluster import MiniBatchKMeans

# 1M+ 样本时用 MiniBatchKMeans
mbk = MiniBatchKMeans(n_clusters=10, batch_size=1024,
                      n_init=3, random_state=42)
mbk.fit(X_large)
labels = mbk.predict(X_large)
print("Inertia:", mbk.inertia_)
```

MiniBatchKMeans 用小批量梯度下降近似 K-Means,精度损失 1~3%,速度提升 5~10 倍。

### 5.6 评估指标对比

```python
from sklearn.metrics import (silhouette_score, calinski_harabasz_score,
                             davies_bouldin_score, adjusted_rand_score,
                             normalized_mutual_info_score)

# 无标签评估
print("Silhouette       :", silhouette_score(X, km.labels_))
print("Calinski-Harabasz:", calinski_harabasz_score(X, km.labels_))
print("Davies-Bouldin   :", davies_bouldin_score(X, km.labels_))

# 有真实标签(假设有 ground truth y_true)
print("ARI              :", adjusted_rand_score(y_true, km.labels_))
print("NMI              :", normalized_mutual_info_score(y_true, km.labels_))
```

- ARI / NMI 需要真实标签,范围 [0, 1](也有 [−1, 1] for ARI),越高越好
- Silhouette / CH / DB 都是无标签度量,适合「完全无监督」场景
- ARI 修正了随机标签下的期望;NMI 基于信息论,语义清晰

---

## 6. K-Means vs PCA vs t-SNE

| 维度 | K-Means | PCA | t-SNE |
|:---|:---|:---|:---|
| 任务类型 | 聚类 | 线性降维 | 非线性可视化 |
| 输出 | 簇标签 (n,) | 低维向量 (n, k) | 2D/3D 坐标 (n, 2/3) |
| 算法性质 | 迭代(EM-like) | 特征值分解(闭式) | 梯度下降迭代 |
| 复杂度 | O(n · K · 迭代) | O(d² · n + d³) | O(n²) |
| 超参 | K | k 或 0.95 | perplexity |
| 尺度敏感 | 是(必 StandardScaler) | 是(必 StandardScaler) | 是 |
| 输出可解释 | 簇中心 + 簇标签 | 主成分(特征向量) | 不可解释,只可视化 |
| 可重复 | 取决于 init | 完全确定 | 取决于 random_state |
| 用于下游 | K-Means 标签可作特征 | PCA 特征可作特征 | 不可 |
| 大数据 | MiniBatchKMeans | IncrementalPCA / RandomizedPCA | openTSNE / UMAP |

---

## 7. 常见坑

### 7.1 K-Means 忘了 StandardScaler
**症状**:K-Means 把方差大的特征当主轴,簇被量级绑架
**修法**:必先 `StandardScaler`,对类别特征先 one-hot 再缩放

### 7.2 调 `n_init=1`
**症状**:不同 random_state 出来结果大相径庭
**修法**:`n_init=10`(sklearn 默认)自动跑 10 次取 inertia 最小

### 7.3 PCA 不缩放直接做
**症状**:第一个主成分被「收入」这种量级万的特征绑架,其它特征被压扁
**修法**:`StandardScaler` → PCA;如果特征本来就同尺度(像素 0~255)可免

### 7.4 PCA 后用 K-Means,但簇奇怪
**症状**:降到 2D 看见簇,K-Means 在原空间分不开
**原因**:PCA 保留方差最大方向,但 K-Means 想要的是「分得开」的方向
**修法**:K-Means 前 PCA 仅作降维加速;若监督场景,改用 LDA(标签信息指导投影方向)

### 7.5 t-SNE 簇间距离拿来当度量
**症状**:报告「A 簇和 B 簇在 t-SNE 图上相距 0.5,B 簇和 C 簇相距 2.0,所以 A≈B」
**修法**:t-SNE 只保留「邻居」关系,簇间距离无意义;需要度量用 PCA + 欧氏 / 余弦

### 7.6 t-SNE 对 MNIST 全量跑
**症状**:t-SNE 跑了 2 小时内存 OOM
**修法**:先 PCA 降到 50 维,再 t-SNE;或用 openTSNE / UMAP(线性复杂度)

### 7.7 perplexity 设 5
**症状**:图上每个点都是孤立簇
**修法**:MNIST / Fashion-MNIST 类用 perplexity=30;小数据集用 5~15

### 7.8 t-SNE 出来的特征拿去训下游模型
**症状**:换 random_state 后特征全变,模型表现浮动
**修法**:t-SNE 只用作可视化,绝不作特征;特征提取用 PCA / UMAP(后者可拟合 transform)

### 7.9 类别特征被当连续送进 K-Means
**症状**:簇没有可解释意义
**修法**:类别特征先 one-hot + 缩放,或用 K-Prototypes(混合数值+类别)

### 7.10 PCA 后用「原来的特征名」解释主成分
**症状**:报告「主成分 1 = 收入 + 0.7」这种表达但收入是 0~1 标准化后的
**原因**:PCA 后特征是原特征的线性组合,解释时需先 reverse StandardScaler
**修法**:把 `pca.components_` 矩阵乘以 `1/std`,再绘制 `biplot`

### 7.11 MiniBatchKMeans 默认 batch_size
**症状**:大数据上跑 MiniBatchKMeans 速度仍慢
**修法**:`batch_size=1024~4096` 提速 5~10 倍,精度略降

---

## 8. 自检三问

**A. K-Means 为什么一定要先做 StandardScaler?从 K-Means 目标函数的角度推导量级差异的影响。**

要点:K-Means 目标 `J = Σ ‖x - μ‖²` 中距离是欧氏距离;若某特征方差 1000,另一方差 1,前者的差异完全主导 J,后者几乎不参与簇划分。StandardScaler 让所有特征量级一致,J 才真正反映「形状」。详见 §1 + §7.1。

**B. PCA 保留多少个主成分才合理?能否从「累计解释方差」和「scree plot 拐点」两个角度给出选 k 的判据?**

要点:① 累计解释方差 ≥ 80%~95%(数据/任务定);② scree plot 中特征值骤降的拐点(从陡变缓的位置);③ 交叉验证:PCA + 下游模型调 k 选最优。详见 §3.4。

**C. t-SNE 能用来计算样本间距离做 KNN 分类吗?为什么说「簇间距离无意义」?从优化目标和 t 分布重尾两个角度答。**

要点:① t-SNE 优化目标是「匹配高维邻居概率分布」,不是「保持全局距离」,簇间距离是优化副产品;② t 分布重尾让远点差异被夸大,但这个差异是「为了可视化清晰」人为引入的。结论:只能用来「看簇在不在」,不能「量距离」,更不能当特征。详见 §4.5-4.6。

---

## 9. 推荐资源

### 视频
- **StatQuest《K-Means》《PCA》《t-SNE》** —— 三个独立视频,各 15 分钟,图解最强
- **3Blue1Brown《线性代数的本质》** —— 特征向量 / 特征值的几何直觉
- **李宏毅《机器学习》无监督章节** —— 中文推导完整

### 教科书
- **《统计学习导论》(ISLR)** 第 10 章 —— PCA 数学
- **《Pattern Recognition and Machine Learning》(PRML)** 第 12 章 —— 连续潜变量 + PCA 概率视角
- **《动手学机器学习》(D2L)》第 13 章 —— PCA + k-means 实战

### 论文
- **MacQueen 1967《Some Methods for Classification and Analysis of Multivariate Observations》** —— K-Means 原论文
- **Arthur & Vassilvitskii 2007《k-means++: The Advantages of Careful Seeding》** —— K-Means++ 论文
- **Pearson 1901《On Lines and Planes of Closest Fit to Systems of Points in Space》** —— PCA 鼻祖
- **van der Maaten & Hinton 2008《Visualizing Data using t-SNE》** —— t-SNE 原论文
- **McInnes, Healy, Melville 2018《UMAP: Uniform Manifold Approximation and Projection》** —— t-SNE 替代

### 博客 / 课程
- **Distill.pub《How to Use t-SNE Effectively》** —— 必读,讲清所有坑
- **《sklearn 文档:Clustering》** —— KMeans / DBSCAN / SpectralClustering 完整接口
- **《sklearn 文档:PCA》** —— 解释清楚 explained_variance_ratio_
- **《sklearn 文档:t-SNE》** —— perplexity / early_exaggeration 参数含义

### 代码
- **scikit-learn `cluster` 模块** —— KMeans / DBSCAN / AgglomerativeClustering / SpectralClustering
- **scikit-learn `decomposition` 模块** —— PCA / KernelPCA / TruncatedSVD / NMF / FactorAnalysis
- **scikit-learn `manifold` 模块** —— TSNE / Isomap / LocallyLinearEmbedding / SpectralEmbedding
- **umap-learn** —— UMAP 的 Python 实现,t-SNE 最佳替代
- **openTSNE** —— t-SNE 的快速版,支持 transform

---

## 10. 本节要点

- **K-Means** 是 Lloyd 算法,最小化簇内平方和;必先 StandardScaler,用 K-Means++ 初始化,n_init≥10,选 K 用轮廓系数 + 肘部法则。
- **PCA** 是协方差矩阵的特征值分解,前 k 个大特征值对应的特征向量是主成分;必先 StandardScaler,选 k 用累计 EVR ≥ 95% 或 scree plot 拐点。
- **t-SNE** 是非线性可视化工具,KL 散度匹配高斯-Student t 概率分布;perplexity 30~50 推荐;只保留邻居结构,簇间距离无意义,不能用于下游。
- **选 K 三件套**:轮廓系数(无标签)/ ARI+NMI(有标签)/ 业务目标驱动。
- **标准流水线**:StandardScaler → PCA(可选降维加速)→ K-Means / t-SNE(可视化)。
- **t-SNE 替代**:大数据用 UMAP / openTSNE;需要新样本 transform 选 UMAP / parametric t-SNE。
- **PCA 边界**:线性 + 正交,非线性和非正交结构抓不到;KernelPCA 是非线性扩展但用得少。

---

## 11. 下一节:Day 13 · 模型评估与调参

主题:交叉验证、网格搜索、过拟合诊断。覆盖:
- K-Fold 交叉验证:用数据自身的多次拆分模拟泛化误差,K=5 vs K=10 的偏差-方差权衡
- 三种 CV 变体:Stratified K-Fold(分层)、TimeSeriesSplit(时间序列,严禁随机)、Group K-Fold
- 网格搜索 vs 随机搜索:Bergstra & Bengio 2012 证明同等预算下随机搜索通常更优
- 过拟合工具箱:L1/L2/ElasticNet 正则化、Dropout、Early Stopping、Data Augmentation、简化模型
- 学习曲线:Bias-Variance Tradeoff 的诊断利器,两条曲线都低→欠拟合,差距大→过拟合

产出物:`cross_val_score + GridSearchCV` 在鸢尾花 / 房价数据集上跑通,绘制 train/val 学习曲线诊断偏差-方差。

---

**作者**:林馨予 + 林晓月
**最后更新**:2026-07-04
**版权**:CC BY-NC-SA 4.0