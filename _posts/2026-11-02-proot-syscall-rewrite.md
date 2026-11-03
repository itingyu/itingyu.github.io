---
layout: post
slug: proot-syscall-rewrite
title: 系统调用改写：参数与返回值的替换
date: 2026-11-02 13:00:00 +0800
column: proot
series: proot-internals
tags:
  - 源码分析
  - 系统调用
  - ptrace
excerpt: 路径翻译只解决了「算」，还没解决「改」。要改一个正在运行的程序的内存，手段只有两个：process_vm_writev（或 PTRACE_POKEDATA）和改寄存器。PRoot 两样都用，而且必须在系统调用的两个 stop 点之间完成。
pinned: false
cover: null
draft: false
permalink: /notes/proot/proot-internals/proot-syscall-rewrite/
---

# 系统调用改写：参数与返回值的替换

系统调用改写发生在 tracee 的寄存器与内存中：替换参数、写入字符串、伪造返回值，必要时取消整次调用。

## 两份寄存器

每个 tracee 保存两份寄存器快照：`ORIGINAL` 是刚停下时用户给的，`MODIFIED` 是 PRoot 改完的。

```c
/* src/syscall/syscall.c:103 */
if (is_enter_stage) {
    tracee->restore_original_regs = false;

    if (tracee->chain.syscalls == NULL) {
        save_current_regs(tracee, ORIGINAL);      /* 原样留底 */
        status = translate_syscall_enter(tracee);
        save_current_regs(tracee, MODIFIED);      /* 改完留档 */
    }

    if (status < 0) {                             /* 翻译失败 */
        set_sysnum(tracee, PR_void);              /* 抹掉这次系统调用 */
        poke_reg(tracee, SYSARG_RESULT, (word_t) status);
        tracee->status = status;
    } else
        tracee->status = 1;
}
```

为什么保留两份？因为出口阶段要还原现场：内核看到的参数是 `MODIFIED`，但 PRoot 在出口要按 `ORIGINAL` 去读用户缓冲区（比如 `readlink` 的 buffer 指针被改过）。`restore_original_regs` 默认在出口为真，就是这个意思。

## 取消一次系统调用

`PR_void` 是这个设计里最省事的一招：

```c
/* src/syscall/sysnum.c */
word_t detranslate_sysnum(Abi abi, Sysnum sysnum) {
    if (sysnum == PR_void)
        return SYSCALL_AVOIDER;      /* ((word_t) -1) */
    ...
}
```

把系统调用号改成 `-1`，内核查表失败，返回 `ENOSYS`，不产生任何副作用。PRoot 随后把 `SYSARG_RESULT` 覆写成自己想返回的值——用户看到的是 `-EACCES` 或 `-ENOENT`，而不是 `ENOSYS`。

这招被用在所有「PRoot 自己要接管」的地方：`getcwd`、`chdir`、`ptrace`、以及所有翻译失败的路径。

## 把字符串写进别人的栈

`openat` 的第一个参数是个用户态指针。翻译后的新路径得先找块内存放下，再把寄存器指过去。

PRoot 不去碰 `brk`，而是直接用 tracee 的栈：把栈指针往下挪，把字符串写进去。

```c
/* src/tracee/mem.c: alloc_mem() */
stack_pointer = peek_reg(tracee, CURRENT, STACK_POINTER);

/* x86_64 的 red zone：栈指针之下 128 字节不能被信号破坏 */
if (stack_pointer == peek_reg(tracee, ORIGINAL, STACK_POINTER))
    size += RED_ZONE_SIZE;

size = ((size - 1) / STACK_ALIGNMENT + 1) * STACK_ALIGNMENT;
stack_pointer -= size;
poke_reg(tracee, STACK_POINTER, stack_pointer);
return stack_pointer;
```

写回流程就三步：

```c
/* src/syscall/syscall.c:98 */
int set_sysarg_path(Tracee *tracee, const char path[PATH_MAX], Reg reg)
{
    return set_sysarg_data(tracee, path, strlen(path) + 1, reg);
}
/* set_sysarg_data: alloc_mem -> write_data -> poke_reg */
```

栈指针在出口阶段会被还原（`restore_original_regs`）。但如果 seccomp 判定这次不需要出口 stop，PRoot 就得在入口自己还回去：

```c
/* src/syscall/syscall.c:147 */
if (tracee->restart_how == PTRACE_CONT) {
    tracee->status = 0;
    poke_reg(tracee, STACK_POINTER,
             peek_reg(tracee, ORIGINAL, STACK_POINTER));
}
```

这一行是「加速」和「正确性」之间最小的接缝，漏掉就是随机崩溃。

## 读内存：process_vm 优先

读参数用 `read_data()`：优先 `process_vm_readv()`，失败再退回 `PTRACE_PEEKDATA`（一次一个字）。

```c
/* src/tracee/mem.c:228 */
status = process_vm_readv(tracee->pid, &local, 1, &remote, 1, 0);
```

`process_vm_*` 需要内核支持（`HAVE_PROCESS_VM` 在编译期探测），而且不检查目标地址是否可读——所以 PRoot 自己在调用前做边界检查，注释里专门引了 `man 2 process_vm_readv` 的警告。

## 三个不进内核的特例

### getcwd：答案在 PRoot 手里

`getcwd` 返回的必须是 guest 路径，而内核只知道宿主路径。PRoot 干脆不让内核执行：

```c
/* src/syscall/enter.c:214 */
case PR_getcwd:
    set_sysnum(tracee, PR_void);
    status = 0;
    break;
```

出口阶段把 `tracee->fs->cwd` 直接写进用户缓冲区，长度不够返回 `-ERANGE`，缓冲区为空返回 `-EINVAL`——完全复刻 `getcwd(2)` 的语义。

### chdir：改的是 PRoot 自己的账本

`chdir` 同理。翻译、`lstat` 检查是不是目录、有没有 `x` 权限，然后把 guest 路径存进 `tracee->fs->cwd`，系统调用本身被抹掉。

代价是：**PRoot 必须自己维护 cwd 的一致性**。源码注释承认了一个无解的歧义——多个绑定指向同一个宿主目录时，`fchdir` 之后再 `getcwd` 无法判断用户原本走的是哪一个：

```text
$ proot -m /tmp:/a -m /tmp:/b fchdir_getcwd /a
/b
```

### readlink：出口反向翻译

`readlink` 必须真的进内核（只有内核知道链接内容），但返回的宿主路径要在出口改回 guest 路径，而且不能超过用户给的 buffer——超了要截断，还要返回正确的长度。

```c
/* src/syscall/exit.c:328 */
old_size = syscall_result;
status = read_data(tracee, referee, output, old_size);
referee[old_size] = '\0';
/* 反向翻译，再按 max_size 截断写回 */
```

v5.5.0 的 changelog 里有一条正是这个：*readlink silently truncating and reporting a wrong guest path when the host-side target is longer than the caller's buffer*。这类 bug 是 PRoot 的日常。

## 还有两个小坑

**Unix socket 路径**。`bind()`/`connect()` 的 `sockaddr_un.sun_path` 也是路径，也要翻译。但内核会回写 `addrlen`，所以 PRoot 在入口把原始指针和长度暂存到没用到的第 5、6 个参数寄存器里，出口再恢复——这是「参数不够用，借两个寄存器当草稿纸」的典型写法。

**brk 不可靠**。内核默认把堆放在 loader 的 BSS 后面，紧挨着别的映射，堆就长不动了（Bash 会直接 abort）。PRoot 的解法是把第一次 `brk` 换成一次 `mmap`，在 BSS 末尾按页对齐处重新开一块堆，之后自己记账。

## 小结

- 每个 tracee 保留 ORIGINAL 与 MODIFIED 两份寄存器：入口按需改，出口按原始寄存器的指针读回用户缓冲区。
- 取消一次系统调用不需要内核配合，把系统调用号改成 `PR_void`（`-1`），再用 `SYSARG_RESULT` 伪造返回值即可。
- 新路径写进 tracee 的栈；一旦这次调用没有出口 stop，PRoot 必须自己把栈指针还回去，否则就是随机崩溃。