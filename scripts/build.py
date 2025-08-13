#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json, re, time, sys, html, urllib.parse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import feedparser, httpx

# ---------------- Config ----------------
ASIA_TAIPEI = ZoneInfo("Asia/Taipei")
PRIMARY_WINDOW_DAYS = 3         # 主窗口
FALLBACK_WINDOW_DAYS = 14       # 若3天内无结果，自动回退到14天

# arXiv API：按标题查（APS accepted 用）与 cond-mat “new”
ARXIV_SEARCH_BY_TITLE = (
    "http://export.arxiv.org/api/query?search_query={query}&start=0&max_results=1"
)
ARXIV_COND_MAT_NEW = (
    "http://export.arxiv.org/api/query?"
    "search_query=cat:cond-mat*&sortBy=lastUpdatedDate&sortOrder=descending&start=0&max_results=200"
)

# ---------------- Init ----------------
with open("data/sources.json", "r", encoding="utf-8") as f:
    SOURCES = json.load(f)

client = httpx.Client(timeout=25)
UA = {"User-Agent": "physics-feeds/1.0 (+github actions)"}

def log(*a): print("[build]", *a, file=sys.stderr)
def iso(dt):
    if isinstance(dt, datetime): return dt.astimezone(timezone.utc).isoformat()
    return dt

DOI_PAT = re.compile(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.I)
TAG_PAT = re.compile(r"<[^>]+>")

def clean_summary(s: str) -> str:
    if not s: return ""
    if isinstance(s, dict): s = s.get("value") or ""
    s = TAG_PAT.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def extract_doi(entry):
    for k in ("prism_doi","doi","dc_identifier","id"):
        v = entry.get(k)
        if isinstance(v,str):
            m = DOI_PAT.search(v)
            if m: return m.group(0)
    for k in ("summary","summary_detail","content"):
        v = entry.get(k)
        if isinstance(v, dict): v = v.get("value")
        if isinstance(v, list) and v: v = v[0].get("value")
        if isinstance(v, str):
            m = DOI_PAT.search(v)
            if m: return m.group(0)
    if "links" in entry:
        for L in entry["links"]:
            href = L.get("href","")
            m = DOI_PAT.search(href)
            if m: return m.group(0)
    link = entry.get("link","")
    m = DOI_PAT.search(link)
    return m.group(0) if m else None

def parse_date(entry):
    # 优先 updated_parsed（更接近“最新”）
    for k in ("updated_parsed","published_parsed","created_parsed"):
        t = entry.get(k)
        if t: return datetime(*t[:6], tzinfo=timezone.utc)
    for k in ("updated","published","created"):
        s = entry.get(k)
        if isinstance(s,str):
            try: return datetime.fromisoformat(s.replace("Z","+00:00"))
            except Exception: pass
    return None

def find_arxiv_by_title(title):
    title = re.sub(r"\s+"," ", title).strip()
    if len(title) < 8: return None
    q = f'ti:"{title}"'
    url = ARXIV_SEARCH_BY_TITLE.format(query=urllib.parse.quote(q))
    try:
        r = client.get(url, headers=UA)
        if r.status_code != 200: return None
        text = r.text
        m = re.search(r"<id>(https?://arxiv\.org/abs/[^<]+)</id>", text)
        if m: return html.unescape(m.group(1))
    except Exception as e:
        log("arXiv title search failed:", e)
    return None

def discover_nature_feed(url):
    try:
        r = client.get(url, headers=UA); r.raise_for_status()
        m = re.search(
            r'rel="alternate"[^>]+type="application/(?:rss|atom)\+xml"[^>]+href="([^"]+)"',
            r.text, re.I
        )
        if not m:
            m = re.search(r'href="(https://www\.nature\.com/[^"]+\.rss[^"]*)"', r.text, re.I)
        if m: return html.unescape(m.group(1))
    except Exception as e:
        log("discover nature feed failed", url, e)
    return None

def discover_iop_feed(url):
    try:
        r = client.get(url, headers=UA); r.raise_for_status()
        m = re.search(
            r'rel="alternate"[^>]+type="application/(?:rss|atom)\+xml"[^>]+href="([^"]+)"',
            r.text, re.I
        )
        if not m:
            m = re.search(r'href="(https?://[^"]+/rss[^"]*)"', r.text, re.I)
        if m: return html.unescape(m.group(1))
    except Exception as e:
        log("discover iop feed failed", url, e)
    return None

def discover_oup_feed(url):
    try:
        r = client.get(url, headers=UA); r.raise_for_status()
        m = re.search(
            r'rel="alternate"[^>]+type="application/(?:rss|atom)\+xml"[^>]+href="([^"]+)"',
            r.text, re.I
        )
        if m: return html.unescape(m.group(1))
    except Exception as e:
        log("discover oup feed failed", url, e)
    return None

def fetch_feed(url):
    # 用 response.text 交给 feedparser 处理即可（它会自行猜测编码）
    return feedparser.parse(client.get(url, headers=UA).text)

# ---------------- Main ----------------
now_tpe = datetime.now(ASIA_TAIPEI)
now_utc = now_tpe.astimezone(timezone.utc)

# 暂存“所有抓到的条目”，最后再统一做时间窗口过滤（避免早筛导致全空）
items_raw = []

# 1) 期刊（sources.json）+ 自动发现
for src in SOURCES:
    key = src["key"]; journal = src["journal"]
    log("processing", key)

    feeds = []
    if src.get("recent"):   feeds.append(("published", src["recent"]))
    if src.get("accepted"): feeds.append(("accepted", src["accepted"]))
    if src.get("recentDiscover"):
        u = src["recentDiscover"]; real = None
        if   "nature.com"        in u: real = discover_nature_feed(u)
        elif "iopscience"        in u: real = discover_iop_feed(u)
        elif "academic.oup.com"  in u: real = discover_oup_feed(u)
        if real: feeds.append(("published", real))

    for typ, url in feeds:
        try:
            fp = fetch_feed(url)
        except Exception as e:
            log("feed fetch failed", key, url, e); continue

        for e in fp.entries[:200]:
            dt = parse_date(e)
            if not dt:  # 没有有效时间就跳过
                continue

            doi    = extract_doi(e)
            title  = html.unescape(e.get("title","")).strip()
            link   = e.get("link") or (e.get("links",[{}])[0].get("href") if e.get("links") else "")
            authors= []
            if isinstance(e.get("authors"), list):
                for a in e["authors"]:
                    nm = a.get("name") or ((a.get("given","")+" "+a.get("family","")).strip())
                    if nm: authors.append(nm)
            elif e.get("author"): authors = [e["author"]]
            summary = clean_summary(
                e.get("summary") or (e.get("content",[{}])[0].get("value") if e.get("content") else "")
            )

            item = {
                "journalKey": key,
                "journal": journal,
                "journalShort": src.get("short", key),
                "type": typ,
                "title": title,
                "authors": authors,
                "date": iso(dt),
                "link": link,
                "doi": doi,
                "summary": summary
            }

            # APS accepted → 尝试查 arXiv（若有则补上）
            if typ == "accepted" and key.startswith("PR"):
                arx = find_arxiv_by_title(title)
                if arx:
                    item["arxiv"] = arx
                    time.sleep(0.25)  # 轻微节流

            # 暂存（稍后统一按窗口过滤）
            items_raw.append((dt, item))

# 2) arXiv: cond-mat new
try:
    r = client.get(ARXIV_COND_MAT_NEW, headers=UA)
    feed = feedparser.parse(r.text)
    for e in feed.entries:
        dt = parse_date(e)
        if not dt:
            continue

        title   = html.unescape(e.get("title","")).strip()
        authors = [a.get("name") for a in e.get("authors",[]) if a.get("name")]
        abs_url = e.get("id") or e.get("link") or ""
        doi     = getattr(e, "arxiv_doi", None) or extract_doi(e)
        summary = clean_summary(e.get("summary",""))

        items_raw.append((dt, {
            "journalKey": "arXivCM",
            "journal": "arXiv: cond-mat",
            "journalShort": "arXiv cond-mat",
            "type": "preprint",
            "title": title,
            "authors": authors,
            "date": iso(dt),
            "link": abs_url,
            "arxiv": abs_url,
            "doi": doi,
            "summary": summary
        }))
except Exception as e:
    log("arXiv cond-mat fetch failed:", e)

# 3) 统一时间过滤（主窗口→回退窗口）
def filter_by_days(pairs, days):
    cutoff = now_utc - timedelta(days=days)
    return [it for dt, it in pairs if dt >= cutoff]

items = filter_by_days(items_raw, PRIMARY_WINDOW_DAYS)
if not items:  # 回退，避免页面空白
    log(f"no items in {PRIMARY_WINDOW_DAYS}d window, fallback to {FALLBACK_WINDOW_DAYS}d")
    items = filter_by_days(items_raw, FALLBACK_WINDOW_DAYS)
    window_days = FALLBACK_WINDOW_DAYS
else:
    window_days = PRIMARY_WINDOW_DAYS

# 输出
items.sort(key=lambda x: x["date"], reverse=True)
out = {
    "generatedAt": iso(now_utc),
    "windowDays": window_days,
    "items": items
}
with open("data/articles.json","w",encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

log("done. items =", len(items), "windowDays =", window_days)
