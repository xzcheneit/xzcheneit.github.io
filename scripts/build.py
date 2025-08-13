#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json, re, time, sys, html, urllib.parse
from urllib.parse import urlparse, urljoin
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import feedparser, httpx

ASIA_TAIPEI = ZoneInfo("Asia/Taipei")
PRIMARY_WINDOW_DAYS = 3
FALLBACK_WINDOW_DAYS = 14

ARXIV_SEARCH_BY_TITLE = (
    "http://export.arxiv.org/api/query?search_query={query}&start=0&max_results=1"
)
ARXIV_COND_MAT_API = (
    "http://export.arxiv.org/api/query?"
    "search_query=cat:cond-mat*&sortBy=lastUpdatedDate&sortOrder=descending&start=0&max_results=200"
)
ARXIV_COND_MAT_RSS = "https://rss.arxiv.org/rss/cond-mat"

with open("data/sources.json","r",encoding="utf-8") as f:
    SOURCES = json.load(f)

client = httpx.Client(timeout=25)
UA = {"User-Agent": "physics-feeds/1.0 (+github actions)"}

def log(*a): print("[build]", *a, file=sys.stderr)
def iso(dt): return dt.astimezone(timezone.utc).isoformat() if isinstance(dt, datetime) else dt

DOI_PAT   = re.compile(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.I)
ARXIV_ID  = re.compile(r"arxiv\.org/(?:abs|pdf)/([0-9]+\.[0-9]+)(?:v\d+)?", re.I)
TAG_PAT   = re.compile(r"<[^>]+>")
DATE_CAND_KEYS = ["dc_date","date","prism_publicationdate","prism_publicationDate","issued","dc_issued"]

def clean_summary(s):
    if not s: return ""
    if isinstance(s, dict): s = s.get("value") or ""
    s = TAG_PAT.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()

def extract_doi(entry):
    for k in ("prism_doi","doi","dc_identifier","id"):
        v = entry.get(k)
        if isinstance(v, str):
            m = DOI_PAT.search(v)
            if m:
                return m.group(0)
    for k in ("summary","summary_detail","content"):
        v = entry.get(k)
        if isinstance(v, dict):
            v = v.get("value")
        if isinstance(v, list) and v:
            v = v[0].get("value")
        if isinstance(v, str):
            m = DOI_PAT.search(v)
            if m:
                return m.group(0)
    for L in entry.get("links", []):
        href = L.get("href", "") or ""
        m = DOI_PAT.search(href)
        if m:
            return m.group(0)
    link = entry.get("link", "") or ""
    m = DOI_PAT.search(link)
    return m.group(0) if m else None

def parse_date(entry):
    for k in ("updated_parsed","published_parsed","created_parsed"):
        t = entry.get(k)
        if t:
            return datetime(*t[:6], tzinfo=timezone.utc)
    for k in ("updated","published","created"):
        s = entry.get(k)
        if isinstance(s,str):
            try:
                return datetime.fromisoformat(s.replace("Z","+00:00"))
            except Exception:
                pass
    for k in DATE_CAND_KEYS:
        v = entry.get(k)
        if isinstance(v, dict):
            v = v.get("value")
        if isinstance(v, list) and v:
            v = v[0].get("value")
        if isinstance(v, str):
            try:
                if len(v) == 10:   # YYYY-MM-DD
                    return datetime.fromisoformat(v + "T00:00:00+00:00")
                return datetime.fromisoformat(v.replace("Z","+00:00"))
            except Exception:
                pass
    return None

def find_arxiv_by_title(title):
    title = re.sub(r"\s+"," ", title).strip()
    if len(title) < 8:
        return None
    q = f'ti:"{title}"'
    url = ARXIV_SEARCH_BY_TITLE.format(query=urllib.parse.quote(q))
    try:
        r = client.get(url, headers=UA)
        if r.status_code != 200:
            return None
        m = re.search(r"<id>(https?://arxiv\.org/abs/[^<]+)</id>", r.text)
        if m:
            return html.unescape(m.group(1))
    except Exception as e:
        log("arXiv title search failed:", e)
    return None

def discover_feed_from_html(url, host_hint=""):
    try:
        r = client.get(url, headers=UA); r.raise_for_status()
        m = re.search(
            r'rel="alternate"[^>]+type="application/(?:rss|atom)\+xml"[^>]+href="([^"]+)"',
            r.text, re.I
        )
        if m:
            return html.unescape(m.group(1))
        if "nature.com" in (host_hint or url):
            m = re.search(r'href="(https://www\.nature\.com/[^"]+\.rss[^"]*)"', r.text, re.I)
            if m:
                return html.unescape(m.group(1))
        if "iopscience" in (host_hint or url):
            m = re.search(r'href="(https?://[^"]+/rss[^"]*)"', r.text, re.I)
            if m:
                return html.unescape(m.group(1))
    except Exception as e:
        log("discover feed failed", url, e)
    return None

def fetch_feed(url):
    return feedparser.parse(client.get(url, headers=UA).text)

def canon_link(raw_link, feed_url, doi):
    if raw_link and re.match(r"^https?://", raw_link):
        return raw_link
    if raw_link and raw_link.startswith("//"):
        return "https:" + raw_link
    if raw_link:
        p = urlparse(feed_url)
        base = f"{p.scheme}://{p.netloc}/"
        return urljoin(base, raw_link)
    if doi:
        return "https://doi.org/" + doi
    return ""

# -------- Main --------
now_local = datetime.now(ASIA_TAIPEI)
now_utc = now_local.astimezone(timezone.utc)

items_raw = []
count_by_key = {}
def push(dt, item):
    items_raw.append((dt, item))
    count_by_key[item["journalKey"]] = count_by_key.get(item["journalKey"], 0) + 1

seen = set()
def seen_key(doi, link):
    if doi:
        return ("doi", doi.lower())
    m = ARXIV_ID.search(link or "")
    if m:
        return ("arxiv", m.group(1).lower())
    return ("link", (link or "").lower())

# 1) sources.json
for src in SOURCES:
    key, journal = src["key"], src["journal"]
    feeds = []
    if src.get("recent"):
        feeds.append(("published", src["recent"]))
    if src.get("accepted"):
        feeds.append(("accepted", src["accepted"]))
    if src.get("recentDiscover"):
        found = discover_feed_from_html(src["recentDiscover"], src["recentDiscover"])
        if found:
            feeds.append(("published", found))

    for typ, feed_url in feeds:
        try:
            fp = fetch_feed(feed_url)
        except Exception as e:
            log("feed fetch failed:", key, feed_url, e)
            continue

        fallback_idx = 0
        for e in fp.entries[:200]:
            dt = parse_date(e)
            if not dt:
                dt = now_utc - timedelta(hours=fallback_idx)
                fallback_idx += 1

            doi = extract_doi(e)
            raw = e.get("link") or (e.get("links",[{}])[0].get("href") if e.get("links") else "")
            link = canon_link(raw, feed_url, doi)

            s_key = seen_key(doi, link)
            if s_key in seen:
                continue
            seen.add(s_key)

            title = html.unescape(e.get("title","")).strip()
            authors = []
            if isinstance(e.get("authors"), list):
                for a in e["authors"]:
                    nm = a.get("name") or ((a.get("given","")+" "+a.get("family","")).strip())
                    if nm:
                        authors.append(nm)
            elif e.get("author"):
                authors = [e["author"]]
            summary = clean_summary(e.get("summary") or (e.get("content",[{}])[0].get("value") if e.get("content") else ""))

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
            if typ == "accepted" and key.startswith("PR"):
                arx = find_arxiv_by_title(title)
                if arx:
                    item["arxiv"] = arx
                    time.sleep(0.25)

            push(dt, item)

# 2) arXiv cond-mat（API + RSS 兜底）
def add_arxiv_from_feed(fp, feed_url_hint):
    for e in fp.entries:
        dt = parse_date(e) or now_utc
        title   = html.unescape(e.get("title","")).strip()
        authors = [a.get("name") for a in e.get("authors",[]) if a.get("name")]
        raw     = e.get("id") or e.get("link") or ""
        doi     = getattr(e, "arxiv_doi", None) or extract_doi(e)
        link    = canon_link(raw, feed_url_hint, doi)

        s_key = seen_key(doi, link)
        if s_key in seen:
            continue
        seen.add(s_key)

        item = {
            "journalKey": "arXivCM",
            "journal": "arXiv: cond-mat",
            "journalShort": "arXiv cond-mat",
            "type": "preprint",
            "title": title,
            "authors": authors,
            "date": iso(dt),
            "link": link,
            "arxiv": link if "arxiv.org/abs/" in link else raw,
            "doi": doi,
            "summary": clean_summary(e.get("summary",""))
        }
        push(dt, item)

try:
    r = client.get(ARXIV_COND_MAT_API, headers=UA)
    add_arxiv_from_feed(feedparser.parse(r.text), ARXIV_COND_MAT_API)
except Exception as e:
    log("arXiv API failed:", e)
try:
    add_arxiv_from_feed(fetch_feed(ARXIV_COND_MAT_RSS), ARXIV_COND_MAT_RSS)
except Exception as e:
    log("arXiv RSS fallback failed:", e)

# 3) 窗口过滤（3d→无则14d）
def filter_by_days(pairs, days):
    cutoff = now_utc - timedelta(days=days)
    return [it for dt, it in pairs if dt >= cutoff]

items = filter_by_days(items_raw, PRIMARY_WINDOW_DAYS)
window_days = PRIMARY_WINDOW_DAYS
if not items:
    log(f"no items in {PRIMARY_WINDOW_DAYS}d window, fallback to {FALLBACK_WINDOW_DAYS}d")
    items = filter_by_days(items_raw, FALLBACK_WINDOW_DAYS)
    window_days = FALLBACK_WINDOW_DAYS

items.sort(key=lambda x: x["date"], reverse=True)
out = {"generatedAt": iso(now_utc), "windowDays": window_days, "items": items}
with open("data/articles.json","w",encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

log("done. items =", len(items), "windowDays =", window_days)
