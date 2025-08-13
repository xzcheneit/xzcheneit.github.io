const DAYS_WINDOW = 3;

// 列表里加入 arXiv cond-mat
const LEGEND = [
  ["PRL","Phys. Rev. Lett."],
  ["PRB","Phys. Rev. B"],
  ["PRE","Phys. Rev. E"],
  ["PRResearch","Phys. Rev. Research"],
  ["PRX","Phys. Rev. X"],
  ["PRXQ","PRX Quantum"],
  ["Nature","Nature"],
  ["NatPhys","Nature Physics"],
  ["NatCommun","Nature Communications"],
  ["Science","Science"],
  ["NanoLett","Nano Letters"],
  ["NJP","New Journal of Physics"],
  ["arXivCM","arXiv cond-mat"]   // 新增
];

const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];

let ALL_ITEMS = [];
const state = {
  journals: new Set(LEGEND.map(x=>x[0])),
  statuses: new Set(['published','accepted','preprint']),
  start: '', end: ''
};

function fmtAuthors(authors){
  if(!authors || !authors.length) return "";
  const names = authors.map(a=> typeof a === 'string' ? a : (a.name||a.family||a.given||"?") );
  return names.slice(0,3).join(", ") + (names.length>3?` 等(${names.length})`:"");
}

function withinDays(iso, days=DAYS_WINDOW){
  if(!iso) return false;
  const dt = new Date(iso);
  const now = new Date();
  const ms = (now - dt)/(1000*60*60*24);
  return ms <= days+0.01;
}

function cssVarName(k){
  return (
    k === 'PRResearch' ? 'prr' :
    k === 'PRXQ' ? 'prxq' :
    k === 'NatPhys' ? 'nphys' :
    k === 'NatCommun' ? 'ncomms' :
    k === 'NanoLett' ? 'nalett' :
    k === 'arXivCM' ? 'arxiv' :
    k.toLowerCase()
  );
}

function bibKey(item){
  const y = (item.year||new Date(item.date).getFullYear());
  const first = (item.authors?.[0]||"").split(/[, ]+/)[0] || 'na';
  const word = (item.title||'').replace(/[^\p{L}\p{N}\s]/gu,'').split(/\s+/).find(w=>w.length>3) || 'paper';
  return `${first}${y}${word}`.replace(/[^A-Za-z0-9]/g,'');
}

function toBib(item){
  const type = (item.type==='preprint') || (item.arxiv && (!item.doi || item.type==='accepted')) ? 'misc' : 'article';
  const au = (item.authors||[]).map(a=>{
    if(typeof a!== 'string') return a.name || `${a.given||''} ${a.family||''}`.trim();
    return a;
  }).join(' and ');
  const lines = [];
  lines.push(`@${type}{${bibKey(item)},`);
  lines.push(`  title={${item.title||''}},`);
  if(au) lines.push(`  author={${au}},`);
  if(item.journal) lines.push(`  journal={${item.journal}},`);
  const y = item.year || (item.date? new Date(item.date).getFullYear(): undefined);
  if(y) lines.push(`  year={${y}},`);
  if(item.volume) lines.push(`  volume={${item.volume}},`);
  if(item.number) lines.push(`  number={${item.number}},`);
  if(item.pages) lines.push(`  pages={${item.pages}},`);
  if(item.doi) lines.push(`  doi={${item.doi}},`);
  if(item.arxiv){
    const id = item.arxiv.replace(/^.*\//,'');
    lines.push(`  eprint={${id}},`);
    lines.push(`  archivePrefix={arXiv},`);
  }
  lines.push(`  url={${item.link}},`);
  lines.push('}');
  return lines.join('\n');
}

function download(name, content){
  const blob = new Blob([content], {type:'text/plain;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const favStore = {
  key: 'pj_favs_v1',
  get(){ try{ return JSON.parse(localStorage.getItem(this.key)||'[]'); }catch{ return [] } },
  set(arr){ localStorage.setItem(this.key, JSON.stringify(arr)); },
  add(item){ const list = this.get(); if(!list.find(x=>x.uid===item.uid)){ list.push(item); this.set(list);} },
  remove(uid){ const list = this.get().filter(x=>x.uid!==uid); this.set(list); },
  has(uid){ return this.get().some(x=>x.uid===uid); }
};

function renderFavCount(){ $("#fav-count").textContent = favStore.get().length; }

function renderFavorites(){
  const list = favStore.get();
  const box = $("#fav-list");
  if(!list.length){ box.innerHTML = '<p class="meta">尚未收藏任何文章。</p>'; return; }
  box.innerHTML = list.map(item => `
    <article class="card">
      <div class="card-head">
        <span class="badge ${item.journalKey}">${item.journalShort||item.journalKey}</span>
        <span class="type">${item.type==='accepted'?'Accepted':(item.type==='preprint'?'Preprint':'Published')}</span>
        <button class="star on" data-uid="${item.uid}">★</button>
      </div>
      <h3 class="title"><a href="${item.link}" target="_blank" rel="noopener">${item.title}</a></h3>
      <p class="meta">${fmtAuthors(item.authors)} · ${item.date?.slice(0,10)||''}${item.doi?` · DOI: ${item.doi}`:''}</p>
      ${item.summary?`<p class="abs">${item.summary}</p>`:''}
      <div class="links">
        <a href="${item.link}" target="_blank" rel="noopener">页面</a>
        ${item.arxiv?`<a href="${item.arxiv}" target="_blank" rel="noopener">arXiv</a>`:''}
      </div>
    </article>`).join("");
  $$(".star", box).forEach(btn=>{
    btn.addEventListener('click', ()=>{ favStore.remove(btn.dataset.uid); renderFavorites(); renderFavCount(); });
  });
}

function cardFromItem(item){
  const tpl = $("#card-tpl").content.cloneNode(true);
  const badge = tpl.querySelector('.badge');
  const type = tpl.querySelector('.type');
  const title = tpl.querySelector('.title');
  const meta = tpl.querySelector('.meta');
  const abs = tpl.querySelector('.abs');
  const links = tpl.querySelector('.links');
  const star = tpl.querySelector('.star');

  badge.classList.add(item.journalKey);
  badge.textContent = item.journalShort || item.journalKey;
  type.textContent = item.type === 'accepted' ? 'Accepted' : (item.type==='preprint'?'Preprint':'Published');
  title.innerHTML = `<a href="${item.link}" target="_blank" rel="noopener">${item.title}</a>`;
  meta.textContent = `${fmtAuthors(item.authors)} · ${item.date?.slice(0,10)||''}${item.doi?` · DOI: ${item.doi}`:''}`;
  abs.textContent = item.summary || "";

  links.innerHTML = `
    <a href="${item.link}" target="_blank" rel="noopener">页面</a>
    ${item.arxiv?`<a href="${item.arxiv}" target="_blank" rel="noopener">arXiv</a>`:''}
  `;

  const uid = `${item.journalKey}|${item.doi||item.link}|${item.date}`;
  item.uid = uid;

  if(favStore.has(item.uid)) star.classList.add('on'), star.textContent='★';
  star.addEventListener('click', ()=>{
    if(favStore.has(item.uid)) { favStore.remove(item.uid); star.classList.remove('on'); star.textContent='☆'; }
    else { favStore.add(item); star.classList.add('on'); star.textContent='★'; }
    renderFavCount();
  });
  return tpl;
}

function normalize(item){
  const uid = `${item.journalKey}|${item.doi||item.link}|${item.date}`;
  return {...item, uid};
}

function filterByQuery(items, q){
  if(!q) return items;
  const s = q.toLowerCase();
  return items.filter(x=>
    (x.title||'').toLowerCase().includes(s) ||
    (x.journal||'').toLowerCase().includes(s) ||
    (x.doi||'').toLowerCase().includes(s) ||
    (x.summary||'').toLowerCase().includes(s) ||
    (x.authors||[]).join(' ').toLowerCase().includes(s)
  );
}

function inDateRange(iso, start, end){
  if(!iso) return false;
  const t = new Date(iso).getTime();
  if(start){
    const ts = new Date(start + "T00:00:00").getTime();
    if(t < ts) return false;
  }
  if(end){
    const te = new Date(end + "T23:59:59").getTime();
    if(t > te) return false;
  }
  return true;
}

function applyLegend(){
  const box = $("#legend");
  box.innerHTML = LEGEND.map(([k,v])=>`<span class="legend-item"><span class="swatch" style="background: var(--c-${cssVarName(k)});"></span>${v}</span>`).join("");
}

function renderJournals(){
  const box = $("#journals");
  box.innerHTML = LEGEND.map(([k,v])=>`
    <label class="chip">
      <input type="checkbox" class="j-check" value="${k}" checked>
      <span class="swatch" style="background: var(--c-${cssVarName(k)}); width:12px;height:12px;border-radius:4px;border:1px solid var(--ring)"></span>
      ${v}
    </label>
  `).join("");
}

function collectStateFromUI(){
  // journals
  state.journals = new Set($$(".j-check").filter(x=>x.checked).map(x=>x.value));
  // statuses
  state.statuses = new Set($$(".status-check").filter(x=>x.checked).map(x=>x.value));
  // dates
  state.start = $("#date-start").value || '';
  state.end = $("#date-end").value || '';
}

function applyRender(){
  collectStateFromUI();
  const url = new URL(location.href);
  const query = url.searchParams.get('q') || '';
  if(query) $('#q').value = query;

  let items = ALL_ITEMS.slice(0);

  // 基础窗口（3天）兜底
  items = items.filter(it=>withinDays(it.date));

  // 期刊、状态、日期
  items = items.filter(it => state.journals.has(it.journalKey));
  items = items.filter(it => state.statuses.has(it.type));
  if(state.start || state.end) items = items.filter(it=>inDateRange(it.date, state.start, state.end));

  // 关键词
  items = filterByQuery(items, query);

  // 渲染
  const box = $('#cards'); box.innerHTML='';
  items.forEach(it=> box.appendChild(cardFromItem(it)) );
}

async function load(){
  applyLegend(); renderFavCount(); renderJournals();

  const resp = await fetch('data/articles.json', {cache:'no-store'});
  const json = await resp.json();
  const itemsRaw = json.items || [];
  ALL_ITEMS = itemsRaw.map(normalize);

  applyRender();
}

$('#btn-refresh').addEventListener('click', load);
$('#btn-favs').addEventListener('click', ()=>{ $('#fav-dialog').showModal(); renderFavorites(); });
$('#btn-export-bib').addEventListener('click', ()=>{
  const list = favStore.get();
  if(!list.length) return alert('还没有收藏任何文章');
  const bib = list.map(toBib).join('\n\n');
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const name = `favorites-${ts}.bib`;
  download(name, bib);
});
$('#btn-export-bib-2').addEventListener('click', ()=> $('#btn-export-bib').click());
$('#btn-clear-favs').addEventListener('click', ()=>{ if(confirm('确定清空所有收藏？')){ favStore.set([]); renderFavorites(); renderFavCount(); }});
$('#q').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ const v=e.target.value.trim(); const u=new URL(location.href); if(v) u.searchParams.set('q',v); else u.searchParams.delete('q'); location.href = u.toString(); }});
$('#btn-apply').addEventListener('click', applyRender);
$('#btn-reset').addEventListener('click', ()=>{
  // 全选期刊、全选状态、清空日期
  $$(".j-check").forEach(x=>x.checked=true);
  $$(".status-check").forEach(x=>x.checked=true);
  $("#date-start").value = ""; $("#date-end").value = "";
  applyRender();
});
$("#journals").addEventListener('change', applyRender);
$$(".status-check").forEach(x=>x.addEventListener('change', applyRender));
$("#date-start").addEventListener('change', applyRender);
$("#date-end").addEventListener('change', applyRender);

load();
