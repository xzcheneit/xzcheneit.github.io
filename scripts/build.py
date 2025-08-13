#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json, re, time, sys, html, urllib.parse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import feedparser, httpx

ASIA_TAIPEI = ZoneInfo("Asia/Taipei")
WINDOW_DAYS = 3

ARXIV_SEARCH_BY_TITLE = "http://export.arxiv.org/api/query?search_query={query}&start=0&max_results=1"
ARXIV_COND_MAT_NEW = "http://export.arxiv.org/api/query?search_query=cat:cond-mat*&sortBy=lastUpdatedDate&sortOrder=descending&start=0&max_results=200"

with open('data/sources.json','r',encoding='utf-8') as f:
    SOURCES = json.load(f)

client = httpx.Client(timeout=25)

def log(*a): print("[build]", *a, file=sys.stderr)

def iso(dt):
    if isinstance(dt, datetime):
        return dt.astimezone(timezone.utc).isoformat()
    return dt

DOI_PAT = re.compile(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.I)
TAG_PAT = re.compile(r"<[^>]+>")  # 粗略去 HTML 标签

def clean_summary(s: str) -> str:
    if not s: return ""
    if isinstance(s, dict): s = s.get('value') or ""
    s = TAG_PAT.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def extract_doi(entry):
    for k in ("prism_doi","doi","dc_identifier","id"):
        v = entry.get(k)
        if isinstance(v,str) and DOI_PAT.search(v):
            return DOI_PAT.search(v).group(0)
    for k in ("summary","summary_detail","content"):
        v = entry.get(k)
        if isinstance(v, dict): v = v.get('value')
        if isinstance(v, list) and v: v = v[0].get('value')
        if isinstance(v, str) and DOI_PAT.search(v):
            return DOI_PAT.search(v).group(0)
    if 'links' in entry:
        for L in entry['links']:
            href = L.get('href','')
            m = DOI_PAT.search(href)
            if m: return m.group(0)
    link = entry.get('link','')
    m = DOI_PAT.search(link)
    return m.group(0) if m else None

def parse_date(entry):
    for k in ('published_parsed','updated_parsed','created_parsed'):
        t = entry.get(k)
        if t:
            return datetime(*t[:6], tzinfo=timezone.utc)
    for k in ('published','updated','created'):
        s = entry.get(k)
        if isinstance(s,str):
            try:
                return datetime.fromisoformat(s.replace('Z','+00:00'))
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
        r = client.get(url, headers={"User-Agent":"physics-feeds/1.0 (GitHub Action)"})
        if r.status_code != 200:
            return None
        text = r.text
        m = re.search(r"<id>(https?://arxiv\.org/abs/[^<]+)</id>", text)
        if m: return html.unescape(m.group(1))
    except Exception as e:
        log("arXiv title search failed:", e)
    return None

def discover_nature_feed(url):
    try:
        r = client.get(url, headers={"User-Agent":"physics-feeds/1.0"})
        r.raise_for_status()
        m = re.search(r'href="(https://www\.nature\.com/[^"]+\.rss[^"]*)"', r.text, re.I)
        if m: return html.unescape(m.group(1))
    except Exception as e:
        log("discover nature feed failed", url, e)
    return None

def discover_iop_feed(url):
    try:
        r = client.get(url, headers={"User-Agent":"physics-feeds/1.0"})
        r.raise_for_status()
        m = re.search(r'href="(https?://[^"]+/rss[^"]*)"', r.text, re.I)
        if m: return html.unescape(m.group(1))
    except Exception as e:
        log("discover iop feed failed", url, e)
    return None

def fetch_feed(url):
    return feedparser.parse(client.get(url, headers={"User-Agent":"physics-feeds/1.0"}).text)

# --------------------- main ---------------------
now_tpe = datetime.now(ASIA_TAIPEI)
cutoff = now_tpe - timedelta(days=WINDOW_DAYS)
cutoff_utc = cutoff.astimezone(timezone.utc)

items = []

# 1) APS / Nature / Science / ACS / IOP
for src in SOURCES:
    key = src['key']
    journal = src['journal']
    log('processing', key)

    feeds = []
    if src.get('recent'): feeds.append(('published', src['recent']))
    if src.get('accepted'): feeds.append(('accepted', src['accepted']))
    if src.get('recentDiscover'):
        if 'nature.com' in src['recentDiscover']:
            real = discover_nature_feed(src['recentDiscover']); 
            if real: feeds.append(('published', real))
        elif 'iopscience' in src['recentDiscover']:
            real = discover_iop_feed(src['recentDiscover']); 
            if real: feeds.append(('published', real))

    for typ, url in feeds:
        try:
            fp = fetch_feed(url)
        except Exception as e:
            log('feed fetch failed', key, url, e)
            continue

        for e in fp.entries[:200]:
            dt = parse_date(e)
            if not dt or dt < cutoff_utc:  # 仅保留最近 WINDOW_DAYS
                continue
            doi = extract_doi(e)
            title = html.unescape(e.get('title','')).strip()

            # authors
            authors = []
            if 'authors' in e and isinstance(e['authors'], list):
                for a in e['authors']:
                    nm = a.get('name') or ((a.get('given','') + ' ' + a.get('family','')).strip())
                    if nm: authors.append(nm)
            elif 'author' in e:
                authors = [e['author']]

            summary = clean_summary(e.get('summary') or (e.get('content',[{}])[0].get('value') if e.get('content') else ""))

            link = e.get('link') or (e['links'][0]['href'] if e.get('links') else '')

            item = {
                'journalKey': key,
                'journal': journal,
                'journalShort': key if key not in ('PRResearch','PRXQ','NatPhys','NatCommun','NanoLett') else {
                    'PRResearch':'PRResearch','PRXQ':'PRX Quantum','NatPhys':'Nat Phys.','NatCommun':'Nat Commun.','NanoLett':'Nano Lett.'
                }[key],
                'type': typ,
                'title': title,
                'authors': authors,
                'date': iso(dt),
                'link': link,
                'doi': doi,
                'summary': summary
            }

            # APS accepted → 尝试查 arXiv
            if typ == 'accepted' and key in {'PRL','PRB','PRE','PRResearch','PRX','PRXQ'}:
                arx = find_arxiv_by_title(title)
                if arx:
                    item['arxiv'] = arx
                    time.sleep(0.25)

            items.append(item)

# 2) arXiv: cond-mat new（同网页列表源）
try:
    r = client.get(ARXIV_COND_MAT_NEW, headers={"User-Agent":"physics-feeds/1.0"})
    feed = feedparser.parse(r.text)
    for e in feed.entries:
        # arXiv API提供 published / updated；我们用 updated
        dt = parse_date({'updated': e.get('updated') or e.get('published')})
        if not dt or dt < cutoff_utc:
            continue

        title = html.unescape(e.get('title','')).strip()
        # 作者
        authors = []
        if 'authors' in e:
            for a in e['authors']:
                nm = a.get('name')
                if nm: authors.append(nm)

        # arXiv abs 链接 & DOI
        abs_url = e.get('id') or e.get('link') or ''
        doi = (getattr(e, 'arxiv_doi', None) or extract_doi(e))
        summary = clean_summary(e.get('summary',''))

        items.append({
            'journalKey': 'arXivCM',
            'journal': 'arXiv: cond-mat',
            'journalShort': 'arXiv cond-mat',
            'type': 'preprint',
            'title': title,
            'authors': authors,
            'date': iso(dt),
            'link': abs_url,
            'arxiv': abs_url,
            'doi': doi,
            'summary': summary
        })
except Exception as e:
    log("arXiv cond-mat fetch failed:", e)

# 排序
items.sort(key=lambda x: x['date'], reverse=True)

out = {
    'generatedAt': iso(datetime.now(timezone.utc)),
    'windowDays': WINDOW_DAYS,
    'items': items,
}

with open('data/articles.json','w',encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

log('done. items =', len(items))
