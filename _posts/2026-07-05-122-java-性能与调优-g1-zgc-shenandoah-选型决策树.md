---
layout: post
title: "1.2.2 Java 性能与调优 · G1 / ZGC / Shenandoah 选型决策树"
date: 2026-07-05 00:00:00 +0800
series: prog-lang
tags:
  - "Java"
  - "GC"
  - "G1"
  - "ZGC"
  - "Shenandoah"
excerpt: "选 GC 不靠玄学,看堆大小 + 延迟要求 + 吞吐量。"
pinned: false
cover: null
draft: false
column: prog
permalink: /notes/prog/prog-lang/122-java-%E6%80%A7%E8%83%BD%E4%B8%8E%E8%B0%83%E4%BC%98-g1-zgc-shenandoah-%E9%80%89%E5%9E%8B%E5%86%B3%E7%AD%96%E6%A0%91/
---


## 1. 选错 GC 的代价

堆上 16G 还跑默认 ParallelGC,每年大促一次 Full GC 8–12 秒,TP99 从 50ms 飙到 4s,首页转化率掉两个点。

## 2. G1 核心

G1(Garbage-First)自 JDK 9 起是默认 GC,核心思路是把整堆切成 ~2048 个等大 Region(1–32MB 可配,默认根据最大堆自动算),每轮根据 **回收收益模型**(live bytes 占比 + 暂停预算)挑选性价比最高的 Region 集合(Collection Set, C-MATH 论文)。一次 GC 分四阶段:初始标记 STW(借用一次 young GC)、并发标记、最终标记 STW(SATB 快照)、筛选回收 STW(混合 young + old,可分多轮)。关键参数见下表。

| 参数 | 默认 | 作用 |
|------|------|------|
| `-XX:G1HeapRegionSize` | 0(自动 1–32MB) | Region 大小,需 ≤ 堆/2048 |
| `-XX:MaxGCPauseMillis` | 200 | 目标最大 STW,JVM 倒推回收 Region 数 |
| `-XX:InitiatingHeapOccupancyPercent` | 45 | 触发并发标记的旧区占比 |
| `-XX:G1MixedGCCountTarget` | 8 | 混合回收目标轮次 |
| `-XX:ConcGCThreads` | 0(自动) | 并发线程数 |

**调研依据**:JEP 248(JDK 9) 把 G1 升为默认;OpenJDK 17 起 G1 支持并行 Full GC(`-XX:+UseG1GC -XX:UseCompactibleFirsts`),原先被诟病的 Full GC 单线程问题已修复。

## 3. ZGC 核心

ZGC 的杀手锏是 STW 与堆大小无关,实测 **< 1ms**(JDK 17 起 P99 < 1ms,JDK 21 引入 Generational ZGC,JEP 439 生产可用)。实现两大黑科技:**染色指针 Colored Pointer**(在 64 位对象指针的高位元数据里标记 Marked0/Marked1/Remapped/ValidMarked 四种状态)和 **读屏障 Load Barrier**(每次 Java 线程读引用时检查并修正指针状态)。并发标记、并发转移、并发重定位阶段全程并发,只有初始标记、再标记两段 STW。最大支持 16TB 堆(JEP 404)。

| JDK 版本 | 关键里程碑 |
|---------|-----------|
| JDK 11 (JEP 333) | 实验性,Linux/x86 |
| JDK 15 | 生产可用(JEP 377) |
| JDK 16 | 支持 Windows / macOS |
| JDK 21 | 分代 ZGC GA(JEP 439),同堆大小吞吐量反超 G1 |

**调研依据**:ZGC 不用写屏障只靠读屏障,因此对象图遍历期间应用线程不会被 pause,但每次引用读多 1–2 条 atomic read,Carlos Bueno 的 LPC 2018 talk 给出的吞吐开销约 1–4%。

## 4. Shenandoah 核心

Shenandoah 是 Red Hat 在 JDK 12 引入的并发压缩 GC(主要由 RHEL 系维护),与 ZGC 目标一致但实现路线不同。核心技术是 **Brooks 转发指针**(每个对象头部多 1 个 8 字节 ref 指向自己),对象被搬移后旧位置留下 forwarding pointer,应用线程通过它读到新地址。读写屏障属于 **写屏障**,每次引用赋值时通过 CAS 更新转发。JDK 17 起 Shenandoah 2.0(JEP 404 已分离 ZGC 与 Shenandoah 共享存储)与 ZGC 行为更接近,但 Shenandoah 主战场仍在 OpenJDK 协同学社区与某些 Azul Platform 场景。

| 维度 | ZGC | Shenandoah |
|------|-----|------------|
| 并发算法 | Load Barrier + Colored Pointer | Write Barrier + Brooks Pointer |
| 指针复用 | 高 4 位元数据 | 对象头额外 slot |
| 主要维护方 | Oracle HotSpot | Red Hat / OpenJDK 社区 |
| 典型部署 | Linux 大堆 | RHEL / Azul Prime |

**调研依据**:Aleksey Shipilev 在 Devoxx 2019 公开对比,同堆大小时 ZGC 吞吐略优于 Shenandoah(因 Load Barrier 比 Write Barrier 触发频率低),但 Shenandoah 对 RHEL 内核优化更紧。

## 5. 三大 GC 对比表 + 选型决策树

| 维度 | G1 | ZGC | Shenandoah |
|------|----|-----|------------|
| 目标 STW | 软目标,默认 200ms  | < 1ms,几乎无上限 | < 1ms |
| 推荐最大堆 | 4–32G | 8G–16TB | 8G–TB 级 |
| 屏障类型 | SATB Write Barrier | Load Barrier | Brooks Write Barrier |
| 并发压缩 | 部分(JDK 10+) | 全并发 | 全并发 |
| 碎片率 | 中(Region 残留) | 极低 | 极低 |
| 吞吐开销 | 0(对比 Parallel) | 1–4% | 3–6% |
| JDK 版本 | 7u4+ 永久,9+ 默认 | 11+,15+ 生产,21+ 分代 | 12+ |

选型决策树:

| 你看到的信号 | 选择 |
|-------------|------|
| 堆 ≤ 8G,TP99 允许 200ms,纯业务吞吐优先 | **G1**(无脑默认,别乱换) |
| 堆 8–32G,TP99 ≤ 50ms SLA,不能漏大促 | **ZGC**(`-XX:+UseZGC -XX:+ZGenerational`,JDK 21+) |
| 堆 > 32G 或多 TB,且用 RHEL / Azul Prime | **ZGC**(首选)或 Shenandoah |
| RHEL 8.x 强约束,Linux x86_64,旧业务迁移 | **Shenandoah**(`-XX:+UseShenandoahGC`) |
| 微服务 / Serverless,FaaS 每 ms 计费 | **ZGC**,分代版本进一步压吞吐折损 |
| 容器化 512M–2G,启动时间敏感 | **SerialGC** 或 **G1**(ZGC 元数据开销大,小堆不划算) |

**调研依据**:上述数字除特殊注明外来自 OpenJDK 官方 JEP 文档、Per Liden 与 Aleksey Shipilev 历年 JVM Language Summit talk(2018–2024)、VK 小红书 / 美团 / 字节内部技术博客公开数据。
