# itingyu.github.io

个人博客，部署在 GitHub Pages。访问 <https://itingyu.github.io/>。

## 当前状态

骨架已搭建，2026-09-26 由 Multica 上的 `SDD开发团队` 接手续做。

## 目录

```
index.html         首页
about/index.html   关于
posts/index.html   文章索引
posts/<slug>/      单篇文章(由 scripts/new-post.sh 生成)
404.html           404 页
assets/style.css   样式
scripts/           写作 / 构建脚本
  new-post.sh      一键生成新文章页
  templates/       文章模板
```

## 写新文章

通过 `scripts/new-post.sh` 一键生成文章页骨架,无需复制模板、不用手填 SEO meta。

### 用法

```bash
./scripts/new-post.sh <slug> "<title>" [--tag <tag>...] [--date YYYY-MM-DD] [--excerpt "<text>"]

# 示例
./scripts/new-post.sh my-first-post "我的第一篇" --tag note --excerpt "占位示例"
```

参数:

- `<slug>` — 文章 URL 段,只允许 `[a-z0-9-]`,违规立即报错
- `<title>` — 文章标题
- `--tag` — 标签,可重复;自动生成 `<meta property="article:tag">` 与 chip 链接
- `--date` — 发布日期,默认今天
- `--excerpt` — 摘要,默认占位文案

### 发布两步走

```bash
# 1. 生成文章页
./scripts/new-post.sh my-post "标题" --tag note

# 2. 编辑正文、提交并推送
$EDITOR posts/my-post/index.html
git add posts/my-post/
git commit -m "post: my-post"
git push
```

GitHub Pages 会自动部署。首页 / 归档 / 标签 / RSS 的增量更新由后续的 `scripts/build-index.js`(AIWORK1-28)接管。

## 后续

技术栈、写作流程、内容来源由 SDD 开发团队按规格驱动开发方式确定。

金融简报类内容由「金融小队」每日产出，会同步发布到此博客。