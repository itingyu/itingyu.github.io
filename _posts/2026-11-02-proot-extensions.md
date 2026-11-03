---
layout: post
slug: proot-extensions
title: 扩展机制：kompat 与插件接口
date: 2026-11-02 15:00:00 +0800
column: proot
series: proot-internals
tags:
  - 源码分析
  - 插件
  - 系统调用
excerpt: PRoot 的三个招牌功能——-0（假装 root）、-l（硬链接转符号链接）、-k（假装旧内核）——都不是核心代码，而是插件。核心只提供一串事件回调，插件决定在这些点上改什么。
pinned: false
cover: null
draft: false
permalink: /notes/proot/proot-internals/proot-extensions/
---

# 扩展机制：kompat 与插件接口

PRoot 的扩展按事件挂载：fake_id0、link2symlink、kompat 等各处理一类系统调用，由 CARE 组合成完整工具。

## 十七个事件

`ExtensionEvent` 是一个枚举，每个事件带两个 `intptr_t` 参数。语义写得很克制，但足够用：

| 事件 | 时机 | 返回值语义 |
|:--|:--|:--|
| `GUEST_PATH` | 路径翻译前 | `>0` 跳过 PRoot 处理，`<0` 直接报错 |
| `HOST_PATH` | 规范化过程中每个宿主路径 | `<0` 报错 |
| `TRANSLATED_PATH` | 翻译完成 | 可原地改写 |
| `SYSCALL_ENTER_START` | 系统调用入口，PRoot 之前 | `>0` 跳过，`<0` 取消 |
| `SYSCALL_ENTER_END` | 入口，PRoot 之后 | `<0` 取消 |
| `SYSCALL_EXIT_START/END` | 出口前后 | `<0` 改返回值 |
| `NEW_STATUS` | `waitpid` 拿到事件 | `!=0` 跳过整个处理 |
| `INHERIT_PARENT/CHILD` | fork/clone 继承 | 决定子进程是否带上插件 |
| `SYSCALL_CHAINED_ENTER/EXIT` | 链式系统调用（PRoot 自己发起的） | 同 enter/exit |
| `PRINT_CONFIG` / `PRINT_USAGE` | 插件追加命令行选项与帮助 | — |
| `INITIALIZATION` / `REMOVED` | 装载/卸载 | — |
| `ALREADY_OPENED_FD` | 启动时扫已打开的 fd | — |

分发就是一个链表遍历，第一个返回非 0 的插件说了算：

```c
/* src/extension/extension.h:177 */
LIST_FOREACH(extension, tracee->extensions, link) {
    int status = extension->callback(extension, event, data1, data2);
    if (status != 0)
        return status;
}
return 0;
```

插件不是白拿事件的：它还要把自己的系统调用名单合进 seccomp 过滤器。`enable_syscall_filtering()` 会把每个扩展的 `filtered_sysnums` 并进主表——所以 `-0` 才拦得到 `getuid`，虽然核心根本不关心它。

## fake_id0：一套完整的假身份

`-0` 装的是 `fake_id0`。它维护四个假 id（ruid/euid/suid/fsuid）和四个假 gid，然后把它们注入到每个能看到身份的地方：

- `getuid`/`geteuid`/`getresuid`：出口直接改返回值；
- `setuid` 一族：`set_sysnum(tracee, PR_void)`，系统调用根本不执行，直接返回成功；
- `stat` 一族：内核填完 `struct stat` 后，按架构偏移改写 `st_uid`/`st_gid`；
- `chown`：把「假 uid」换成进程的真实 uid 再交给内核，注释写得很实在——*Swap actual and emulated ids to get a chance of success*。

最麻烦的不是读，是写。一个 uid 为 1000 的进程要往 root 拥有的目录里写文件，内核会拒绝。`fake_id0` 的办法是**临时改权限**：

```c
/* src/extension/fake_id0/fake_id0.c:166 */
new_mode = perms.st_mode & (S_IRWXU | S_IRWXG | S_IRWXO);
new_mode |= (S_IRUSR | S_IWUSR);              /* 加 u+rw */
if (S_ISDIR(perms.st_mode))
    new_mode |= S_IXUSR;                      /* 目录还要 +x */
...
(void) chmod(path, new_mode);                 /* 真的改，真的写盘 */
```

改完必须还回去，否则文件权限就被永久污染了。恢复用的是 talloc 析构函数：

```c
node->path = talloc_strdup(node, path);
talloc_set_destructor(node, restore_mode);
```

注释解释了为什么这样能成立：

> The mode restoration works because Talloc destructors are called in reverse order.

也就是说，一次系统调用里被放宽的多个路径，会按**相反顺序**恢复，正好对应「先开后关」的栈式语义。用内存管理器的析构顺序当栈用，是这套代码里最巧的一处。

## link2symlink：硬链接的替代实现

Android 的 `/sdcard`、FUSE、以及很多容器文件系统都不支持 `link()`。`-l` 的做法是把 `link()` 改写成 `symlink()`：

```c
/* src/extension/link2symlink/link2symlink.c:560 */
case PR_link:
    status = move_and_symlink_path(tracee, SYSARG_1);
    set_sysnum(tracee, PR_symlink);   /* 系统调用号直接换掉 */
    break;
```

但符号链接和硬链接语义不同：删掉一边，另一边不能失效；`rename` 要处理「伪硬链接」；`unlink` 要递减引用计数。所以它把真文件改名成 `.l2s.<name>`，让两个名字都指向它，并在文件名里维护计数；`rename`/`unlink`/`linkat` 全都要额外打补丁。

这是一个典型的 PRoot 式妥协：**能在系统调用层伪造的语义就伪造，伪造不了的就改数据布局。**

## kompat：让新内核装老程序

`-k` 装的是 `kompat`。它解决的是另一个方向的问题：程序按老内核编译，用了新内核没有的系统调用（比如 2.6.27 上跑 `dup3`），或者反过来。

它的做法是「降级系统调用」：

```c
/* src/extension/kompat/kompat.c:184 */
case PR_dup3:{
    Modif modif = {
        .expected_release = KERNEL_VERSION(2, 6, 27),
        .new_sysarg_num  = PR_dup2,
    };
    if (peek_reg(tracee, CURRENT, SYSARG_1) ==
        peek_reg(tracee, CURRENT, SYSARG_2))
        return -EINVAL;              /* dup3 的特有语义，dup2 没有 */
    modify_syscall(tracee, config, &modif);
}
```

`accept4 → accept`、`epoll_create1 → epoll_create`、`pipe2 → pipe`……每一处都要手工补回新调用独有的语义（标志位、参数校验）。这是全项目最「脏」但最实用的一块。

## ptrace：连调试器都要模拟

`ptrace(2)` 有一个内核级限制：**一个进程同时只能有一个 tracer**。PRoot 已经是 tracee 的 tracer 了，如果 tracee 自己再 `ptrace`（比如在里面跑 gdb、strace），内核会拒绝。

PRoot 的选择是把这个系统调用整个吞掉：

```c
/* src/ptrace/ptrace.c:100 */
int translate_ptrace_enter(Tracee *tracee)
{
    /* The ptrace syscall have to be emulated since it can't be nested.  */
    set_sysnum(tracee, PR_void);
    return 0;
}
```

然后它在用户态重建了一套 tracer/tracee 关系：`attach_to_ptracer()` 记账，`PTRACE_TRACEME`/`ATTACH`/`SEIZE`/`INTERRUPT` 逐个处理，`wait4` 被拦下来自己填 `siginfo`，事件在 `handle_ptracee_event()` 里转发。

代价前面提过：一旦有 tracee 开始当 tracer，seccomp 加速就必须关掉，因为 PRoot 无法预知那位调试器关心哪些系统调用。

## CARE：扩展的整合工具

仓库里还有个 `care` 子命令（`src/extension/care/`）。它不改系统调用语义，只是把每个系统调用、每个被打开的文件、每段输出录下来，最后打成一个自包含的包，可以在另一台机器上重放。

它能成立，全靠 `SYSCALL_*` 和 `ALREADY_OPENED_FD` 这几个事件——核心不需要为「录制回放」写一行代码。这是扩展机制设计得最成功的地方：**PRoot 把自己变成了一个进程级插桩引擎**，chroot 只是它的第一个用例。

## 小结

- 扩展机制只有两样东西：17 个事件的回调链表，以及每个插件自己贡献的 seccomp 系统调用名单。核心不写死任何「撒谎」逻辑。
- fake_id0 靠临时 `chmod` 加 talloc 析构的逆序恢复，link2symlink 靠改数据布局，kompat 靠降级系统调用——三种手法对应三种伪造难度。
- `ptrace` 不能嵌套，所以连它都要在用户态重造一套 tracer/tracee 关系；代价是一旦有 tracee 当 tracer，seccomp 加速必须关掉。