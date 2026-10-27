# Physics Feeds

物理期刊与 arXiv 凝聚态预印本的静态阅读入口，部署于 [xzcheneit.github.io](https://xzcheneit.github.io)。无需前端构建工具或服务器数据库。

- 数据端保留最近 **14 天**，页面默认筛选最近 **3 天**；日期和更新时间按浏览器本地时区显示。
- 按期刊、发表状态、时间和关键词筛选；筛选条件保存在网址中，支持刷新与分享。
- 关键词命中高亮、收藏、阅读状态、自动保存笔记、本周阅读摘要和 BibTeX 复制。
- 标题、摘要与收藏内的 LaTeX 化学式和数学公式使用本地 KaTeX 排版；支持直接输入 `Ca3(Ru,Ti)2O7` 搜索对应上下标公式。BibTeX 保留原始 LaTeX。
- 每次加载 30 篇，点击「加载更多论文」追加；手机与桌面均可使用。
- 收藏、笔记和关键词仅保存在当前浏览器的 localStorage。清除浏览器数据会移除这些内容，可先复制收藏或本周阅读的 BibTeX / Markdown。

## 本地预览

在仓库目录运行：

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

打开 [本地预览](http://127.0.0.1:8000)。不建议直接用 `file://` 打开，因为页面需要 fetch JSON 数据。

## 更新数据

需要 Python 3.11 或更新版本：

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r scripts/requirements.txt
python scripts/build.py
```

期刊配置位于 `data/sources.json`；`recent` / `accepted` 可为单个 URL 或多个官方订阅 URL 的数组，合并后自动去重。arXiv cond-mat 由脚本追加。输出 `data/articles.json` 包含论文、来源配色、日期覆盖范围和抓取报告；`data/arxiv_cache.json` 缓存 Accepted 文章的 arXiv 标题匹配结果。

脚本对临时失败的来源保留其 14 天内已有记录；全部来源失败或没有可用文章时中止写入。JSON 采用原子替换，避免留下半写入文件。RSS 有条目数上限，14 天是保留时间窗口，并不保证每个期刊都完整覆盖这段时间。

只需刷新期刊 RSS、并复用已缓存的 arXiv 匹配时，可运行 `python scripts/build.py --skip-arxiv-title-search`，避免逐条标题查询。默认命令仍执行可选匹配。

官方 RSS 地址核查和其他期刊推荐见 [RSS_SOURCES.md](RSS_SOURCES.md)；可将 [推荐订阅 OPML](docs/recommended-physics-feeds.opml) 导入 RSS 阅读器。推荐源尚未自动加入网站。

## 验证

```sh
python -m unittest discover -s tests -p 'test_build.py' -v
node --check assets/app.js
node --test scripts/test_frontend.cjs tests/test_math.mjs
```

测试使用离线数据，不访问期刊，也不修改现有数据文件。Node.js 使用 22 或更新版本。GitHub Actions 会在相关源文件变更时执行相同检查。

## GitHub Pages

仓库 Settings → Pages 使用 **Deploy from a branch → main → /(root)**。`Fetch latest journal feeds (14-day window)` 工作流每两小时运行，也可手动触发；它只提交两个生成的数据文件。修改站点源文件后需提交并推送到部署分支，Pages 才会更新。

抓取失败时先查看页面「RSS 状态」与 Actions 日志。部分出版商会返回访问限制或防机器人页面，HTTP 200 本身不能证明 RSS 正常。审阅结果及已知限制见 [REVIEW.md](REVIEW.md)。

## 公式渲染

`assets/scientific-text.mjs` 识别 `$…$`、`$$…$$`、`\(…\)`、`\[…\]` 以及化学命令 `\ce{…}`，在标题、摘要和收藏中生成带无障碍 MathML 的排版结果。连续的元素与上下标保持在一起，较长公式可局部滚动。搜索会同时匹配原始源码和可读形式，本周阅读 Markdown 使用可读纯文本，BibTeX 和数据字段保留源文。

KaTeX 0.19.1、mhchem、字体和 MIT 许可证随站点保存在 `assets/vendor/katex/`，无需运行时 CDN 或前端安装。来源异常、截断公式及没有定义的作者宏会局部保留源文，不影响其他公式。金额文本保持原样；公式不能创建外部图片、链接或任意 HTML，也不能跨文章定义宏。
