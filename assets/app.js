/* ---------- DOM helpers ---------- */
const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];
const isAbs = u => /^https?:\/\//i.test(u||"");
const esc = (s)=> String(s??'').replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));

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
  _parse(raw){ try{ const v=JSON.parse(raw||'[]'); return Array.isArray(v)?v:[]; }catch{return [];} },
  minify(item){
    const uid = item.uid || `${item.journalKey}|${item.doi||item.arxiv||item.link}|${item.date||''}`;
    return {
      uid,
      title: item.title||'',
      authors: Array.isArray(item.authors)? item.authors.slice(0) : [],
      date: item.date||'',
      journalKey: item.journalKey||'',
      journalShort: item.journalShort||item.journalKey||'',
      journal: item.journal||'',
      type: item.type||'',
      link: item.link||'',
      arxiv: item.arxiv||'',
      doi: item.doi||'',
      summary: item.summary||'',
      volume: item.volume||'',
      issue: item.issue||'',
      pages: item.pages||'',
      publisher: item.publisher||''
    };
  },
  load(){ return this._parse(localStorage.getItem(this.key)); },
  save(list){ localStorage.setItem(this.key, JSON.stringify(list||[])); },
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
      const v = JSON.parse(localStorage.getItem(this.key)||'{}');
      return {...this.defaults, ...(v||{})};
    }catch{
      return {...this.defaults};
    }
  },
  save(p){ localStorage.setItem(this.key, JSON.stringify(p||this.defaults)); }
};

const UserStore = {
  key: 'pj_user_v1',
  _loadAll(){
    try{
      const v = JSON.parse(localStorage.getItem(this.key)||'{}');
      if(!v || typeof v!=='object') return { items:{} };
      if(!v.items || typeof v.items!=='object') v.items = {};
      return v;
    }catch{ return { items:{} }; }
  },
  _saveAll(v){ localStorage.setItem(this.key, JSON.stringify(v||{items:{}})); },
  get(uid){
    const all=this._loadAll();
    return all.items?.[uid] || { status:"", note:"", updatedAt:0 };
  },
  set(uid, patch){
    const all=this._loadAll();
    const cur = all.items?.[uid] || { status:"", note:"", updatedAt:0 };
    all.items = all.items || {};
    all.items[uid] = { ...cur, ...patch, updatedAt: Date.now() };
    this._saveAll(all);
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
  get(){ return Number(localStorage.getItem(this.key)||'0')||0; },
  set(ts){ localStorage.setItem(this.key, String(ts||Date.now())); }
};

function updateFavCount(){
  const n = FavStore.load().length;
  $("#fav-count") && ($("#fav-count").textContent = n);
}

/* ---------- Data state ---------- */
let ALL_ITEMS = [];
let ITEM_BY_UID = new Map();
let SOURCES_META = [];
let SOURCE_MAP = new Map();
let BUILD_REPORT = null;
let SERVER_WINDOW = 14;
let LAST_VISIT_TS = 0;

/* ---------- Text helpers ---------- */
function fmtAuthorsList(authors){
  if(!authors || !authors.length) return [];
  return authors.map(a => typeof a === 'string' ? a : (a.name || `${a.given||''} ${a.family||''}`.trim()));
}
function authorsCondensed(authors){
  const list = fmtAuthorsList(authors);
  const n = list.length;
  if(n === 0) return '';
  if(n <= 3) return list.join(', ');
  return `${list[0]} … ${list[n-1]}（共 ${n} 人）`;
}
function formatDate(iso){
  if(!iso) return "";
  const d = new Date(iso);
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function formatDay(iso){
  if(!iso) return "";
  const d = new Date(iso);
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function withinDays(iso, days){
  if(days==='all') return true;
  const dt = new Date(iso); const now = new Date();
  return (now - dt)/(1000*60*60*24) <= Number(days)+0.01;
}
function filterByQuery(items, q){
  if(!q) return items;
  const s = q.toLowerCase();
  return items.filter(x =>
    (x.title||'').toLowerCase().includes(s) ||
    (x.journal||'').toLowerCase().includes(s) ||
    (x.doi||'').toLowerCase().includes(s) ||
    (x.summary||'').toLowerCase().includes(s) ||
    (x.authors||[]).join(' ').toLowerCase().includes(s)
  );
}

/* ---------- Keywords ---------- */
function normalizeKeywords(list){
  return (list||[])
    .map(s=>String(s||'').trim())
    .filter(Boolean);
}
function itemTextForMatch(it){
  return `${it.title||''}\n${(it.authors||[]).join(' ')}\n${it.summary||''}\n${it.doi||''}`.toLowerCase();
}
function keywordHits(it, keywords){
  const s = itemTextForMatch(it);
  const hits = [];
  for(const kw of keywords){
    if(!kw) continue;
    if(s.includes(kw.toLowerCase())) hits.push(kw);
  }
  return hits;
}
function renderHighlighted(container, text, keywords){
  container.textContent = '';
  if(!text){ return; }
  const kws = keywords.map(k=>k.trim()).filter(Boolean);
  if(!kws.length){ container.textContent = text; return; }

  const lower = text.toLowerCase();
  // Collect matches
  const spans = [];
  for(const kw of kws){
    const k = kw.toLowerCase();
    let idx = 0;
    while(true){
      const pos = lower.indexOf(k, idx);
      if(pos === -1) break;
      spans.push({start:pos, end:pos+k.length});
      idx = pos + k.length;
    }
  }
  if(!spans.length){ container.textContent = text; return; }
  // Merge overlaps
  spans.sort((a,b)=>a.start-b.start);
  const merged = [spans[0]];
  for(const sp of spans.slice(1)){
    const last = merged[merged.length-1];
    if(sp.start <= last.end) last.end = Math.max(last.end, sp.end);
    else merged.push(sp);
  }
  const frag = document.createDocumentFragment();
  let cur = 0;
  for(const m of merged){
    if(m.start > cur) frag.append(document.createTextNode(text.slice(cur, m.start)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(m.start, m.end);
    frag.append(mark);
    cur = m.end;
  }
  if(cur < text.length) frag.append(document.createTextNode(text.slice(cur)));
  container.append(frag);
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

function bibSanitize(s){
  return String(s??'').replace(/[{}]/g,'').replace(/\s+/g,' ').trim();
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
  const a0 = (it.authors||[])[0] || "anon";
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
  const kind = (it.journal || it.doi) ? 'article' : 'misc';
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
    const auth = it.authors.map(bibSanitize).filter(Boolean).join(' and ');
    if(auth) fields.push(`  author = {${auth}}`);
  }
  const journal = bibSanitize(it.journal || SOURCE_MAP.get(it.journalKey)?.journal || '');
  if(journal) fields.push(`  journal = {${journal}}`);

  const vol = bibSanitize(it.volume||'');
  const issue = bibSanitize(it.issue||'');
  const pages = bibSanitize(it.pages||'');
  const numpages = bibSanitize(it.numpages||'');

  if(vol) fields.push(`  volume = {${vol}}`);
  if(issue) fields.push(`  issue = {${issue}}`);
  if(pages) fields.push(`  pages = {${pages}}`);
  if(numpages) fields.push(`  numpages = {${numpages}}`);

  const d = it.date ? new Date(it.date) : null;
  const year = bibSanitize(it.year || (d ? d.getUTCFullYear() : ''));
  if(year) fields.push(`  year = {${year}}`);
  if(d){
    const m = MONTH_ABBR[d.getUTCMonth()];
    if(m) fields.push(`  month = {${m}}`);
  }

  const publisher = bibSanitize(it.publisher || '');
  if(publisher) fields.push(`  publisher = {${publisher}}`);

  const doi = bibSanitize(it.doi||'');
  if(doi) fields.push(`  doi = {${doi}}`);

  // URL preference: explicit link; if missing, DOI URL
  const url = bibSanitize(it.link || (doi?`https://doi.org/${doi}`:''));
  if(url) fields.push(`  url = {${url}}`);

  // arXiv extras
  if(it.arxiv){
    const eprint = bibSanitize(it.arxiv);
    fields.push(`  eprint = {${eprint}}`);
    fields.push(`  archivePrefix = {arXiv}`);
  }

  const note = bibSanitize(composeUserNote(it, prefs));
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
  if(legend){
    legend.innerHTML = SOURCES_META.map(s =>
      `<span class="legend-item"><span class="swatch" style="background:${esc(s.bg)}"></span>${esc(s.journal)}</span>`
    ).join("");
  }
  if(srcSel){
    srcSel.innerHTML = `<option value="">全部来源</option>` +
      SOURCES_META.map(s=>`<option value="${esc(s.key)}">${esc(s.journal)}</option>`).join("");
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
  }
}

/* ---------- Normalize items ---------- */
function normalizeItem(item){
  const uid = `${item.journalKey}|${item.doi||item.arxiv||item.link}|${item.date||''}`;
  const dt = item.date ? new Date(item.date).getTime() : 0;
  const isNew = (LAST_VISIT_TS>0) ? (dt > LAST_VISIT_TS) : false;
  return { ...item, uid, _isNew: isNew };
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

  applyTone(root, item.journalKey);

  badge.textContent = item.journalShort || item.journalKey;
  type.textContent  = item.type==='accepted' ? 'Accepted' : (item.type==='preprint' ? 'Preprint' : 'Published');
  time.textContent  = formatDate(item.date);

  if(item._isNew && newtag){
    newtag.classList.add('on');
  }

  // Title link with keyword highlight
  const link = bestLink(item);
  const a = document.createElement('a');
  a.href = link; a.target="_blank"; a.rel="noopener noreferrer nofollow";
  if(prefs.highlight){
    const span = document.createElement('span');
    renderHighlighted(span, item.title||'', normalizeKeywords(prefs.keywords));
    a.append(span);
  }else{
    a.textContent = item.title||'';
  }
  title.textContent = "";
  title.append(a);

  const authorsLine = authorsCondensed(item.authors);
  const doiPart = item.doi ? `　·　DOI: ${item.doi}` : '';
  meta.innerHTML = `<strong>作者：</strong>${esc(authorsLine)}${esc(doiPart)}`;

  // Abstract with optional highlight
  abs.textContent = "";
  const absStrong = document.createElement('strong');
  absStrong.textContent = '摘要：';
  abs.append(absStrong);
  const absSpan = document.createElement('span');
  if(prefs.highlight && prefs.highlightSummary){
    renderHighlighted(absSpan, item.summary || '（无摘要）', normalizeKeywords(prefs.keywords));
  }else{
    absSpan.textContent = item.summary || '（无摘要）';
  }
  abs.append(absSpan);

  // Links
  const arxiv = isAbs(item.arxiv) ? item.arxiv : '';
  const pdfLink = arxiv && arxiv.includes('/abs/') ? (arxiv.replace('/abs/','/pdf/') + '.pdf') : '';
  links.innerHTML = `
    <a href="${esc(link)}" target="_blank" rel="noopener noreferrer nofollow">页面</a>
    ${arxiv?`<a href="${esc(arxiv)}" target="_blank" rel="noopener noreferrer nofollow">arXiv</a>`:''}
    ${pdfLink?`<a href="${esc(pdfLink)}" target="_blank" rel="noopener noreferrer nofollow">PDF</a>`:''}
  `;

  // Favorite star
  if(FavStore.has(item.uid)){ star.classList.add('on'); star.textContent='★'; }
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
  }

  statusSel?.addEventListener('change', ()=>{
    UserStore.set(item.uid, { status: statusSel.value || "" });
    showToast("状态已保存");
  });

  btnNote?.addEventListener('click', ()=>{
    noteBox?.classList.toggle('on');
    if(noteBox?.classList.contains('on')) noteTa?.focus();
  });

  noteTa?.addEventListener('blur', ()=>{
    UserStore.set(item.uid, { note: noteTa.value || "" });
    showToast("笔记已保存");
  });

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
  const url = new URL(location.href);
  const q = url.searchParams.get('q') || '';
  if(q) $('#q') && ($('#q').value = q);
  return {src, win, stat, view, q};
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
  box.innerHTML='';
  items.forEach(it=> box.appendChild(cardFromItem(it, prefs)) );
  $("#total") && ($("#total").textContent = items.length);
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
      const it = ITEM_BY_UID.get(f.uid) || f;
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
      const it = ITEM_BY_UID.get(u.uid) || FavStore.load().find(x=>x.uid===u.uid);
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
      lines.push(`- [${it.title||''}](${bestLink(it)}) — ${it.journalShort||it.journalKey||''} — ${formatDay(it.date)}${hitLine}`);
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
    box.innerHTML = '<p class="hint">没有 build report。</p>';
    dlg.showModal();
    return;
  }
  box.innerHTML = '';
  // Show newest first
  const sources = rep.sources.slice(0).reverse();
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
      ${s.error ? `<div class="hint small">Error: ${esc(s.error)}</div>` : ''}
    `;
    box.appendChild(el);
  }
  dlg.showModal();
}

/* ---------- Load ---------- */
async function load(){
  updateFavCount();
  LAST_VISIT_TS = VisitStore.get();

  let json = null;
  try{
    const resp = await fetch('data/articles.json', {cache:'no-store'});
    if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
    json = await resp.json();
  }catch(err){
    const box = $('#cards');
    if(box) box.innerHTML = `<p class="hint">数据读取失败：${esc(String(err))}</p>`;
    console.error('load articles.json failed', err);
    return;
  }

  SERVER_WINDOW = json.windowDays || 14;
  SOURCES_META = (json.sources || []).slice(0);
  SOURCE_MAP = new Map(SOURCES_META.map(s=>[s.key, s]));
  BUILD_REPORT = json.buildReport || null;

  applySourcesUI();
  setCoverageUI(json);

  ALL_ITEMS = (json.items||[]).map(normalizeItem);
  ITEM_BY_UID = new Map(ALL_ITEMS.map(it=>[it.uid, it]));

  // New count relative to last visit
  const newCount = ALL_ITEMS.filter(it=>it._isNew).length;
  $("#new-count") && ($("#new-count").textContent = String(newCount));

  // If backend window > 14 (shouldn't), adjust default select
  if (SERVER_WINDOW > 14 && $("#win")) $("#win").value = 'all';

  const n = render();
  if(n===0 && $("#win") && $("#win").value !== 'all'){ $("#win").value = 'all'; render(); }

  // Update last visit timestamp AFTER first render
  VisitStore.set(Date.now());
}

/* ---------- Events ---------- */
$('#btn-refresh')?.addEventListener('click', load);
$('#src')?.addEventListener('change', render);
$('#win')?.addEventListener('change', render);
$('#stat')?.addEventListener('change', render);
$('#view')?.addEventListener('change', render);

$('#q')?.addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){
    const v=e.target.value.trim();
    const u=new URL(location.href);
    if(v) u.searchParams.set('q',v); else u.searchParams.delete('q');
    location.href = u.toString();
  }
});

$('#btn-favs')?.addEventListener('click', openFavs);
$('#btn-copy-favs')?.addEventListener('click', copyFavoritesBib);
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

/* ---------- Boot ---------- */
load();
