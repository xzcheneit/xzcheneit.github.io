const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];

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
  ["NatMater","Nature Materials"],
  ["NatNano","Nature Nanotechnology"],
  ["Science","Science"],
  ["SciAdv","Science Advances"],
  ["NanoLett","Nano Letters"],
  ["NJP","New Journal of Physics"],
  ["CPL","Chinese Physics Letters"],
  ["CPB","Chinese Physics B"],
  ["NSR","National Science Review"],
  ["arXivCM","arXiv cond-mat"]
];

let ALL_ITEMS = [];
const favStore = {
  key: 'pj_favs_v1',
  get(){ try{ return JSON.parse(localStorage.getItem(this.key)||'[]'); }catch{ return [] } },
  set(v){ localStorage.setItem(this.key, JSON.stringify(v)); },
  add(it){ const a=this.get(); if(!a.find(x=>x.uid===it.uid)){ a.push(it); this.set(a);} },
  remove(uid){ this.set(this.get().filter(x=>x.uid!==uid)); },
  has(uid){ return this.get().some(x=>x.uid===uid); }
};

function fmtAuthors(authors){
  if(!authors || !authors.length) return "";
  const names = authors.map(a=> typeof a === 'string' ? a : (a.name||a.family||a.given||"?") );
  return names.slice(0,3).join(", ") + (names.length>3?` 等(${names.length})`:"");
}
function formatDate(iso){
  if(!iso) return ""; const d = new Date(iso);
  const pad = n=> String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function makeSourceSelect(){
  const sel = $("#src");
  sel.innerHTML = `<option value="">全部来源</option>` +
    LEGEND.map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
}
function applyLegend(){
  $("#legend").innerHTML = LEGEND.map(([k,v]) =>
    `<span class="legend-item"><span class="swatch" style="background: var(--c-${cssVarName(k)});"></span>${v}</span>`
  ).join("");
}
function cssVarName(k){
  return ({
    PRResearch:'prr', PRXQ:'prxq', NatPhys:'nphys', NatCommun:'ncomms',
    NatMater:'nmat', NatNano:'nnano', NanoLett:'nalett', SciAdv:'sciadv',
    CPL:'cpl', CPB:'cpb', NSR:'nsr', arXivCM:'arxiv'
  }[k] || k.toLowerCase());
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

function normalize(item){
  const uid = `${item.journalKey}|${item.doi||item.link}|${item.date}`;
  return {...item, uid};
}

function cardFromItem(item){
  const tpl = $("#card-tpl").content.cloneNode(true);
  const root = tpl.querySelector('.card');
  const badge = tpl.querySelector('.badge');
  const type = tpl.querySelector('.type');
  const time = tpl.querySelector('.time');
  const title = tpl.querySelector('.title');
  const meta = tpl.querySelector('.meta');
  const abs = tpl.querySelector('.abs');
  const links = tpl.querySelector('.links');
  const star = tpl.querySelector('.star');

  root.classList.add(item.journalKey); // 着色
  badge.classList.add(item.journalKey);
  badge.textContent = item.journalShort || item.journalKey;
  type.textContent = item.type==='accepted' ? 'Accepted' : (item.type==='preprint' ? 'Preprint' : 'Published');
  time.textContent = formatDate(item.date);
  title.innerHTML = `<a href="${item.link}" target="_blank" rel="noopener">${item.title}</a>`;
  meta.textContent = `${fmtAuthors(item.authors)}${item.doi?` · DOI: ${item.doi}`:''}`;
  abs.textContent = item.summary || '';

  const pdfLink = (item.arxiv && item.arxiv.replace('/abs/','/pdf/') + '.pdf');
  links.innerHTML = `
    <a href="${item.link}" target="_blank" rel="noopener">页面</a>
    ${item.arxiv?`<a href="${item.arxiv}" target="_blank" rel="noopener">arXiv</a>`:''}
    ${pdfLink?`<a href="${pdfLink}" target="_blank" rel="noopener">PDF</a>`:''}
  `;

  if(favStore.has(item.uid)) star.classList.add('on'), star.textContent='★';
  star.addEventListener('click', ()=>{
    if(favStore.has(item.uid)) { favStore.remove(item.uid); star.classList.remove('on'); star.textContent='☆'; }
    else { favStore.add(item); star.classList.add('on'); star.textContent='★'; }
    $("#fav-count").textContent = favStore.get().length;
  });

  return tpl;
}

function applyRender(){
  const url = new URL(location.href);
  const query = url.searchParams.get('q') || '';
  if(query) $('#q').value = query;

  const src = $("#src").value;         // 单选期刊
  const win = $("#win").value;         // 单选窗口
  const stat = $("#stat").value;       // 单选状态

  let items = ALL_ITEMS.slice(0);
  if(src) items = items.filter(it => it.journalKey === src);
  if(stat !== 'all') items = items.filter(it => it.type === stat);
  items = items.filter(it => withinDays(it.date, win));
  items = filterByQuery(items, query);

  const box = $('#cards'); box.innerHTML='';
  items.forEach(it=> box.appendChild(cardFromItem(it)) );
  $("#total").textContent = items.length;
}

async function load(){
  makeSourceSelect(); applyLegend();
  $("#fav-count").textContent = favStore.get().length;

  const resp = await fetch('data/articles.json', {cache:'no-store'});
  const json = await resp.json();
  ALL_ITEMS = (json.items||[]).map(normalize);

  applyRender();
}

$('#btn-refresh').addEventListener('click', load);
$('#btn-favs').addEventListener('click', ()=>{ $('#fav-dialog').showModal();
  const list = favStore.get(), box = $("#fav-list");
  if(!list.length){ box.innerHTML = '<p class="meta">尚未收藏任何文章。</p>'; return; }
  box.innerHTML = list.map(item => `
    <article class="card tone ${item.journalKey}">
      <div class="card-head">
        <span class="badge ${item.journalKey}">${item.journalShort||item.journalKey}</span>
        <span class="type">${item.type==='accepted'?'Accepted':(item.type==='preprint'?'Preprint':'Published')}</span>
        <span class="time">${formatDate(item.date)}</span>
        <button class="star on" data-uid="${item.uid}">★</button>
      </div>
      <h3 class="title"><a href="${item.link}" target="_blank" rel="noopener">${item.title}</a></h3>
      <p class="meta">${fmtAuthors(item.authors)}${item.doi?` · DOI: ${item.doi}`:''}</p>
      ${item.summary?`<p class="abs">${item.summary}</p>`:''}
    </article>`).join("");
  $$(".star", box).forEach(btn=>{
    btn.addEventListener('click', ()=>{ favStore.remove(btn.dataset.uid); btn.closest('article').remove(); $("#fav-count").textContent = favStore.get().length; });
  });
});
$('#btn-export-bib').addEventListener('click', ()=>{
  const list = favStore.get(); if(!list.length) return alert('还没有收藏任何文章');
  const bib = list.map(toBib).join('\n\n');
  const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const name = `favorites-${ts}.bib`;
  const blob = new Blob([bib], {type:'text/plain;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
});
$('#btn-export-bib-2').addEventListener('click', ()=> $('#btn-export-bib').click());
$('#btn-clear-favs').addEventListener('click', ()=>{ if(confirm('确定清空所有收藏？')){ favStore.set([]); $("#fav-list").innerHTML=''; $("#fav-count").textContent='0'; }});
$('#q').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ const v=e.target.value.trim(); const u=new URL(location.href); if(v) u.searchParams.set('q',v); else u.searchParams.delete('q'); location.href = u.toString(); }});
$('#src').addEventListener('change', applyRender);
$('#win').addEventListener('change', applyRender);
$('#stat').addEventListener('change', applyRender);

load();
