# Physics Feeds (纯 HTML 静态站)

- 预设期刊：PRL / PRB / PRE / PRResearch / PRX / PRX Quantum / Nature / Nature Physics / Nature Communications / Science / Nano Letters / New Journal of Physics 等主流期刊
- APS 系列包含 “Accepted” 文章，并尝试为 Accepted 文章查找 arXiv 链接（若存在）
- 仅显示最近 **3 天**（Asia/Taipei 时区计算）
- 支持收藏（localStorage 持久化在浏览器本机）与一键导出 `.bib`

## 本地预览
```bash
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## GitHub Pages 部署（主分支即网站内容）
1. 将本项目推送到 GitHub 仓库的主分支（如 `main`）。
2. 仓库 Settings → Pages：
   - Source: **Deploy from a branch**
   - Branch: **main**，目录 **/**（root）
3. Actions 里启用 `Fetch latest journal feeds` 工作流（已设为每 2 小时自动运行；也可手动运行）。

## 工作流做了什么
- 定时抓取各期刊 RSS，包括 APS 的 `recent` 与 `accepted`
- 生成 `data/articles.json`（仅最近 3 天）
- 如有更新就提交回主分支，静态站点自动展示

—— 生成时间：2025-08-13T04:07:14.241033
