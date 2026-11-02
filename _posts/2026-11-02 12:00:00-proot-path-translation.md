---
layout: post
slug: proot-path-translation
title: 路径翻译：canonicalize、binding 与 glue
date: 2026-11-02 12:00:00 +0800
column: proot
series: proot-internals
tags:
  - 源码分析
  - 文件系统
  - 符号链接
excerpt: 内核只认宿主路径。所以 PRoot 接到 openat(AT FDCWD,  /etc/passwd , ...) 时，必须先把它变成 /home/u/rootfs/etc/passwd ，再把指针换掉——而 guest 里那个 /etc/passwd 可能根本不存在，也可能是三层符号链接套出来的。
pinned: false
cover: null
draft: false
permalink: /notes/proot/proot-internals/proot-path-translation/
---

# 路径翻译：canonicalize、binding 与 glue

内核只认宿主路径。所以 PRoot 接到 `openat(AT_FDCWD, "/etc/passwd", ...)` 时，必须先把它变成 `/home/u/rootfs/etc/passwd`，再把指针换掉——而 guest 里那个 `/etc/passwd` 可能根本不存在，也可能是三层符号链接套出来的。

`src/path/` 这 3,053 行就干这一件事。它是整个项目最绕、也最容易出 bug 的部分。

## 六步

`translate_path()` 是唯一入口，注释把契约写得很清楚：返回 `root + canon(dir_fd + user_path)`。

```c
/* src/path/path.c:330 */
if (user_path[0] == '/') {
    strcpy(result, "/");                 /* 1. 绝对路径，base 就是 "/" */
} else if (dir_fd != AT_FDCWD) {
    status = readlink_proc_pid_fd(tracee->pid, dir_fd, result);
    if (result[0] != '/')
        return -ENOTDIR;                 /* 管道/套接字，不属于文件系统 */
    status = detranslate_path(tracee, result, NULL);   /* 2. dirfd 反查 */
} else {
    status = getcwd2(tracee, result);    /* 3. 相对 cwd */
}

status = notify_extensions(tracee, GUEST_PATH, result, user_path);
if (status > 0)
    goto skip;                           /* 扩展接管 */

status = join_paths(2, guest_path, result, user_path);
strcpy(result, "/");
status = canonicalize(tracee, guest_path, deref_final, result, 0);
status = substitute_binding(tracee, GUEST, result);    /* 4. guest -> host */
```

归纳成六步：

1. 确定 base：绝对路径用 `/`，相对路径用 cwd，`*at` 系列用 `dir_fd` 反查。
2. 拼接。
3. **按 guest 语义**规范化（不是 `realpath`）。
4. 绑定替换，得到宿主路径。
5. 通知扩展（`TRANSLATED_PATH`），扩展可以再改。
6. 返回，由调用方 `set_sysarg_path()` 写回 tracee 内存。

## 为什么不能直接 realpath

因为 `realpath()` 在宿主命名空间里解析符号链接，而 PRoot 要的是**在 guest 命名空间里**解析。差别在于：guest 的 `/` 不是宿主的 `/`，符号链接的每一段都可能落在绑定上。

`canonicalize()` 因此自己走了一遍逐段解析：

```c
/* src/path/canon.c:190 */
while (!IS_FINAL(finality)) {
    finality = next_component(component, &cursor);

    if (strcmp(component, ".") == 0)  continue;
    if (strcmp(component, "..") == 0) { pop_component(guest_path); continue; }

    status = join_paths(2, scratch_path, guest_path, component);
    status = substitute_binding_stat(tracee, finality, recursion_level,
                                     scratch_path, host_path);

    if (status <= 0 || (finality == FINAL_NORMAL && !deref_final)) {
        /* 不是链接，或明确要求不解析最后一段（lstat/readlink） */
        continue;
    }

    /* 是链接：readlink -> detranslate -> 递归 canonicalize */
}
```

三个关键点：

- **`..` 不会越界**。`pop_component()` 作用在 guest 路径上，`/..` 还是 `/`，所以 `../../../../etc/passwd` 这种经典逃逸在 guest 里只会被夹回根目录。
- **每一段都要 `lstat`**。中间组件必须是目录或符号链接，否则返回 `-ENOTDIR`；这顺带复刻了内核对路径中间段的检查。
- **`deref_final` 决定最后一段**。`open` 传 true，`lstat`/`readlink`/`unlink` 传 false——因为内核对这些系统调用本来就不跟随最后一段链接。

递归有上限：`recursion_level > MAXSYMLINKS` 直接 `-ELOOP`（`MAXSYMLINKS` 来自 `sys/param.h`，Linux 下是 40）。

## binding：两张按长度排序的表

`-b host:guest` 不是挂载，只是一条记录。PRoot 为每个 tracee 维护两张循环链表：guest 侧和 host 侧，都按路径前缀从长到短排列（准确地说，是保证「包含关系在前」，而不是单纯比长度）。

```c
/* src/path/binding.c:243 */
binding = get_binding(tracee, side, path);
if (!binding)
    return -ENOENT;

if (!binding->need_substitution)   /* host 和 guest 路径相同，无事可做 */
    return 0;

substitute_path_prefix(path, ref->length, reverse_ref->path, reverse_ref->length);
```

`get_binding()` 从头扫，第一个前缀匹配的就是最长匹配——这就是为什么表要按长度排序。

`-r /rootfs` 只是 `-b /rootfs:/` 的语法糖，源码注释写得很直接：

```c
/* src/cli/proot.c:38 */
/* ``chroot $PATH`` is semantically equivalent to
 * ``mount --bind $PATH /``.  */
binding = new_binding(tracee, value, "/", true);
```

根绑定是唯一不做规范化的绑定——因为规范化本身需要先有根，这是个先有鸡还是先有蛋的问题，`initialize_binding()` 里专门为 `"/"` 开了后门。

## glue：给不存在的目标造个壳

绑定目标在 guest 里可能不存在。比如 `-b /dev/null`，而 guest 的 `/dev` 是个空目录。PRoot 不能真的 `mknod`，也不该污染用户的 rootfs。

它的办法是造一个「glue rootfs」：在临时目录里按需 `mkdir` 出中间目录、`open(O_CREAT)` 出同类型的空文件，再把绑定指向这个临时文件。

```c
/* src/path/glue.c:105 */
if (tracee->glue == NULL)
    tracee->glue = create_temp_directory(NULL, tracee->tool_name);
...
if (S_ISDIR(type))
    status = mkdir(host_path, mode);
```

`PROOT_DONT_POLLUTE_ROOTFS=1` 可以禁止它往真实 rootfs 里写，只在 glue 目录里造。

## /proc 是个例外

`/proc` 下的内容是内核动态生成的，不能按普通路径规范化。PRoot 在 `canonicalize()` 里对 `/proc` 前缀单独走了 `readlink_proc()`：

- `/proc/self` → `/proc/<tracee->pid>`
- `/proc/<pid>/exe` → `tracee->exe`
- `/proc/<pid>/cwd` → `tracee->fs->cwd`
- `/proc/<pid>/root` → `get_root(tracee)`
- `/proc/<pid>/fd/N` → 原样返回，标记 `DONT_CANONICALIZE`（可能指向管道或套接字）

对 `fd/N` 不做规范化的理由写在注释里：它可能是匿名管道，此时任何「解析」都是错的；如果它确实指向文件，等 `readlink` 返回时再反向翻译。

## detranslate：把答案翻译回去

`readlink("/bin/echo")` 在内核里返回的是宿主路径 `/bin/busybox`。直接交给用户就穿帮了，所以出口还要反向翻译：

```c
/* src/path/path.c:426 */
switch (compare_paths(get_root(tracee), path)) {
case PATH1_IS_PREFIX:
    prefix_length = strlen(get_root(tracee));
    if (prefix_length == 1) prefix_length = 0;   /* root 就是 "/" */
    memmove(path, path + prefix_length, new_length);
    break;
default:
    if (sanity_check)
        return -EPERM;      /* 不在 root 里，拒绝暴露 */
    else
        return 0;
}
```

`sanity_check` 为真时（普通路径，不是符号链接），任何落在 root 之外的宿主路径都返回 `-EPERM`。这是 PRoot「不泄露宿主路径」的唯一一道闸门，也是 `getcwd` 这类系统调用必须拦截的原因。

## 实际长什么样

用 `-v 2` 跑一次，日志会把每次翻译打出来：

```text
proot info: vpid 1: translate("/" + "/bin/echo")
proot info: vpid 1:          -> "/bin/busybox"
proot info: vpid 1: translate("/" + "/bin/echo")
proot info: vpid 1:          -> "/bin/echo"
```

同一个 `/bin/echo`，一次解析到 `/bin/busybox`（它是指向 busybox 的符号链接），一次原样保留。差别就是 `deref_final`：第一次是「找到要执行的文件」，第二次是 `lstat` 语义。一个参数，两种答案。

下一篇进入真正动手的一层：把翻译好的字符串写回别人的地址空间。
