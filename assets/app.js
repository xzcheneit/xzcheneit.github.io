import { renderScientificText, scientificPlainText, scientificSearchText, splitScientificText } from './scientific-text.mjs';

/* ---------- DOM helpers ---------- */
const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];
const isAbs = u => /^https?:\/\//i.test(u||"");
const esc = (s)=> String(s??'').replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));

// RSS titles can contain markup. Parse in an inert template, then keep text only.
function feedText(value){
  const text = String(value ?? '');
  if(!/[<&]/.test(text)) return text.trim();
  const math=[];
  const html=splitScientificText(text,{prepare:false}).map(token=>{
    if(token.type!=='math') return token.value;
    math.push(token.raw);
    return `\uE000SCIMATH${math.length-1}\uE001`;
  }).join('');
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script, style').forEach(el=>el.remove());
  return (tpl.content.textContent || '').replace(/\uE000SCIMATH(\d+)\uE001/g,(_,index)=>math[index]??'').replace(/\s+/g,' ').trim();
}
function itemUID(item){
  return `${item.journalKey||''}|${item.doi?.toLowerCase() || item.arxiv || item.link || item.title || ''}`;
}
function canonicalUid(uid){
  // Migrate the former journal|identifier|date keys without losing local notes.
  return String(uid||'').replace(/\|\d{4}-\d{2}-\d{2}(?:T[^|]*)?$/, '').replace(/\|(10\.[^|]+)$/,(_,doi)=>'|'+doi.toLowerCase());
}

// Cache strings so rendering cards never reparses or reads storage per card.
const Storage = {
  cache: new Map(), warned: false,
  get(key){
    if(this.cache.has(key)) return this.cache.get(key);
    let value = null;
    try{ value = localStorage.getItem(key); }catch{ this.warn(); }
    this.cache.set(key, value);
    return value;
  },
  set(key, value){
    this.cache.set(key, value);
    try{ localStorage.setItem(key, value); }catch{ this.warn(); }
  },
  warn(){
    if(this.warned) return;
    this.warned = true;
    setTimeout(()=>showToast('浏览器存储不可用：本次更改仅在当前页面保留，请及时复制备份。'), 0);
  }
};

function showToast(msg){
  const el = $("#toast"); if(!el) return;
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> el.classList.remove("on"), 1600);
}

/* ---------- Storage ---------- */
const FavStore = {
  key: 'pj_favs_v2',
  _parse(raw){
    try{
      const v=JSON.parse(raw||'[]');
      const unique=new Map();
      for(const item of Array.isArray(v)?v:[]){
        if(!item || typeof item!=='object') continue;
        const uid=canonicalUid(item.uid||itemUID(item));
        const previous=unique.get(uid);
        if(!previous || Date.parse(item.date)>=Date.parse(previous.date)) unique.set(uid,{...item,uid});
      }
      return [...unique.values()];
    }catch{return [];}
  },
  minify(item){
    const uid = canonicalUid(item.uid || itemUID(item));
    return {
      uid,
      title: feedText(item.title),
      authors: Array.isArray(item.authors)? item.authors.slice(0) : [],
      date: item.date||'',
      journalKey: item.journalKey||'',
      journalShort: item.journalShort||item.journalKey||'',
      journal: item.journal||'',
      type: item.type||'',
      link: item.link||'',
      arxiv: item.arxiv||'',
      doi: item.doi||'',
      summary: feedText(item.summary),
      volume: item.volume||'',
      issue: item.issue||'',
      pages: item.pages||'',
      publisher: item.publisher||'',
      year: item.year||'',
      numpages: item.numpages||''
    };
  },
  load(){
    const raw = Storage.get(this.key);
    if(raw !== this._raw){ this._raw=raw; this._list=this._parse(raw); }
    return this._list || [];
  },
  save(list){ this._list=list||[]; this._raw=JSON.stringify(this._list); Storage.set(this.key, this._raw); },
  has(uid){ return this.load().some(x=>x.uid===uid); },
  add(item){
    const list=this.load();
    const m=this.minify(item);
    if(!list.some(x=>x.uid===m.uid)){ list.push(m); this.save(list); }
    return list.length;
  },
  remove(uid){
    const list=this.load().filter(x=>x.uid!==uid);
    this.save(list); return list.length;
  },
  clear(){ this.save([]); return 0; }
};

const PrefStore = {
  key: 'pj_prefs_v1',
  defaults: { keywords: [], highlight: true, highlightSummary: true },
  load(){
    try{
      const v = JSON.parse(Storage.get(this.key)||'{}');
      return {...this.defaults, ...(v||{}), keywords:normalizeKeywords(Array.isArray(v?.keywords)?v.keywords:[])};
    }catch{
      return {...this.defaults};
    }
  },
  save(p){ Storage.set(this.key, JSON.stringify(p||this.defaults)); }
};

const UserStore = {
  key: 'pj_user_v1',
  _loadAll(){
    if(this._all) return this._all;
    try{
      const v = JSON.parse(Storage.get(this.key)||'{}');
      const items = Object.create(null);
      for(const [key, value] of Object.entries(v?.items || {})){
        if(!value || typeof value!=='object') continue;
        const uid = canonicalUid(key);
        if(!items[uid]) items[uid]=value;
        else{
          const [older,newer]=(value.updatedAt||0)>=(items[uid].updatedAt||0)?[items[uid],value]:[value,items[uid]];
          const notes=[newer.note,older.note].filter(note=>typeof note==='string' && note.trim());
          items[uid]={...older,...newer,status:newer.status||older.status||'',note:[...new Set(notes)].join('\n\n'),item:newer.item||older.item};
        }
      }
      this._all = {items};
    }catch{ this._all = {items:Object.create(null)}; }
    return this._all;
  },
  _saveAll(v){ this._all=v; Storage.set(this.key, JSON.stringify(v||{items:{}})); },
  get(uid){
    const all=this._loadAll();
    return all.items?.[canonicalUid(uid)] || { status:"", note:"", updatedAt:0 };
  },
  set(uid, patch, item){
    uid=canonicalUid(uid);
    const all=this._loadAll();
    const cur = all.items?.[uid] || { status:"", note:"", updatedAt:0 };
    if(Object.keys(patch).every(key=>key==='item' || patch[key]===cur[key])) return false;
    all.items = all.items || {};
    all.items[uid] = { ...cur, ...patch, ...((item||patch.item)?{item:FavStore.minify(item||patch.item)}:{}), updatedAt: Date.now() };
    this._saveAll(all);
    return true;
  },
  listUpdatedSince(ts){
    const all=this._loadAll();
    const out=[];
    for(const [uid,v] of Object.entries(all.items||{})){
      if((v?.updatedAt||0) >= ts) out.push({uid, ...v});
    }
    out.sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0));
    return out;
  }
};

const VisitStore = {
  key: 'pj_last_visit_ts',
  get(){ return Number(Storage.get(this.key)||'0')||0; },
  set(ts){ Storage.set(this.key, String(ts||Date.now())); }
};

function updateFavCount(){
  const favs = new Set(FavStore.load().map(it=>it.uid));
  const n = favs.size;
  $("#fav-count") && ($("#fav-count").textContent = n);
  $$('.star[data-uid]').forEach(star=>{
    const on=favs.has(star.dataset.uid);
    star.classList.toggle('on',on);
    star.textContent=on?'★':'☆';
    star.setAttribute('aria-pressed',String(on));
    star.setAttribute('aria-label',on?'移出收藏':'加入收藏');
    star.title=on?'移出收藏':'加入收藏';
  });
}

/* ---------- Data state ---------- */
let ALL_ITEMS = [];
let ITEM_BY_UID = new Map();
let SOURCES_META = [];
let SOURCE_MAP = new Map();
let BUILD_REPORT = null;
let SERVER_WINDOW = 14;
let LAST_VISIT_TS = 0;
let SEEN_BEFORE = null;
let INITIALIZED = false;
let FILTERED_ITEMS = [];
let SHOWN = 0;
const PAGE_SIZE = 30;
let LOADING = false;

/* ---------- Text helpers ---------- */
function fmtAuthorsList(authors, journalKey=''){
  if(!Array.isArray(authors)) return [];
  const list = authors.filter(Boolean).map(a => feedText(typeof a === 'string' ? a : (a.name || `${a.given||''} ${a.family||''}`.trim())));
  // APS supplies a prose author list in one string; leave "Family, Given" intact.
  if((journalKey.startsWith('PR') || journalKey==='RMP') && list.length===1 && /\s+and\s+/i.test(list[0])) return list[0].split(/,?\s+and\s+|,\s*/i).filter(Boolean);
  return list;
}
function authorsCondensed(authors, journalKey){
  const list = fmtAuthorsList(authors,journalKey);
  const n = list.length;
  if(n === 0) return '';
  if(n <= 3) return list.join(', ');
  return `${list[0]} … ${list[n-1]}（共 ${n} 人）`;
}
function formatDate(iso){
  if(!iso) return "";
  const d = new Date(iso);
  if(!Number.isFinite(d.getTime())) return '';
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function formatDay(iso){
  if(!iso) return "";
  const d = new Date(iso);
  if(!Number.isFinite(d.getTime())) return '';
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function withinDays(iso, days){
  const dt = Date.parse(iso);
  if(!Number.isFinite(dt)) return false;
  if(days==='all') return true;
  const age = (Date.now()-dt)/86400000;
  return age >= -1 && age <= Number(days);
}
function filterByQuery(items, q){
  if(!q) return items;
  const query = scientificSearchText(q);
  return items.filter(item => itemTextForMatch(item).includes(query) || (item.journal||'').toLowerCase().includes(query));
}

/* ---------- Keywords ---------- */
function normalizeKeywords(list){
  return [...new Map((Array.isArray(list)?list:[])
    .map(s=>String(s||'').trim())
    .filter(Boolean).map(s=>[s.toLowerCase(),s])).values()];
}
const searchTextCache = new WeakMap();
function itemTextForMatch(it){
  if(searchTextCache.has(it)) return searchTextCache.get(it);
  const raw = `${it.title||''}\n${fmtAuthorsList(it.authors,it.journalKey).join(' ')}\n${it.summary||''}\n${it.doi||''}`;
  const text = raw.toLowerCase() + '\n' + scientificSearchText(raw);
  searchTextCache.set(it,text);
  return text;
}
function keywordHits(it, keywords){
  const s = itemTextForMatch(it);
  const hits = [];
  for(const kw of keywords){
    if(!kw) continue;
    if(s.includes(scientificSearchText(kw))) hits.push(kw);
  }
  return hits;
}
/* ---------- Links ---------- */
const bestLink = (it)=>{
  if (isAbs(it.arxiv)) return it.arxiv;
  if (isAbs(it.link))  return it.link;
  if (it.doi)          return `https://doi.org/${it.doi}`;
  return '#';
};

/* ---------- BibTeX (APS-like) ---------- */
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function bibSanitize(s, markup=true){
  const text=(markup?feedText(s):String(s??'')).replace(/\s+/g,' ').trim();
  // Preserve source mathematics, but escape punctuation in ordinary prose.
  return text.split(/(\$[^$]*\$|\\\([\s\S]*?\\\))/g).map((part,i)=>i%2?part:part.replace(/(?<!\\)[&%#_{}]/g,ch=>'\\'+ch)).join('');
}

function bibKeyFor(it){
  // Prefer DOI suffix (APS new DOIs are short like ys32-853g)
  if(it.doi){
    const suf = it.doi.split('/').pop() || it.doi;
    return suf.replace(/[^A-Za-z0-9]+/g,'-');
  }
  // arXiv id
  if(it.arxiv){
    const m = /arxiv\.org\/abs\/(\d{4}\.\d{4,5})/i.exec(it.arxiv);
    if(m) return `arxiv-${m[1].replace('.','_')}`;
  }
  // fallback: surname+year+short
  const a0 = fmtAuthorsList(it.authors,it.journalKey)[0] || "anon";
  const surname = (String(a0).includes(',') ? String(a0).split(',')[0] : String(a0).trim().split(/\s+/).slice(-1)[0] || "anon")
    .replace(/[^A-Za-z0-9]+/g,'');
  const year = it.year || (it.date ? new Date(it.date).getUTCFullYear() : "");
  const sh = (it.journalShort||it.journalKey||'J').replace(/[^A-Za-z0-9]+/g,'');
  return `${surname}${year}${sh}` || "key";
}

function composeUserNote(it, prefs){
  const u = UserStore.get(it.uid);
  const parts = [];
  const st = u.status || "";
  if(st){
    parts.push(`Status: ${st}`);
  }
  const kws = normalizeKeywords(prefs.keywords||[]);
  if(kws.length){
    const hits = keywordHits(it, kws);
    if(hits.length) parts.push(`Keywords: ${hits.join(', ')}`);
  }
  const note = (u.note||'').trim();
  if(note) parts.push(`Note: ${note}`);
  return parts.join(' ; ');
}

function toBibAPS(it, prefs, seen){
  const kind = it.type==='preprint' ? 'misc' : (it.journal || it.doi) ? 'article' : 'misc';
  let key = bibKeyFor(it);
  // De-duplicate keys in batch
  if(seen){
    let base = key, i=0;
    while(seen.has(key)){ i++; key = `${base}-${i}`; }
    seen.add(key);
  }
  const fields = [];
  const title = bibSanitize(it.title||'');
  fields.push(`  title = {${title}}`);

  if(Array.isArray(it.authors) && it.authors.length){
    // Keep authors as "A and B and C"
    const auth = fmtAuthorsList(it.authors,it.journalKey).map(name=>bibSanitize(name)).filter(Boolean).join(' and ');
    if(auth) fields.push(`  author = {${auth}}`);
  }
  const journal = bibSanitize(it.journal || SOURCE_MAP.get(it.journalKey)?.journal || '');
  if(journal && kind==='article') fields.push(`  journal = {${journal}}`);

  const vol = bibSanitize(it.volume||'');
  const issue = bibSanitize(it.issue||'');
  const pages = bibSanitize(it.pages||'');
  const numpages = bibSanitize(it.numpages||'');

  if(vol) fields.push(`  volume = {${vol}}`);
  if(issue) fields.push(`  issue = {${issue}}`);
  if(pages) fields.push(`  pages = {${pages}}`);
  if(numpages) fields.push(`  numpages = {${numpages}}`);

  const d = Number.isFinite(Date.parse(it.date)) ? new Date(it.date) : null;
  const year = bibSanitize(it.year || (d ? d.getUTCFullYear() : ''));
  if(year) fields.push(`  year = {${year}}`);
  if(d){
    const m = MONTH_ABBR[d.getUTCMonth()];
    if(m) fields.push(`  month = {${m}}`);
  }

  const publisher = bibSanitize(it.publisher || '');
  if(publisher) fields.push(`  publisher = {${publisher}}`);

  const doi = String(it.doi||'').replace(/[{}\s]/g,'');
  if(doi) fields.push(`  doi = {${doi}}`);

  // URL preference: explicit link; if missing, DOI URL
  const url = String(it.link || (doi?`https://doi.org/${doi}`:'')).replace(/[{}\s]/g,'');
  if(url) fields.push(`  url = {${url}}`);

  // arXiv extras
  if(it.arxiv){
    const eprint = String(it.arxiv).replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i,'').replace(/\.pdf$/i,'').replace(/[{}\s]/g,'');
    fields.push(`  eprint = {${eprint}}`);
    fields.push(`  archivePrefix = {arXiv}`);
  }

  const note = bibSanitize(composeUserNote(it, prefs),false);
  if(note) fields.push(`  note = {${note}}`);

  return `@${kind}{${key},\n${fields.join(',\n')}\n}`;
}

async function copyText(text, okMsg="已复制"){
  try{
    await navigator.clipboard.writeText(text);
    showToast(okMsg);
  }catch(e){
    // fallback: prompt
    console.warn("clipboard failed", e);
    window.prompt("复制失败，请手动复制：", text);
  }
}

/* ---------- UI init ---------- */
function applySourcesUI(){
  const legend = $("#legend");
  const srcSel = $("#src");
  const selected = srcSel?.value || '';
  $('#source-count') && ($('#source-count').textContent = `${SOURCES_META.length} 个`);
  if(legend){
    legend.innerHTML = SOURCES_META.map(s =>
      `<button type="button" class="legend-item" data-source="${esc(s.key)}" aria-pressed="${s.key===selected}"><span class="swatch" style="background:${esc(s.fg)}"></span>${esc(s.journal)}</button>`
    ).join("");
    $$('button',legend).forEach(btn=>btn.addEventListener('click',()=>{
      srcSel.value=srcSel.value===btn.dataset.source?'':btn.dataset.source;
      updateFilters();
    }));
  }
  if(srcSel){
    srcSel.innerHTML = `<option value="">全部来源</option>` +
      SOURCES_META.map(s=>`<option value="${esc(s.key)}">${esc(s.journal)}</option>`).join("");
    srcSel.value=selected;
  }
}

function setCoverageUI(json){
  const pill = $("#coverage-pill");
  const gen = $("#generatedAt");
  const cov = json.coverage || {};
  const latest = cov.latest ? formatDay(cov.latest) : '';
  const earliest = cov.earliest ? formatDay(cov.earliest) : '';
  if(pill){
    pill.textContent = `覆盖：最近 ${json.windowDays||SERVER_WINDOW} 天（${earliest} ~ ${latest}）`;
  }
  if(gen){
    gen.textContent = json.generatedAt ? formatDate(json.generatedAt) : '—';
    if(json.generatedAt) gen.dateTime=json.generatedAt;
  }
  const failed = (json.buildReport?.sources||[]).filter(s=>!s.ok).length;
  const stale = Date.now()-Date.parse(json.generatedAt) > 24*3600000;
  const notice = $('#data-notice');
  if(notice){
    notice.hidden=!stale && !failed;
    notice.textContent = [stale?'数据已超过 24 小时未更新，最新论文可能尚未收录。':'', failed?`${failed} 个抓取任务未成功，可在「RSS 状态」查看详情。`:''].filter(Boolean).join(' ');
  }
}

/* ---------- Normalize items ---------- */
function normalizeItem(item){
  const uid = itemUID(item);
  const dt = item.date ? new Date(item.date).getTime() : 0;
  const isNew = SEEN_BEFORE ? !SEEN_BEFORE.has(uid) : (LAST_VISIT_TS>0 && dt>LAST_VISIT_TS);
  return { ...item, title:feedText(item.title), summary:feedText(item.summary), uid, _isNew: isNew };
}

/* ---------- Card rendering ---------- */
function applyTone(root, key){
  const meta = SOURCE_MAP.get(key);
  if(meta){
    root.style.setProperty('--tone-bg', meta.bg || '#fff');
    root.style.setProperty('--tone-fg', meta.fg || '#0f172a');
  }else{
    root.style.setProperty('--tone-bg', '#fff');
    root.style.setProperty('--tone-fg', '#0f172a');
  }
}

function cardFromItem(item, prefs){
  const tpl = $("#card-tpl")?.content?.cloneNode(true);
  if(!tpl) return document.createTextNode('');
  const root  = tpl.querySelector('.card');
  const badge = tpl.querySelector('.badge');
  const type  = tpl.querySelector('.type');
  const time  = tpl.querySelector('.time');
  const title = tpl.querySelector('.title');
  const meta  = tpl.querySelector('.meta');
  const abs   = tpl.querySelector('.abs');
  const links = tpl.querySelector('.links');
  const star  = tpl.querySelector('.star');
  const newtag = tpl.querySelector('.newtag');

  const statusSel = tpl.querySelector('.status');
  const btnNote = tpl.querySelector('.btn-note');
  const btnCopy = tpl.querySelector('.btn-copy');
  const noteBox = tpl.querySelector('.note-box');
  const noteTa  = tpl.querySelector('.note');
  const btnAbstract = tpl.querySelector('.btn-abstract');

  applyTone(root, item.journalKey);

  badge.textContent = item.journalShort || item.journalKey;
  type.textContent  = item.type==='accepted' ? 'Accepted' : (item.type==='preprint' ? 'Preprint' : 'Published');
  time.textContent  = formatDay(item.date);
  time.dateTime = item.date || '';
  time.title = formatDate(item.date);

  if(item._isNew && newtag){
    newtag.classList.add('on');
  }

  // Title link with keyword highlight
  const link = bestLink(item);
  const a = document.createElement('a');
  a.href = link; a.target="_blank"; a.rel="noopener noreferrer nofollow";
  renderScientificText(a, item.title||'', prefs.highlight?normalizeKeywords(prefs.keywords):[]);
  title.textContent = "";
  title.append(a);

  const authorsLine = authorsCondensed(item.authors,item.journalKey);
  const doiPart = item.doi ? `　·　DOI: ${item.doi}` : '';
  meta.innerHTML = `<strong>作者：</strong>${esc(authorsLine)}${esc(doiPart)}`;

  // Abstract with optional highlight
  abs.textContent = "";
  const absStrong = document.createElement('strong');
  absStrong.textContent = '摘要：';
  abs.append(absStrong);
  const absSpan = document.createElement('span');
  renderScientificText(absSpan, item.summary || '（无摘要）', prefs.highlight && prefs.highlightSummary?normalizeKeywords(prefs.keywords):[]);
  abs.append(absSpan);
  if(item.summary){
    btnAbstract.addEventListener('click',()=>{
      const expanded=abs.classList.toggle('expanded');
      btnAbstract.textContent=expanded?'收起摘要 ↑':'展开摘要 ↓';
      btnAbstract.setAttribute('aria-expanded',String(expanded));
    });
  }

  // Links
  const arxiv = isAbs(item.arxiv) ? item.arxiv : '';
  const pdfLink = arxiv && arxiv.includes('/abs/') ? (arxiv.replace('/abs/','/pdf/') + '.pdf') : '';
  links.innerHTML = `
    <a href="${esc(link)}" target="_blank" rel="noopener noreferrer nofollow">原文页面 ↗</a>
    ${arxiv?`<a href="${esc(arxiv)}" target="_blank" rel="noopener noreferrer nofollow">arXiv</a>`:''}
    ${pdfLink?`<a href="${esc(pdfLink)}" target="_blank" rel="noopener noreferrer nofollow">PDF</a>`:''}
  `;

  // Favorite star
  star.dataset.uid=item.uid;
  if(FavStore.has(item.uid)){ star.classList.add('on'); star.textContent='★'; star.setAttribute('aria-pressed','true');star.setAttribute('aria-label','移出收藏');star.title='移出收藏'; }
  star?.addEventListener('click', ()=>{
    if(FavStore.has(item.uid)){
      FavStore.remove(item.uid);
      star.classList.remove('on'); star.textContent='☆';
      showToast("已移出收藏");
    }else{
      FavStore.add(item);
      star.classList.add('on'); star.textContent='★';
      showToast("已加入收藏");
    }
    updateFavCount();
  });

  // User status + note
  const u = UserStore.get(item.uid);
  if(statusSel) statusSel.value = u.status || "";
  if(noteTa) noteTa.value = u.note || "";

  // Auto-open note if already has content
  if((u.note||"").trim()){
    noteBox?.classList.add('on');
    btnNote?.setAttribute('aria-expanded','true');
  }

  statusSel?.addEventListener('change', ()=>{
    UserStore.set(item.uid, { status: statusSel.value || "" }, item);
    showToast("状态已保存");
  });

  btnNote?.addEventListener('click', ()=>{
    noteBox?.classList.toggle('on');
    btnNote.setAttribute('aria-expanded',String(noteBox.classList.contains('on')));
    if(noteBox?.classList.contains('on')) noteTa?.focus();
  });

  let noteTimer;
  const saveNote = ()=>{
    clearTimeout(noteTimer);
    if(UserStore.set(item.uid, { note: noteTa.value || "" }, item)) showToast("笔记已保存");
  };
  noteTa?.addEventListener('input',()=>{clearTimeout(noteTimer);noteTimer=setTimeout(saveNote,300);});
  noteTa?.addEventListener('blur',saveNote);

  btnCopy?.addEventListener('click', async ()=>{
    const bib = toBibAPS(item, prefs, null);
    await copyText(bib, "BibTeX 已复制");
  });

  return tpl;
}

/* ---------- Render ---------- */
function readSelections(){
  const src  = $("#src")?.value || "";
  const win  = $("#win")?.value || "3";
  const stat = $("#stat")?.value || "all";
  const view = $("#view")?.value || "all";
  const q = $('#q')?.value.trim() || '';
  return {src, win, stat, view, q};
}

function restoreFilters(){
  const params = new URL(location.href).searchParams;
  $('#q').value=params.get('q')||'';
  for(const [id,fallback] of [['src',''],['win','3'],['stat','all'],['view','all']]){
    const select=$(`#${id}`);
    const value=params.get(id)??fallback;
    select.value=[...select.options].some(o=>o.value===value)?value:fallback;
  }
}
function syncURL(){
  const url = new URL(location.href);
  const defaults = {q:'',src:'',win:'3',stat:'all',view:'all'};
  for(const [key,value] of Object.entries(readSelections())){
    if(value===defaults[key]) url.searchParams.delete(key); else url.searchParams.set(key,value);
  }
  history.replaceState(null,'',url);
}
function updateFilters(){ syncURL(); render(); }
function resetFilters(){
  $('#q').value='';$('#src').value='';$('#win').value='3';$('#stat').value='all';$('#view').value='all';
  updateFilters();
}
function renderMore(){
  const box=$('#cards');
  const prefs=PrefStore.load();
  const batch=FILTERED_ITEMS.slice(SHOWN,SHOWN+PAGE_SIZE);
  const fragment=document.createDocumentFragment();
  batch.forEach(it=>fragment.appendChild(cardFromItem(it,prefs)));
  box.appendChild(fragment);
  updateAbstractButtons();
  SHOWN+=batch.length;
  const pagination=$('#pagination');
  pagination.hidden=!FILTERED_ITEMS.length;
  $('#page-info').textContent=`已显示 ${SHOWN} / ${FILTERED_ITEMS.length} 篇`;
  $('#btn-more').hidden=SHOWN>=FILTERED_ITEMS.length;
}
function updateAbstractButtons(){
  $$('#cards .card').forEach(card=>{
    const abs=$('.abs',card);
    const button=$('.btn-abstract',card);
    button.hidden=!abs.classList.contains('expanded') && abs.scrollHeight<=abs.clientHeight+1;
  });
}

function render(){
  const prefs = PrefStore.load();
  const {src, win, stat, view, q} = readSelections();

  let items = ALL_ITEMS.slice(0);
  if(src) items = items.filter(it => it.journalKey === src);
  if(stat !== 'all') items = items.filter(it => it.type === stat);
  items = items.filter(it => withinDays(it.date, win));
  items = filterByQuery(items, q);

  // view filter
  if(view === 'new'){
    items = items.filter(it => it._isNew);
  }else if(view === 'kw'){
    const kws = normalizeKeywords(prefs.keywords||[]);
    if(kws.length) items = items.filter(it => keywordHits(it, kws).length > 0);
    else items = []; // no keywords
  }

  const box = $('#cards'); if(!box) return 0;
  box.replaceChildren();
  FILTERED_ITEMS=items;
  SHOWN=0;
  if(items.length) renderMore();
  else{
    const noKeywords=view==='kw' && !normalizeKeywords(prefs.keywords).length;
    box.innerHTML=`<div class="empty-state"><h3>${noKeywords?'先设置你的研究关键词':'没有符合条件的论文'}</h3><p>${noKeywords?'添加关键词，即可集中浏览相关研究。':'试试更短的关键词、其他期刊，或扩大时间范围。'}</p><button class="btn" id="empty-action" type="button">${noKeywords?'设置关键词':'重置筛选'}</button></div>`;
    $('#empty-action').addEventListener('click',noKeywords?openPrefs:resetFilters);
    $('#pagination').hidden=true;
  }
  box.setAttribute('aria-busy','false');
  $("#total") && ($("#total").textContent = items.length);
  $$('.legend-item').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.source===src)));
  return items.length;
}

/* ---------- Favorites dialog ---------- */
function openFavs(){
  const dlg = $('#fav-dialog');
  const box = $("#fav-list");
  if(!dlg || !box){ alert('收藏夹视图未找到'); return; }

  const prefs = PrefStore.load();
  const favs = FavStore.load();
  if(!favs.length){
    box.innerHTML = '<p class="hint">尚未收藏任何文章。</p>';
  }else{
    box.innerHTML = '';
    for(const f of favs){
      const it = ITEM_BY_UID.get(f.uid) || {...f,title:feedText(f.title)};
      const u = UserStore.get(f.uid);
      const st = u.status ? ` · <b>${esc(u.status)}</b>` : '';
      const note = (u.note||'').trim();
      const noteLine = note ? `<div class="hint small">Note: ${esc(note.slice(0,160))}${note.length>160?'…':''}</div>` : '';
      const el = document.createElement('div');
      el.className = 'rss-item';
      el.innerHTML = `
        <div class="top">
          <span class="k">${esc(it.journalShort||it.journalKey||'')}</span>
          <span class="hint small">${esc(formatDay(it.date))}${st}</span>
          <button class="btn soft" data-act="copy" data-uid="${esc(f.uid)}" type="button">📋 BibTeX</button>
          <button class="btn danger" data-act="rm" data-uid="${esc(f.uid)}" type="button">移除</button>
        </div>
        <div><a href="${esc(bestLink(it))}" target="_blank" rel="noopener noreferrer nofollow">${esc(it.title||'')}</a></div>
        ${noteLine}
      `;
      renderScientificText($('a',el),it.title||'',prefs.highlight?normalizeKeywords(prefs.keywords):[]);
      box.appendChild(el);
    }
    // handlers
    $$("button[data-act]", box).forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const uid = btn.dataset.uid;
        const act = btn.dataset.act;
        if(act === 'rm'){
          FavStore.remove(uid);
          btn.closest('.rss-item')?.remove();
          updateFavCount();
          showToast("已移除收藏");
          if(!FavStore.load().length) box.innerHTML = '<p class="hint">尚未收藏任何文章。</p>';
        }else if(act === 'copy'){
          const it = ITEM_BY_UID.get(uid) || FavStore.load().find(x=>x.uid===uid);
          if(!it) return;
          const bib = toBibAPS(it, prefs, null);
          await copyText(bib, "BibTeX 已复制");
        }
      });
    });
  }
  dlg.showModal();
}

/* ---------- Copy favorites BibTeX ---------- */
async function copyFavoritesBib(){
  const prefs = PrefStore.load();
  const favs = FavStore.load();
  if(!favs.length){ showToast("收藏为空"); return; }
  const seen = new Set();
  const bib = favs.map(f=>{
    const it = ITEM_BY_UID.get(f.uid) || f;
    return toBibAPS(it, prefs, seen);
  }).join("\n\n");
  await copyText(bib, "收藏 BibTeX 已复制");
}

/* ---------- Preferences dialog ---------- */
function openPrefs(){
  const dlg = $("#prefs-dialog"); if(!dlg) return;
  const p = PrefStore.load();
  $("#kw-text").value = (p.keywords||[]).join("\n");
  $("#kw-highlight").checked = !!p.highlight;
  $("#kw-in-summary").checked = !!p.highlightSummary;
  dlg.showModal();
}

function savePrefs(){
  const kws = normalizeKeywords(String($("#kw-text").value||'').split("\n"));
  const p = {
    keywords: kws,
    highlight: !!$("#kw-highlight").checked,
    highlightSummary: !!$("#kw-in-summary").checked
  };
  PrefStore.save(p);
  showToast("关键词设置已保存");
  render();
}

/* ---------- Weekly digest ---------- */
function buildWeeklyDigestMarkdown(){
  const weekMs = 7*24*3600*1000;
  const since = Date.now() - weekMs;
  const prefs = PrefStore.load();
  const kws = normalizeKeywords(prefs.keywords||[]);

  const updates = UserStore.listUpdatedSince(since)
    .map(u=>{
      const it = ITEM_BY_UID.get(u.uid) || FavStore.load().find(x=>x.uid===u.uid) || u.item;
      if(!it) return null;
      return { it, u };
    })
    .filter(Boolean);

  const byStatus = { todo:[], reading:[], done:[], other:[] };
  for(const x of updates){
    const st = x.u.status || "";
    if(st === "todo") byStatus.todo.push(x);
    else if(st === "reading") byStatus.reading.push(x);
    else if(st === "done") byStatus.done.push(x);
    else byStatus.other.push(x);
  }

  // keyword stats
  const kwCount = new Map();
  const pairCount = new Map();
  for(const x of updates){
    const hits = kws.length ? keywordHits(x.it, kws) : [];
    // counts
    for(const h of hits) kwCount.set(h, (kwCount.get(h)||0)+1);
    // intersections (pairs)
    for(let i=0;i<hits.length;i++){
      for(let j=i+1;j<hits.length;j++){
        const a = hits[i], b = hits[j];
        const k = [a,b].sort((p,q)=>p.localeCompare(q)).join(" ∩ ");
        pairCount.set(k, (pairCount.get(k)||0)+1);
      }
    }
  }

  const sortedKw = [...kwCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);
  const sortedPairs = [...pairCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);

  const today = new Date();
  const p2 = n=>String(n).padStart(2,'0');
  const titleDate = `${today.getFullYear()}-${p2(today.getMonth()+1)}-${p2(today.getDate())}`;

  const lines = [];
  lines.push(`# Weekly Digest (${titleDate})`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push(`- Updated items: ${updates.length}`);
  lines.push(`- Done: ${byStatus.done.length} · Reading: ${byStatus.reading.length} · To read: ${byStatus.todo.length} · Other: ${byStatus.other.length}`);
  if(kws.length){
    lines.push(`- Keywords tracked: ${kws.join(', ')}`);
  }
  if(sortedKw.length){
    lines.push(`- Keyword hits (top): ${sortedKw.map(([k,v])=>`${k}(${v})`).join(' · ')}`);
  }
  if(sortedPairs.length){
    lines.push(`- Keyword intersections (top): ${sortedPairs.map(([k,v])=>`${k}(${v})`).join(' · ')}`);
  }
  lines.push('');

  const section = (name, arr)=>{
    lines.push(`## ${name} (${arr.length})`);
    if(!arr.length){ lines.push(`- (none)`); lines.push(''); return; }
    for(const x of arr){
      const it = x.it; const u = x.u;
      const note = (u.note||'').trim();
      const hits = kws.length ? keywordHits(it, kws) : [];
      const hitLine = hits.length ? ` · Keywords: ${hits.join(', ')}` : '';
      lines.push(`- [${scientificPlainText(it.title||'').replace(/[\\\[\]]/g,'\\$&')}](${bestLink(it)}) — ${it.journalShort||it.journalKey||''} — ${formatDay(it.date)}${hitLine}`);
      if(note) lines.push(`  - Note: ${note.replace(/\n+/g,' ').slice(0,280)}${note.length>280?'…':''}`);
    }
    lines.push('');
  };

  section('Done', byStatus.done);
  section('Reading', byStatus.reading);
  section('To read', byStatus.todo);
  section('Other', byStatus.other);

  return { markdown: lines.join('\n'), items: updates.map(x=>x.it) };
}

async function openDigest(){
  const dlg = $("#digest-dialog"); if(!dlg) return;
  const r = buildWeeklyDigestMarkdown();
  $("#digest-text").textContent = r.markdown || "(本周暂无更新的阅读状态/笔记)";
  dlg.showModal();
}

async function copyDigestMarkdown(){
  const r = buildWeeklyDigestMarkdown();
  await copyText(r.markdown || "", "digest 已复制");
}

async function copyDigestBib(){
  const prefs = PrefStore.load();
  const r = buildWeeklyDigestMarkdown();
  const seen = new Set();
  const bib = (r.items||[]).map(it=> toBibAPS(it, prefs, seen)).join("\n\n");
  await copyText(bib || "", "digest BibTeX 已复制");
}

/* ---------- RSS status dialog ---------- */
function openRSSStatus(){
  const dlg = $("#rss-dialog"); const box = $("#rss-list");
  if(!dlg || !box) return;
  const rep = BUILD_REPORT;
  if(!rep || !Array.isArray(rep.sources)){
    $('#rss-summary').textContent='尚无抓取报告。';
    box.innerHTML = '<p class="hint">没有 build report。</p>';
    dlg.showModal();
    return;
  }
  $('#rss-summary').textContent=`${rep.sources.filter(s=>s.ok).length} / ${rep.sources.length} 次抓取成功 · 检查于 ${formatDate(rep.generatedAt)}`;
  box.innerHTML = '';
  // Failed requests come first so source problems are easy to find.
  const sources = rep.sources.slice(0).sort((a,b)=>Number(a.ok)-Number(b.ok) || String(a.key).localeCompare(String(b.key)));
  for(const s of sources){
    const ok = !!s.ok;
    const el = document.createElement('div');
    el.className = 'rss-item';
    el.innerHTML = `
      <div class="top">
        <span class="k">${esc(s.key||'')}</span>
        <span class="${ok?'ok':'bad'}">${ok?'OK':'FAIL'}</span>
        <span class="hint small">${esc(s.type||'')} · ${esc(s.origin||'')} · HTTP ${esc(s.status??'—')} · entries ${esc(s.entries??0)}</span>
      </div>
      <div class="u">${esc(s.url||'')}</div>
      ${s.latestArticleAt ? `<div class="hint small">源内最新日期：${esc(formatDay(s.latestArticleAt))}</div>` : ''}
      ${s.latestArticleAt && !withinDays(s.latestArticleAt,SERVER_WINDOW) ? `<div class="hint small">此订阅源暂无最近 ${esc(SERVER_WINDOW)} 天的条目。</div>` : ''}
      ${s.retainedItems ? `<div class="hint small">已保留 ${esc(s.retainedItems)} 篇窗口内的已有论文。</div>` : ''}
      ${s.error ? `<div class="hint small">Error: ${esc(s.error)}</div>` : ''}
    `;
    box.appendChild(el);
  }
  dlg.showModal();
}

/* ---------- Load ---------- */
async function load(){
  if(LOADING) return;
  LOADING=true;
  const refresh=$('#btn-refresh');
  refresh.disabled=true;
  refresh.textContent='正在刷新…';
  updateFavCount();
  if(!INITIALIZED){
    LAST_VISIT_TS = VisitStore.get();
    try{
      const seen=JSON.parse(Storage.get('pj_seen_items_v1')||'null');
      if(Array.isArray(seen)) SEEN_BEFORE=new Set(seen);
    }catch{ /* A malformed baseline behaves like a first visit. */ }
  }

  let json = null;
  try{
    const resp = await fetch('data/articles.json', {cache:'no-store'});
    if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
    json = await resp.json();
    if(!json || !Array.isArray(json.items)) throw new Error('文献数据格式不正确');
  }catch(err){
    const box = $('#cards');
    if(INITIALIZED) showToast('刷新失败，已保留当前论文。请稍后重试。');
    else if(box){
      box.setAttribute('aria-busy','false');
      box.innerHTML = '<div class="empty-state"><h3>暂时无法加载论文</h3><p>请检查网络连接后重试。</p><button class="btn" id="btn-retry" type="button">重新加载</button></div>';
      $('#btn-retry').addEventListener('click',load);
      $('#coverage-pill').textContent='数据暂不可用';
    }
    console.error('load articles.json failed', err);
    return;
  }finally{
    LOADING=false;
    refresh.disabled=false;
    refresh.textContent='↻ 刷新数据';
  }

  SERVER_WINDOW = json.windowDays || 14;
  SOURCES_META = (json.sources || []).slice(0);
  SOURCE_MAP = new Map(SOURCES_META.map(s=>[s.key, s]));
  BUILD_REPORT = json.buildReport || null;

  applySourcesUI();
  setCoverageUI(json);

  ALL_ITEMS = (json.items||[]).map(normalizeItem);
  ALL_ITEMS.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  ITEM_BY_UID = new Map(ALL_ITEMS.map(it=>[it.uid, it]));
  // Attach metadata to legacy reading records before articles age out of the feed.
  const reading=UserStore._loadAll();
  let upgraded=false;
  for(const [uid,u] of Object.entries(reading.items)){
    if(!u.item && ITEM_BY_UID.has(uid)){u.item=FavStore.minify(ITEM_BY_UID.get(uid));upgraded=true;}
  }
  if(upgraded) UserStore._saveAll(reading);

  // New count relative to last visit
  const newCount = ALL_ITEMS.filter(it=>it._isNew).length;
  $("#new-count") && ($("#new-count").textContent = String(newCount));

  if(!INITIALIZED) restoreFilters();
  render();

  // Update last visit timestamp AFTER first render
  VisitStore.set(Date.now());
  const seen=new Set([...(SEEN_BEFORE||[]),...ALL_ITEMS.map(it=>it.uid)]);
  Storage.set('pj_seen_items_v1',JSON.stringify([...seen].slice(-5000)));
  // Freeze this visit's baseline so refreshing does not erase NEW markers.
  if(!SEEN_BEFORE) SEEN_BEFORE=new Set(ALL_ITEMS.filter(it=>!it._isNew).map(it=>it.uid));
  INITIALIZED=true;
}

/* ---------- Events ---------- */
$('#btn-refresh')?.addEventListener('click', load);
$('#src')?.addEventListener('change', updateFilters);
$('#win')?.addEventListener('change', updateFilters);
$('#stat')?.addEventListener('change', updateFilters);
$('#view')?.addEventListener('change', updateFilters);
$('#btn-reset')?.addEventListener('click', resetFilters);
$('#btn-more')?.addEventListener('click', renderMore);

let searchTimer;
$('#q')?.addEventListener('input',()=>{
  clearTimeout(searchTimer);
  searchTimer=setTimeout(updateFilters,180);
});

$('#q')?.addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){
    e.preventDefault();
    clearTimeout(searchTimer);
    updateFilters();
  }
});

$('#btn-favs')?.addEventListener('click', openFavs);
$('#btn-copy-favs-2')?.addEventListener('click', copyFavoritesBib);

$('#btn-clear-favs')?.addEventListener('click', ()=>{
  if(confirm('确定清空所有收藏？')){
    FavStore.clear();
    updateFavCount();
    const box = $("#fav-list");
    if(box) box.innerHTML = '<p class="hint">尚未收藏任何文章。</p>';
    showToast("已清空收藏");
  }
});

$('#btn-prefs')?.addEventListener('click', openPrefs);
$('#btn-save-prefs')?.addEventListener('click', savePrefs);
$('#btn-clear-prefs')?.addEventListener('click', ()=>{
  $("#kw-text").value = "";
  savePrefs();
});

$('#btn-digest')?.addEventListener('click', openDigest);
$('#btn-copy-digest-md')?.addEventListener('click', copyDigestMarkdown);
$('#btn-copy-digest-bib')?.addEventListener('click', copyDigestBib);

$('#btn-rss')?.addEventListener('click', openRSSStatus);

window.addEventListener('popstate',()=>{restoreFilters();render();});
window.addEventListener('keydown',e=>{
  if(e.key==='/' && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('dialog[open]') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !e.target.isContentEditable){e.preventDefault();$('#q')?.focus();}
});
window.addEventListener('storage',()=>{
  Storage.cache.clear();FavStore._raw=undefined;UserStore._all=null;
  updateFavCount();
  if(INITIALIZED) render();
});
let resizeTimer;
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(updateAbstractButtons,100);});
document.fonts?.ready.then(updateAbstractButtons);

/* ---------- Boot ---------- */
load();
