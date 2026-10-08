---
layout: post
title: "1.2.4 Java 性能与调优 · synchronized / AQS / JMM happens-before 实战"
date: 2026-07-05 00:00:00 +0800
series: "编程语言精进"
tags:
  - "Java"
  - "synchronized"
  - "AQS"
  - "JMM"
  - "happens-before"
excerpt: "锁的本质是状态机,AQS 是所有锁的基类。"
pinned: false
cover: null
draft: false
column: 知识宝典
permalink: /notes/%E7%9F%A5%E8%AF%86%E5%AE%9D%E5%85%B8/%E7%BC%96%E7%A8%8B%E8%AF%AD%E8%A8%80%E7%B2%BE%E8%BF%9B/124-java-%E6%80%A7%E8%83%BD%E4%B8%8E%E8%B0%83%E4%BC%98-synchronized-aqs-jmm-happens-before/
---


## 1. synchronized 升级链(无锁 → 偏向锁 → 轻量级锁 → 重量级锁)

synchronized 在 JVM 内部并非一上来就调用 OS 的 mutex,而是一条根据竞争强度逐级膨胀的状态机(lock escalation)。无锁态下对象头的 mark word 直接存放线程 ID,适合单线程重复进入;一旦出现第二个线程 CAS 撤销偏向,锁就升级到轻量级,在用户态用自旋 + CAS 避免内核切换;自旋超过阈值或竞争方超过 CPU 核数的一半,JVM 才会膨胀到重量级,真正走 pthread_mutex。**调研依据**:OpenJDK 官方 wiki "HotSpot Synchronization" 与 Aleksey Shipilëv 的《Java JIT 编译与锁优化》演讲,JDK 15 起偏向锁默认关闭(需 `-XX:+UseBiasedLocking` 开启)。

| 状态 | mark word 内容 | 加锁开销 | 触发升级条件 |
| --- | --- | --- | --- |
| 无锁 | 对象哈希码 | 1 次 CAS | 对象刚 new 出来 |
| 偏向锁 | 持有线程 ID + epoch | 几乎零开销 | 其他线程 CAS 撤销 |
| 轻量级锁 | 栈中 LockRecord 指针 | 多次自旋 CAS | 多线程交替进入 |
| 重量级锁 | monitor 指针 + 等待队列 | 阻塞 + 内核态 | 自旋失败或竞争激烈 |

## 2. AQS(AbstractQueuedSynchronizer)核心

Doug Lea 写的 AQS 是 `ReentrantLock`、`Semaphore`、`CountDownLatch`、`CyclicBarrier` 的共同基类,核心只有三件事:一个 `volatile int state`、一个 CLH 变体的 FIFO 等待队列,以及模板方法 `acquire`/`release`。`state` 表示资源计数,子类用 `tryAcquire`/`tryRelease` 决定能否拿到锁;拿不到就把当前线程包装成 `Node` 塞进队尾,前驱节点释放时再唤醒后继。**调研依据**:JDK 源码 `java.util.concurrent.locks.AbstractQueuedSynchronizer`、并发编程网翻译的 Lea 论文《The java.util.concurrent Synchronizer Framework》。

```java
// 自定义互斥锁(简化版,源码参考 ReentrantLock.NonfairSync)
class Mutex extends AbstractQueuedSynchronizer {
    protected boolean tryAcquire(int acquires) {
        if (compareAndSetState(0, 1)) { setExclusiveOwnerThread(Thread.currentThread()); return true; }
        return false;
    }
    protected boolean tryRelease(int releases) {
        setExclusiveOwnerThread(null); setState(0); return true;
    }
}
```

## 3. JMM happens-before 8 大规则

JMM(Java Memory Model)用 happens-before 取代"内存可见性"这种含糊说法:只要操作 A happens-before 操作 B,A 的结果对 B 可见,且 A 在 B 之前执行。JLS §17.4.5 明确规定了 8 条规则,这是判断多线程代码是否正确的唯一权威依据。**调研依据**:《Java Language Specification》Chapter 17,JSR-133 Cookbook、Doug Lea《Concurrent Programming in Java》第二章。

| # | 规则 | 含义 |
| --- | --- | --- |
| 1 | 程序顺序规则 | 同一线程内,前面的语句 happens-before 后面语句 |
| 2 | 监视器锁规则 | `unlock` happens-before 后续对同一把锁的 `lock` |
| 3 | volatile 规则 | volatile 写 happens-before 后续 volatile 读 |
| 4 | 线程启动规则 | `Thread.start()` happens-before 该线程任何动作 |
| 5 | 线程终止规则 | 线程所有动作 happens-before `join()` 返回 |
| 6 | 中断规则 | `interrupt()` happens-before 检测到中断 |
| 7 | 对象终结规则 | 构造函数 happens-before `finalize()` |
| 8 | 传递性 | A hb B 且 B hb C ⇒ A hb C |

## 4. volatile 关键字

volatile 在 Java 里只承诺两件事:把当前 CPU 缓存行的写立刻刷回主内存(volatile write),并让后续读从主内存重载(volatile read),由此得到可见性;同时插入内存屏障禁止编译器和 CPU 把 volatile 读写与普通读写重排序。但 volatile **不保证复合操作的原子性**,`i++` 仍是三步(读、加、写),两个线程并发执行 volatile `i++` 仍会丢更新。**调研依据**:JLS §17.4、Shipilëv 的 JMM Pragmatics 实验。

| 语义 | 是否保证 |
| --- | --- |
| 单次读/写的可见性 | ✅ |
| 禁止指令重排序(写读两侧) | ✅ |
| 复合操作 `i++` 原子性 | ❌,需 `AtomicInteger` 或 `synchronized` |
| 64 位 long/double 的原子性(JLS §17.7) | ✅,volatile 强制 8 字节原子读写 |

## 5. 实战对比(synchronized vs ReentrantLock vs Atomic)

选锁不是看谁性能高,而是看场景。低竞争计数场景用 `AtomicLong` 跑 JMH 比 `synchronized` 快 2~3 倍;中等竞争、需要可中断、`tryLock` 超时、`Condition` 多条件队列时切 `ReentrantLock`;高竞争短临界区或需要 JVM 自动优化(锁消除、锁粗化、偏向锁)时留 `synchronized`,让 JIT 在 JDK 25 之后用 `LockStack` 把同步开销几乎压到 0。**调研依据**:JMH `jmh-java-benchmarks` 中 `synchronized`-vs-`ReentrantLock`、JDK 24/25 release notes 的 LockStack 优化。

| 维度 | synchronized | ReentrantLock | Atomic* |
| --- | --- | --- | --- |
| 加锁方式 | JVM monitor,intrinsic lock | JDK AQS,显式 lock/unlock | CAS,无锁 |
| 可中断 | ❌ | ✅ `lockInterruptibly` | N/A |
| 公平锁 | ❌(默认非公平) | ✅ 构造函数可选 | N/A |
| 条件队列 | 单个 wait set | 多个 `Condition` | 不支持 |
| 典型吞吐(JMH,2024) | 80–120 M ops/s | 70–110 M ops/s | 200–300 M ops/s(低竞争) |