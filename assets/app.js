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

// const isAbs = (u)=> /^https?:\/\//i.test(u||"");
// const bestLink = (it)=>{
//   if(isAbs(it.link)) return it.link;
//   if(it.doi) return `https://doi.org/${it.doi}`;
//   if(isAbs(it.arxiv)) return it.arxiv;
//   return '#';
// };

const isAbs = u => /^https?:\/\//i.test(u||"");
const bestLink = (it)=>{
  if (it.journalKey === 'arXivCM' && isAbs(it.arxiv)) return it.arxiv; // 纯 arXiv
  if (isAbs(it.arxiv)) return it.arxiv;                                 // 有预印本则优先
  if (isAbs(it.link)) return it.link;                                   // 否则官网
  if (it.doi) return `https://doi.org/${it.doi}`;                       // 再退到 DOI
  return '#';
};

function cssVarName(k){
  return ({
    PRResearch:'prr', PRXQ:'prxq', NatPhys:'nphys', NatCommun:'ncomms',
    NatMater:'nmat', NatNano:'nnano', NanoLett:'nalett', SciAdv:'sciadv',
    CPL:'cpl', CPB:'cpb', NSR:'nsr', arXivCM:'arxiv'
  }[k] || k.toLowerCase());
}

function safeApplyLegend(){
  const el = $("#legend"); if(!el) return;
  el.innerHTML = LEGEND.map(([k,v]) =>
    `<span class="legend-item"><span class="swatch" style="background: var(--c-${cssVarName(k)});"></span>${v}</span>`
  ).join("");
}
function safeMakeSourceSelect(){
  const sel = $("#src"); if(!sel) return;
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
  const uid = `${item.journalKey}|${item.doi||item.link||item.arxiv}|${item.date}`;
  return {...item, uid};
}

function cardFromItem(item){
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

  const link = bestLink(item);
  const arxiv = isAbs(item.arxiv) ? item.arxiv : '';

  root.classList.add(item.journalKey);
  badge.classList.add(item.journalKey);
  badge.textContent = item.journalShort || item.journalKey;
  type.textContent  = item.type==='accepted' ? 'Accepted' : (item.type==='preprint' ? 'Preprint' : 'Published');
  time.textContent  = formatDate(item.date);
  title.innerHTML   = `<a href="${link}" target="_blank" rel="noopener noreferrer nofollow">${item.title}</a>`;

  const authorsLine = authorsCondensed(item.authors);
  meta.innerHTML = `<strong>作者：</strong>${authorsLine}${item.doi?`　·　DOI: ${item.doi}`:''}`;
  abs.innerHTML  = `<strong>摘要：</strong>${item.summary || '（无摘要）'}`;

  const pdfLink = arxiv && arxiv.includes('/abs/') ? (arxiv.replace('/abs/','/pdf/') + '.pdf') : '';
  links.innerHTML = `
    <a href="${link}" target="_blank" rel="noopener noreferrer nofollow">页面</a>
    ${arxiv?`<a href="${arxiv}" target="_blank" rel="noopener noreferrer nofollow">arXiv</a>`:''}
    ${pdfLink?`<a href="${pdfLink}" target="_blank" rel="noopener noreferrer nofollow">PDF</a>`:''}
  `;

  const key='pj_favs_v1';
  const list = JSON.parse(localStorage.getItem(key)||'[]');
  if(list.some(x=>x.uid===item.uid)) { star.classList.add('on'); star.textContent='★'; }
  star?.addEventListener('click', ()=>{
    const l = JSON.parse(localStorage.getItem(key)||'[]');
    const i = l.findIndex(x=>x.uid===item.uid);
    if(i>=0){ l.splice(i,1); star.classList.remove('on'); star.textContent='☆'; }
    else { l.push(item); star.classList.add('on'); star.textContent='★'; }
    localStorage.setItem(key, JSON.stringify(l));
    $("#fav-count") && ($("#fav-count").textContent = l.length);
  });

  return tpl;
}

function readSelections(){
  const src  = $("#src")?.value || "";
  const win  = $("#win")?.value || "3";
  const stat = $("#stat")?.value || "all";
  const url = new URL(location.href);
  const q = url.searchParams.get('q') || '';
  if(q) $('#q') && ($('#q').value = q);
  return {src, win, stat, q};
}

function render(){
  const {src, win, stat, q} = readSelections();
  let items = ALL_ITEMS.slice(0);
  if(src) items = items.filter(it => it.journalKey === src);
  if(stat !== 'all') items = items.filter(it => it.type === stat);
  items = items.filter(it => withinDays(it.date, win));
  items = filterByQuery(items, q);

  const box = $('#cards'); if(!box) return;
  box.innerHTML='';
  items.forEach(it=> box.appendChild(cardFromItem(it)) );
  $("#total") && ($("#total").textContent = items.length);
  return items.length;
}

async function load(){
  // 这些节点缺失时也不会报错
  const legend = $("#legend"); const srcSel = $("#src");
  if(legend) safeApplyLegend();
  if(srcSel) safeMakeSourceSelect();
  $("#fav-count") && ($("#fav-count").textContent = (JSON.parse(localStorage.getItem('pj_favs_v1')||'[]')).length);

  let json = null;
  try{
    const resp = await fetch('data/articles.json', {cache:'no-store'});
    if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
    json = await resp.json();
  }catch(err){
    const box = $('#cards');
    if(box) box.innerHTML = `<p class="meta">数据读取失败：${String(err)}</p>`;
    console.error('load articles.json failed', err);
    return;
  }

  ALL_ITEMS = (json.items||[]).map(normalize);
  SERVER_WINDOW = json.windowDays || 3;
  if (SERVER_WINDOW > 3 && $("#win")) $("#win").value = 'all';

  const n = render();
  if(n===0 && $("#win") && $("#win").value !== 'all'){
    $("#win").value = 'all';
    render();
  }
}

/* 事件绑定 */
$('#btn-refresh')?.addEventListener('click', load);
$('#src')?.addEventListener('change', render);
$('#win')?.addEventListener('change', render);
$('#stat')?.addEventListener('change', render);
$('#q')?.addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){
    const v=e.target.value.trim(); const u=new URL(location.href);
    if(v) u.searchParams.set('q',v); else u.searchParams.delete('q');
    location.href = u.toString();
  }
});
$('#btn-favs')?.addEventListener('click', ()=>{
  $('#fav-dialog')?.showModal();
  const key='pj_favs_v1';
  const list = JSON.parse(localStorage.getItem(key)||'[]');
  const box = $("#fav-list");
  if(!box) return;
  if(!list.length){ box.innerHTML = '<p class="meta">尚未收藏任何文章。</p>'; return; }
  box.innerHTML = list.map(item => `
    <article class="card tone ${item.journalKey}">
      <div class="card-head">
        <span class="badge ${item.journalKey}">${item.journalShort||item.journalKey}</span>
        <span class="type">${item.type==='accepted'?'Accepted':(item.type==='preprint'?'Preprint':'Published')}</span>
        <span class="time">${formatDate(item.date)}</span>
        <button class="star on" data-uid="${item.uid}">★</button>
      </div>
      <h3 class="title"><a href="${bestLink(item)}" target="_blank" rel="noopener noreferrer nofollow">${item.title}</a></h3>
      <p class="meta"><strong>作者：</strong>${authorsCondensed(item.authors)}${item.doi?`　·　DOI: ${item.doi}`:''}</p>
      ${item.summary?`<p class="abs"><strong>摘要：</strong>${item.summary}</p>`:''}
    </article>`).join("");
  $$(".star", box).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const uid = btn.dataset.uid;
      const l = JSON.parse(localStorage.getItem(key)||'[]');
      const i = l.findIndex(x=>x.uid===uid);
      if(i>=0) l.splice(i,1);
      localStorage.setItem(key, JSON.stringify(l));
      btn.closest('article').remove();
      $("#fav-count") && ($("#fav-count").textContent = l.length);
    });
  });
});

load();
