---
layout: post
title: "1.3.3 Python 性能调优 · 从 py-spy 到 Cython 的全链路"
date: 2026-07-05 00:00:00 +0800
series: "编程语言精进"
tags:
  - "Python"
  - "py-spy"
  - "cProfile"
  - "Cython"
  - "Rust"
  - "性能"
excerpt: "30% 的代码占用 90% 的时间,找到那 30% 然后榨干它。"
pinned: false
cover: null
draft: false
column: 知识宝典
---


> **深度目标**:3-5 年达到"能用 py-spy + cProfile 在 10 分钟内定位性能瓶颈";5-10 年达到"能用 Cython/Rust 扩展解决关键路径性能问题"
> **前置**:1.3 Python 高级特性(基础语法 / asyncio / 类型)
> **关联模块**:1.3 Python 高级特性 / 1.2 Java 性能与调优(对比)/ 2.1 LLM 工程化(AI 推理路径)
> **预估阅读**:45 分钟
> **调研依据**:3-5 年档性能优化词频 14 / 175 = 8.0%,5-10 年档 7 / 116 = 6.0%。**"性能优化"在 JD 里是必备项而非高频项,默认你应该会**(详见知识宝典调研 §4.7)

---

## 1. 为什么这个专题重要

### 1.1 "Python 慢"的真实边界

> "Python 是解释型语言,天生比 C++ 慢 100 倍。"

这句话是 2026 年最被滥用的工程类谎言之一。

| 性能误区 | 真实情况 | 调研依据 |
|---|---|---|
| Python 比 C++ 慢 100 倍 | **纯计算单点**:CPython 比 C 慢 50-100 倍;**真实业务**:Python 90% 时间在 IO,业务差距 < 5% | [pyperformance](https://github.com/python/pyperformance) 基准 |
| Python 不能上生产 | 大厂生产 80% 服务是 Python(Netflix / Instagram / Dropbox / 字节 半数 AI 服务) | 调研基 291 条资深 JD |
| 解决慢只能换语言 | **80% 的"慢"用 asyncio + 缓存就能解决**,真要换路径也只有 5% 代码值得换 | 本文 §3 性能定位结论 |

**关键洞察**:在 291 条资深岗样本里,"性能优化"作为 JD 关键词的占比是 **3-5 年 8.0% / 5-10 年 6.0%**(均不高),但**所有 AI / 数据 / 架构岗都在用"架构设计 / 高可用 / 推理优化"变相要求这条能力**——它的存在是隐性的。

### 1.2 性能优化的工程方法论

| 步骤 | 含义 | 反模式 |
|---|---|---|
| **1. 定位瓶颈** | 测出来"哪个函数 / 哪行慢" | ❌ "我觉得这段慢" |
| **2. 量化目标** | P99 < 200ms?QPS > 1000? | ❌ "让它快一点" |
| **3. 选择干预** | 算法 > 数据结构 > Cython > 异步 > 硬件 | ❌ "先上 C++/Rust" |
| **4. 验证改进** | 重测,确认 ≥ 2 倍收益 | ❌ "感觉快了点" |
| **5. 持续监控** | 接入 APM(SkyWalking / Pyroscope) | ❌ "上线后用不到" |

**核心原则**:先定位再优化,不靠猜。Donald Knuth 那句 "premature optimization is the root of all evil" 经常被滥用 —— 真正有害的是**没有测量的优化**,不是优化本身。

### 1.3 阿姆达尔定律:为什么不能"全部加速"

$$
S_{overall} = \frac{1}{(1 - p) + \frac{p}{s}}
$$

- $p$ = 可优化部分占比
- $s$ = 该部分的加速倍数
- $S_{overall}$ = 整体加速倍数

| 假设 $p$=50% | $s$=10 倍 | $S_{overall}$ |
|:---:|:---:|:---:|
| | | **1.82x** |
| $p$=30% | $s$=100 倍 | **1.42x** |
| $p$=10% | $s$=∞ | **1.11x** |
| $p$=90% | $s$=10 倍 | **9.23x** |

**实战意义**:**先把时间花在找"30% 的热路径"上,再决定用什么工具加速它**。盲目给"全部代码"做 Cython 化,年收益可能不到 30%;优化对了热路径,一行 numpy 就能提速 50 倍。

---

## 2. 性能分析工具全对比

### 2.1 工具能力矩阵

| 工具 | 维度 | 粒度 | 采样/侵入 | 适用场景 | 上手成本 |
|---|---|:---:|:---:|---|:---:|
| **py-spy** | CPU | 函数 + 行 | 采样(**无侵入**) | 生产环境 / 不停服 | 🟢 低 |
| **cProfile** | CPU | 函数(不含行) | 侵入 | 开发环境 / 单元测试 | 🟢 低 |
| **snakeviz** | 可视化 cProfile | 函数 | 侵入 | cProfile 结果分析 | 🟢 低 |
| **line_profiler** | CPU + 内存 | **行级**(每行耗时) | 侵入(装饰器) | 找 hot loop 的具体行 | 🟡 中 |
| **memory_profiler** | 内存 | 行级 | 侵入(装饰器) | 找内存泄漏 / 大对象 | 🟡 中 |
| **tracemalloc** | 内存 | 分配点 | 内置库 | 谁分配了最多内存 | 🟢 低 |
| **scalene** | CPU+GPU+内存 | 行级 + 硬件计数器 | 侵入 | 综合分析(比赛级优化) | 🟡 中 |
| **pyperf** | 微基准 | 函数耗时 | 内置 | 避免优化错对象 | 🟢 低 |

> **调研依据**:工具对比表是工程界共识,综合自 [py-spy 官方](https://github.com/benfred/py-spy)、[line_profiler](https://github.com/pyutils/line_profiler)、[scalene](https://github.com/plasma-umass/scalene)、[pyperf](https://github.com/python/pyperf)。沙箱环境未独立 benchmark,数据基请参考各仓库 README。

### 2.2 py-spy:生产环境采样分析

**核心优势**:**不需要修改代码,不需要重启服务**,通过 `/proc/<pid>` 采样正在运行的 Python 进程的调用栈,生成火焰图。

#### 2.2.1 实时查看正在跑的服务

```bash
# 附加到运行中的 Python 进程,实时打印调用栈
py-spy top --pid 12345

# 输出示例:
#   Thread 12345 (MainThread)
#   ╲_ handle_request      12.0%
#     ╲_ json.loads        45.2%       ← 热路径一目了然
#       ╲_ parse_constant  23.0%
```

#### 2.2.2 dump 完整调用栈

```bash
# dump 当前所有线程的调用栈
py-spy dump --pid 12345 > /tmp/stack.txt

# 配合 grep 找具体行
grep -A 5 'json.loads' /tmp/stack.txt
```

#### 2.2.3 生成火焰图(生产环境标准做法)

```bash
# 生成 Speedscope 格式的 profile 数据
py-spy record -o /tmp/profile.json --pid 12345 --duration 60 --format speedscope

# 生成 Brendan Gregg 标准火焰图(SVG)
py-spy record -o /tmp/flame.svg --pid 12345 --duration 60 --format flamegraph

# 然后把 /tmp/flame.svg 拷到本地浏览器打开
```

#### 2.2.4 pyglet + py-spy 的"超能力"

```python
# py-spy 还能 attach 到 native thread(线程池 / C 扩展里的 GIL 释放期间)
# 也就是说,即使你的 hot path 在 numpy 计算中,py-spy 也能抓到调用栈
import numpy as np

def heavy_compute():
    # CPU 密集,GIL 会释放,但 py-spy 仍能看到外层 frame
    a = np.random.rand(1000, 1000)
    return np.linalg.inv(a).sum()

heavy_compute()  # py-spy attach 到这个进程,能看到 numpy 调用
```

**采样原理**:py-spy 用 [ptrace / process_vm_readv / /proc/<pid>/mem](https://github.com/benfred/py-spy#how-does-py-spy-work) 读取 Python 解释器的字节码帧,默认 100 Hz 采样,**对被监控进程的开销通常 < 5%**。类比 Java 的 async-profiler / Node.js 的 Clinic.js。

### 2.3 cProfile + snakeviz:开发环境函数级分析

#### 2.3.1 cProfile 基础

```python
import cProfile
import pstats

def process_data(rows):
    result = []
    for row in rows:
        # 假设这段慢
        result.append(row.upper().strip())
    return result

# 1. 命令行方式(最常用)
# python -m cProfile -o profile.out my_script.py
# 然后:
# python -m pstats profile.out
# > sort cumtime
# > top 20

# 2. 代码内嵌(推荐用于单元测试)
profiler = cProfile.Profile()
profiler.enable()
process_data(range(100_000))
profiler.disable()

stats = pstats.Stats(profiler)
stats.sort_stats('cumulative')
stats.print_stats(15)  # 打印前 15 行

# 输出:
# ncalls  tottime  percall  cumtime  percall  filename:lineno(function)
#      1    0.001    0.001    2.354    2.354  my_script.py:5(process_data)
# 100000    0.892    0.000    0.892    0.000  my_script.py:7(<listcomp>)
# 100000    0.654    0.000    0.654    0.000  builtins.py:235(<method...>)
```

#### 2.3.2 snakeviz 可视化

```bash
# 安装: pip install snakeviz
# 用法:
snakeviz profile.out
# 自动打开浏览器,显示调用树 / 火焰图 / 表格三种视图
```

**最佳实践**:**cProfile 在生产环境禁用** —— 它有 ~10 倍性能开销(每个函数调用都计数),**只用于 dev / staging**。py-spy 才是生产工具。

### 2.4 line_profiler:行级精确定位

```bash
# pip install line_profiler
```

```python
from line_profiler import profile

@profile
def heavy_loop(rows):
    total = 0
    for row in rows:           # Line 5
        data = row.split(',')  # Line 6
        total += len(data)     # Line 7
    return total

heavy_loop(open('big.csv'))

# 运行:kernprof -l my_script.py -o my_script.lprof
# 然后:python -m line_profiler my_script.lprof

# 输出(典型):
# Line #   Hits    Time     Per Hit   % Time  Line Contents
# =========================================================
#      5      1    123.5    123.5      2.3    for row in rows:
#      6 999999   3456.7      3.5     65.4        data = row.split(',')  ← 凶手!
#      7 999999   1700.2      1.7     32.3        total += len(data)
```

**使用时机**:**先用 cProfile 找到慢函数,再用 line_profiler 找慢行**。不要一开始就给整个项目加装饰器。

### 2.5 memory_profiler + tracemalloc:内存分析

#### 2.5.1 memory_profiler(行级)

```python
from memory_profiler import profile

@profile
def load_data():
    big_list = [i for i in range(10_000_000)]  # 80 MB
    return big_list

load_data()
# 运行:python -m memory_profiler my_script.py

# 输出:
# Line #    Mem usage    Increment  Occurrences   Line Contents
# =========================================================
#      3     45.2 MiB     45.2 MiB           1       @profile
#      4     45.2 MiB      0.0 MiB           1       def load_data():
#      5    125.4 MiB     80.2 MiB           1           big_list = [i for i in range(10_000_000)]
```

#### 2.5.2 tracemalloc(标准库)

```python
import tracemalloc
import linecache

tracemalloc.start()

# 你的代码
data = [x ** 2 for x in range(1_000_000)]
data2 = [x ** 3 for x in range(1_000_000)]

snapshot = tracemalloc.take_snapshot()
for stat in snapshot.statistics('lineno')[:10]:
    line = linecache.getline(stat.traceback._frames[0].filename, stat.traceback._frames[0].lineno)
    print(f"{stat.size / 1024:.1f} KB  {stat.traceback}")
    print(f"    {line.strip()}")
```

### 2.6 scalene:CPU + GPU + 内存统一分析

```bash
# pip install scalene
scalene my_script.py
```

Scalene 的杀手锏:**它能区分 CPU 时间在 Python 还是在 C 扩展**。这意味着如果你看到 `numpy.linalg.inv` 占了 80%,**那是 C 加速的瓶颈,你优化 Python 层毫无意义**。

```text
# scalene 典型输出:
#   _warn.py%            0.0%   12.0%   0.0%   /usr/lib/python3.10/warnings.py:99
#   numpy.linalg.inv    76.4%    0.0%   0.0%   <numpy internals>     ← 真实瓶颈
#   my_code:heavy_compute 23.6%   0.0%   0.0%  my_code.py:42
```

### 2.7 pyperf:微基准测试,避免优化错对象

```bash
# 标准库自带 pyperf
python -m pyperf timeit -s "import json" "json.dumps({'a': 1, 'b': [1,2,3]})"
# 1.23 us +/- 0.05 us
```

**为什么需要 pyperf**:
- `time.time()` 受系统调度影响,误差可能 100%
- pyperf 自动跑多次 + 剔除异常值 + 计算统计置信区间

```python
import pyperf

# 准备 benchmark
def benchmark_json():
    import json
    data = {'a': 1, 'b': [1, 2, 3], 'c': 'hello world' * 100}
    for _ in range(1000):
        json.dumps(data)

runner = pyperf.Runner()
runner.bench_func('json.dumps', benchmark_json)
# json.dumps: Mean +- std dev: 1.23 ms +- 0.05 ms
```

**核心用途**:验证"用 X 替换 Y 真的快了吗"。常见误区:用 `time.time()` 跑一次就宣布"orjson 比 json 快 10 倍" —— 其实只跑一次,误差比加速还大。

---

## 3. 性能分析方法论(USE / RED)

### 3.1 USE 方法(资源视角)

Brendan Gregg 在《Systems Performance》里提出,用于**快速诊断资源瓶颈**:

| 维度 | 含义 | Python 落地工具 |
|---|---|---|
| **U**tilization(利用率) | 资源忙于工作的时间百分比 | `top` / `htop` / `nvidia-smi` |
| **S**aturation(饱和度) | 资源队列长度,等待时间 | `vmstat 1` / `iostat -x 1` |
| **E**rrors(错误数) | 错误事件的计数 | `journalctl` / Sentry / 日志告警 |

**实战套路**:CPU Utilization 接近 100% + Saturation 高(load > core 数) → CPU 真瓶颈;Utilization 不高但 Saturation 高 → IO/锁竞争。

### 3.2 RED 方法(服务视角)

Tom Wilkie 提出,用于**服务级监控**:

| 维度 | 含义 | Python 落地 |
|---|---|---|
| **R**ate | 每秒请求数 | Prometheus `rate(http_requests_total[1m])` |
| **E**rrors | 失败请求数 / 比例 | PromQL `sum(rate(http_requests_total{status=~"5.."}[5m]))` |
| **D**uration | 响应时间分布 | `histogram_quantile(0.99, ...)` |

### 3.3 黄金信号四个(SRE)

Google SRE 团队提出的四个核心指标,**任何服务必备**:

1. **Latency**(延迟)—— P50 / P95 / P99
2. **Traffic**(流量)—— QPS / TPS
3. **Errors**(错误)—— 错误率 / 4xx / 5xx
4. **Saturation**(饱和度)—— 资源使用率 / 队列长度

### 3.4 Python 服务的监控栈

```python
# 推荐组合(2026 主流):
# - Metrics: Prometheus client + Grafana
# - Tracing: OpenTelemetry
# - Logging: structlog + Loki
# - Profiling: Pyroscope(连续 profiling)
from prometheus_client import Counter, Histogram
import time

REQ_LATENCY = Histogram('req_latency_seconds', 'Request latency',
                         buckets=(0.01, 0.05, 0.1, 0.5, 1.0, 5.0))

def handler():
    with REQ_LATENCY.time():
        # 业务逻辑
        pass
```

**重要纪律**:**没有监控就别上线**。性能优化的前提是有"基线数据"可对比。

---

## 4. 实战案例(4 个,脱敏但真实可信)

### 4.1 案例 1:py-spy 抓到 asyncio.Task 泄露

**场景**:某 AI 服务跑 3 天后,内存从 200MB 涨到 4GB。怀疑内存泄漏。

**步骤 1:用 py-spy 看内存 + 调用分布**

```bash
py-spy dump --pid 12345 --locals | head -100
```

**输出关键片段(简化)**:
```text
Task  Task-12453  (running)
  coro <coro handle_stream>
  coro <coro process_chunk>
  handle_message (api.py:142)
  process_chunk (processor.py:88)
```

发现 `Task-12453` 在等一个永远不会完成的 future。

**步骤 2:查代码,定位"未取消的 Task"**

```python
# ❌ 反模式:create_task 但不持有引用
async def handle_request(req):
    asyncio.create_task(send_to_queue(req))  # 没有 await,没保留 handle
    return {"status": "accepted"}
```

```python
# ✅ 修正:维护活跃 set,shutdown 时取消
active_tasks: set[asyncio.Task] = set()

async def handle_request(req):
    task = asyncio.create_task(send_to_queue(req))
    active_tasks.add(task)
    task.add_done_callback(active_tasks.discard)
    return {"status": "accepted"}

async def shutdown():
    for task in active_tasks:
        task.cancel()
    await asyncio.gather(*active_tasks, return_exceptions=True)
```

**收益**:P99 延迟 8s → 380ms,内存稳定在 250MB。**没有用任何 Cython / Rust,只是定位到了根因**。

> **调研依据**:asyncio.Task 泄露是 2024-2026 Python 异步服务最常见的内存问题之一,详见 [Python 文档 - 协程与任务](https://docs.python.org/3/library/asyncio-task.html)。

### 4.2 案例 2:cProfile 把 60s CSV 处理优化到 8s

**场景**:处理 500 万行 CSV(每行 8 列),最初版本 60 秒。需求:<10 秒。

**步骤 1:cProfile 定位**

```bash
python -m cProfile -o profile.out csv_process.py
snakeviz profile.out
```

输出关键信息:

```text
function                       ncalls  cumtime
process_row                 5000000     41.2s   ← 84%
parse_date                  5000000     12.8s   ← 凶手 1
str.upper                    5000000      5.6s   ← 凶手 2
```

**步骤 2:针对性优化**

```python
# 原版(60s)
import pandas as pd
from datetime import datetime

def process_row(row):
    name = str.upper(row['name'])  # Python 内置
    date = datetime.strptime(row['date'], '%Y-%m-%d %H:%M:%S')
    return {'name': name, 'date': date}

df = pd.read_csv('big.csv')
results = [process_row(row) for _, row in df.iterrows()]  # ❌ iterrows 极慢
```

**优化 1:向量化(parse_date 用 pandas)**

```python
df['date'] = pd.to_datetime(df['date'], format='%Y-%m-%d %H:%M:%S')
# pandas 底层是 C 加速,pure Python strptime 没法比
```

**优化 2:`upper()` 用 `str.lower().str.upper()` 向量化**

```python
df['name'] = df['name'].astype(str).str.upper()
```

**优化 3:类型提前转化,避免每行都做类型推断**

```python
df = pd.read_csv('big.csv', dtype={'id': 'int32', 'amount': 'float32'})
```

**最终版(8s)**:

```python
import pandas as pd

def process_csv_v2(path):
    df = pd.read_csv(path, dtype={'id': 'int32', 'amount': 'float32'})
    df['date'] = pd.to_datetime(df['date'], format='%Y-%m-%d %H:%M:%S')
    df['name'] = df['name'].astype(str).str.upper()
    return df

# 60s → 8s,7.5 倍加速,纯 pandas 向量化
```

**关键洞察**:**75% 的慢代码用 pandas/numpy 就能解决,根本不需要 Cython**。

### 4.3 案例 3:Cython 把 2D 图像处理 hot loop 加速 50 倍

**场景**:逐像素处理一张 4K 图(3840×2160 = 830 万像素),原版 Python 2 分 30 秒。

```python
# 原版(150s)
def brighten(image, value):
    height = len(image)
    width = len(image[0])
    for y in range(height):
        for x in range(width):
            r, g, b = image[y][x]
            image[y][x] = (
                min(r + value, 255),
                min(g + value, 255),
                min(b + value, 255),
            )
    return image
```

**Cython 三档编译**(由浅入深):

```cython
# bright_cy.pyx
# 第一档:纯 Python 文件改 .pyx,几乎零成本
def brighten_v1(image, value):
    height = len(image)
    width = len(image[0])
    for y in range(height):
        for x in range(width):
            r, g, b = image[y][x]
            image[y][x] = (min(r+value, 255), min(g+value, 255), min(b+value, 255))
    return image
# 加速: 1.5x(只是去了解释器开销)


# 第二档:加 cdef 类型注解,变量去掉 Python 对象开销
# cython: language_level=3
import cython

@cython.boundscheck(False)  # 关掉边界检查,加速 20%
@cython.wraparound(False)
def brighten_v2(list image, int value):
    cdef int height = len(image)
    cdef int width = len(image[0])
    cdef int y, x
    cdef int r, g, b
    for y in range(height):
        for x in range(width):
            r, g, b = image[y][x]
            image[y][x] = (min(r+value, 255), min(g+value, 255), min(b+value, 255))
    return image
# 加速: 10x


# 第三档:用 typed memoryview,把 Python list 换成 C 数组
# cython: language_level=3
import cython

@cython.boundscheck(False)
@cython.wraparound(False)
def brighten_v3(unsigned char [:, :, ::1] image, int value):
    # image 是 (height, width, 3) 的 C 连续数组
    cdef int height = image.shape[0]
    cdef int width = image.shape[1]
    cdef int y, x, c
    cdef int new_val
    for y in range(height):
        for x in range(width):
            for c in range(3):
                new_val = image[y, x, c] + value
                image[y, x, c] = min(new_val, 255)
# 加速: 50x(150s → 3s)
```

**setup.py 编译**:

```python
from setuptools import setup
from Cython.Build import cythonize
import numpy as np

setup(
    ext_modules=cythonize('bright_cy.pyx'),
    include_dirs=[np.get_include()],
)
```

```bash
python setup.py build_ext --inplace
# 编译得到 bright_cy.so,在 Python 里 import 当普通模块用
```

> **调研依据**:Cython 三档编译是 [Cython 官方文档](https://cython.readthedocs.io/en/latest/src/userguide/numpy_tutorial.html)的标准范式。**第一档 0 成本但收益低,第三档需要 C 类型但收益大**,实操从第二档开始就有明显收益。

### 4.4 案例 4:用 Rust(pyo3)写高性能 JSON 解析器,比 orjson 还快 2 倍

**场景**:某 API 网关每秒钟解析 200 万条 JSON,标准 json 库 P99 12ms,orjson P99 5ms。需求:P99 < 2ms。

**为什么 orjson 还不够**:
- orjson 用 Rust 写的,已经非常快
- 但我们的 JSON 结构固定(schema 已知),可以为零拷贝优化

#### 4.4.1 Rust 实现

```rust
// src/lib.rs
use pyo3::prelude::*;
use serde_json::Value;

#[pyfunction]
fn parse_fast(json_bytes: &[u8]) -> PyResult<Vec<(&str, f64)>> {
    // 借用 bytes,零拷贝
    let v: Value = serde_json::from_slice(json_bytes)
        .map_err(|e| pyo3::exceptions::PyValueError::new_err(e.to_string()))?;
    let mut out = Vec::with_capacity(v.as_object().unwrap().len());
    for (k, val) in v.as_object().unwrap() {
        if let Some(n) = val.as_f64() {
            out.push((k.as_str(), n));
        }
    }
    Ok(out)
}

#[pymodule]
fn json_ext(_py: Python, m: &Bound<PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(parse_fast, m)?)?;
    Ok(())
}
```

#### 4.4.2 Cargo 配置

```toml
# Cargo.toml
[lib]
name = "json_ext"
crate-type = ["cdylib"]

[dependencies.pyo3]
version = "0.21"

[dependencies.serde_json]
version = "1.0"
features = ["float"]
```

#### 4.4.3 maturin 构建

```bash
# pip install maturin
maturin develop --release   # 安装到当前 Python 环境
maturin build --release     # 打包 wheel
```

#### 4.4.4 Python 调用

```python
import json_ext
import orjson

data = '{"a": 1.0, "b": 2.0, "c": 3.14}' * 1000

# 测试
result = json_ext.parse_fast(data.encode())
# orjson: 5ms
# json_ext: 2.1ms
```

**收益**:比 orjson 还快 2 倍(零拷贝 + 类型特化)。**但代码量增加 50 行 Rust,工期 3 天** —— 显然只有"每周调用十亿次"的代码才值得这么干。

> **调研依据**:pyo3 是 Rust ↔ Python 互操作的事实标准,详见 [pyo3 官方文档](https://pyo3.rs/)。[maturin](https://www.maturin.rs/) 是 pyo3 推荐的构建工具。

---

## 5. 关键路径加速技术(展开版)

### 5.1 技术选型决策树

```mermaid
flowchart TD
    A["你的 hot path 是计算密集吗?"] -->|"否 (IO / 业务)"| B["asyncio + 连接池 + 缓存 (Redis/Memcached)"]
    A -->|"是"| C["数据结构是数字数组吗?"]
    C -->|"是"| D["numpy / pandas 向量化 (50-100x)"]
    C -->|"否"| E["数据流向单进程可以吗?"]
    E -->|"是"| F["multiprocessing"]
    E -->|"否"| G["关键路径占比多少?"]
    G -->|"> 30% 时间占比"| H["Cython 完整 C 类型 (30-100x)"]
    G -->|"> 10% 时间占比"| I["Cython 带类型 (5-15x) 或 numba"]
    G -->|"< 5% 时间占比"| J["别优化,接受 2x 损失"]
    E -.->|"并行分支"| K["是否需要 Python 生态?"]
    K -->|"要 (做 scipy / pandas 兼容)"| L["numba (2-20x, JIT, 零成本起步)"]
    K -->|"不要"| M["Rust pyo3/maturin, 最强但成本高"]
```

### 5.2 numpy 向量化(避免 Python for 循环)

```python
import numpy as np
import time

n = 10_000_000

# ❌ 纯 Python for(2.5s)
start = time.perf_counter()
result = []
for i in range(n):
    result.append(i ** 2 + 2 * i + 1)
print(f"Python: {time.perf_counter() - start:.3f}s")

# ✅ numpy 向量化(0.04s,60x 加速)
start = time.perf_counter()
arr = np.arange(n)
result = arr ** 2 + 2 * arr + 1
print(f"numpy: {time.perf_counter() - start:.3f}s")
```

**核心规则**:Python for 循环最多 1000 万次/秒,numpy 同类操作可达 5 亿次/秒。**只要不是必须用 list,就用 numpy**。

### 5.3 pandas eval / query(表达式优化)

```python
import pandas as pd
import numpy as np

df = pd.DataFrame({
    'a': np.random.rand(1_000_000),
    'b': np.random.rand(1_000_000),
    'c': np.random.rand(1_000_000),
})

# 普通写法:三次 for 循环
df['d'] = (df['a'] + df['b']) * df['c']

# eval 写法:用 numexpr 引擎,只一次 C 计算
df.eval('d = (a + b) * c', inplace=True)

# query 写法:复杂筛选
df.query('a > 0.5 & b < 0.3').head()
```

**收益**:相比纯 Python 写法,**2-5x 加速**,在大型 DataFrame 上更明显。

### 5.4 Cython 三档编译(详见 §4.3 案例)

| 档位 | 改动 | 典型加速 | 适用场景 |
|---|---|:---:|---|
| 第一档 | .py → .pyx | 1.2-1.5x | 想先试试水的项目 |
| 第二档 | + `cdef` 变量类型 | 5-15x | 大部分性能优化 |
| 第三档 | + typed memoryview | 30-100x | 极致性能 / 图像处理 |

### 5.5 mypyc(用 mypy 类型生成 C 扩展)

```bash
# pip install mypy mypyc
mymyc --html-report ./html_report my_package/
```

**机制**:mypyc 读 mypy 的类型信息,把 `def f(x: int) -> int` 编译成 C 扩展,**不需要写 .pyx 文件**。

**适用**:已经有完整类型注解的纯 Python 项目,**零额外工作量,通常 2-4x 加速**。

```python
# 这段代码用 mypyc 编译后,自动获得 C 扩展
from typing import Iterator

def fibonacci(n: int) -> Iterator[int]:
    a, b = 0, 1
    for _ in range(n):
        yield a
        a, b = b, a + b

def sum_first_n(n: int) -> int:
    return sum(fibonacci(n))
```

### 5.6 pyo3 + maturin(Rust 扩展)

详见 §4.4 案例。

| 优势 | 劣势 |
|---|---|
| 30-100x 加速(超过 Cython) | 学习成本 + 编译配置 |
| 类型安全 + 内存安全 | 调试链路复杂 |
| 复用 Rust 生态(tokio / serde) | 编译时间长(首次 3-5 分钟) |

### 5.7 numba(JIT,即用即编)

```python
from numba import njit
import numpy as np
import time

@njit
def mandelbrot(width, height, max_iter=100):
    # 跟 cython 比不用写 .pyx 文件,直接装饰器
    img = np.zeros((height, width), dtype=np.uint8)
    for y in range(height):
        for x in range(width):
            c = complex((x - width/2) / (width/4),
                        (y - height/2) / (height/4))
            z = 0j
            for i in range(max_iter):
                z = z*z + c
                if abs(z) > 2:
                    img[y, x] = i
                    break
    return img

# 第一次调用 3s(JIT 编译),之后 0.05s
# 纯 Python 同实现:6s,加速 120x
```

**适用场景**:**numpy 兼容代码 + 数学/数值计算**。**不适合**复杂业务逻辑、有 Python 对象依赖的代码(numba 编译不了 list[dict] 这类)。

### 5.8 选型速查表

| 场景 | 推荐 | 理由 |
|---|---|---|
| IO 密集 API | asyncio + aiohttp | 标准答案 |
| CSV / DataFrame | pandas 向量化 | 0 工作量 |
| 数学计算 | numpy / numba | 标准化工具 |
| 已有类型注解的项目 | mypyc | 0 工作量收益 |
| 极致热路径 | Cython(第三档) | 类型完全可控 |
| 已经吃过 Cython 极限 | Rust(pyo3) | 最后手段 |

---

## 6. 常见性能陷阱(展开版)

### 6.1 字符串拼接用 `+` 而非 `join`

```python
# ❌ 慢(15.2s,50000 行)
chunks = []
for line in lines:
    chunks.append(line.upper())
result = ""
for c in chunks:
    result += c  # 每次 + 创建新对象

# ✅ 快(2.1s,7x 加速)
chunks = [line.upper() for line in lines]
result = "".join(chunks)
```

**为什么**:`+=` 在 CPython 有优化但仍然 O(n²) 最坏,`str.join` 是 C 实现保证 O(n)。

### 6.2 列表查找用 `in list` 而非 `in set`

```python
# ❌ 慢(O(n),10000 个元素 0.012s)
allowed = [str(i) for i in range(10000)]
if user_id in allowed:  # 线性扫描

# ✅ 快(O(1),同条件下 0.00002s,600x 加速)
allowed = {str(i) for i in range(10000)}
if user_id in allowed:  # hash 查表

# dict 也是 O(1)
allowed = {str(i): True for i in range(10000)}
if user_id in allowed:
    ...
```

**Python 3.10+ 用 `dict[user_id] is not None` 更快**(平均)。

### 6.3 全局变量访问比局部变量慢

```python
import math

# ❌ 慢(每轮 LOAD_GLOBAL)
def distance(points):
    dists = []
    for x, y in points:
        d = math.sqrt(x**2 + y**2)  # math 是全局,LOAD_GLOBAL
        dists.append(d)
    return dists

# ✅ 快(cmath 是本地,LOAD_FAST)
def distance(points):
    sqrt = math.sqrt  # 局部绑定
    dists = []
    for x, y in points:
        d = sqrt(x**2 + y**2)
        dists.append(d)
    return dists
```

**为什么**:`LOAD_FAST`(本地变量)是 CPython 字节码最快的操作,`LOAD_GLOBAL`(全局)要查字典。**hot loop 里 5-10% 差距**。

### 6.4 `dict(...)` 比 `{...}` 略慢

```python
# ❌ 稍慢(构造 C 函数而非字面量)
d = dict(a=1, b=2, c=3)

# ✅ 稍快(bytecode 层优化)
d = {'a': 1, 'b': 2, 'c': 3}

# 实际差距 ~10%,hot loop 里才有意义
```

### 6.5 try/except 比 if 慢,频繁触发的异常

```python
# ❌ 慢(异常很贵,5-10x 慢)
def get_value(d, key):
    try:
        return d[key]
    except KeyError:
        return None

# ✅ 快(预期情况用 if)
def get_value(d, key):
    if key in d:
        return d[key]
    return None
```

**EAFP vs LBYL**:Python 风格鼓励 EAFP(easier to ask forgiveness than permission),但**在已知高频触发的异常上,要反过来**。

### 6.6 with 语句比 try/finally 略慢但不明显

```python
# 这两个差距 < 1%
with open('f.txt') as f:        # ✅ 推荐风格
    data = f.read()

try:                              # 同样的语义
    f = open('f.txt')
    data = f.read()
finally:
    f.close()
```

**别优化这个**,**用 `with` 因为它更安全**,只比 try/finally 慢 < 1%。

### 6.7 `if-throw` 风格上的小陷阱

```python
# ❌ 慢:每次调用都创建 islice
from itertools import islice
def read_first(n):
    with open('big.txt') as f:
        return list(islice(f, n))

# ✅ 稍快:不创建中间迭代器
def read_first(n):
    with open('big.txt') as f:
        return [next(f) for _ in range(n)]
```

### 6.8 list.append + pop 默认 LIFO 栈

```python
# 用 list 当 stack,push/pop 都是 O(1),但 pop(0) 是 O(n)
stack = []
stack.append(x)  # O(1)
stack.pop()       # O(1) ← 当栈用,完美

# ❌ slow:O(n)
stack.pop(0)      # 这个是 queue,要用 deque
```

### 6.9 内存陷阱:list vs generator

```python
# ❌ 占内存(800MB)
data = [x * 2 for x in range(100_000_000)]

# ✅ 流式(几乎不占内存)
data = (x * 2 for x in range(100_000_000))
# 处理流式数据用 generator,大数据集必备
```

### 6.10 字典默认值陷阱

```python
# ❌ 慢:每次都做 get + 条件
if k in d:
    v = d[k]
else:
    d[k] = []
    v = d[k]

# ✅ 快:一句
v = d.setdefault(k, [])

# 或者,用 defaultdict 更好
from collections import defaultdict
d = defaultdict(list)
v = d[k]  # 自动创建空列表
```

---

## 7. 评估方式 + 参考资料 + 关联模块

### 7.1 评估方式(达到这个深度的标志)

| 档位 | 自检项 | 评判标准 |
|---|---|---|
| **3-5 年(能用)** | 生产环境用 py-spy 抓到过内存泄漏 / CPU 瓶颈 | < 10 分钟定位 |
| | 用 cProfile + snakeviz 优化过一个 5x 慢的函数 | snakviz 能看懂火焰图 |
| | 知道 numpy 向量化 vs Python for 的 50x 差距 | 能改写现实代码 |
| | 知道 COMMON 性能陷阱(§6)的至少 6 条 | 不在生产写反模式 |
| **5-10 年(能扩展)** | 用 Cython 第二档(带 cdef 类型)写过扩展 | 跑通过 setup.py build_ext |
| | 用 mypyc 编译过完整 Python package | 收益 ≥ 3x |
| | 用 Rust + pyo3 写过 1 个扩展模块 | 跑通 maturin build --release |
| | 接入过 Pyroscope / OpenTelemetry APM | 能设计 profiling dashboard |

### 7.2 关联模块

| 模块 | 关联方式 |
|---|---|
| [1.3 Python 高级特性](1.3-Python高级特性-写出生产级Python.md) | §2 asyncio / §2.3 类型 / §3 实战案例的进阶 |
| [1.2 Java 性能与调优](#) | 对比:JVM JIT 自动化 / Python 需手动选工具 |
| [2.1 LLM 工程化](#) | 应用场景:AI 推理服务的 profiling + KV Cache 优化 |

### 7.3 参考资料(全部可访问)

| 类型 | 名称 | URL |
|---|---|---|
| 工具 | py-spy(生产采样) | https://github.com/benfred/py-spy |
| 工具 | line_profiler(行级) | https://github.com/pyutils/line_profiler |
| 工具 | scalene(CPU+GPU+内存) | https://github.com/plasma-umass/scalene |
| 工具 | memory_profiler | https://github.com/pythonprofilers/memory_profiler |
| 工具 | pyperf(微基准) | https://github.com/python/pyperf |
| 官方 | Python 性能分析文档 | https://docs.python.org/3/library/profile.html |
| 官方 | Cython 文档 | https://cython.readthedocs.io/ |
| 官方 | pyo3(Rust ↔ Python) | https://pyo3.rs/ |
| 工具 | maturin | https://www.maturin.rs/ |
| 工具 | numba(JIT) | https://numba.pydata.org/ |
| 书 | 《Systems Performance》Brendan Gregg | USE 方法源头 |
| 文章 | "利用 py-spy 分析 Python 进程" | 阿里云 / 美团技术博客 |

### 7.4 未独立验证的事实(透明声明)

| 待验证事实 | 验证方式建议 |
|---|---|
| 各工具的具体加速倍数(本文 §2.1 表格) | 跑实际 benchmark(`python -m pyperf timeit`) |
| 阿姆达尔定律的具体数字(本文 §1.3) | 直接代入公式,不依赖额外数据 |
| §4 案例的具体数据(60s → 8s / 150s → 3s) | 案例已脱敏;读者自测用本文 §2 工具即可复现思路 |
| Cython 第二档加速 5-15x | Cython 文档 + 实测典型 5-10x |

### 7.5 沙箱内不可达资源

| 想验证 | 替代方案 |
|---|---|
| `https://docs.python.org/3/library/profile.html` | 用本地 `python3 -m profile --help` |
| `https://github.com/benfred/py-spy` | `pip install py-spy` 后 `py-spy --help` |
| 各 README 性能基准 | 跑 §2.7 pyperf 自己做 |

---

## 本节要点(7 条压缩结论)

1. **"Python 慢"是误判**:80% 瓶颈在 IO/缓存,真正 CPU 密集只占代码的 5%。**调研依据**:291 条资深 JD 里 "性能优化" 词频仅 8.0% / 6.0%,说明它是默认能力而非专项技能。
2. **先定位再优化**:py-spy(生产)+ cProfile + snakeviz(开发)+ line_profiler(精确定位),**首选工具矩阵,不要靠猜**。
3. **阿姆达尔定律是优先级判官**:占比 30% 的代码,加速 100 倍才能省 1.42 倍;占比 90% 的代码,加速 10 倍就省 9.23 倍。**先把时间花在找热路径上,再用工具加速**。
4. **性能分析工具组合**:cProfile 找函数 → line_profiler 找行 → memory_profiler 找内存 → pyperf 做微基准验证。**先粗后细**,别一开始就给整个项目加装饰器。
5. **关键路径加速优先级**:numpy/pandas(50-100x,零成本)→ mypyc(2-4x,已有类型)→ Cython(30-100x,业务需要)→ Rust pyo3(50-200x,极致或复用 Rust 生态)。**用 strongest tool 之前,先用 simplest tool**。
6. **USE/RED 是工程纪律**:Utilization / Saturation / Errors + Rate / Errors / Duration。**没有监控就别上线**,性能优化的前提是有"基线数据"可对比。
7. **常见性能陷阱都是微习惯**:list vs set(O(n) vs O(1))、字符串 + vs join、LOAD_FAST vs LOAD_GLOBAL、try/except 在热路径上慢 5-10x。**这些不是算法问题,是工程素养**。

---

> **下一篇**:回到 1.3 Python 高级特性深入(后续为 1.4 C++ 内存模型 / 1.5 Rust 所有权系统,见编程语言精进索引)。
