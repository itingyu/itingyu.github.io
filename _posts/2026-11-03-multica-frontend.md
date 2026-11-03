---
layout: post
slug: multica-frontend
title: 三端共享：业务层与平台适配器
date: 2026-11-03 10:00:00 +0800
column: multica
series: multica-code
tags:
  - Multica
  - 前端架构
  - 跨平台
excerpt: Web、桌面与移动端共享 core、views、ui 三层，平台能力由适配器接口注入。文章说明依赖方向、状态分工与契约漂移的处理。
pinned: false
cover: null
draft: false
permalink: /notes/multica/multica-code/multica-frontend/
---

# 三端共享：业务层与平台适配器

Web、Electron 与 React Native 共享三层包：`core` 提供 API 客户端与状态，`views` 提供页面与业务组件，`ui` 提供视觉原语。平台差异由适配器接口收敛。

平台差异收敛在适配器接口上，共享层只写业务。

Multica 有三个客户端：Next.js 的 Web、Electron 的桌面、Expo 的手机。它们共享 4.8 MB 的 `packages/core` 和 18.2 MB 的 `packages/views`，但没有任何一个页面被复制三遍。

## 依赖方向

仓库里有一条规则，写在 `AGENTS.md`：

```text
views -> core + ui
core 和 ui 互不依赖
```

具体分工：

- `packages/core`：无头逻辑。API 客户端、TanStack Query hooks、Zustand store、权限判断、类型。禁止出现 `react-dom`、`localStorage`、`process.env`。
- `packages/ui`：视觉原语和共享样式。禁止业务逻辑，禁止 import `core`。
- `packages/views`：Web 和桌面共享的页面与业务组件。禁止定义 store，禁止 `next/*` 和 `react-router-dom`。
- `apps/web`：Next.js 路由和 Web 专属 UI。
- `apps/desktop`：Electron 主进程、渲染进程、桌面专属状态。
- `apps/mobile`：独立的 Expo 客户端，只共享 `core` 的类型和纯工具，不复用 `views`。

这条方向由 lint 和 review 检查。结果是三端共享**规则和数据**，不共享像素。

## 平台能力用接口注入

`core` 不能直接用 `localStorage`，因为它还要跑在 Electron 和 React Native 上。于是有了 `StorageAdapter`：

```ts
export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
```

Zustand 的 `persist` 中间件通过 `createPersistStorage(adapter)` 桥接，Web 用 `localStorage`，桌面用文件或 IndexedDB，移动端用 AsyncStorage。`core` 只认接口。

导航也是同样的思路。`NavigationAdapter` 定义在 `packages/views/navigation/types.ts`：

```ts
export interface NavigationAdapter {
  push(path: string): void;
  replace(path: string): void;
  back(): void;
  pathname: string;
  searchParams: URLSearchParams;
  hash: string;
  getShareableUrl(path: string): string;
  prefetch?(path: string): void;
  canGoBack?(): boolean;
  forward?(): void;
  openInNewTab?(path: string, title?: string, opts?: { activate?: boolean }): void;
  openWorkspaceInNewWindow?(slug: string): void;
}
```

Web 的实现包着 Next 的 `useRouter`、`usePathname`、`useSearchParams`；桌面实现包着 react-router 的 MemoryRouter 和它自己的 tab 栈。

这里有一个很具体的坑，注释里写得很清楚：

> The desktop renderer runs a MemoryRouter over a `file://` page, so its `window.location.hash` is always empty.

桌面端的 URL 不是真实地址，`window.location.hash` 永远为空。如果共享组件直接读 `window.location`，桌面上的深链接（比如 `#comment-123`）就会丢。所以 adapter 必须提供 `hash`，由平台自己维护。Web 用 `useSyncExternalStore` 订阅 `hashchange` 和 `popstate`；桌面从内存路由里取。

`getShareableUrl` 也是平台差异：Web 返回 `origin + path`，桌面要返回「所连接环境的公网地址」，因为 `file://` 不能分享。`openInNewTab`、`openWorkspaceInNewWindow` 在 Web 上是 `undefined`，共享组件必须用可选调用 `openInNewTab?.()`。

这套接口的设计原则是：**共享层只声明「我需要什么能力」，不关心平台怎么实现；可选能力用 `?` 标注，调用方必须处理缺失。**

## 服务端状态和客户端状态分开

`AGENTS.md` 里有一条状态规则：

> TanStack Query owns API/server data. Zustand owns client state such as filters, drafts, modals, and tab layout.

这条规则听起来像常识，实际执行起来很容易破。最常见的破法是：WebSocket 收到事件后，把新数据写进 Zustand，页面再从 Zustand 读。于是同一份 issue 有两个来源，Query 缓存和 store 迟早不一致。

Multica 的做法是：**实时事件只 patch 或 invalidate Query 缓存，不把服务端 payload 塞进 Zustand。**

```ts
// 事件到达后
queryClient.setQueryData(issueKeys.detail(wsId, id), patcher);
// 或者
queryClient.invalidateQueries({ queryKey: issueKeys.all(wsId) });
```

什么时候 patch、什么时候 invalidate，也有一条判断标准：能预测结果、失败概率低、回滚简单、用户还停在当前页面，才做乐观 patch；否则 invalidate，让服务器重新给权威数据。

查询键必须带 `wsId`。同一个用户在多个 workspace 之间切换，如果不带，A 工作区的 issue 列表会命中 B 工作区的缓存。账户级的数据（比如个人设置）才用 account-scoped key。

## 契约漂移的兼容处理

后端和客户端不是同时发布的。桌面端尤其严重：用户可能半年不升级，连的是一个新后端。

`packages/core/api/schema.ts` 只有 55 行，但解决了一个大问题：

```ts
export function parseWithFallback<T>(
  data: unknown,
  schema: ZodType,
  fallback: T,
  opts: ParseOptions,
): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data as T;
  schemaLogger.warn(`API response failed schema validation: ${opts.endpoint}`, {...});
  return fallback;
}
```

解析失败不抛异常，而是记一条带 endpoint 的警告，返回一个安全的默认值。注释里的目标是：把「API 契约漂移」从白屏事故，降级成「能渲染但功能少一点」。

配套的还有两条规则：

- schema 故意宽松。枚举用 `z.string()` 而不是 `z.enum()`，未知值也能通过，交给下游的 `default` 分支处理。
- 新增字段必须有默认值；服务端枚举新增值时，客户端不能因为不认识就崩。

这套做法牺牲了「类型绝对准确」，换来了「老客户端不死」。对一个有桌面和移动端的 product 来说，这是必要的交换。

## 桌面端的差异

桌面端有几件事是 Web 没有的：

- **多 tab**。每个 workspace 会话是一个 tab destination，切换 workspace 不是换路由，而是换 tab group。
- **多窗口**。一个 workspace 可以单独开窗；跨窗口导航要走 `switchWorkspace(slug, path)`，不能直接 `router.push`。
- **窗口覆盖层**。创建 workspace、接受邀请这类「还没有 workspace 上下文」的流程，用 `WindowOverlay`，不占路由。
- **拖拽区**。整窗视图的第一子元素必须是 `<DragStrip />`，顶部 48px 的交互控件要标 `WebkitAppRegion: "no-drag"`。

这些都不是「业务逻辑」，而是平台壳的职责。它们留在 `apps/desktop`，不污染 `views`。

移动端走得更远：它只共享 `core` 的类型和纯函数，页面、状态、i18n 全部自己维护。原因很现实——React Native 的布局、手势、导航模型和 Web 差异太大，强行共享 `views` 会让两边都难受。

所以「三端共享」准确的表述是：**业务规则共享，展示层按平台重写**。`views` 服务 Web 和桌面这两个 DOM 环境；移动端复用 `core` 的契约。

## 代价

- **适配器接口会膨胀**。`NavigationAdapter` 已经有 13 个成员，每加一个平台能力就要加一个可选方法。接口越大，新平台的实现成本越高。
- **共享组件要防御性调用**。可选方法必须用 `?.()`，否则 Web 上崩溃、桌面正常，或者反过来。
- **两层缓存的调试成本**。Query 缓存、Zustand、WebSocket 事件三者交互，出问题时要先定位是哪一层没有更新。团队需要约定「事件只碰 Query」的纪律，否则迟早会有人图省事直接写 store。

## 接口成本

适配器接口会随平台能力增长，可选方法需要防御性调用；Query、Zustand 与 WebSocket 三者交互时，排障成本高于单一状态源。
