---
layout: post
title: "渲染测试：Mermaid + LaTeX"
date: 2026-10-08 16:00:00 +0800
series: ai-basics
excerpt: "验证 Mermaid 图和 LaTeX 公式在文章页的渲染"
pinned: false
cover: null
draft: false
column: ai
permalink: /notes/ai/ai-basics/render-test-mermaid-latex/
---

## Mermaid 图测试

### 流程图

```mermaid
graph TD
  A[用户] -->|访问| B(博客)
  B --> C{专栏}
  C -->|AI| D[AI 学习笔记]
  C -->|股票| E[股票专栏]
  C -->|厨房| F[厨房学]
  D --> G[文章 1]
  D --> H[文章 2]
  E --> I[A 股复盘]
  F --> J[厨房原理]
  style A fill:#f9f,stroke:#333
  style B fill:#bbf,stroke:#333
```

### 时序图

```mermaid
sequenceDiagram
  participant U as 用户
  participant B as 浏览器
  participant S as GitHub Pages
  U->>B: 访问 URL
  B->>S: GET /notes/AI学习笔记/...
  S-->>B: HTML + JS
  B->>B: 解析 HTML
  B->>B: JS 加载 Mermaid
  B->>B: 转换 <pre> → <div class="mermaid">
  B->>B: mermaid.run() 渲染 SVG
  B-->>U: 显示渲染图
```

### 类图

```mermaid
classDiagram
  class Post {
    +String title
    +String column
    +String series
    +Date date
    +render()
  }
  class Column {
    +String slug
    +String title
    +Post[] posts
  }
  class Series {
    +String title
    +String column
    +Post[] posts
  }
  Column "1" --> "*" Series
  Series "1" --> "*" Post
  Column "1" --> "*" Post
```

## LaTeX 测试

### 行内公式

质能方程：$E = mc^2$ 是物理学的核心。欧拉恒等式 $e^{i\pi} + 1 = 0$ 被誉为「数学之美」。

### 块级公式

高斯积分：

$$
\int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
$$

矩阵乘法：

$$
\begin{bmatrix}
a & b \\
c & d
\end{bmatrix}
\begin{bmatrix}
x \\
y
\end{bmatrix}
=
\begin{bmatrix}
ax + by \\
cx + dy
\end{bmatrix}
$$

求和与级数：

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

机器学习损失函数（交叉熵）：

$$
L = -\frac{1}{N} \sum_{i=1}^{N} \left[ y_i \log(\hat{y}_i) + (1-y_i) \log(1-\hat{y}_i) \right]
$$

### 转义测试

代码块内的 `$$ 不应被识别为公式：

```
def foo():
    return "$ 100 + $ 200 = $ 300"  # 这里 $$ 不应触发 MathJax
```

行内代码 `$\int f(x)dx$` 也不应被识别（已通过 `skipHtmlTags: code` 跳过）。

## 结论

- ✅ Mermaid 三种图（流程 / 时序 / 类）正常渲染
- ✅ LaTeX 行内 `$...$` 和块级 `$$...$$` 正常渲染
- ✅ 代码块内 `$$` 不误触发
- ✅ 行内 code 内 `$...$` 不误触发
