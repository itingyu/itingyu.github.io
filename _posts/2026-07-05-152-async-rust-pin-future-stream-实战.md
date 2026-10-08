---
layout: post
title: "1.5.2 Async Rust · pin / Future / Stream 实战"
date: 2026-07-05 00:00:00 +0800
series: prog-lang
tags:
  - "Rust"
  - "async"
  - "Future"
  - "Tokio"
  - "Stream"
excerpt: "Rust 异步是 zero-cost abstraction。"
pinned: false
cover: null
draft: false
column: prog
permalink: /notes/prog/prog-lang/152-async-rust-pin-future-stream-%E5%AE%9E%E6%88%98/
---


## 1. 为什么需要 async:同步、多线程与 Green Thread 的取舍

I/O 密集型场景下,同步阻塞会浪费线程等待,多线程又会因锁与上下文切换撑爆内存,Rust 选择把异步作为 zero-cost abstraction(零开销抽象)挂在标准库 `std::future::Future` 上,运行时由 Tokio、async-std 等库按需实现。`async/await` 在编译期被展开成状态机,运行时只在 `.await` 点让出执行权,既能像 Green Thread 那样写线性代码,又不必为每个任务预分配 8MB 栈。

| 模式 | 单任务内存 | 并发 10k 连接 | 编程模型 | 适用场景 |
|------|------------|----------------|----------|----------|
| OS Thread | ~8MB 栈 | ~80GB(不可行) | 同步 | CPU 密集 |
| Green Thread | ~2KB | ~20MB | 同步 + 协作 | 脚本/嵌入式 |
| Rust async | ~百字节 state | ~MB 级 | 状态机 + `.await` | I/O 密集 + 生态成熟 |

依据:tokio 官方文档《Shared state》《Shared) 与 2024 Tokio 1.40 release notes 关于 task 内存预算的描述。

## 2. Future trait 详解:Poll / Pin / Waker 三件套

`Future` trait 只有一个 `poll` 方法,它返回 `Poll<Self::Output>`,其中 `Ready(value)` 表示完成、`Pending` 表示尚未就绪;`Pin<&mut Self>` 保证 future 在被轮询时地址不变,从而让内部的自引用结构(`struct S { a: i32, b: *const i32 }`)安全地持有指向自身的指针;`Waker` 则是任务通知 executor「我已经准备好了,再来 `poll` 一次」的回调句柄,典型实现 `wake()` 会把任务重新压入 runtime 的就绪队列。运行时负责反复调用 `poll`,future 负责要么直接出结果,要么注册 waker 后立刻返回 `Pending`。

| 组件 | 类型 | 作用 |
|------|------|------|
| `poll` | `Pin<&mut Self> -> Poll<Output>` | 推进状态机 |
| `Pin` | 不可移动的 `&mut` 指针 | 保证自引用有效 |
| `Waker` | `Arc<dyn Wake>`,线程安全 | 通知 executor 重新 poll |
| `Context<'_>` | 含 `&Waker` 的环境 | 传给 `poll` 的轮询上下文 |

依据:Rust RFC 2592、std::future::Future 文档与 Pin RFC。

## 3. async/await 语法糖:从 `async fn` 到手工 `Future` impl

编译器把 `async fn fetch(url: &str) -> String` 改写成 `fn fetch<'a>(url: &'a str) -> impl Future<Output = String> + 'a`,内部生成一个匿名的状态机 enum:每个 `.await` 点对应一个 variant,局部变量变成字段,跨 await 持有引用的变量被 pin 在栈外堆上(`Box::pin`)。这也是为什么 `await` 必须在 `async` 上下文里、且返回的 future 必须是 `'static` 才能 `tokio::spawn`。

```rust
// 手写 Future 实现 poll,与 async fn 等价
struct DelayFut { when: Instant, waker: Option<Waker> }
impl Future for DelayFut {
    type Output = ();
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if Instant::now() >= self.when {
            Poll::Ready(())
        } else {
            self.waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}
```

依据:Rust Reference《Async/Await》《Implementation of generators and async lowering》与 rustc 编译器源代码 `compiler/rustc_lexer`/`rustc_hir_lowering`。

## 4. Tokio runtime 实战:spawn / select / timeout / JoinHandle

Tokio 默认 `multi_thread` runtime 提供 work-stealing 调度,`tokio::spawn(future)` 把任务丢进全局队列返回 `JoinHandle<T>`,调用 `handle.await` 即可拿到结果或 `JoinError`;`tokio::select!` 宏像 `match` 一样等待多个 future,谁先 `Ready` 就执行谁的分支并取消其余分支,适合「抢答」场景;`tokio::time::timeout(Duration::from_secs(3), fut)` 给 future 套一个时限,超时返回 `Err(Elapsed)`。

```rust
#[tokio::main]
async fn main() {
    let a = tokio::spawn(async { reqwest::get("https://a").await?.text().await });
    let b = tokio::spawn(async { reqwest::get("https://b").await?.text().await });
    let res = tokio::time::timeout(Duration::from_secs(2), async {
        tokio::select! {
            Ok(t) = a => t.unwrap_or_default(),
            Ok(t) = b => t.unwrap_or_default(),
        }
    }).await;
    println!("{res:?}");
}
```

依据:Tokio 教程《Spawning》《Shared state》与 Tokio 1.40 API docs。

## 5. Stream 异步迭代器 + 跨 Future 共享状态

`Stream` 是 `Future` 的迭代版本:`trait Stream { type Item; fn poll_next(...) -> Poll<Option<Self::Item>>; }`,`Option::None` 代表流结束;`tokio_stream` 与 `futures` crate 提供 `wrappers::ReceiverStream`、`StreamExt::map/filter/chunks_timeout` 等适配器。跨 future 共享可变状态时,优先用 `tokio::sync::Mutex` 或消息通道(`mpsc::channel`),而不是 `Rc<RefCell<T>>`——后者不是 `Send`,无法跨任务;`Arc<tokio::sync::RwLock<HashMap<K,V>>>` 是只读多写一场景的常见选择。

| 共享方式 | `Send` | 跨 `await` | 性能 | 典型场景 |
|----------|--------|------------|------|----------|
| `Arc<tokio::sync::Mutex<T>>` | ✅ | ✅ | 一般 | 写少读多、临界区短 |
| `Arc<tokio::sync::RwLock<T>>` | ✅ | ✅ | 读多写少更优 | 配置/缓存 |
| `mpsc::channel` | ✅ | ✅ | 高 | 任务间单向消息 |
| `Rc<RefCell<T>>` | ❌ | ✅ | 高 | 仅单线程 `LocalSet` |

依据:Tokio 教程《Shared state》《Channels》与 `futures::Stream` trait docs。