const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => [...el.querySelectorAll(sel)];

const LEGEND = [
  ["PRL","Phys. Rev. Lett."],["PRB","Phys. Rev. B"],["PRE","Phys. Rev. E"],
  ["PRResearch","Phys. Rev. Research"],["PRX","Phys. Rev. X"],["PRXQ","PRX Quantum"],
  ["Nature","Nature"],["NatPhys","Nature Physics"],["NatCommun","Nature Communications"],
  ["NatMater","Nature Materials"],["NatNano","Nature Nanotechnology"],
  ["Science","Science"],["SciAdv","Science Advances"],["NanoLett","Nano Letters"],
  ["NJP","New Journal of Physics"],["CPL","Chinese Physics Letters"],["CPB","Chinese Physics B"],
  ["NSR","National Science Review"],["arXivCM","arXiv cond-mat"]
];

let ALL_ITEMS = [];
let SERVER_WINDOW = 3;

function cssVarName(k){
  return ({
    PRResearch:'prr', PRXQ:'prxq', NatPhys:'nphys', NatCommun:'ncomms',
    NatMater:'nmat', NatNano:'nnano', NanoLett:'nalett', SciAdv:'sciadv',
    CPL:'cpl', CPB:'cpb', NSR:'nsr', arXivCM:'arxiv'
  }[k] || k.toLowerCase());
}

function applyLegend(){
  $("#legend").innerHTML = LEGEND.map(([k,v]) =>
    `<span class="legend-item"><span class="swatch" style="background: var(--c-${cssVarName(k)});"></span>${v}</span>`
  ).join("");
}

function makeSourceSelect(){
  const sel = $("#src");
  sel.innerHTML = `<option value="">全部来源</option>` +
    LEGEND.map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
}

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
  if(!iso) return ""; const d = new Date(iso);
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

function normalize(item){
  const uid = `${item.journalKey}|${item.doi||item.link}|${item.date}`;
  return {...item, uid};
}

function toBib(item){
  const type = (item.type==='preprint') || (item.arxiv && (!item.doi || item.type==='accepted')) ? 'misc' : 'article';
  const au = fmtAuthorsList(item.authors).join(' and ');
  const lines = [];
  lines.push(`@${type}{${(fmtAuthorsList(item.authors)[0]||'na')}${new Date(item.date).getFullYear() || ''},`);
  lines.push(`  title={${item.title||''}},`);
  if(au) lines.push(`  author={${au}},`);
  if(item.journal) lines.push(`  journal={${item.journal}},`);
  const y = (item.date? new Date(item.date).getFullYear(): undefined);
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

function cardFromItem(item){
  const tpl = $("#card-tpl").content.cloneNode(true);
  const root  = tpl.querySelector('.card');
  const badge = tpl.querySelector('.badge');
  const type  = tpl.querySelector('.type');
  const time  = tpl.querySelector('.time');
  const title = tpl.querySelector('.title');
  const meta  = tpl.querySelector('.meta');
  const abs   = tpl.querySelector('.abs');
  const links = tpl.querySelector('.links');
  const star  = tpl.querySelector('.star');

  root.classList.add(item.journalKey);  // 背景着色
  badge.classList.add(item.journalKey);
  badge.textContent = item.journalShort || item.journalKey;
  type.textContent  = item.type==='accepted' ? 'Accepted' : (item.type==='preprint' ? 'Preprint' : 'Published');
  time.textContent  = formatDate(item.date);
  title.innerHTML   = `<a href="${item.link}" target="_blank" rel="noopener">${item.title}</a>`;

  // 作者单独一行
  const authorsLine = authorsCondensed(item.authors);
  meta.innerHTML = `<strong>作者：</strong>${authorsLine}${item.doi?`　·　DOI: ${item.doi}`:''}`;

  // 摘要单独一行
  abs.innerHTML = `<strong>摘要：</strong>${item.summary || '（无摘要）'}`;

  const pdfLink = (item.arxiv && item.arxiv.includes('/abs/')) ? (item.arxiv.replace('/abs/','/pdf/') + '.pdf') : '';
  links.innerHTML = `
    <a href="${item.link}" target="_blank" rel="noopener">页面</a>
    ${item.arxiv?`<a href="${item.arxiv}" target="_blank" rel="noopener">arXiv</a>`:''}
    ${pdfLink?`<a href="${pdfLink}" target="_blank" rel="noopener">PDF</a>`:''}
  `;

  if(localStorage.getItem('pj_favs_v1')){
    const list = JSON.parse(localStorage.getItem('pj_favs_v1')||'[]');
    if(list.some(x=>x.uid===item.uid)) { star.classList.add('on'); star.textContent='★'; }
  }
  star.addEventListener('click', ()=>{
    const key='pj_favs_v1';
    const list = JSON.parse(localStorage.getItem(key)||'[]');
    const i = list.findIndex(x=>x.uid===item.uid);
    if(i>=0){ list.splice(i,1); star.classList.remove('on'); star.textContent='☆'; }
    else { list.push(item); star.classList.add('on'); star.textContent='★'; }
    localStorage.setItem(key, JSON.stringify(list));
    $("#fav-count").textContent = list.length;
  });

  return tpl;
}

function applyRender(){
  const url = new URL(location.href);
  const query = url.searchParams.get('q') || '';
  if(query) $('#q').value = query;

  const src  = $("#src").value;
  const win  = $("#win").value;
  const stat = $("#stat").value;

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
  applyLegend(); makeSourceSelect();
  $("#fav-count").textContent = (JSON.parse(localStorage.getItem('pj_favs_v1')||'[]')).length;

  const resp = await fetch('data/articles.json', {cache:'no-store'});
  const json = await resp.json();
  ALL_ITEMS = (json.items||[]).map(normalize);
  SERVER_WINDOW = json.windowDays || 3;

  // 若服务端窗口>3，默认把前端时间窗口切到“全部时间”，避免只看见少数刊物
  if (SERVER_WINDOW > 3) {
    const winSel = $("#win");
    if (winSel) winSel.value = 'all';
  }

  applyRender();
}

$('#btn-refresh').addEventListener('click', load);
$('#src').addEventListener('change', applyRender);
$('#win').addEventListener('change', applyRender);
$('#stat').addEventListener('change', applyRender);

$('#q').addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){
    const v=e.target.value.trim(); const u=new URL(location.href);
    if(v) u.searchParams.set('q',v); else u.searchParams.delete('q');
    location.href = u.toString();
  }
});

$('#btn-favs').addEventListener('click', ()=>{
  $('#fav-dialog').showModal();
  const key='pj_favs_v1';
  const list = JSON.parse(localStorage.getItem(key)||'[]');
  const box = $("#fav-list");
  if(!list.length){ box.innerHTML = '<p class="meta">尚未收藏任何文章。</p>'; return; }
  box.innerHTML = list.map(item => `
    <article class="card tone ${item.journalKey}">
      <div class="card-head">
        <span class="badge ${item.journalKey}">${item.journalShort||item.journalKey}</span>
        <span class="type">${item.type==='accepted'?'Accepted':(item.type==='preprint'?'Preprint':'Published')}</span>
        <span class="time">${formatDate(item.date)}</span>
        <button class="star on" data-uid="${item.uid}">★</button>
      </div>
      <h3 class="title"><a href="${item.li
