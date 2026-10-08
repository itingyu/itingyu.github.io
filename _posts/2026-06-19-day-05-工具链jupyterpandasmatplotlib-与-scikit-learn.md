---
layout: post
title: "Day 05｜工具链:Jupyter、pandas、matplotlib 与 scikit-learn（AI 学习笔记 · 基础筑基周 · 第 5 篇）"
date: 2026-06-19 00:00:00 +0800
series: "AI 学习笔记"
excerpt: ""
pinned: false
cover: null
draft: false
---


AI 工程第一天真正的产出物不是公式,而是「能跑的环境 + 5 行 demo」:Jupyter 提供交互式探索循环,让"写一行 → 立即看结果"成为常态;pandas 把 CSV 变成可切片的二维表格;matplotlib 把数字画成图,Loss 曲线 / 散点 / 直方图全靠它;scikit-learn 用统一 `fit / predict / transform` 接口把经典 ML 模型装进一个 namespace。

---

## 1. Python 环境搭建:venv / conda / pip

### 1.1 定义

AI 工程必须把"项目依赖"和"系统 Python"隔离,否则升级一个库就可能破坏另两个项目。**虚拟环境**给每个项目一份独立的 Python 解释器 + site-packages 目录,主流两种:

- **venv**:Python 3.3+ 内置,轻量,只管理 Python 包,不含 R / C 编译器
- **conda**:Anaconda / Miniconda 自带,管理 Python 包 + R 包 + 系统级 C/C++ 库(Numpy / PyTorch 的底层 BLAS、CUDA),适合科学计算重依赖项目

### 1.2 公式 / 命令清单

```bash
# venv 路线(Python 自带)
python3.10 -m venv .venv
source .venv/bin/activate          # Linux/macOS
.venv\Scripts\activate              # Windows PowerShell
pip install --upgrade pip
pip install numpy pandas matplotlib scikit-learn jupyter
pip freeze > requirements.txt       # 锁版本,可被同事 pip install -r 复原

# conda 路线(科学计算首选)
conda create -n ai-study python=3.10 -y
conda activate ai-study
conda install numpy pandas matplotlib scikit-learn jupyter -y
# 或走 conda-forge(更新更快)
conda install -c conda-forge numpy pandas matplotlib scikit-learn jupyter -y
```

### 1.3 例子:一键验证环境

```bash
# requirements.txt
numpy==2.1.0
pandas==2.2.3
matplotlib==3.9.2
scikit-learn==1.5.2
jupyter==1.1.1
```

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -c "import numpy, pandas, matplotlib, sklearn; print('OK', numpy.__version__)"
```

预期:`OK 2.1.0`(或类似版本号)。如果 import 报错或版本号不显示,环境就还没装好——Day 6 起所有代码都依赖这个环境,务必今天闭环。

### 1.4 取舍 / 直觉

把虚拟环境想象成"项目的独立工位":pip 是桌面抽屉(只放 Python 包),conda 是仓库管理员(还能调度系统级编译器 / CUDA)。如果你只用 sklearn / pandas / numpy + 纯 Python 包,venv 足够;一旦上 PyTorch 且需要 GPU,conda 更省心——`conda install pytorch torchvision pytorch-cuda=12.4 -c pytorch -c nvidia` 一行装齐 CUDA 工具链。

### 1.5 对比表

| 维度 | venv | conda | pip + system |
|:---|:---|:---|:---|
| 内置 | 是(Python 3.3+) | 需装 Miniconda | 是 |
| 包数 | PyPI(~500k) | Anaconda repo + conda-forge(~25k) | PyPI |
| 装系统库 | 否 | 是(BLAS / CUDA / MKL) | 否 |
| 速度 | 快 | 中(解析器慢) | 快 |
| 适合 | 纯 Python Web / 工具脚本 | 科学计算 + GPU | 简单小项目 |
| 锁定方式 | `pip freeze` | `conda env export` | 同 venv |

---

## 2. Jupyter:交互式探索环境

### 2.1 定义

**Jupyter Notebook** 是 cell-based 交互式执行环境。每个 cell 可以是代码 / Markdown / 原生输出,运行结果(数字、表格、图、HTML)保留在 cell 下方,变量驻留在全局 kernel 状态中跨 cell 复用。**JupyterLab** 是 Notebook 的下一代 IDE 版本,支持多 tab、文件浏览器、终端、git。

### 2.2 公式 / 关键 Magic Commands

```text
%matplotlib inline     # matplotlib 内嵌画图
%timeit                # 单行代码计时,自动取多次平均
%%timeit               # 整 cell 计时
%run script.py         # 跑外部 .py
%load_ext autoreload   # 改了 .py 自动重载
%autoreload 2          # 不重启 kernel 也能用新代码
%pdb                   # 出错自动进调试器
%who                   # 列出所有变量
```

### 2.3 例子:5 行探索式数据分析

```python
import pandas as pd
df = pd.read_csv("train.csv")
df.head()                        # 看前 5 行
df.describe()                    # 数值列统计摘要
df["col"].value_counts()         # 分类列频次
df.groupby("city")["price"].mean()  # 分组聚合
```

每行单独跑一个 cell,中间任何一行报错都只丢当前 cell 的状态,前 4 行的 `df` 还在内存里——这比写 .py 脚本再重跑整个文件快 10 倍。

### 2.4 取舍 / 直觉

Notebook 是"探索沙盒",但不是"产品代码"——kernel 状态隐式、运行顺序自由,导致"重启 kernel 后报错"的经典坑。生产代码请把成熟逻辑搬进 .py 模块 + 用 `%run` 或 `import` 加载,Notebook 只做编排。

### 2.5 对比表

| 工具 | 形态 | 适合 | 不适合 |
|:---|:---|:---|:---|
| Jupyter Notebook | 浏览器,cell 序列 | 探索、汇报、教学 | 长流程、版本控制 |
| JupyterLab | IDE 化 Notebook | 多文件项目 | — |
| VS Code + .py + REPL | 编辑器 + 交互终端 | 产品代码 | 演示 |
| Google Colab | 云 Notebook,免费 GPU | 临时跑模型 | 数据隐私 / 长任务 |
| Streamlit / Dash | Web App | 展示 / 内部工具 | 复杂交互 |

---

## 3. pandas:DataFrame / Series / I/O

### 3.1 定义

**pandas** 是 Python 数据分析的"事实标准":

- **Series**:一维带标签数组(`index` + `values`)
- **DataFrame**:二维带标签表格(行索引 + 列名),底层是 `np.ndarray` + index 字典

### 3.2 公式 / 核心 API

```math
\text{DataFrame 操作的三类轴:}
\begin{aligned}
&\text{列操作:}\ df[\text{col}], df[\text{col1}, \text{col2}] \\
&\text{行操作(按标签):}\ df.loc[\text{label}], df.loc[\text{l1:l3}, \text{c1:c2}] \\
&\text{行操作(按位置):}\ df.iloc[\text{i}], df.iloc[\text{i1:i3}, \text{c1:c2}] \\
&\text{条件筛选:}\ df[df[\text{age}] > 30] \\
&\text{聚合:}\ df.groupby(\text{key}).agg(\{\text{col}: ["mean", "sum"]\})
\end{aligned}
```

### 3.3 例子:泰坦尼克数据切片

```python
import pandas as pd

df = pd.read_csv("titanic.csv")
# 一行代码做条件聚合
survival_by_class = (
    df.groupby(["Pclass", "Sex"])["Survived"]
      .agg(["mean", "count"])
      .round(3)
)
print(survival_by_class)
# Pclass=1 Female: 96.8% 生还
# Pclass=3 Male:   13.5% 生还
```

### 3.4 取舍 / 直觉

把 DataFrame 想象成"带行号的 Excel":列名当字段名,行号当主键,索引当超快 `dict` 查表。DataFrame 比 ndarray 强在"列名可读 + 缺失值处理 + 类型异构",弱在"纯数值计算速度慢 1.5-3x"。热路径请 `.values` 转回 ndarray 或直接用 numpy / pyarrow。

### 3.5 对比表

| 数据结构 | 维度 | 轴标签 | 缺失值 | 速度 | 适合 |
|:---|:---|:---|:---|:---|:---|
| `ndarray` | n | 无 | 无 | 最快 | 数值计算 |
| `pd.Series` | 1 | 1 个 index | NaN | 中 | 单列时序 |
| `pd.DataFrame` | 2 | 行 + 列 | NaN | 中 | 表格数据 |
| `pyarrow.Table` | 2 | 行 + 列 | null | 快(并行) | 大数据 / Parquet |
| `polars.DataFrame` | 2 | 行 + 列 | null | 快 + 并行 | 大数据,API 类似 pandas |
| `dask.DataFrame` | 2 | 行 + 列 | NaN | 分布式 | 内存放不下时 |

---

## 4. matplotlib 与可视化基础

### 4.1 定义

**matplotlib** 是 Python 最经典的可视化库,所有 ML 训练曲线、EDA 散点图、混淆矩阵都基于它。两个 API:

- **pyplot 接口**(`plt.plot`, `plt.hist`, `plt.scatter`):简单快捷,默认当前 figure / axes
- **面向对象接口**(`fig, ax = plt.subplots()`, `ax.plot`):多子图、精细控制时必用

### 4.2 公式 / 常用图速查

| 任务 | pyplot | 面向对象 |
|:---|:---|:---|
| 折线 | `plt.plot(x, y)` | `ax.plot(x, y)` |
| 散点 | `plt.scatter(x, y, c=...)` | `ax.scatter(x, y, c=...)` |
| 柱状 | `plt.bar(x, h)` | `ax.bar(x, h)` |
| 直方图 | `plt.hist(x, bins=30)` | `ax.hist(x, bins=30)` |
| 子图 | `plt.subplot(2, 1, 1)` | `fig, ax = plt.subplots(2, 1)` |
| 保存 | `plt.savefig("out.png")` | `fig.savefig("out.png", dpi=150)` |

### 4.3 例子:训练 loss 曲线 + 残差散点

```python
import numpy as np
import matplotlib.pyplot as plt

rng = np.random.default_rng(0)
x = np.linspace(0, 10, 100)
y = 2.5 * x + 1.0 + rng.normal(0, 2.0, 100)

# 拟合
w, b = np.polyfit(x, y, 1)
y_pred = w * x + b

fig, axes = plt.subplots(1, 2, figsize=(12, 4))
axes[0].scatter(x, y, s=10, label="data")
axes[0].plot(x, y_pred, color="red", label=f"y={w:.2f}x+{b:.2f}")
axes[0].legend(); axes[0].set_title("fit")

axes[1].scatter(y_pred, y - y_pred, s=10)
axes[1].axhline(0, color="red", lw=1)
axes[1].set_xlabel("predicted"); axes[1].set_ylabel("residual")
axes[1].set_title("residual plot")

plt.tight_layout(); plt.savefig("fit.png", dpi=150)
```

### 4.4 取舍 / 直觉

可视化是 ML 调试的"X 光":Loss 曲线能秒辨"学习率太大(震荡)"还是"过拟合(train ↓ val ↑)";残差散点能秒辨"线性假设错(曲线形残差)"还是"高斯假设错(漏斗形残差)";散点图能秒辨"两个类可分(线性)"还是"必须上非线性"。**每个模型问题几乎都先画图,再写代码**。

### 4.5 对比表

| 库 | 语法 | 适合 | 静态 / 交互 |
|:---|:---|:---|:---|
| matplotlib | 低层,慢上手 | 出版级图 | 静态 |
| seaborn | 高层,基于 mpl | 统计图(箱线 / 热力) | 静态 |
| plotly | 交互,Web | Dashboard | 交互 |
| altair | 声明式 | 探索 | 交互 |
| bokeh | 交互,流数据 | 实时仪表盘 | 交互 |

---

## 5. scikit-learn:统一 Estimator API

### 5.1 定义

**scikit-learn** 是 Python 经典 ML 工具箱,所有模型都遵循统一 API:

```math
\text{Estimator 三件套:}
\begin{aligned}
&\text{fit}(X, y)\quad\text{训练(从数据学参数)} \\
&\text{predict}(X)\quad\text{预测(对新样本推结果)} \\
&\text{transform}(X)\quad\text{特征工程(标准化 / 编码 / 降维)}
\end{aligned}
$$

三件套之外的常用配套:`fit_transform` 一步搞定(训练时学参数 + 应用),`score(X, y)` 自带评分,`get_params() / set_params()` 网格搜索用。

### 5.2 公式 / 内置工具速查

```text
数据加载:    sklearn.datasets.load_iris / load_diabetes / load_digits
数据划分:    sklearn.model_selection.train_test_split / KFold / GridSearchCV
预处理:      sklearn.preprocessing.StandardScaler / MinMaxScaler / OneHotEncoder
特征工程:    sklearn.feature_extraction.text.TfidfVectorizer
线性模型:    sklearn.linear_model.LinearRegression / LogisticRegression / Ridge / Lasso
树模型:      sklearn.tree.DecisionTreeClassifier / Regressor
集成:        sklearn.ensemble.RandomForestClassifier / GradientBoostingClassifier
度量:        sklearn.metrics.accuracy_score / f1_score / confusion_matrix / r2_score
降维:        sklearn.decomposition.PCA / TruncatedSVD
聚类:        sklearn.cluster.KMeans / DBSCAN
```

### 5.3 例子:5 行跑通 Iris 分类

```python
from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.metrics import accuracy_score

X, y = load_iris(return_X_y=True)
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)
clf = KNeighborsClassifier(n_neighbors=5).fit(X_train, y_train)
y_pred = clf.predict(X_test)
print(f"acc = {accuracy_score(y_test, y_pred):.3f}")
# 通常 0.967
```

### 5.4 取舍 / 直觉

sklearn 统一 API 让"换模型只需改 1 行":LinearRegression → RandomForestRegressor,其他代码不动。这背后是**策略模式 + 协议类型**(Python 鸭子类型):只要对象实现了 `fit / predict`,Pipeline / GridSearchCV / cross_val_score 就能适配任何模型——这是 sklearn 在工业界被广泛采用的核心原因。

### 5.5 对比表

| 库 | 强项 | 弱项 | 适合 |
|:---|:---|:---|:---|
| scikit-learn | 经典 ML 全家桶、API 一致 | 无深度学习 / 无 GPU | tabular 任务 |
| XGBoost / LightGBM | 树模型速度快、效果好 | 仅树模型 | Kaggle tabular |
| PyTorch | 灵活、动态图、研究首选 | API 不统一 | 深度学习 / 研究 |
| TensorFlow / Keras | 工业部署成熟 | 灵活度低 | 大规模生产 |
| HuggingFace | 预训练模型 + Datasets | 不写经典 ML | NLP / 多模态 |
| statsmodels | 统计推断(置信区间 / p-value) | 无 ML 算法 | 统计建模 |

---

## 6. PyTorch / NumPy 实战:端到端最小 Pipeline

### 6.1 最小可运行实现

```python
# 一份完整的"数据 → 模型 → 评估"骨架,用 sklearn 实现
import numpy as np
from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.neighbors import KNeighborsClassifier
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.pipeline import Pipeline

X, y = load_iris(return_X_y=True)
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# Pipeline 把"预处理 + 模型"串成一个 Estimator
pipe = Pipeline([
    ("scaler", StandardScaler()),         # z-score 标准化
    ("clf",    KNeighborsClassifier(n_neighbors=5)),
])

pipe.fit(X_train, y_train)
y_pred = pipe.predict(X_test)

print(confusion_matrix(y_test, y_pred))
print(classification_report(y_test, y_pred, digits=3))
```

预期输出(典型):

```text
[[10  0  0]
 [ 0  9  1]
 [ 0  0 10]]
              precision    recall  f1-score   support
           0      1.000     1.000     1.000        10
           1      1.000     0.900     0.947        10
           2      1.000     1.000     1.000        10
    accuracy                          0.967        30
```

### 6.2 进阶版:NumPy 手算底层逻辑

```python
import numpy as np

# 上面 Pipeline 的"标准化 + KNN 距离"其实就这 30 行
X = load_iris().data
y = load_iris().target
mu, sigma = X.mean(axis=0), X.std(axis=0)
Xz = (X - mu) / sigma                              # z-score

# 手算一个测试样本到所有训练样本的欧氏距离
np.random.seed(0)
idx = np.random.permutation(len(Xz))
tr, te = idx[:100], idx[100:]
dists = np.linalg.norm(Xz[te][:, None, :] - Xz[tr][None, :, :], axis=2)
# shape (30, 100),dists[i, j] = 测试 i 到训练 j 的距离
k = 5
topk = np.argsort(dists, axis=1)[:, :k]
y_pred = np.array([np.bincount(y[tr][row], minlength=3).argmax() for row in topk])
acc = (y_pred == y[te]).mean()
print(f"manual KNN acc = {acc:.3f}")     # 通常 0.93-0.97
```

把 sklearn 当"黑箱 API",把 numpy 当"白盒实现",**两套都要会**——前者快出结果,后者让你真正理解算法内部发生了什么。

---

## 7. vs 其他方法对比

| 维度 | Jupyter + sklearn | R + tidyverse | Julia + Flux | Spark MLlib |
|:---|:---|:---|:---|:---|
| 语言 | Python | R | Julia | Scala / PySpark |
| ML 库 | scikit-learn / PyTorch | caret / tidymodels | MLJ.jl | ml / mllib |
| 学习曲线 | 平缓(API 一致) | 平缓(管道友好) | 中 | 陡(分布式概念) |
| 速度(单机) | 中(C 加速在 BLAS) | 中 | 极快(JIT) | 慢(序列化开销) |
| 适合 | 教学 / 入门 / 中小数据 | 统计 / 学术 | 高性能计算 | 大数据 / 集群 |
| 部署 | Flask / FastAPI / ONNX | plumber | HTTP.jl | Spark cluster |

- Python + sklearn 路线:**入门首选,生态最广,后续 PyTorch 兼容**
- R + tidyverse 路线:**统计学家首选,EDA 体验最好,但工业部署弱**
- Julia 路线:**研究 / 高性能,生态比 Python 略小**
- Spark MLlib:**数据放不下单机时的兜底**

---

## 8. 常见坑(10 条)

### 8.1 装包时混 pip 和 conda
**症状**:`pip install numpy` 后 `import numpy` 报"numpy not found"或两个版本号打架。
**原因**:pip 装在 conda 环境的 site-packages,但 conda activate 没生效,装到了系统 Python。
**修法**:始终先 `conda activate ai-study`,再 `pip install ...`,或全程用 `conda install`。

### 8.2 `import sklearn` 报错说找不到
**症状**:明明 `pip install scikit-learn` 显示成功,但 `import sklearn` 报 ModuleNotFoundError。
**原因**:`scikit-learn` 是 pip 包名,`sklearn` 是 import 名,二者不等价。
**修法**:`pip install scikit-learn`,`import sklearn`(这是约定,跟 `import cv2` / `import PIL` 同理)。

### 8.3 Jupyter 用错 kernel
**症状**:Notebook 里 `import torch` 失败,但 terminal 里能 import。
**原因**:Notebook 选了别的 kernel(系统 Python / 其他 conda env),不是当前 venv 的。
**修法**:右上角切换 kernel 到 `ai-study`,或 `python -m ipykernel install --user --name=ai-study`。

### 8.4 cell 顺序混乱导致 bug
**症状**:某个变量明明刚才定义了,重启 kernel 后报 NameError。
**原因**:Notebook cell 顺序执行,你后来改了上面 cell 的变量名,旧的输出还在误导。
**修法**:养成习惯 `Kernel → Restart & Run All`,确保从空状态能跑通。

### 8.5 pandas 操作 SettingWithCopyWarning
**症状**:`df[df.a > 0]["b"] = 1` 报警告,有时生效有时不生效。
**原因**:`df[df.a > 0]` 返回的可能是个 view 也可能是 copy,链式赋值行为未定义。
**修法**:用 `.loc`:`df.loc[df.a > 0, "b"] = 1`,明确写"我对哪行哪列赋值"。

### 8.6 train_test_split 不分层导致类别失衡
**症状**:`y` 中 95% 是 0,默认切分后训练集 / 测试集里 0 占 99%,模型几乎不学 1。
**原因**:分层采样没启用,稀有类别被随机切歪。
**修法**:`train_test_split(..., stratify=y)`,K 折用 `StratifiedKFold`。

### 8.7 StandardScaler 在测试集上重新 fit
**症状**:训练集 acc 0.95、测试集 acc 0.40。
**原因**:`scaler.fit_transform(X_test)`,用了测试集自己的 mean / std 标准化,导致"用未来信息"。
**修法**:`scaler.fit(X_train); X_test_scaled = scaler.transform(X_test)`,测试集只能 `transform` 不能 `fit`。

### 8.8 matplotlib 中文 / 负号乱码
**症状**:画图中文方框、负号变成小方块。
**原因**:默认字体不含中文字符,unicode minus 没启用。
**修法**:`plt.rcParams["font.sans-serif"] = ["SimHei"]; plt.rcParams["axes.unicode_minus"] = False`。

### 8.9 Jupyter 内核挂掉不释放
**症状**:进程列表里一堆 zombie kernel 占内存。
**原因**:关闭 tab 时 kernel 没停,后台 Python 进程还在跑。
**修法**:Notebook 用完执行 `Kernel → Shut Down`,或 `jupyter notebook stop`。

### 8.10 sklearn 1.0+ 旧 API 被弃用
**症状**:跑老代码 `from sklearn.linear_model import SGDClassifier` 报 FutureWarning。
**原因**:sklearn 1.0+ 改了部分 API,旧 import 路径被废。
**修法**:`pip install -U scikit-learn` 到 1.5+,改用新 API;或锁旧版本 `pip install scikit-learn==0.24`。

---

## 9. 自检三问

**A. Jupyter 的 cell-based 执行模式相比传统 .py 脚本,优势是什么?又有什么坑(比如执行顺序混乱、忘记保存变量)?怎么应对?**

要点:优势是「探索循环短」——每写一行立即看结果,变量驻留内核跨 cell 复用;坑是「顺序混乱」+「隐式状态」,改完旧 cell 不重启就不知道有没有新 bug。应对:用 `.py` 模块装可复用逻辑,Notebook 只做编排;定期 `Kernel → Restart & Run All` 验证可重现。

**B. pandas DataFrame 和 numpy ndarray 的核心区别是什么?为什么数据清洗阶段几乎一定先转 DataFrame,而不是直接用 ndarray?**

要点:DataFrame 带行 / 列标签、异构类型、缺失值原生支持、聚合 / groupby / merge 一行 API;ndarray 是同构 dtype、纯数值计算更快。清洗阶段需要按列名定位、混合字符串 + 数字 + 日期、填充缺失值,DataFrame 一行 `.fillna() / .astype() / .str.replace()` 完成,ndarray 要写多行索引代码;真到 ML 喂入模型前再 `.values` 转 ndarray。

**C. scikit-learn 统一 fit / predict API 设计带来了什么好处?如果让你切换线性回归和随机森林做同一个回归任务,需要改哪些代码?**

要点:好处是「策略模式 + 鸭子类型」让模型可替换、Pipeline / GridSearchCV / cross_val_score 通吃。切换代码改动:`from sklearn.linear_model import LinearRegression` → `from sklearn.ensemble import RandomForestRegressor`,`clf = LinearRegression()` → `clf = RandomForestRegressor(n_estimators=100)`,其余 `fit / predict / score` 调用完全不变。

---

## 10. 推荐资源(5 类)

### 视频
- **《JupyterCon 精选 talk》**(YouTube) — 5 分钟掌握 cell / magic / 调试最佳实践
- **Corey Schafer「Pandas Tutorial」**(YouTube, 12 集) — DataFrame / Series / groupby 全套
- **sentdex「Matplotlib Tutorial」**(YouTube) — pyplot 与 OO 接口对比

### 教科书
- **《Python Data Science Handbook》(Jake VanderPlas)** — 免费在线版,Jupyter / pandas / sklearn / matplotlib 一本通
- **《Hands-On Machine Learning with Scikit-Learn, Keras and TensorFlow》(Aurélien Géron)** — 第 1-4 章工具链入门
- **《Python for Data Analysis》(Wes McKinney, pandas 作者)** — pandas 圣经

### 论文 / 文档
- **scikit-learn「User Guide」**(sklearn.org) — 每个 Estimator 有 User Guide 段,比 docstring 详细
- **pandas「10 Minutes to pandas」**(pandas.pydata.org) — 速查表
- **matplotlib「Tutorials」**(matplotlib.org) — pyplot / OO / 3D 全套示例

### 博客 / 课程
- **Kaggle「Pandas」微课**(kaggle.com/learn/pandas) — 4 小时动手过完核心操作
- **Kaggle「Data Visualization」微课** — seaborn + matplotlib 入门
- **DataCamp「Intro to Python for Data Science」** — 环境 + Jupyter + numpy 全套

### 代码 / 模板
- **Kaggle Titanic "starter notebook"** — Kaggle 比赛页面直接 Run,EDA + 提交一键
- **scikit-learn 官方 examples**(scikit-learn.org/stable/auto_examples) — 200+ 可运行脚本
- **cookiecutter-data-science**(GitHub) — 数据科学项目目录结构模板,`data / notebooks / src / models / reports`

---

## 11. 本节要点

- **要 1**:Python 环境必须用 venv 或 conda 隔离,`requirements.txt` 锁定依赖,装包后写一行 `import` 验证。
- **要 2**:Jupyter 提供 cell-based 交互循环,magic commands(`%timeit` / `%matplotlib inline` / `%autoreload`)提升效率,但产品代码用 .py 模块。
- **要 3**:pandas DataFrame 是带行列标签的二维异构表,`.loc / .iloc / groupby / agg` 覆盖 90% 清洗需求。
- **要 4**:matplotlib pyplot 快速画、OO 接口精细画,所有 ML 训练 loss 曲线、EDA 散点图都靠它。
- **要 5**:scikit-learn 统一 `fit / predict / transform` 三件套,换模型只改 1 行,Pipeline 把预处理 + 模型串成一个 Estimator。
- **要 6**:`train_test_split(..., stratify=y)` 防类别失衡切歪,`StandardScaler` 必须只在训练集 `fit`、测试集 `transform`。
- **要 7**:从 numpy / pandas / sklearn 到 PyTorch / XGBoost 都是同一个"数据 → 模型 → 评估"骨架,Day 6 手写线性回归只走前 30 行。

---

## 12. 下一节:Day 06 · 线性回归手写实现

主题:第一个真 ML 模型——纯 numpy 把 `y = wx + b` + MSE Loss + 梯度下降从零写出来。覆盖:

- **线性回归假设** $\hat y = w^\top x + b$ 的几何意义(最佳拟合直线 / 超平面)
- **MSE 损失函数** $L = \frac{1}{N}\sum (y_i - \hat y_i)^2$ 的概率解释(高斯噪声 + 极大似然)
- **梯度下降** $w \leftarrow w - \eta \nabla L$ 的迭代公式,学习率 $\eta$ 与收敛速度的关系
- **解析解 vs 数值解** 正规方程 $w = (X^\top X)^{-1} X^\top y$ 与 GD 的等价性和适用场景
- **向量化** 用 `X @ w + b` 一次算所有样本,代替 Python for 循环加速 50-200 倍

产出物:一份手写实现脚本(纯 numpy)+ 一张 loss 曲线图 + 一份与 sklearn `LinearRegression` 结果对比的验证报告(权重误差应在 1e-6 量级)。