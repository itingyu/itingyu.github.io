---
layout: post
title: "1.2.3 Java 性能与调优 · async-profiler 与 JFR 实战"
date: 2026-07-05 00:00:00 +0800
series: "编程语言精进"
tags:
  - "Java"
  - "async-profiler"
  - "JFR"
  - "火焰图"
  - "性能"
excerpt: "4 类问题 10 分钟定位。"
pinned: false
cover: null
draft: false
column: 知识宝典
permalink: /notes/%E7%9F%A5%E8%AF%86%E5%AE%9D%E5%85%B8/%E7%BC%96%E7%A8%8B%E8%AF%AD%E8%A8%80%E7%B2%BE%E8%BF%9B/123-java-%E6%80%A7%E8%83%BD%E4%B8%8E%E8%B0%83%E4%BC%98-async-profiler-%E4%B8%8E-jfr-%E5%AE%9E%E6%88%98/
---


## 1. 5 类典型性能问题速查表

线上 Java 应用出问题,90% 落在下面五类症状里。先把症状认清楚,后面的工具才有用武之地。

| 症状 | 典型表现 | 首选工具 | 备选工具 |
|---|---|---|---|
| 高 CPU | 进程 CPU 接近 100%,load 高,RT 上升 | async-profiler CPU 火焰图 | `top -H` + `jstack` |
| OOM / 内存泄漏 | 堆持续上涨,Full GC 频繁,最终 OOM | async-profiler 分配采样 + heap dump | MAT / JFR |
| 锁竞争 | 线程多但吞吐上不去,大量 BLOCKED | async-profiler `-e lock` | JFR `jdk.JavaMonitorWait` |
| 线程阻塞 / 卡死 | RT 偶发飙高,日志停在某行 | async-profiler `-e wall` | `jstack` 多次采样 |
| 慢 GC | GC 日志显示停顿 > 100ms,Young/Old 都慢 | JFR GC 事件 | GCViewer / async-profiler `-e alloc` |

**调研依据**:Brendan Gregg 在《Systems Performance》及 Netflix 技术博客多次指出,生产环境性能问题按出现频率排序为:CPU > 内存 > 锁 > 阻塞 > GC,async-profiler 作者 Andrei Pangin 也确认这一分布。

判断顺序建议:`top` 看 CPU → `jstat -gcutil` 看 GC → `jstack` 看线程状态,三步就能把症状归类。

## 2. async-profiler 详解

async-profiler 是 Linux 上最主流的低开销 Java profiler,基于 perf + AsyncGetCallTrace,采样时不打断目标线程,默认开销 1-3%。

### 2.1 安装

```bash
# 下载并解压到 /opt
curl -L -o /tmp/async-profiler.tar.gz https://github.com/async-profiler/async-profiler/releases/download/v3.0/async-profiler-3.0-linux-x64.tar.gz
tar -xzf /tmp/async-profiler.tar.gz -C /opt
export ASP=/opt/async-profiler-3.0-linux-x64
```

> **注意**:Linux 版本与 glibc 强绑定,容器内建议直接下 `linux-x64` glibc 通用包。

### 2.2 四种核心采样模式

```bash
# 1) CPU 采样 (默认):谁在消耗 CPU 时间
$ASP/bin/asprof -d 30 -f /tmp/cpu.html <pid>

# 2) 分配采样:谁在疯狂 new 对象
$ASP/bin/asprof -e alloc -d 30 -f /tmp/alloc.html <pid>

# 3) 锁采样:谁在阻塞别人 (Java 9+ 需加 --lock-mode)
$ASP/bin/asprof -e lock --lock-mode bias -d 30 -f /tmp/lock.html <pid>

# 4) 墙钟采样:谁让线程"看起来"卡住 (含 GC、syscall)
$ASP/bin/asprof -e wall -d 30 -f /tmp/wall.html <pid>
```

### 2.3 远程 Attach

生产不能 SSH 进机?启动时加 agent,远程抓取:

```bash
# 启动时加载 agent,开启通信端口
java -agentpath:$ASP/lib/libasyncProfiler.so=start,event=cpu,file=/tmp/remote.jfr,server=y -jar app.jar

# 从任意机器远程触发采样
$ASP/bin/asprof -e cpu -d 60 -o collapsed -f /tmp/remote.txt \
  --target <pid>@<host>:<port>
```

**调研依据**:async-profiler GitHub README 与多份 Netflix/Confluent 工程博客表明,远程 attach + JFR 格式输出是企业最常用形态,可与 JMC 联动分析。

## 3. 4 个实战案例

下面四个案例来自真实生产环境,给出"症状 → 命令 → 火焰图读法 → 修复"完整链路。

### 3.1 高 CPU 案例:JSON 序列化死循环

```java
// 反例:在 getter 里递归调用自己
public class UserDTO {
    private List<Order> orders;
    public List<Order> getOrders() { return orders; }
    public String toJson() {
        return new ObjectMapper().writeValueAsString(this);  // 触发 toString 链式
    }
}
```

火焰图特征:一个 `UserDTO$$Lambda$$xx.toJson()` 自调用栈占据 70% 宽度。修复:移除循环引用,或用 `@JsonIgnore` 打断环。

### 3.2 OOM 案例:线程池里堆积大对象

```java
// 症状:堆 4G 老年代打满,async-profiler alloc 火焰图显示
// 80% 分配来自 BatchProcessor.queue
BlockingQueue<byte[]> queue = new LinkedBlockingQueue<>(100_000);
```

修复:换有界 + 拒绝策略,大对象改用堆外 `DirectByteBuffer` 或 `MappedByteBuffer`。

### 3.3 锁竞争案例:`synchronized` 退化

```java
// lock 火焰图里看到 ReentrantLock.lock 占 40%
// 原因:热点方法内 lock + 远程调用
synchronized (cache) {
    return remoteService.query(key);  // 持锁 200ms
}
```

修复:缩小锁粒度,把远程调用挪出临界区,或换 `StampedLock` 乐观读。

### 3.4 慢 GC 案例:大对象直接进老年代

JFR `jdk.GCPhasePause` 事件显示 `G1 Old Generation` 单次停顿 800ms。火焰图配合 GC 日志,定位到 `byte[]` 5MB 反复分配,触发大对象区域 (Humongous) 回收。修复:对象池化 + 切分批处理。

## 4. JFR (Java Flight Recorder) 详解

JFR 是 JDK 内置的二进制事件流,开销 < 1%,适合长时间挂载在生产环境。

### 4.1 启用方式

```bash
# 方式 1:启动参数 (推荐)
java -XX:StartFlightRecording=disk=true,filename=/tmp/app.jfr,maxsize=500m,maxage=1d \
     -XX:FlightRecorderOptions=stackdepth=128 \
     -jar app.jar

# 方式 2:运行时动态开启 (无需重启,最常用)
jcmd <pid> JFR.start duration=60s filename=/tmp/incident.jfr settings=profile

# 方式 3:异步 dump
jcmd <pid> JFR.dump filename=/tmp/snapshot.jfr
```

### 4.2 JMC 分析

下载 JDK Mission Control (JMC),打开 `.jfr` 文件,左侧视图包括:

- **概览 (Overview)**:CPU、堆、GC、I/O 概览图
- **内存 (Memory)**:分配 TLAB 热点、泄漏嫌疑
- **线程 (Threads)**:线程状态时间线、Park/Block 时长
- **方法剖析 (Method Profiling)**:等价于 async-profiler 的 CPU 火焰图
- **事件浏览器 (Event Browser)**:原始事件表,SQL-like 过滤

### 4.3 4 大事件类别

| 类别 | 开关 (settings=) | 典型事件 | 用途 |
|---|---|---|---|
| JVM 内部 | `default` 包含 | `jdk.GCPhasePause`, `jdk.CPULoad` | 运行时基线 |
| Java 级别 | `default` 包含 | `jdk.JavaMonitorEnter`, `jdk.ThreadPark` | 锁 / 阻塞 |
| 分配 / TLAB | `gc=profile` 开启 | `jdk.ObjectAllocationInNewTLAB` | OOM 排查 |
| OS / 系统 | `default` 包含 | `jdk.OSFileRead`, `jdk.SocketRead` | I/O 瓶颈 |

**调研依据**:JFR 在 OpenJDK 11 后开源,Oracle 官方文档与 Azul Zulu 工程团队均推荐 `settings=profile` 作为生产默认,5 分钟采样开销约 0.5%。

## 5. async-profiler vs JFR 对比

两者经常被混用,但定位和形态完全不同。

| 维度 | async-profiler | JFR |
|---|---|---|
| 输出形态 | HTML 火焰图 (FlameGraph) | 二进制时间线 (.jfr) |
| 核心优势 | 一眼定位 CPU 热点栈 | 长时段、多维度事件回溯 |
| 典型耗时 | 30s ~ 5min 短期采样 | 数小时 ~ 数天持续录制 |
| 开销 | 1-3% CPU | < 1% CPU |
| 锁 / 分配采样 | ✅ 简单一行命令 | ✅ 需 JMC 打开事件表 |
| 在线 / 离线分析 | 偏在线 (生成即看) | 偏离线 (JMC 二次剖析) |
| 容器兼容 | 需 `--perf-events` 特权 | 零特权即可用 |
| 历史回放 | ❌ 无 | ✅ 任意 1s 切片可回放 |
| 推荐场景 | 救火 / 单点定位 | 基线录制 / 趋势分析 |

**协作最佳实践**:线上默认挂 JFR (`settings=profile`) 做基线;出现告警后,`jcmd` 触发一次 60s JFR dump,同时用 async-profiler 抓 30s CPU 火焰图快速定位。JFR 负责"什么时候发生",async-profiler 负责"哪个方法在烧 CPU"。

**调研依据**:Andrei Pangin (async-profiler 作者) 与 OpenJDK JFR 团队在 2023-2024 多场会议中明确推荐两者互补,而非互斥:async-profiler 的火焰图对应 JFR 的 Method Profiling 视图,后者再叠加锁、分配、I/O 时间线。
