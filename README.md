# 个人主页与笔记

一个基于 Astro 的静态个人主页。笔记是仓库中的 Markdown 文件，可以在本地编辑、按文件夹整理，并用 `tags` 标记主题；推送到 GitHub 后，GitHub Actions 会构建并发布网站。

## 在本地使用

安装 Node.js 24，然后在项目目录运行：

```bash
npm ci
npm run dev
```

开发服务器会在终端显示本地预览地址。发布前可运行 `npm run build` 检查静态构建，生成的网站位于 `dist/`。

## 添加和整理笔记

在 `src/content/notes/` 下新建 `.md` 文件。子文件夹可用来表示分类，例如 `src/content/notes/programming/first-note.md`。文件开头填写元数据：

```markdown
---
title: 我的第一篇笔记
date: 2026-09-21
description: 这篇笔记的简短摘要
tags:
  - Astro
  - 学习记录
---

这里开始写正文。可以使用 Markdown 标题、列表、链接和代码块。
```

在本地按上述格式编辑 Markdown，或复制并补齐元数据后放入该目录，即可添加内容。改动会出现在本地预览中；把笔记和项目代码一起提交、推送到 GitHub 后，网站会自动重新发布。移动文件可调整文件夹分类，修改 `tags` 可调整标签。移动或重命名文件也会改变对应笔记的网址。

已有本地 Markdown 文件也可以用导入命令复制进笔记目录：

```powershell
npm run import -- "C:\notes\My Note.md" --folder "课程/算法" --tags "算法,学习"
```

`--folder` 指定 `src/content/notes/` 下的相对目录，`--tags` 用英文逗号分隔标签，两者都可以省略。导入时会为缺少元数据的笔记补上标题和日期；已有元数据会保留，传入 `--tags` 时会更新标签。若目标文件已存在，命令会报错，不会覆盖原笔记。

笔记中的本地图片可用 `![说明](./cover.png)` 或 `![说明](images/diagram.png)` 引用。导入命令会把这类相对路径图片一起复制，并保留目录结构；支持 PNG、JPG、JPEG、WebP、GIF 和 SVG。引用式图片 `![说明][id]`、HTML `<img>` 和带查询参数的图片地址需要手动整理。远程图片 URL 可直接留在 Markdown 中。

首次将项目推送到 GitHub 后，日常更新可以在项目目录运行：

```bash
git add src/content/notes
git commit -m "Update notes"
git push
```

## 发布到 GitHub Pages

1. 使用仓库 `https://github.com/dovellx/dovellx.github.io`，网站地址为 `https://dovellx.github.io/`。同一套配置也支持普通仓库名，对应地址为 `https://<用户名>.github.io/<仓库名>/`。
2. 将本项目推送到该仓库的 `main` 分支，并提交 `package-lock.json`。部署工作流使用 `npm ci` 安装依赖，因此需要锁文件。
3. 打开仓库的 **Settings → Pages**，将 **Build and deployment → Source** 设为 **GitHub Actions**。
4. 查看仓库的 **Actions** 页签中的 **Deploy to GitHub Pages** 运行结果。之后每次推送到 `main` 都会重新构建并发布，也可以在 Actions 中手动运行。

部署工作流会根据仓库名自动设置 Astro 的 `BASE_PATH`：`<用户名>.github.io` 使用 `/`，普通仓库使用 `/<仓库名>`。因此同一份项目可以发布在上述两种 GitHub Pages 地址下。

相关文档：[Astro 的 GitHub Pages 部署指南](https://docs.astro.build/en/guides/deploy/github/) · [GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
