# RSS 地址修正与推荐

检查时间：2026-10-27；以下日期使用北京时间（UTC+8）。新配置已在本地全量抓取：**34 / 34 请求成功，1397 篇最近 14 天内文章**。生成时间为 10:28:40。

## 已修正的 5 个来源

| 来源 | 新官方 RSS | 本次解析数量 | 网站内近 14 天数量 |
|---|---|---:|---:|
| Nano Letters | [ASAP](https://pubs.acs.org/rss/nalefd/asap.xml) + [当期](https://pubs.acs.org/rss/nalefd/currentIssue.xml) | 2 + 51 | 4 |
| Newton | [In Press](https://www.cell.com/newton/inpress.rss) + [当期](https://www.cell.com/newton/current.rss) | 50 + 18 | 3 |
| New Journal of Physics | [IOP 官方 RSS](https://iopscience.iop.org/journal/rss/1367-2630) | 10 | 8 |
| Chinese Physics Letters | [IOP 官方 RSS](https://iopscience.iop.org/journal/rss/0256-307X) + [期刊官网当期](https://cpl.iphy.ac.cn/rss/current.xml) | 10 + 19 | 4 |
| Chinese Physics B | [IOP 官方 RSS](https://iopscience.iop.org/journal/rss/1674-1056) + [期刊官网当期](https://cpb.iphy.ac.cn/rss/current.xml) | 10 + 83 | 0 |

所有表内 URL 都实际返回 HTTP 200 和可解析 XML。Nano Letters 新链接来自 [ACS 官方 RSS 目录](https://pubs.acs.org/pages/rss)；CPB 的官网 current.xml 可在其 [RSS 说明页](https://cpb.iphy.ac.cn/showRssInfo_en.htm)模板中找到。其余地址均为相应期刊或出版社官方域名上的有效订阅响应。

失败原因与修复：

- Nano Letters 的旧 `action/showFeed` 返回 403，替换为新版 `/rss/nalefd/*.xml`。
- Newton 的 `/newton/rss` 返回 403，替换为 `/newton/inpress.rss`，同时合并 `/newton/current.rss`，覆盖网络先发与当期文章。
- NJP 的旧查询参数路径已失效，改用 `/journal/rss/1367-2630`。
- CPB 的 `rss_lmqy.xml` 返回空响应，改为可用的官方 RSS。
- CPL 原地址本身有效，旧抓取逻辑错误追加 `/rss`；同时加入更新更及时的 IOP 同刊订阅。

**CPB 的零条不是抓取失败。** IOP 源内最近一期为 10 月 1 日，官网当期源最新日期为 8 月 28 日，都早于网站 14 天窗口。CPL 官网源也仍停在 9 月，IOP 源已更新至 10 月 20 日，所以合并同刊官方源能补足近期开刊数据。不会把抓取时间当成发布日期来制造“新论文”。

RSS 状态现显示任务成功总数、检查时间和各源内最新文章日期；较旧的有效源会显示“暂无最近 14 天条目”。多个来源合并时按 DOI / 链接去重，部分订阅失败时保留窗口内已有文章。

## 推荐补充的期刊

以下七种在本次检查中均返回 HTTP 200 和有效 RSS；只作为推荐，尚未自动加入网站。倾向凝聚态与材料方向时，可优先订阅 **PRMaterials、JPCM、2D Materials**；做量子信息、光学时补充 **PRA、Quantum**。

| 期刊 | 适合追踪的内容 | 官方 RSS | 本次条目数 |
|---|---|---|---:|
| Physical Review Materials | 材料物理、磁性、强关联与量子材料 | [订阅](https://feeds.aps.org/rss/recent/prmaterials.xml) | 100 |
| Physical Review A | 原子分子、量子光学与量子信息 | [订阅](https://feeds.aps.org/rss/recent/pra.xml) | 100 |
| Journal of Physics: Condensed Matter | 凝聚态综合研究 | [订阅](https://iopscience.iop.org/journal/rss/0953-8984) | 10 |
| 2D Materials | 二维材料、异质结构与输运 | [订阅](https://iopscience.iop.org/journal/rss/2053-1583) | 10 |
| Quantum | 量子信息、量子计算与量子多体；仅论文分类 | [订阅](https://quantum-journal.org/category/paper/feed/) | 30 |
| Nature Reviews Physics | 物理综述、进展与观点 | [订阅](https://www.nature.com/natrevphys.rss) | 8 |
| Nature Reviews Materials | 材料综述与进展 | [订阅](https://www.nature.com/natrevmats.rss) | 8 |

[下载七刊 OPML 订阅文件](docs/recommended-physics-feeds.opml)，可导入支持 OPML 的阅读器。期刊选择依据其办刊范围；可用地址依据本次实际响应，而非只检查 HTTP 状态。

官方目录依据：[APS RSS 目录](https://journals.aps.org/feeds)、[Quantum 论文分类](https://quantum-journal.org/category/paper/)、[Nature Reviews Physics](https://www.nature.com/natrevphys/)、[Nature Reviews Materials](https://www.nature.com/natrevmats/)。IOP 主页在本机可能返回验证页面，但上述 RSS 本身返回有效 XML。

另有两本常用应用物理期刊：[Applied Physics Letters](https://pubs.aip.org/rss/site_1000017/1000011.xml)、[Journal of Applied Physics](https://pubs.aip.org/rss/site_1000029/1000017.xml)。官网 RSS 链接已确认，但本次直接请求均为 403，暂未放入可用 OPML。SciPost 官方订阅页也受访问验证限制，暂未推荐具体地址。

RSS 往往只提供最近 8、10 或 100 条，条目数量不代表完整的 14 天覆盖。有效源的内容和访问策略也可能随时变化。
