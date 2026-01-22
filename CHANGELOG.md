# Changelog (local patch)

## vNext (2026-01-22)

### ✅ Priority goal: “14 天数据 + 动态 sources + PRApplied 配色/筛选可用”
- 后端 `scripts/build.py` 固定输出最近 **14 天**（`OUTPUT_WINDOW_DAYS = 14`），并在输出里附带 `coverage`（最早/最晚日期）。
- `data/articles.json` 现在包含：
  - `sources`：动态来源元信息（key/journal/short/bg/fg）
  - `buildReport`：每个来源的抓取状态（HTTP status、entries 数、bozo、error）
- 前端不再写死 LEGEND/来源列表；而是从 `sources` 动态生成，并且用 `bg/fg` 做配色（新加的 PRApplied 会自动支持筛选+配色）。

### ✅ RSS 有效性排查（自动化）
- 构建时对每个 feed 记录成功/失败与原因；前端新增按钮 **“🛰 RSS 状态”** 查看 report。

### ✅ 新功能（科研效率向）
- **新增条目提示**：显示“相对上次访问新增”数量；卡片显示 `NEW`。
- **一键复制 BibTeX**（卡片级 + 收藏夹级）：
  - 不下载文件；直接复制到剪贴板。
  - 会把你的 `阅读状态 + note + 关键词命中` 合并到 `note = {...}` 字段，方便粘进 `.bib`。
- **关键词订阅/高亮（可配置）**：
  - “⚙️ 关键词”里每行一个关键词/短语
  - 支持标题/摘要高亮 + “只看关键词命中”视图
- **阅读状态管理 + 个人笔记（本地保存）**
  - 每条卡片：To read / Reading / Done + Note
- **本周 digest 自动生成（本地）**
  - “🗓️ 本周 digest” 基于最近 7 天内你修改过状态/笔记的条目生成 Markdown，并可一键复制 Markdown 或 BibTeX。

### 🧹 修复
- 修复了旧版 `assets/style.css` 截断导致的样式错误；改为更稳健的“CSS 变量 + 动态配色”方案。
