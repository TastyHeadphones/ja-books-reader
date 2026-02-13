# ja-books-reader

一个日文书网页阅读器，支持：

- 将 `books` 目录中的 EPUB 提取为网页可读章节
- 句子级点击朗读（Google Cloud Text-to-Speech）
- 日文汉字自动标注假名（furigana）
- Apple 风格的轻玻璃化 UI

## Quick Start

```bash
npm install
npm run setup
npm run dev
```

然后打开本地 Vite 地址（默认 `http://localhost:5173`）。

## 使用说明

1. 顶部输入你的 Google Cloud API Key。
2. 在左侧选择章节。
3. 点击正文中的任意句子，即可生成并播放日文语音。

## 书籍数据构建

默认会读取 `books` 目录下第一个 `.epub`，输出到 `public/data/book.json`。

```bash
npm run build:book
```

也可以指定输入/输出路径：

```bash
node scripts/extract-epub.js "<输入epub路径>" "<输出json路径>"
```

## GitHub Actions 部署

仓库已包含自动部署工作流：`/.github/workflows/deploy-pages.yml`

- 触发条件：`push` 到 `main`，或手动 `workflow_dispatch`
- 部署目标：GitHub Pages

首次使用请在仓库中设置：

1. 打开 GitHub 仓库 `Settings > Pages`
2. `Build and deployment` 的 `Source` 选择 `GitHub Actions`
3. 推送到 `main` 分支，等待 `Deploy To GitHub Pages` 工作流完成
