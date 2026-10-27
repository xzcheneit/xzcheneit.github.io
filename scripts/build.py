#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Physics Feeds build script
- Fetch RSS/Atom feeds from data/sources.json
- Normalize fields and deduplicate
- Output: data/articles.json (includes sources meta + build report)
"""

import json, re, time, sys, html, urllib.parse, os
import tempfile
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urljoin
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import feedparser
import httpx

ASIA_TAIPEI = ZoneInfo("Asia/Taipei")
ROOT = Path(__file__).resolve().parents[1]

# Output window (the frontend can further filter, but we always provide up to this many days)
OUTPUT_WINDOW_DAYS = 14

ARXIV_SEARCH_BY_TITLE = (
    "https://export.arxiv.org/api/query?search_query={query}&start=0&max_results=1"
)
ARXIV_COND_MAT_API = (
    "https://export.arxiv.org/api/query?"
    "search_query=cat:cond-mat*&sortBy=lastUpdatedDate&sortOrder=descending&start=0&max_results=200"
)
ARXIV_COND_MAT_RSS = "https://rss.arxiv.org/rss/cond-mat"

with open(ROOT / "data/sources.json", "r", encoding="utf-8") as f:
    SOURCES = json.load(f)

UA = {"User-Agent": "physics-feeds/1.2 (+github actions)"}
client = httpx.Client(timeout=30, follow_redirects=True)

def log(*a): print("[build]", *a, file=sys.stderr)
def iso(dt): return dt.astimezone(timezone.utc).isoformat() if isinstance(dt, datetime) else dt

def atomic_json_write(path, value):
    """Publish complete JSON only, so an interrupted run keeps the previous data."""
    path = Path(path)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=f".{path.name}.", suffix=".tmp", delete=False) as f:
            temp_path = f.name
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(temp_path, path)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)

DOI_PAT   = re.compile(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.I)
ARXIV_NUM = re.compile(r"(\d{4}\.\d{4,5})(?:v\d+)?", re.I)  # 2408.01234
TAG_PAT   = re.compile(r"</?[A-Za-z][^>]*>")
DATE_KEYS = ["dc_date","date","prism_publicationdate","prism_publicationDate","issued","dc_issued"]

APS_CIT_PAT = re.compile(r"\[([^\]]+)\]\s*(?:Published|Accepted|Updated)\b.*$", re.I)

# ---------------- helpers ----------------
def plain_text(raw):
    return re.sub(r"\s+", " ", html.unescape(TAG_PAT.sub(" ", raw or ""))).strip()

def ensure_https(u: str):
    if not u: return u
    if u.startswith("//"):      return "https:" + u
    if u.startswith("http://"): return "https://" + u[7:]
    return u

def normalize_arxiv_abs(raw: str):
    """Normalize various arXiv forms to https://arxiv.org/abs/xxxx"""
    if not raw: return ""
    raw = ensure_https(raw) or ""
    if "arxiv.org/abs/" in raw:
        return raw
    m = ARXIV_NUM.search(raw)  # may be pdf or bare id
    if m:
        return f"https://arxiv.org/abs/{m.group(1)}"
    return raw

def parse_author_string(s: str):
    """
    APS RSS sometimes provides a single author string like:
      "A, B, and C"
    Convert it to ["A","B","C"].
    """
    s = (s or "").strip()
    if not s: return []
    # Normalize separators
    s = re.sub(r"\s+and\s+", ", ", s, flags=re.I)
    s = s.replace(", and ", ", ")
    parts = [p.strip() for p in s.split(",") if p.strip()]
    # Remove trailing 'and' leftovers
    parts = [re.sub(r"^and\s+", "", p, flags=re.I).strip() for p in parts]
    return [p for p in parts if p]

def normalize_authors(authors, src_key):
    authors = [plain_text(name) for name in authors if name]
    # APS puts a whole natural-language author list in one Atom author element.
    # Requiring a conjunction avoids splitting names formatted as "family, given".
    if (src_key.startswith("PR") or src_key == "RMP") and len(authors) == 1:
        if re.search(r"\s+and\s+", authors[0], re.I):
            return parse_author_string(authors[0])
    return authors

def _strip_authors_prefix(text, authors):
    s = text.lstrip()
    if not re.match(r'^(?:authors?|author\(s\))\s*:', s, re.I):
        return text
    last_end = -1
    low = s.lower()
    for name in (authors or []):
        nm = (name or "").strip()
        if not nm: continue
        pos = low.find(nm.lower())
        if 0 <= pos < 300:
            last_end = max(last_end, pos + len(nm))
    if last_end > 0:
        rest = s[last_end:]
        rest = re.sub(r'^[\s,.;:–—-]*(?:and)?\s*', '', rest, flags=re.I)
        return rest
    m = re.search(r'\.\s+| {2,}', s)
    return s[m.end():] if m else s

def extract_aps_citation(raw_summary: str):
    """
    APS feeds often append: "... [Phys. Rev. Lett. 136, 031001] Published Wed Jan 21, 2026"
    Return (journal, volume, pages, citation_text) if possible.
    """
    if not raw_summary: 
        return (None, None, None, None)
    # Grab the last bracketed citation (if present)
    m = re.search(r"\[([^\]]+)\]", raw_summary)
    if not m: 
        return (None, None, None, None)
    cit = m.group(1).strip()
    # Try parse: "<journal> <volume>, <pages>"
    m2 = re.match(r"^(.*?)(\d+)\s*,\s*([A-Za-z0-9]+)\s*$", cit)
    if m2:
        j = m2.group(1).strip()
        vol = m2.group(2).strip()
        pages = m2.group(3).strip()
        return (j, vol, pages, cit)
    return (None, None, None, cit)

def clean_summary(raw, authors=None, src_key=""):
    """
    Normalize abstracts:
    - remove arXiv header
    - strip HTML
    - strip 'Author(s): ...'
    - strip leading DOI
    - strip APS trailing citation + Published/Accepted stamps
    """
    s = raw or ""
    if isinstance(s, dict): s = s.get("value") or ""
    if isinstance(s, list) and s: s = s[0].get("value") or ""

    s = re.sub(
        r'^\s*arXiv:\d{4}\.\d{4,5}(?:v\d+)?(?:\s+\[[^\]]+\])?'
        r'(?:\s+Announce Type:\s*\w+)?(?:\s*New)?\s*(?:Abstract:)?\s*',
        '',
        s, flags=re.I
    )

    # Strip HTML tags and compress whitespace
    s = TAG_PAT.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()

    # Strip APS suffix like: "[... ] Published ..."
    s = APS_CIT_PAT.sub("", s).strip()

    # Strip 'Author(s): ...' prefix
    s = _strip_authors_prefix(s, authors or [])

    # Leading DOI
    s = re.sub(r'^\s*DOI:\s*\S+\s*', '', s, flags=re.I)

    # If it still ends with a bare bracketed citation, remove it
    s = re.sub(r'\s*\[[^]]+\]\s*$', '', s).strip()

    return s

def extract_doi(entry):
    for k in ("prism_doi","doi","dc_identifier","id"):
        v = entry.get(k)
        if isinstance(v, str):
            m = DOI_PAT.search(v)
            if m: return m.group(0)
    for k in ("summary","summary_detail","content"):
        v = entry.get(k)
        if isinstance(v, dict): v = v.get("value")
        if isinstance(v, list) and v: v = v[0].get("value")
        if isinstance(v, str):
            m = DOI_PAT.search(v)
            if m: return m.group(0)
    for L in entry.get("links", []):
        href = (L.get("href", "") or "")
        m = DOI_PAT.search(href)
        if m: return m.group(0)
    link = entry.get("link", "") or ""
    m = DOI_PAT.search(link)
    return m.group(0) if m else None

def parse_date(entry):
    for k in ("updated_parsed","published_parsed","created_parsed"):
        t = entry.get(k)
        if t: return datetime(*t[:6], tzinfo=timezone.utc)
    for k in ("updated","published","created"):
        s = entry.get(k)
        if isinstance(s,str):
            try:
                dt = datetime.fromisoformat(s.replace("Z","+00:00"))
                return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
            except Exception: pass
    for k in DATE_KEYS:
        v = entry.get(k)
        if isinstance(v, dict): v = v.get("value")
        if isinstance(v, list) and v: v = v[0].get("value")
        if isinstance(v, str):
            try:
                if len(v) == 10:  # YYYY-MM-DD
                    return datetime.fromisoformat(v + "T00:00:00+00:00")
                dt = datetime.fromisoformat(v.replace("Z","+00:00"))
                return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
            except Exception:
                pass
    return None

# ---- arXiv title matching cache (reduces API calls) ----
ARX_CACHE_PATH = ROOT / "data/arxiv_cache.json"
def load_arxiv_cache():
    try:
        with open(ARX_CACHE_PATH, "r", encoding="utf-8") as f:
            d = json.load(f)
            if not isinstance(d, dict):
                return {}
            normalized = {}
            for key, value in d.items():
                clean_key = plain_text(key).lower()
                if clean_key not in normalized or value:
                    normalized[clean_key] = value
            return normalized
    except Exception:
        return {}

def save_arxiv_cache(d):
    try:
        atomic_json_write(ARX_CACHE_PATH, d)
    except Exception as e:
        log("save arxiv_cache failed:", e)

_ARX_CACHE = load_arxiv_cache()
_ARX_SEARCH_FAILURES = 0

def find_arxiv_by_title(title):
    global _ARX_SEARCH_FAILURES
    title = plain_text(title)
    if len(title) < 8: return None
    key = title.lower()
    cached = _ARX_CACHE.get(key)
    if isinstance(cached, str) and cached:
        return cached
    if isinstance(cached, dict):
        checked = parse_date({"published": cached.get("checkedAt")})
        if checked and datetime.now(timezone.utc) - checked < timedelta(days=7):
            return cached.get("url") or None
    if _ARX_SEARCH_FAILURES >= 3:
        return None  # An optional lookup outage must not delay hundreds of articles.

    q = f'ti:"{title}"'
    url = ARXIV_SEARCH_BY_TITLE.format(query=urllib.parse.quote(q))
    found = None
    try:
        time.sleep(3)  # arXiv asks for at least three seconds between API requests.
        r = client.get(url, headers=UA)
        r.raise_for_status()
        fp = feedparser.parse(r.content)
        if not getattr(fp, "version", "") or getattr(fp, "bozo", False):
            raise ValueError("Invalid arXiv search feed")
        _ARX_SEARCH_FAILURES = 0
        for entry in fp.entries:
            candidate = entry.get("id", "")
            if candidate.startswith(("http://arxiv.org/abs/", "https://arxiv.org/abs/")):
                found = ensure_https(candidate)
                break
    except Exception as e:
        _ARX_SEARCH_FAILURES += 1
        log("arXiv title search failed:", e)
        return None  # A temporary failure must not become a permanent negative cache hit.

    _ARX_CACHE[key] = found or {"url": "", "checkedAt": iso(datetime.now(timezone.utc))}
    return found

def discover_feed_from_html(url, host_hint=""):
    """
    Best-effort: discover RSS/Atom link from a journal landing page.
    Some sites block bots; we treat this as optional.
    """
    try:
        r = client.get(url, headers=UA); r.raise_for_status()
        class FeedLinks(HTMLParser):
            href = None

            def handle_starttag(self, tag, attrs):
                values = dict(attrs)
                if (tag == "link" and "alternate" in (values.get("rel") or "").lower().split()
                        and (values.get("type") or "").lower() in ("application/rss+xml", "application/atom+xml")
                        and values.get("href") and self.href is None):
                    self.href = values["href"]

        links = FeedLinks()
        links.feed(r.text)
        if links.href:
            return urljoin(str(r.url), links.href)
        # Nature sometimes embeds .rss links
        if "nature.com" in (host_hint or url):
            m = re.search(r'href="(https://www\.nature\.com/[^"]+\.rss[^"]*)"', r.text, re.I)
            if m: return html.unescape(m.group(1))
        # IOPscience sometimes provides /rss endpoints, but page discovery might fail
        if "iopscience" in (host_hint or url):
            m = re.search(r'href="(https?://[^"]+/rss[^"]*)"', r.text, re.I)
            if m: return html.unescape(m.group(1))
    except Exception as e:
        log("discover feed failed", url, e)
    return None

def fetch_feed_with_report(feed_url):
    """
    Fetch url with httpx then parse with feedparser.
    Returns (feedparser_obj, report_dict)
    """
    rep = {
        "url": feed_url,
        "ok": False,
        "status": None,
        "contentType": None,
        "entries": 0,
        "bozo": False,
        "error": ""
    }
    try:
        r = client.get(feed_url, headers=UA)
        rep["status"] = r.status_code
        rep["contentType"] = r.headers.get("content-type", "")
        fp = feedparser.parse(r.content)
        rep["bozo"] = bool(getattr(fp, "bozo", False))
        rep["entries"] = len(getattr(fp, "entries", []) or [])
        dates = [date for entry in fp.entries if (date := parse_date(entry))]
        rep["latestArticleAt"] = iso(max(dates)) if dates else None
        rep["ok"] = (r.status_code == 200 and rep["entries"] > 0)
        if not rep["ok"]:
            if r.status_code != 200:
                rep["error"] = f"HTTP {r.status_code}"
            elif not getattr(fp, "version", ""):
                rep["error"] = "HTTP 200 response is not a recognized RSS/Atom feed"
            else:
                rep["error"] = "HTTP 200 feed contained no entries"
        return fp, rep
    except Exception as e:
        rep["error"] = str(e)
        return feedparser.FeedParserDict(entries=[]), rep

def canon_link(raw_link, feed_url, doi):
    if raw_link and re.match(r"^https?://", raw_link): return raw_link
    if raw_link and raw_link.startswith("//"):         return "https:" + raw_link
    if raw_link:
        return urljoin(feed_url, raw_link)
    if doi: return "https://doi.org/" + doi
    return ""

def seen_key(doi, link):
    if doi: return ("doi", doi.lower())
    m = ARXIV_NUM.search(link or "")
    if m:  return ("arxiv", m.group(1).lower())
    return ("link", (link or "").lower())

def feed_urls(value):
    """A source may combine official online-first and current-issue feeds."""
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        return list(dict.fromkeys(url for url in value if isinstance(url, str) and url))
    return []

# ---------- Color palette (light bg + dark fg) ----------
DEFAULT_TONES = [
    {"bg":"#fde2e4","fg":"#9f1d2d"},
    {"bg":"#e0f2fe","fg":"#0b4f71"},
    {"bg":"#dcfce7","fg":"#166534"},
    {"bg":"#ede9fe","fg":"#5b21b6"},
    {"bg":"#fff7ed","fg":"#9a3412"},
    {"bg":"#e0e7ff","fg":"#3730a3"},
    {"bg":"#f0fdf4","fg":"#166534"},
    {"bg":"#faf5ff","fg":"#7e22ce"},
    {"bg":"#ecfeff","fg":"#155e75"},
    {"bg":"#fdf2f8","fg":"#9d174d"},
    {"bg":"#fefce8","fg":"#854d0e"},
    {"bg":"#fee2e2","fg":"#991b1b"},
    {"bg":"#eef2ff","fg":"#3730a3"},
    {"bg":"#f0f9ff","fg":"#075985"},
    {"bg":"#fffbeb","fg":"#92400e"},
    {"bg":"#f5f3ff","fg":"#4c1d95"},
    {"bg":"#ecfccb","fg":"#3f6212"},
    {"bg":"#fef2f2","fg":"#9f1239"},
    {"bg":"#e6fffb","fg":"#0e7490"},
    {"bg":"#f1f5f9","fg":"#0f172a"},
]

def tone_for_index(i):
    t = DEFAULT_TONES[i % len(DEFAULT_TONES)]
    return (t["bg"], t["fg"])

def retain_failed_source_items(previous_items, reports, cutoff, seen):
    """Keep old articles when a source or a complementary issue/ASAP feed fails."""
    attempts = {}
    for report in reports:
        pair = (report["key"], report["type"])
        attempts.setdefault(pair, []).append(report)
    failed = {pair for pair, rows in attempts.items()
              if not any(row["ok"] for row in rows)
              or any(not row["ok"] and row.get("origin") in ("recent", "accepted") for row in rows)}
    retained = []
    counts = {}
    for previous in previous_items:
        pair = (previous.get("journalKey"), previous.get("type"))
        if pair not in failed:
            continue
        dt = parse_date({"published": previous.get("date")})
        if not dt or dt < cutoff:
            continue
        key = seen_key(previous.get("doi"), previous.get("link"))
        if key in seen:
            continue
        item = dict(previous)
        item["title"] = plain_text(item.get("title", ""))
        item["authors"] = normalize_authors(item.get("authors", []), item.get("journalKey", ""))
        item["date"] = iso(dt)
        retained.append((dt, item))
        seen.add(key)
        counts[pair] = counts.get(pair, 0) + 1
    for pair, count in counts.items():
        for report in attempts[pair]:
            report["retainedItems"] = count
    return retained


def main(sources=None, output_path=None, now=None, lookup_arxiv=True):
    global _ARX_SEARCH_FAILURES
    _ARX_SEARCH_FAILURES = 0
    sources = SOURCES if sources is None else sources
    output_path = Path(output_path) if output_path is not None else ROOT / "data/articles.json"
    now_utc = (now or datetime.now(ASIA_TAIPEI)).astimezone(timezone.utc)
    cutoff = now_utc - timedelta(days=OUTPUT_WINDOW_DAYS)
    items_raw = []
    seen = set()
    build_report = {"generatedAt": iso(now_utc), "windowDays": OUTPUT_WINDOW_DAYS, "sources": []}
    try:
        with output_path.open(encoding="utf-8") as f:
            previous_items = json.load(f).get("items", [])
    except (OSError, ValueError, AttributeError):
        previous_items = []

    # ---------- Build sources meta (single source of truth) ----------
    sources_meta = []
    for i, src in enumerate(sources):
        bg = src.get("bg") or src.get("color") or src.get("toneBg")
        fg = src.get("fg") or src.get("toneFg")
        if not (bg and fg):
            bg2, fg2 = tone_for_index(i)
            bg = bg or bg2
            fg = fg or fg2
        sources_meta.append({
            "key": src["key"],
            "journal": src.get("journal", src["key"]),
            "short": src.get("short", src["key"]),
            "bg": bg,
            "fg": fg
        })

    # arXiv meta (not in sources.json)
    sources_meta.append({
        "key": "arXivCM",
        "journal": "arXiv: cond-mat",
        "short": "arXiv cond-mat",
        "bg": "#e6fffb",
        "fg": "#0e7490"
    })

    # ---------- 1) sources.json feeds ----------
    for src in sources:
        key, journal = src["key"], src.get("journal", src["key"])
        feeds = []

        feeds.extend(("published", url, "recent") for url in feed_urls(src.get("recent")))
        feeds.extend(("accepted", url, "accepted") for url in feed_urls(src.get("accepted")))

        prefetched = {}
        # Some legacy "recentDiscover" URLs already return RSS. Try them directly first.
        if src.get("recentDiscover"):
            direct_url = src["recentDiscover"]
            direct_fp, direct_rep = fetch_feed_with_report(direct_url)
            if direct_rep["ok"]:
                feeds.append(("published", direct_url, "direct"))
                prefetched[direct_url] = (direct_fp, direct_rep)
            else:
                direct_rep.update({"key": key, "journal": journal, "type": "published", "origin": "direct"})
                build_report["sources"].append(direct_rep)
                found = discover_feed_from_html(direct_url, direct_url)
                if found:
                    feeds.append(("published", found, "discover"))

        for typ, feed_url, origin in feeds:
            fp, rep = prefetched[feed_url] if feed_url in prefetched else fetch_feed_with_report(feed_url)
            rep.update({"key": key, "journal": journal, "type": typ, "origin": origin})
            build_report["sources"].append(rep)
            log(key, typ, origin, "HTTP", rep["status"], "entries", rep["entries"])

            if not rep["ok"]:
                continue

            fallback_idx = 0
            for e in (fp.entries or [])[:200]:
                dt = parse_date(e)
                if not dt:
                    dt = now_utc - timedelta(hours=fallback_idx); fallback_idx += 1

                # Early cut: we only keep last OUTPUT_WINDOW_DAYS
                if dt < cutoff:
                    continue

                doi = extract_doi(e)
                raw = e.get("link") or (e.get("links",[{}])[0].get("href") if e.get("links") else "")
                link = canon_link(raw, feed_url, doi)
                link = ensure_https(link)

                title = plain_text(e.get("title", ""))
                if not title or not link:
                    continue
                sk = seen_key(doi, link)
                if sk in seen:
                    continue
                seen.add(sk)

                # authors
                authors = []
                if isinstance(e.get("authors"), list):
                    for a in e["authors"]:
                        nm = a.get("name") or ((a.get("given","")+" "+a.get("family","")).strip())
                        if nm: authors.append(nm)
                elif e.get("author"):
                    authors = [e.get("author")]
                authors = normalize_authors(authors, key)

                raw_summary = e.get("summary") or (e.get("content",[{}])[0].get("value") if e.get("content") else "")

                # APS citation extraction (helps BibTeX later)
                cit_j, cit_vol, cit_pages, cit_text = extract_aps_citation(raw_summary)

                summary = clean_summary(raw_summary, authors, key)

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
                    "summary": summary,
                }

                # Optional structured fields (best-effort)
                if cit_j and not item.get("journal"):
                    item["journal"] = cit_j
                if cit_vol: item["volume"] = cit_vol
                if cit_pages: item["pages"] = cit_pages
                if cit_text: item["citation"] = cit_text

                # Publisher (APS)
                if key.startswith("PR") or key == "RMP":
                    item["publisher"] = "American Physical Society"

                # APS accepted → try arXiv match (only for items within window)
                if typ == "accepted" and (key.startswith("PR") or key == "RMP"):
                    cached = _ARX_CACHE.get(title.lower())
                    arx = find_arxiv_by_title(title) if lookup_arxiv else (cached if isinstance(cached, str) else (cached or {}).get("url"))
                    if arx:
                        item["arxiv"] = normalize_arxiv_abs(arx)

                items_raw.append((dt, item))

    # ---------- 2) arXiv cond-mat (API + RSS fallback) ----------
    def add_arxiv_from_feed(fp):
        for e in (fp.entries or []):
            dt = parse_date(e) or now_utc
            if dt < cutoff:
                continue

            title = plain_text(e.get("title", ""))
            authors = [a.get("name") for a in e.get("authors", []) if a.get("name")]

            raw = e.get("id") or e.get("link") or ""
            doi = getattr(e, "arxiv_doi", None) or extract_doi(e)

            abs_url = normalize_arxiv_abs(raw)
            link = abs_url or canon_link(raw, ARXIV_COND_MAT_RSS, doi)
            if not title or not link:
                continue

            sk = seen_key(doi, link)
            if sk in seen:
                continue
            seen.add(sk)

            summary = clean_summary(e.get("summary",""), authors, "arXivCM")

            items_raw.append((dt, {
                "journalKey": "arXivCM",
                "journal": "arXiv: cond-mat",
                "journalShort": "arXiv cond-mat",
                "type": "preprint",
                "title": title,
                "authors": authors,
                "date": iso(dt),
                "link": link,
                "arxiv": abs_url or link,
                "doi": doi,
                "summary": summary
            }))

    fp, rep = fetch_feed_with_report(ARXIV_COND_MAT_API)
    rep.update({"key":"arXivCM", "journal":"arXiv: cond-mat", "type":"preprint", "origin":"api"})
    build_report["sources"].append(rep)
    if rep["ok"]:
        add_arxiv_from_feed(fp)

    try:
        fp, rep = fetch_feed_with_report(ARXIV_COND_MAT_RSS)
        rep.update({"key":"arXivCM", "journal":"arXiv: cond-mat", "type":"preprint", "origin":"rss"})
        build_report["sources"].append(rep)
        if rep["ok"]:
            add_arxiv_from_feed(fp)
    except Exception as e:
        build_report["sources"].append({
            "key":"arXivCM", "journal":"arXiv: cond-mat", "type":"preprint", "origin":"rss",
            "url": ARXIV_COND_MAT_RSS, "ok": False, "status": None, "contentType": None,
            "entries": 0, "bozo": False, "error": str(e)
        })
        log("arXiv RSS failed:", e)

    # ---------- Finalize ----------
    if not any(report["ok"] for report in build_report["sources"]):
        raise RuntimeError("All feeds failed; keeping the previous articles.json")
    retained = retain_failed_source_items(previous_items, build_report["sources"], cutoff, seen)
    items_raw.extend(retained)
    build_report["retainedItems"] = len(retained)
    items = [it for _, it in items_raw]
    items.sort(key=lambda x: x.get("date",""), reverse=True)

    # coverage
    dates = [datetime.fromisoformat(it["date"].replace("Z","+00:00")) for it in items if it.get("date")]
    coverage = {
        "latest": iso(max(dates)) if dates else iso(now_utc),
        "earliest": iso(min(dates)) if dates else iso(now_utc),
        "count": len(items)
    }

    out = {
        "generatedAt": iso(now_utc),
        "windowDays": OUTPUT_WINDOW_DAYS,
        "coverage": coverage,
        "sources": sources_meta,
        "buildReport": build_report,
        "items": items
    }

    if not items:
        raise RuntimeError("No usable recent articles; keeping the previous articles.json")
    atomic_json_write(output_path, out)

    if lookup_arxiv:
        save_arxiv_cache(_ARX_CACHE)

    log("done. items =", len(items), "windowDays =", OUTPUT_WINDOW_DAYS)

    return out


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-arxiv-title-search", action="store_true",
                        help="Refresh feeds using cached arXiv matches without optional per-title API queries")
    args = parser.parse_args()
    try:
        main(lookup_arxiv=not args.skip_arxiv_title_search)
    finally:
        client.close()
