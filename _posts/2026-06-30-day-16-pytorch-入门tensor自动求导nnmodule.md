---
layout: post
title: "Day 16｜PyTorch 入门:Tensor、自动求导、nn.Module（AI 学习笔记 · 深度学习周 · 第 16 篇）"
date: 2026-06-30 00:00:00 +0800
series: ai-basics
excerpt: ""
pinned: false
cover: null
draft: false
column: ai
permalink: /notes/ai/ai-basics/day-16-pytorch-%E5%85%A5%E9%97%A8tensor%E8%87%AA%E5%8A%A8%E6%B1%82%E5%AF%BCnnmodule/
---


PyTorch 三件套是后续所有深度学习的脚手架:Tensor 是「跑在 GPU 上支持自动求导的 ndarray」,autograd 自动沿计算图反向传播,nn.Module 把所有网络层封装成可组合的模块——学完今天,Day 15 的 MLP 概念就能 30 行代码跑通 MNIST。

---

## 1. Tensor:统一的数据结构

### 1.1 一句话定义

PyTorch 的 Tensor = NumPy ndarray + GPU + 自动求导。它是标量 / 向量 / 矩阵 / 图像 (NCHW) / 批次 (NCHW) 统一的类。

### 1.2 关键属性三件套

| 属性 | 含义 | 例子 |
|:---|:---|:---|
| `dtype` | 数据类型 | `torch.float32` / `torch.int64` |
| `device` | 计算设备 | `'cpu'` / `'cuda'` / `'cuda:0'` |
| `shape` | 维度 | `(N, C, H, W)` / `(B, T, d)` |

```python
import torch
x = torch.tensor([[1.0, 2.0], [3.0, 4.0]],
                 dtype=torch.float32,
                 device='cuda' if torch.cuda.is_available() else 'cpu')
print(x.dtype, x.device, x.shape)
```

### 1.3 创建 Tensor 的 8 种方式

```python
torch.tensor([1, 2, 3])         # 从 Python list
torch.zeros((3, 4))              # 全 0
torch.ones((2, 2))               # 全 1
torch.empty((2, 2))              # 未初始化(快,慎用)
torch.randn((3, 4))              # 标准正态
torch.arange(0, 10, 2)           # 等差 [0, 2, 4, 6, 8]
torch.linspace(0, 1, 5)          # 等距 5 点 [0, 0.25, 0.5, 0.75, 1]
torch.eye(3)                     # 单位矩阵
```

### 1.4 Tensor 与 NumPy 互转

```python
import numpy as np
a = np.array([1, 2, 3])
t = torch.from_numpy(a)         # ndarray → tensor(共享内存)
a2 = t.numpy()                  # tensor → ndarray(共享内存)
```

零拷贝(共享内存)是 PyTorch 设计的优势,改一边另一边跟着变;需要独立副本用 `.clone()`。

### 1.5 设备迁移

```python
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
x = torch.randn(3, 4)             # 默认在 CPU
x = x.to(device)                  # CPU → GPU
y = torch.randn(3, 4, device=device)  # 直接在 GPU 上建
z = x + y                         # GPU + GPU = GPU
```

### 1.6 索引 / 切片 / 变形

```python
x = torch.arange(12).reshape(3, 4)
x[0, :]            # 第一行
x[:, 1]            # 第二列
x[x > 5]           # 布尔索引
x.view(2, 6)       # reshape(共享内存)
x.reshape(2, 6)    # reshape(可能复制)
x.transpose(0, 1)  # 维度换位(返回视图)
x.permute(1, 0, 2) # 多维换位(返回视图)
x.unsqueeze(0)     # (3,4) → (1,3,4) 加维
x.squeeze()        # (1,3,4) → (3,4) 压维
```

---

## 2. 自动求导 autograd

### 2.1 计算图与 requires_grad

设 `requires_grad=True`,Tensor 的所有运算会动态构建计算图;`loss.backward()` 沿图反向传播,梯度累加到叶子节点的 `.grad`。

```python
x = torch.tensor([1.0, 2.0, 3.0], requires_grad=True)
y = x * 2                # y = [2, 4, 6],requires_grad 也为 True
z = y.mean()             # z = 4.0,标量
z.backward()             # 反向传播
print(x.grad)            # tensor([0.6667, 0.6667, 0.6667])
```

为什么是 `0.6667`?`z = (2*x).mean() = (2/3) * Σ x_i`,`∂z/∂x_i = 2/3 ≈ 0.6667`。

### 2.2 `with torch.no_grad()` 推理模式

推理时不希望追踪梯度(浪费显存 + 干扰):

```python
model.eval()
with torch.no_grad():
    pred = model(X_test)
```

装饰器 `@torch.inference_mode()` 是更新版,更省显存。

### 2.3 `detach()` 切断梯度

```python
x = torch.randn(3, requires_grad=True)
y = x.detach()        # y 与 x 同值,但不参与梯度计算
y.requires_grad       # False
```

常用于:把某个中间值「冻结」用于 loss,不让它反向传播。

### 2.4 梯度累加与 zero_grad

```python
# ⚠️ PyTorch 梯度默认累加(不覆盖)
for x, y in loader:
    pred = model(x)
    loss = loss_fn(pred, y)
    loss.backward()        # 累加梯度到 .grad
    opt.step()
    opt.zero_grad()         # 清零,否则下个 batch 累加
```

### 2.5 标量 vs 非标量 loss 反向

```python
# 标量 loss:直接 backward()
loss = loss_fn(pred, y); loss.backward()

# 非标量(向量化):要么 sum / mean 成标量
loss = (pred - y).pow(2).mean(); loss.backward()

# 要么显式传 gradient 参数(不推荐)
loss = (pred - y).pow(2)
loss.backward(torch.ones_like(loss))  # 把 loss 当作「向量的偏导」
```

---

## 3. nn.Module 基类

### 3.1 写法模板

```python
import torch.nn as nn

class MLP(nn.Module):
    def __init__(self, d_in=784, d_hid=128, d_out=10):
        super().__init__()
        self.fc1 = nn.Linear(d_in, d_hid)
        self.fc2 = nn.Linear(d_hid, d_out)

    def forward(self, x):
        x = torch.relu(self.fc1(x))   # 隐藏层带激活
        return self.fc2(x)             # 输出 logits
```

### 3.2 parameters() 自动收集机制

```python
m = MLP()
for name, p in m.named_parameters():
    print(name, p.shape)
# fc1.weight torch.Size([128, 784])
# fc1.bias   torch.Size([128])
# fc2.weight torch.Size([10, 128])
# fc2.bias   torch.Size([10])
```

**机制**:`nn.Module.__setattr__` 重载——遇到 `nn.Module` / `nn.Parameter` 自动注册到 `_parameters` / `_modules` 字典;普通 Python 属性则不会。

### 3.3 forward 自动调用

```python
m = MLP()
x = torch.randn(32, 784)
out = m(x)            # 等价 m.forward(x),PyTorch 重载 __call__
```

### 3.4 常用 nn.Module 子类

| 模块 | 用途 |
|:---|:---|
| `nn.Linear(in, out)` | 全连接层 |
| `nn.Conv2d / Conv1d / Conv3d` | 卷积层 |
| `nn.LSTM / GRU / RNN` | 循环层 |
| `nn.Transformer` | Transformer |
| `nn.BatchNorm2d / LayerNorm` | 归一化 |
| `nn.Dropout` | 随机失活 |
| `nn.Embedding` | 词 / 类别嵌入 |
| `nn.MultiheadAttention` | 多头注意力 |

### 3.5 Sequential 与 ModuleList

```python
# Sequential:线性流水线
model = nn.Sequential(
    nn.Linear(784, 128),
    nn.ReLU(),
    nn.Linear(128, 10),
)

# ModuleList:在 forward 里灵活组织
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.ModuleList([nn.Linear(10, 10) for _ in range(5)])
    def forward(self, x):
        for layer in self.layers:
            x = torch.relu(layer(x))
        return x
```

---

## 4. 训练五步闭环

### 4.1 模板代码

```python
model = MyModel().to(device)
opt = torch.optim.Adam(model.parameters(), lr=1e-3)

for epoch in range(num_epochs):
    model.train()       # 训练模式(Dropout / BN)
    for x, y in train_loader:
        x, y = x.to(device), y.to(device)

        opt.zero_grad()           # 1. 清零梯度
        pred = model(x)           # 2. 前向
        loss = loss_fn(pred, y)   # 3. 算 loss
        loss.backward()           # 4. 反向
        opt.step()                # 5. 更新
```

### 4.2 train() vs eval() 行为差异

| 模块 | train 模式 | eval 模式 |
|:---|:---|:---|
| Dropout | 随机屏蔽 | 全保留(乘以 keep_prob) |
| BatchNorm | 用 batch 均值方差 | 用 running_mean / running_var |
| LayerNorm / Linear / Conv | 相同 | 相同 |

### 4.3 GPU 训练关键点

```python
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model = MyModel().to(device)

for x, y in loader:
    x = x.to(device, non_blocking=True)
    y = y.to(device, non_blocking=True)
    # ... 五步 ...
    loss = loss_fn(model(x), y)
```

`non_blocking=True` 配合 `pin_memory=True` 的 DataLoader 可让数据传输与计算 overlap。

### 4.4 DataLoader 与 Dataset

```python
from torch.utils.data import DataLoader, TensorDataset

ds = TensorDataset(X_tensor, y_tensor)
loader = DataLoader(ds, batch_size=64, shuffle=True,
                    num_workers=4, pin_memory=True)
```

- `shuffle=True` 训练时必加,验证 / 测试 False
- `num_workers` > 0 多进程读数据
- `pin_memory=True` 加速 CPU→GPU 传输

---

## 5. PyTorch 实战

### 5.1 Tensor 与 autograd 入门

```python
import torch

# 1. 创建
x = torch.tensor([[1.0, 2.0], [3.0, 4.0]], requires_grad=True)
print("x:", x, "\nrequires_grad:", x.requires_grad)

# 2. 运算 + 计算图
y = x @ x.T      # y = [[5, 11], [11, 25]]
loss = y.sum()    # 标量
print("loss:", loss)

# 3. 反向
loss.backward()
print("x.grad:\n", x.grad)    # ∂(sum(y))/∂x = 2x + (x^T)^T · I = 4x → ?(动手算)
```

### 5.2 最小 nn.Module + GPU 切换

```python
import torch.nn as nn, torch.nn.functional as F

class TinyMLP(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(10, 32)
        self.fc2 = nn.Linear(32, 2)
    def forward(self, x):
        return self.fc2(F.relu(self.fc1(x)))

m = TinyMLP()
m_cuda = m.cuda() if torch.cuda.is_available() else m
x = torch.randn(4, 10)
if torch.cuda.is_available():
    x = x.cuda()
out = m_cuda(x)
print("out shape:", out.shape)
```

### 5.3 MNIST 五步训练闭环

```python
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import datasets, transforms
from torch.utils.data import DataLoader

torch.manual_seed(42)
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# 1. 数据
transform = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize((0.1307,), (0.3081,)),
])
train_ds = datasets.MNIST('data', train=True, download=True, transform=transform)
test_ds  = datasets.MNIST('data', train=False, transform=transform)
train_loader = DataLoader(train_ds, batch_size=64, shuffle=True)
test_loader  = DataLoader(test_ds,  batch_size=256)

# 2. 模型
class MNISTNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(784, 128)
        self.fc2 = nn.Linear(128, 10)
    def forward(self, x):
        x = x.view(x.size(0), -1)
        return self.fc2(F.relu(self.fc1(x)))

model = MNISTNet().to(device)
opt = torch.optim.Adam(model.parameters(), lr=1e-3)

# 3. 训练
for epoch in range(3):
    model.train()
    for x, y in train_loader:
        x, y = x.to(device), y.to(device)
        opt.zero_grad()
        loss = F.cross_entropy(model(x), y)
        loss.backward()
        opt.step()
    print(f"epoch {epoch+1} done")

# 4. 评估
model.eval()
correct, total = 0, 0
with torch.no_grad():
    for x, y in test_loader:
        x, y = x.to(device), y.to(device)
        pred = model(x).argmax(1)
        correct += (pred == y).sum().item()
        total   += y.size(0)
print(f"Test acc: {correct / total:.4f}")
```

预期输出:`Test acc ≈ 0.97` 一个 epoch 后可达 ~97%,3 epoch 后 ~98%。

### 5.4 保存与加载模型

```python
# 保存(只存参数,推荐)
torch.save(model.state_dict(), "mnist.pth")

# 加载
m2 = MNISTNet()
m2.load_state_dict(torch.load("mnist.pth", map_location=device))
m2.eval()
```

存整个模型(连结构)也行,但跨版本兼容差,推荐 `state_dict()`。

### 5.5 torch.compile 加速(PyTorch 2.0+)

```python
model = torch.compile(model)   # 一行提速 10~50%
```

底层把 Python 代码 JIT 编译成优化过的内核。

---

## 6. vs NumPy / TF / JAX

| 维度 | NumPy | TensorFlow | JAX | PyTorch |
|:---|:---|:---|:---|:---|
| 自动求导 | 无 | tf.GradientTape | grad / jit | autograd |
| GPU 支持 | 无(cupy 替代) | 一流 | 一流 | 一流 |
| 动态图 | — | TF 2 eager 模式 | tracing | define-by-run |
| 易调试 | 最易 | 中 | 中 | 易 |
| 部署生态 | — | TFLite / TF Serving | — | TorchScript / ONNX |
| 研究 / 论文 | 少 | 中 | 中 | **主流** |
| 工业部署 | — | 强 | 弱 | 中 |

PyTorch 是当前研究界默认选择,生态成熟,TensorFlow 在工业部署侧仍有优势。

---

## 7. 常见坑

### 7.1 漏了 zero_grad()
**症状**:loss 跨 batch 累加,等效 batch_size × N
**修法**:每个 batch 开头 `opt.zero_grad()`

### 7.2 不切换 model.train() / eval()
**症状**:验证时 Dropout 仍然随机 / BatchNorm 用 batch 统计
**修法**:训练循环开头 `model.train()`,验证开头 `model.eval()`

### 7.3 Tensor 没 to(device) 一致
**症状**:`RuntimeError: Expected all tensors to be on the same device`
**修法**:所有 x, y, model 统一 `.to(device)`

### 7.4 requires_grad=True 后改数值
**症状**:warning + 梯度错乱
**修法**:用 `x.detach().clone()` 或 `with torch.no_grad(): x.copy_(new)`

### 7.5 模型参数忘了 .to(device)
**症状**:CPU 模型 + GPU 数据 → device mismatch
**修法**:`model = model.to(device)` 后再喂数据

### 7.6 loss 是 Python float 而非 Tensor
**症状**:`backward()` 失败或静默错乱
**修法**:loss 必须是 Tensor(由 loss_fn 算出)

### 7.7 view(-1) 维度推断错
**症状**:CNN 输出 view 后尺寸不对
**修法**:卷积前后用 `print(x.shape)` 调试,或 `nn.Flatten()` 替 view

### 7.8 测试时忘 torch.no_grad()
**症状**:显存爆炸
**修法**:`with torch.no_grad():` 包住推理代码;PyTorch 2.0+ 用 `torch.inference_mode()`

### 7.9 DataLoader num_workers 太大
**症状**:多进程抢占 CPU,反而更慢
**修法**:CPU 核数 / 2 是合理值;Linux 下也可加 `if __name__ == "__main__":`

### 7.10 CrossEntropyLoss 喂了 one-hot 标签
**症状**:loss = 0 或 NaN
**修法**:CE 期望 `class_index`(整数张量),不是 one-hot;one-hot 用 BCE 或手动算

---

## 8. 自检三问

**A. `x = torch.tensor([1.0, 2.0, 3.0], requires_grad=True); y = x * 2; z = y.mean(); z.backward()` 为什么 `x.grad` 是 `[0.6667, 0.6667, 0.6667]` 而不是 `[2, 2, 2]`?提示看 `mean()` 把总和除以几。**

要点:`z = mean(x*2) = (1/3) Σ 2 x_i`,所以 `∂z/∂x_i = (1/3) · 2 = 2/3 ≈ 0.6667`。`[2, 2, 2]` 是忘记 mean 的常见错答。详见 §2.1。

**B. nn.Module 的 `__init__` 里写了 `self.fc1 = nn.Linear(10, 5)`,为什么 `model.parameters()` 不用手动注册?如果换成普通 Python 属性赋值会发生什么?**

要点:`nn.Module.__setattr__` 被重载:检测到赋值对象是 `nn.Module` / `nn.Parameter` 时自动注册到 `_modules` / `_parameters` 字典;`parameters()` 递归遍历这些字典。换成普通属性(如 `self.fc1 = some_function`)不会被注册,参数无法被优化器找到。详见 §3.2。

**C. 训练时 loss 突然变成 NaN,常见三类原因分别对应什么排查动作?学习率从 0.1 直接降到 0.0001 一定对吗?**

要点:三类原因 = (1) 模型输出范围爆炸 / log(0) → 加数值稳定 loss(BCEWithLogits / CrossEntropyLoss);(2) 梯度爆炸 → 加 `torch.nn.utils.clip_grad_norm_` 梯度裁剪;(3) 学习率过大 → 从 1e-3 起步。学习率从 0.1 直接降到 0.0001 不一定对,要看是不是「过冲」导致,如果数据本身有 NaN,再小也救不了。先排查数据 → 再调超参。详见 §7.5。

---

## 9. 推荐资源

### 视频
- **PyTorch 官方 Tutorial 视频** —— 60 分钟入门
- **Andrej Karpathy《Let's build GPT》** —— 从零手写训练循环
- **李沐《动手学深度学习》PyTorch 版** —— 中文实战

### 教科书
- **《动手学深度学习》(D2L) PyTorch 版** —— 第 1-3 章对应今天内容
- **《Deep Learning with PyTorch》(Stevens)** —— 工业视角
- **《Python Deep Learning》(Vasilev)** —— 入门视角

### 论文 / 官方文档
- **PyTorch 官方文档 `torch.Tensor`** —— 完整 API
- **PyTorch 官方文档 `torch.autograd`** —— 自动求导机制
- **Paszke et al. 2019《PyTorch: An Imperative Style, High-Performance Deep Learning Library》** —— NeurIPS 论文
- **《PyTorch Internals》** —— 计算图实现细节

### 博客 / 课程
- **PyTorch 官方教程《Learn the Basics》** —— Tensor / autograd / nn.Module / Training
- **Real Python《PyTorch Introduction》** —— 中文友好教程
- **PyTorch Lightning** —— 把训练循环封装得更高
- **《PyTorch Lightning vs Ignite vs Accelerate》** —— 工程框架对比

### 代码
- **PyTorch Examples** —— MNIST / CIFAR / ImageNet 完整范例
- **torchvision** —— 视觉数据集 + 模型
- **torchtune** —— LLM 微调框架
- **accelerate** —— Hugging Face 分布式训练封装
- **lightning** —— 高层 PyTorch 训练框架

---

## 10. 本节要点

- **Tensor** 是「NumPy ndarray + GPU + 自动求导」,关键属性 `dtype / device / shape`;与 NumPy 通过 `from_numpy` / `.numpy()` 零拷贝互转。
- **autograd**:`requires_grad=True` 后所有运算建计算图,`loss.backward()` 沿图反向,梯度累加到 `.grad`;推理必须 `with torch.no_grad()` 或 `model.eval()`。
- **nn.Module**:基类,只需写 `__init__`(声明子层)+ `forward`(定义前向);`parameters()` 自动递归收集;Sequential 用于线性流水线,ModuleList 用于灵活组合。
- **训练五步**:`zero_grad → forward → loss → backward → step`,缺一不可;漏掉 `zero_grad()` 让梯度跨 batch 累加。
- **train / eval**:含 Dropout / BatchNorm 的模型必切;BN 的 running 统计在 eval 时才用。
- **GPU**:`model.to(device)` + 数据 `.to(device)` 一致;`DataLoader(pin_memory=True, non_blocking=True)` 异步传输加速。
- **部署**:`torch.save(state_dict)` 推荐,跨版本兼容;`torch.compile` 一行提速 10~50%。

---

## 11. 下一节:Day 17 · CNN

主题:卷积 / 池化 / 经典架构 ResNet。覆盖:
- 卷积:可学习的小核在输入张量上滑动,逐位置点积提取局部特征(边缘 / 纹理 / 色块)
- 池化:无参数降采样,max-pool 保留最显著响应,获得平移鲁棒性
- 经典架构 ResNet:残差连接 `y = F(x) + x` 让深层网络至少能学恒等映射,解决退化问题
- 实战:PyTorch 搭 LeNet-5 在 MNIST 上 ≥98%;ResNet-18 在 CIFAR-10 上迁移学习
- 训练技巧:数据增强(DataAugmentation)、学习率调度、BatchNorm

产出物:PyTorch 实现 LeNet-5 跑通 MNIST + ResNet-18 微调 CIFAR-10 的迁移学习 baseline。

---

**作者**:林馨予 + 林晓月
**最后更新**:2026-07-04
**版权**:CC BY-NC-SA 4.0