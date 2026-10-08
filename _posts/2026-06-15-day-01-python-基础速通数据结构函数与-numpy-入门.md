---
layout: post
title: "Day 01｜Python 基础速通:数据结构、函数与 NumPy 入门（AI 学习笔记 · 基础筑基周 · 第 1 篇）"
date: 2026-06-15 00:00:00 +0800
series: "AI 学习笔记"
excerpt: "30 天 AI 学习计划 Day 1:Python 基础语法速通,为后续机器学习打地基。"
pinned: false
cover: null
draft: false
column: AI学习笔记
permalink: /notes/AI%E5%AD%A6%E4%B9%A0%E7%AC%94%E8%AE%B0/AI%20%E5%AD%A6%E4%B9%A0%E7%AC%94%E8%AE%B0/day-01-python-%E5%9F%BA%E7%A1%80%E9%80%9F%E9%80%9A%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84%E5%87%BD%E6%95%B0%E4%B8%8E-numpy-%E5%85%A5%E9%97%A8/
---


# Day 01｜Python 基础速通:数据结构、函数与 NumPy 入门

Python 是 AI 工程的事实标准语言,但会写 `if/for/print` 只算「识字」;真正进入 AI 工程需要把 **数据结构选择、函数封装、NumPy 向量化**这三件事内化成肌肉记忆——它们决定了后续 30 天写代码是「调包一行跑」还是「for 循环卡到天黑」。

---

## 1. 内置数据结构:四把武器

### 1.1 list(列表):可变有序序列

```python
xs = [3, 1, 4, 1, 5, 9, 2, 6]
xs.append(7)          # 末尾追加,O(1)
xs.insert(0, 99)      # 头部插入,O(n)
xs[2:5]               # 切片,左闭右开
[x * x for x in xs if x > 3]   # 列表推导式,常用
```

| 操作 | 时间复杂度 | 备注 |
|:---|:---|:---|
| `append` | O(1) 均摊 | 末尾追加极快 |
| `insert(0, x)` | O(n) | 头部插入要搬所有元素 |
| `x in xs` | O(n) | 成员检测要扫描 |
| `xs[i]` | O(1) | 按下标读 |

**AI 中的角色**:存放批量样本、做 mini-batch 切片、记录训练日志。**坑**:循环里反复 `append` 大对象比预分配 `list` 慢,因为 CPython 解释器每条语句都有调度开销。

### 1.2 dict(字典):哈希表映射

```python
word_to_idx = {"<pad>": 0, "<unk>": 1, "the": 2, "cat": 3}
idx = word_to_idx.get("dog", word_to_idx["<unk>"])  # 安全查,缺时回退
```

| 操作 | 时间复杂度 |
|:---|:---|
| `d[k]` / `d[k] = v` | O(1) 均摊 |
| `k in d` | O(1) |
| 遍历 items | O(n) |

**AI 中的角色**:词表、类别索引、配置项、模型 state_dict 全部用 dict 表达。**坑**:用可变对象(list / dict / set)做 key 会立刻抛 `TypeError: unhashable type`,只能拿不可变对象(str / int / tuple)做 key。

### 1.3 set(集合):去重 + 集合运算

```python
A = {1, 2, 3, 4}; B = {3, 4, 5, 6}
A & B   # 交集 → {3, 4}
A | B   # 并集 → {1, 2, 3, 4, 5, 6}
A - B   # 差集 → {1, 2}
```

**AI 中的角色**:训练集/验证集/测试集 ID 去重、做交叉验证的 fold 划分、过滤停用词。**坑**:空集合必须写 `set()`,`{}` 是空字典。

### 1.4 tuple(元组):不可变序列

```python
pt = (3, 4)
x, y = pt              # 解包
d = {(0, 0): "origin", (1, 0): "x+"}   # 可作 dict key
```

**AI 中的角色**:函数返回多值、shape 描述(如 `(B, C, H, W)`)、numpy 数组的轴交换索引。**坑**:单元素 tuple 必须写成 `(x,)` 而不是 `(x)`,后者只是加括号的表达式。

### 1.5 四者对比表

| 容器 | 可变 | 有序 | 元素可重复 | 查找复杂度 | 典型 AI 用途 |
|:---|:---:|:---:|:---:|:---:|:---|
| `list` | 是 | 是 | 是 | O(n) | batch、序列、日志 |
| `dict` | 是 | 插入序(Python 3.7+) | key 唯一 | O(1) | 词表、配置、state_dict |
| `set` | 是 | 否 | 否 | O(1) | 去重、集合运算 |
| `tuple` | 否 | 是 | 是 | O(n) | 形状描述、复合 key |

### 1.6 容器嵌套:数据结构的真实形态

```python
dataset = [
    {"id": 0, "tokens": [2, 15, 88, 3], "label": 1},
    {"id": 1, "tokens": [2, 71, 4],     "label": 0},
]
vocab = {"<pad>": 0, "<unk>": 1, "the": 2}
```

**AI 中的典型结构**:外层 list 装样本,每个样本是 dict,dict 里有「token id 序列」这种嵌套 list。这种「list of dict」的形态是 PyTorch DataLoader 处理数据时的事实标准。

### 1.7 `collections` 模块:进阶武器

| 数据结构 | 来源 | 优势 | AI 用途 |
|:---|:---|:---|:---|
| `deque` | `collections.deque` | 两端 O(1) 增删 | 滑动窗口特征 |
| `Counter` | `collections.Counter` | 频次统计 | 类别分布、词频 |
| `OrderedDict` | `collections.OrderedDict` | 显式有序 | Python 3.7+ 后 dict 已自带顺序 |
| `defaultdict` | `collections.defaultdict` | 缺 key 自动建默认值 | 词表构建、邻接表 |

```python
from collections import Counter, defaultdict
cnt = Counter(["cat", "dog", "cat", "fish"])  # Counter({'cat': 2, 'dog': 1, 'fish': 1})

vocab = defaultdict(int)
for tok in tokens:
    vocab[tok] += 1     # 缺 key 时自动创建 0 再 +=1
```

---

## 2. 函数:从 `def` 到纯函数

### 2.1 函数定义三要素

```python
def predict(x, w, b):
    """线性预测:y = w·x + b"""
    return w * x + b
```

- 函数名:`predict`,动词风格
- 形参:`x, w, b`,**显式**优于隐式
- 返回:用 `return`,不依赖全局副作用

### 2.2 *args / **kwargs:可变参数

```python
def log_metrics(metrics, *tags, **opts):
    for k, v in metrics.items():
        line = f"{k}={v:.4f}"
        if opts.get("bold"):
            line = "**" + line + "**"
        print(" ".join([line, *tags]))
```

`*args` 收集成 tuple,`**kwargs` 收集成 dict;用于「我不知道调用方会传几个参数」的库函数。

### 2.3 默认参数陷阱

```python
# 错误写法:lst 在函数定义时只创建一次
def append_bad(x, lst=[]):
    lst.append(x)
    return lst

print(append_bad(1))   # [1]
print(append_bad(2))   # [1, 2] ← 状态污染!
```

```python
# 正确写法:每次显式创建
def append_good(x, lst=None):
    if lst is None:
        lst = []
    lst.append(x)
    return lst
```

**根因**:Python 函数定义时就把默认实参对象求值并绑定,后续所有调用共享同一对象。**AI 中常见坑**:`def train(model, optimizer=Adam(model.parameters()))` 会让所有 train 调用共用同一个 optimizer,训练一会就乱套。

### 2.4 lambda 与高阶函数

```python
sorted(scores, key=lambda kv: -kv[1])[:10]
list(map(lambda x: x ** 2, range(10)))
list(filter(lambda x: x % 2 == 0, range(10)))
```

lambda 只适合写一行能写完的简单函数,复杂逻辑请用 `def`。

---

## 3. NumPy 基础:ndarray

### 3.1 为什么必须学 NumPy

1000×1000 矩阵相乘:

| 方式 | 耗时 |
|:---|:---|
| 纯 Python for 循环 | 约 12 秒 |
| NumPy `@` | 约 30 毫秒 |

快约 **400 倍**,因为 NumPy 底层是 C 实现 + BLAS + SIMD 向量化指令。

### 3.2 ndarray 属性

```python
import numpy as np
a = np.arange(12).reshape(3, 4)
print(a.shape)        # (3, 4)
print(a.dtype)        # int64
print(a.ndim)         # 2
print(a.size)         # 12
print(a.strides)      # (32, 8) — 每跨一行/列要跳多少字节
```

### 3.3 创建数组 6 种方式

```python
np.zeros((3, 4))            # 全 0
np.ones((3, 4), dtype=np.float32)   # 全 1
np.full((3, 4), 7.0)       # 全 7
np.eye(4)                   # 单位矩阵
np.arange(0, 10, 0.5)      # 等差,类似 range
np.linspace(0, 1, 5)        # 5 个点把 [0,1] 均分
np.random.randn(3, 4)       # 标准正态
```

### 3.4 索引与切片

```python
a = np.arange(12).reshape(3, 4)
a[1, 2]            # 元素:7
a[1]               # 第 2 行:array([4,5,6,7])
a[:, 1]            # 第 2 列:array([1,5,9])
a[a > 5]           # 布尔索引:array([6,7,8,9,10,11])
a[[0, 2], [1, 3]]  # 花式索引:(0,1) 和 (2,3) 两个元素
```

**坑**:`a[:, 0]` 返回的是**视图**(和原数组共享内存),修改它会改原数组;`a[:, 0:1]` 返回的是**副本**。

---

## 4. NumPy 向量化运算

### 4.1 element-wise 与矩阵乘

```python
a = np.array([[1, 2], [3, 4]])
b = np.array([[5, 6], [7, 8]])

a + b        # element-wise 加
a * b        # element-wise 乘,不是矩阵乘!
a @ b        # 真正的矩阵乘:[[19,22],[43,50]]
np.dot(a, b) # 等价于 a @ b
```

**核心区别**:`*` 是「对应位置相乘」;`@` 是线性代数定义的矩阵乘。混淆这两者是初学者最常见的错。

### 4.2 三种「乘」的区别

| 操作 | 符号 | 1D | 2D | ND |
|:---|:---|:---|:---|:---|
| element-wise | `*` | 对应位相乘 | 对应位相乘 | 对应位相乘 |
| 内积 / 矩阵乘 | `np.dot` / `@` | 内积(sum) | 矩阵乘 | 最后两维做矩阵乘,前面当 batch |
| `np.matmul` | `@` | 内积 | 矩阵乘 | batch 维广播,与 `dot` 在 1D 上有细微差异 |

### 4.3 聚合与 axis

```python
a = np.arange(24).reshape(2, 3, 4)
a.sum()              # 全部求和:276
a.sum(axis=0)        # 沿第 0 轴压扁:(3,4)
a.sum(axis=1)        # 沿第 1 轴压扁:(2,4)
a.sum(axis=(0, 2))   # 沿 0 和 2 同时压扁:(3,)
```

`axis=k` 表示「沿第 k 维做归约,该维消失」。`keepdims=True` 可保留被压扁的维为 1,方便广播。

### 4.4 范数与距离

```python
x = np.array([3.0, 4.0])
np.linalg.norm(x)            # L2 范数:5.0
np.linalg.norm(x, ord=1)     # L1 范数:7.0
np.linalg.norm(x, ord=np.inf)  # L∞ 范数:4.0
```

### 4.5 实战对比:三种方式算 sum-of-squares

```python
import numpy as np
import time

x = np.random.randn(10_000_000)

# 方式 1:Python sum + 生成器
t0 = time.time()
s1 = sum(v * v for v in x)
t1 = time.time(); print(t1 - t0, "s")   # 约 2.5 秒

# 方式 2:numpy sum
t0 = time.time()
s2 = (x ** 2).sum()
t1 = time.time(); print(t1 - t0, "s")   # 约 0.02 秒

# 方式 3:numpy dot 内积(等价)
t0 = time.time()
s3 = x @ x
t1 = time.time(); print(t1 - t0, "s")   # 约 0.005 秒
```

数量级差异:**Python ≈ 2.5 s / numpy.sum ≈ 20 ms / numpy.dot ≈ 5 ms**。`x @ x` 还快于 `(x**2).sum()` 是因为 `**2` 会显式分配一个新数组,`@` 走 BLAS 的点积内核直接算。**AI 实战准则**:能用 BLAS 内核(`dot / matmul / einsum`)就别用 element-wise 三段式。

### 4.6 einsum:爱因斯坦求和约定

```python
# 矩阵乘 C[i,j] = Σ_k A[i,k] * B[k,j]
C = np.einsum("ik,kj->ij", A, B)

# batch 矩阵乘 (B,N,M) @ (B,M,P) → (B,N,P)
out = np.einsum("bnm,bmp->bnp", X, W)

# 沿 axis 求和:等价于 X.sum(axis=k)
np.einsum("ij->i", X)
```

`einsum` 把「对哪些维求和、对哪些维保留」写在字符串里,**永远不需要临时 reshape**;复杂张量运算首选。

---

## 5. 广播机制(Broadcasting)

### 5.1 规则(从右往左对齐)

1. 如果两个数组维度数不同,小维度的数组**左侧补 1**
2. 沿每个维度,如果两者大小相同或其中一个为 1,则可广播
3. 维度为 1 的那一维会被「拉伸」到与另一维相同,**不复制数据**

```python
A = np.arange(6).reshape(2, 3)   # (2,3)
b = np.array([10, 20, 30])       # (3,) → (1,3)
C = A + b                          # (2,3) + (1,3) → (2,3)
```

### 5.2 5 个典型例子

| A shape | B shape | A+B 结果 shape | 说明 |
|:---|:---|:---|:---|
| (3, 1) | (1, 4) | (3, 4) | 行向量 × 列向量 = 矩阵 |
| (4, 1, 3) | (2, 1) | (4, 2, 3) | B 补 1 维 → (1,2,1) 再广播 |
| (8, 4) | (4,) | (8, 4) | b 补 1 维 → (1,4) 再广播 |
| (3, 4) | (3, 1) | (3, 4) | 列方向广播 |
| (3, 4) | (3,) | error | 不能广播(最后对齐后 4 vs 3) |

### 5.3 神经网络里到处都是广播

```python
# (B, C) 的特征减去均值,沿 feature 维
mean = x.mean(axis=0, keepdims=True)   # (1, C)
x_centered = x - mean                  # (B, C) - (1, C) → (B, C)
```

---

## 6. PyTorch / NumPy 互操作(衔接 Day 16)

```python
import numpy as np
import torch

a = np.arange(6, dtype=np.float32).reshape(2, 3)
t = torch.from_numpy(a)       # 共享内存!
t2 = torch.tensor(a)          # 复制
b = t.numpy()                 # 转回去,共享内存
```

共享内存意味着改 NumPy 会影响 Tensor,反过来亦然。后续 PyTorch 章节会大量用到这个互转。

### 6.1 dtype 对齐

NumPy 默认 `int64 / float64`,PyTorch 默认 `int64 / float32`。模型输入若用 numpy 喂 double 进去,PyTorch 会立刻报 `RuntimeError: mat1 and mat2 must have the same dtype`,**永远是 dtype 不匹配**。修法:构造数据时显式 `.astype(np.float32)`,或在 tensor 侧 `.float()`。

### 6.2 零拷贝 vs 复制

| 操作 | 内存 | 速度 |
|:---|:---|:---|
| `torch.from_numpy(a)` | 共享 | O(1) |
| `torch.tensor(a)` | 复制 | O(n) |
| `tensor.numpy()` | 共享 | O(1) |
| `tensor.cpu().numpy()` | 共享 + 跨设备 | 涉及 CUDA 同步 |

**坑**:GPU 上的 tensor 不能直接 `.numpy()`,要先 `.cpu()`;CUDA tensor 与 numpy 永远不共享内存,这是 CUDA 模型必须的事实。

---

## 7. 常见坑(7 条)

### 7.1 list 索引 vs numpy 索引混用

**症状**:`TypeError: only integer scalar arrays can be converted to a scalar index`
**原因**:把 numpy 数组当 list 用 `a[[1, 2]]` 是花式索引,行为不同于 `a[1, 2]`(后者是二维索引)
**修法**:始终明确「我在用 list 还是 ndarray」,二者索引语义不同

### 7.2 默认参数持有可变对象

**症状**:函数多次调用结果「串味」
**原因**:默认参数对象在函数定义时创建,后续共享
**修法**:默认参数设为 `None`,函数内显式创建

### 7.3 `*` 与 `@` 混淆

**症状**:`a * b` 想做矩阵乘,结果 shape 不对
**原因**:`*` 是 element-wise,`@` 才是矩阵乘
**修法**:矩阵乘永远用 `a @ b` 或 `np.matmul(a, b)`

### 7.4 广播维度不对齐

**症状**:`ValueError: operands could not be broadcast together with shapes (3,4) (3,)`
**原因**:最后对齐时维度不匹配,且都不为 1
**修法**:`b = b.reshape(1, -1)` 或 `b = b[:, None]` 显式升维

### 7.5 `np.dot` 在 1D/2D 的行为差异

**症状**:`np.dot(v1, v2)` 返回标量,`np.dot(M1, M2)` 返回矩阵,写法相似但语义不同
**原因**:`np.dot` 对 1D 是内积、对 2D 是矩阵乘
**修法**:涉及 1D 向量用 `v1 @ v2`,涉及矩阵用 `M1 @ M2`,统一用 `@`

### 7.6 修改切片影响原数组

**症状**:`a[0, :] = 999` 把原数组某行改了,自己都没注意
**原因**:基础切片返回**视图**而非副本
**修法**:需要副本时显式 `a[0, :].copy()`

### 7.7 整数除法 vs 浮点除法

**症状**:`3 / 2 == 1` 让人懵
**原因**:Python 3 之前 `/` 是整除,Python 3 之后 `/` 是真除法但整数运算可能被类型推断成 int
**修法**:写 `3.0 / 2` 或 `from __future__ import division`;numpy 默认是浮点

### 7.8 append 迭代累积

**症状**:循环里反复 `arr.append(x)`,比预分配慢 10 倍
**原因**:list 没预留容量,每次 append 满了就重新分配
**修法**:能预分配就用 numpy ndarray,Python 场景可先 `[None] * N` 再按下标填

### 7.9 深拷贝 vs 浅拷贝

**症状**:`b = a; b[0] = 99` 把 a 也改了
**原因**:赋值是引用绑定,b 和 a 指向同一个 list
**修法**:`b = a.copy()`(浅拷贝)或 `b = copy.deepcopy(a)`(深拷贝,递归复制嵌套对象)

### 7.10 `np.random.seed` 不够用

**症状**:设了 seed 结果还是每次不同
**原因**:`np.random` 默认全局状态,多进程/多线程下被覆盖
**修法**:用 `np.random.default_rng()` 创建独立 Generator 实例,或换 PyTorch 的 `torch.Generator`

---

## 8. 自检三问

**A. 给你 100 万条 `(user_id, score)` 数据,要求按 `user_id` O(1) 查 score,选 list 还是 dict?为什么?如果还要按 score 排序输出 top 10,又该用什么数据结构配合?**

要点:必须用 `dict`,键是 `user_id`,值是 `score`,因为 dict 基于哈希表查找是 O(1) 均摊,而 list 是 O(n)。Top 10 排序:从 dict 拿到 `(user_id, score)` 列表,用 `heapq.nlargest(10, items, key=lambda kv: kv[1])` 维护大小为 10 的小顶堆,O(n log 10) ≈ O(n),比全排序 `sorted(items, key=..., reverse=True)[:10]` 在大 n 下省一个 log 因子。

**B. 为什么 `def f(x, lst=[])` 是反模式?请给出一种正确写法,并说出 AI 代码里你见过因为「可变默认参数」导致的状态污染 bug。**

要点:Python 函数定义时就把默认实参对象求值,`lst=[]` 创建的空 list 被绑定到函数对象的 `__defaults__` 上,所有调用共享同一对象。正确写法:`def f(x, lst=None): lst = lst if lst is not None else []`。AI 常见 bug:训练脚本里 `def train(model, optimizer=Adam(model.parameters()))` 会让所有 train 调用共用同一个 optimizer 状态。

**C. 一句话解释 NumPy 广播机制,并写出 `A` 形状 `(4, 1, 3)` 与 `B` 形状 `(2, 1)` 相加后的结果 shape;再说明 `A @ B` 与 `A * B` 的本质区别。**

要点:广播 = 维度为 1 时沿该轴「虚拟拉伸」对齐,从右往左对齐。`A(4,1,3) + B(2,1)`:B 补 1 维成 `(1,2,1)`,再对齐到 `(4,2,3)`。`A @ B` 是矩阵乘(线性代数),`A * B` 是 element-wise(对应位相乘)。Day 2 线性代数的矩阵乘就是 `@`,这是把神经网络「一层」从 for 循环改写成一行 `X @ W + b` 的根本。

---

## 9. 推荐资源

### 视频
- **莫烦 Python** —— 中文入门,讲 list/dict/set/tuple 时举的生活化例子最接地气
- **3Blue1Brown《线性代数的本质》** —— Day 2 会用,但 Day 1 也推荐先看第 1 集建立向量直觉
- **Corey Schafer《Python Tutorials》** —— 英文经典,函数、推导式、生成器讲得透彻

### 教科书
- **《Python编程:从入门到实践》(Eric Matthes)** —— 案例驱动,前 8 章覆盖本节所有内容
- **《Fluent Python》(Luciano Ramalho)** —— 第 3 章讲「字典和集合」是 Python 进阶必读

### 论文
- 本节无原始论文(工程基础)。后续 **《NumPy 1.26 Reference》** 官方文档是写矩阵代码时的事实字典

### 博客 / 课程
- **NumPy 官方 Quickstart Tutorial** —— `numpy.org/doc/stable/user/quickstart.html`,把本节所有内容官方背书
- **Real Python《NumPy Tutorial》** —— 实战导向,广播讲得最清楚
- **Python 官方文档《Data Structures》** —— 5 分钟过一遍 list/dict/set/tuple 语义

### 代码
- **NumPy 100 题**(GitHub 搜索 "100 numpy exercises")—— 做完前 30 题就足够覆盖本节
- **scipy-lectures.org** —— 免费的科学计算 Python 教程,章节「1. NumPy」约 2 小时可读完

---

## 10. 本节要点

- **数据结构选型**:list = 有序可变序列,dict = O(1) 映射,set = 去重/集合运算,tuple = 不可变,可作 dict key。AI 工程几乎所有「标签→值」都是 dict。
- **默认参数陷阱**:`def f(x, lst=[])` 会让所有调用共享同一个 list 对象,正确写法是 `lst=None` + 函数内显式创建。AI 中常见 optimizer/state 污染就是这条坑。
- **NumPy 是地基**:ndarray 比 Python list 快 50–400 倍,因为底层 C + BLAS + SIMD。`a @ b` 是矩阵乘,`a * b` 是 element-wise,**永不要混用**。
- **广播机制**:维度从右往左对齐,缺位补 1,维度为 1 处虚拟拉伸。`(4,1,3) + (2,1) = (4,2,3)`,这是神经网络 batch 维度计算天天用的机制。
- **`axis` 与 `keepdims`**:`axis=k` 沿第 k 维归约、该维消失;`keepdims=True` 保留被归约的维为 1,方便后续广播。
- **NumPy ↔ PyTorch**:`torch.from_numpy(a)` 与 `a.numpy()` 共享内存,改一边另一边同步;`torch.tensor(a)` 会复制。这是后续深度学习的常用入口。
- **AI 实战范式**:训练循环里第一反应应该是「能不能用 numpy 一行搞定」,而不是 for 嵌套——向量化是性能分水岭,本节以后所有代码都默认向量化。

---

## 11. 下一节:Day 02 · 线性代数核心

主题:向量、矩阵、点积、特征值。覆盖:

- **向量**作为数据点 / 方向的几何直觉,模长、点积、夹角
- **矩阵**作为线性变换算子,左乘 = 行变换 / 右乘 = 列变换,矩阵乘法的真正含义
- **(AB)ᵀ = BᵀAᵀ** 转置规则,以及为什么 Transformer QKᵀ 反向传播要用
- **特征值 / 特征向量** `A v = λ v`,PCA 取最大 λ 对应 v 作为第一主成分的几何解释
- **NumPy 手算**:向量加减、点积、矩阵乘法、2×2 矩阵特征值各 1 例,亲手算不用 `np.linalg.eig` 内部实现

产出物:`np.dot` vs `*` 的 shape 推演表,PCA 在二维 toy 数据上的 1 行实现 + 可视化。