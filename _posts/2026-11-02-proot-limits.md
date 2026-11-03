---
layout: post
slug: proot-limits
title: 能力边界：隔离、性能与限制
date: 2026-11-02 16:00:00 +0800
column: proot
series: proot-internals
tags:
  - 沙箱
  - 对比
  - 源码分析
excerpt: 前六篇讲的都是「怎么做到」。最后一篇讲代价：PRoot 给你一个看起来很完整的 guest 系统，但它既不是沙箱，也不是免费午餐。
pinned: false
cover: null
draft: false
permalink: /notes/proot/proot-internals/proot-limits/
---

# 能力边界：隔离、性能与限制

PRoot 不是安全边界：不隔离内核资源，性能开销集中在路径翻译，并会破坏 ASLR 与 setuid。

## 它不是安全边界

这是最需要说清楚的一条。PRoot 只改写路径和一部分返回值，**每一条系统调用最终都发给宿主内核**，权限检查、LSM（SELinux、AppArmor 那一层）、capability 全是真的。

几个直接后果：

- `-0` 只是 `fake_id0` 在 `getuid()` 的返回值上撒谎。用 `-R` 把宿主 `/proc` 绑进来后，`cat /proc/self/status` 里的 `Uid:` 仍是真实值，`CapEff` 也仍是真实能力集。
- 它不创建 namespace：guest 里的进程能看到宿主的所有进程、所有网络接口、所有设备（如果绑定了 `/dev`）。
- 路径改写不是访问控制。绑定表是「翻译规则」，不是「白名单」；写错一条 `-b /:/host`，整台机器就都在 guest 里了。

PRoot 的定位一直是「兼容层」，不是「隔离层」。要隔离，用 user namespace + bwrap，或者干脆用虚拟机。

## 性能：贵在路径，不在系统调用

PRoot 的开销不是均匀的：

- 普通系统调用（读写、内存、时间）在 seccomp 模式下根本不会停，开销接近零。
- 路径类系统调用要停两次（入口 + 出口），每次都要 `process_vm_readv` 读参数、`process_vm_writev` 写新路径，再走一遍 `canonicalize`（每段一次 `lstat`）。

所以 `make -j8`、解包、`git status` 这类「大量 stat/open」的负载会明显变慢；纯计算任务几乎无感。这个差异比「PRoot 慢几倍」这种笼统说法更有意义——它慢在元数据操作上。

`PROOT_NO_SECCOMP=1` 可以关掉加速做对照，代价是所有系统调用都停两次。

## 它偷走了 ASLR

第五篇留下的那句话值得单独拎出来：

```c
/* TODO: support for ASLR. */
add_load_base(tracee->load_info, EXEC_PIC_ADDRESS);   /* 固定 0x3000000000 */
```

为了让 `AT_PHDR`/`AT_BASE` 可预测，PRoot 把所有 PIE 程序装到固定地址。副作用是整个进程树的地址布局高度可预测——对调试是好事，对安全是坏事。

## setuid 会失效

内核有一条硬规则：被 ptrace 的进程 `execve` 一个 setuid 程序时，setuid/setgid 位会被忽略。PRoot 全程 ptrace，所以：

- `sudo`、`su`、`passwd` 这类依赖 setuid 的程序在 guest 里不可用；
- 文件上的 setuid 位仍然存在，`ls -l` 也显示 `s`，但执行时不生效。

这不是 bug，是内核的安全设计。`fake_id0` 能用 `-0` 骗过 `getuid`，但骗不过内核的权限判定。

## 不能嵌套

这是我自己踩到的：在一个 PRoot 里再跑一个 PRoot，内层会「部分失灵」——外层把子进程接管了，内层的 syscall-stop 收不全。

根因就是 `src/ptrace/ptrace.c` 里那句话：*ptrace can't be nested*，一个进程同时只能有一个 tracer。PRoot 自己模拟 ptrace 正是为了绕开这个限制（让 guest 里的 gdb 能用），但 PRoot 自身没法绕开它。

实际表现是：内层 proot 启动时的路径翻译还正常（execve 那一次），一旦程序开始跑，`open`/`stat` 就漏翻译，于是「文件明明在却打不开」。要做多层，只能用 user namespace 或虚拟机。

## 和别的方案比

| 方案 | 需要特权 | 隔离强度 | 开销 | 跨架构 |
|:--|:--|:--|:--|:--|
| `chroot` | root | 仅文件系统视图 | 0 | 否 |
| bwrap / user ns | 通常不需要 | 内核级（namespace + seccomp） | 极低 | 否 |
| PRoot | 不需要 | 仅路径改写，**无隔离** | 路径操作显著变慢 | 可以（配 QEMU user） |
| 虚拟机 | 需要 | 硬件级 | 高 | 可以 |

## 那它为什么还活着

因为它解决的是一个别人不愿碰的角落：

- **Android/Termux**：没有 root、没有 user namespace，但想跑一个完整的 Debian——`proot-distro` 至今是标准答案。
- **跨架构**：`proot -q qemu-arm` 能把 ARM 根文件系统跑在 x86 上，路径翻译和 CPU 模拟各管一层。
- **CI 与旧系统**：没有 root 的构建机上，用一个固定 rootfs 复现构建环境。
- **进程插桩**：CARE 证明了这套事件总线可以拿来做录制回放，跟 chroot 没关系。

## 收尾

PRoot 的全部聪明，都集中在同一个约束上：**只能在 ptrace 的 stop 点上做文章**。

因为只能在 stop 点上改参数，它必须自己实现路径规范化；因为改不了内核装载 ELF 的过程，它必须自带 loader；因为 ptrace 不能嵌套，它必须在用户态模拟 ptrace；因为一切都发生在用户态，它永远成不了沙箱。

2.6 万行代码，几乎全花在同一件事上：和一个不可协商的接口较劲。这大概就是读它的价值。
