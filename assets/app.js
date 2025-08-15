import { parseBibTeX } from './bibtex.js';

/* Storage keys */
const K_ITEMS='biblab_items_v4', K_CATS='biblab_categories_v4', K_ASG='biblab_assign_v4';
const K_NOTES='biblab_notes_v4', K_THEME='biblab_theme_v4', K_RATINGS='biblab_ratings_v4';

/* State */
let state={items:[],categories:[],assign:{},notes:{},ratings:{},view:'unsorted',q:'',sort:'date_desc',theme:'dark'};

/* Journal map & abbreviations */
const JOURNAL_KEY={
  'phys. rev. lett.':'PRL','physical review letters':'PRL','phys. rev. a':'PRA','physical review a':'PRA',
  'phys. rev. b':'PRB','physical review b':'PRB','phys. rev. x':'PRX','physical review x':'PRX',
  'phys. rev. research':'PRR','physical review research':'PRR',
  'nature physics':'NatPhys','nature communications':'NC','nat. commun.':'NC',
  'nature':'NChem','nature chemistry':'NChem','chemical science':'ChemSci','chem. sci.':'ChemSci',
  'science':'Science','prx quantum':'PRXQ','phys. rev. e':'PRE','epl':'EPL','europhysics letters':'EPL'
};
function journalKeyOf(j){
  const s=(j||'').toLowerCase().trim();
  return JOURNAL_KEY[s] || (s.includes('arxiv')?'arXiv':'Else');
}
function journalAbbrOf(j){
  const k=journalKeyOf(j);
  const MAP={PRL:'PRL',PRB:'PRB',PRX:'PRX',PRR:'PRR',NatPhys:'NP',NC:'NC',NChem:'NC',ChemSci:'CS',Science:'SC',PRXQ:'PRXQ',PRE:'PRE',EPL:'EPL',arXiv:'arXiv',Else:'J'};
  return MAP[k] || 'J';
}

/* Names */
function surnameOf(name){
  if(!name) return 'Anon';
  // handle "Last, First" or "First Last"
  if(name.includes(',')) return name.split(',')[0].trim().replace(/\s+/g,'');
  const parts=name.trim().split(/\s+/);
  return (parts[parts.length-1]||'Anon').replace(/[^A-Za-z\u4e00-\u9fa5]/g,'');
}
function normalizeAuthors(a){
  if(!a) return [];
  if(Array.isArray(a)) return a.map(x=>x.trim()).filter(Boolean);
  return a.split(/\s+and\s+|;\s*|,\s*(?=[A-Z][a-z])/).map(x=>x.trim()).filter(Boolean);
}

/* UID */
function makeUID(it){
  const base = `${it.title}__${(it.authors||[]).join(',')}__${it.journal||''}__${it.year||''}__${it.doi||it.arxiv||it.url||''}`;
  let h=0; for(let i=0;i<base.length;i++){ h=((h<<5)-h)+base.charCodeAt(i); h|=0; }
  return 'u'+Math.abs(h).toString(36);
}

/* Bib key (备用：文件中已有 citeKeyFor，这里保留一致策略) */
function citeKeyFor(it, seen){
  const first=(it.authors||[])[0]||'Anon';
  const sur=surnameOf(first);
  const y=(it.year || (it.date?new Date(it.date).getUTCFullYear():'')) || '';
  const abbr=journalAbbrOf(it.journal || (it.arxiv?'arXiv':''));
  let key=`${sur}${y}${abbr}`.replace(/[^A-Za-z0-9]+/g,'');
  let i=0, sfx='';
  while(seen.has(key+sfx)){ i++; sfx=String.fromCharCode(96+i); }
  seen.add(key+sfx);
  return key+sfx;
}

/* Load/Save */
function saveAll(){ localStorage.setItem(K_ITEMS, JSON.stringify(state.items)); localStorage.setItem(K_CATS, JSON.stringify(state.categories)); localStorage.setItem(K_ASG, JSON.stringify(state.assign)); localStorage.setItem(K_NOTES, JSON.stringify(state.notes)); localStorage.setItem(K_RATINGS, JSON.stringify(state.ratings)); localStorage.setItem(K_THEME, state.theme); }
function loadAll(){ try{ state.items=JSON.parse(localStorage.getItem(K_ITEMS)||'[]'); state.categories=JSON.parse(localStorage.getItem(K_CATS)||'[]'); state.assign=JSON.parse(localStorage.getItem(K_ASG)||'{}'); state.notes=JSON.parse(localStorage.getItem(K_NOTES)||'{}'); state.ratings=JSON.parse(localStorage.getItem(K_RATINGS)||'{}'); state.theme=localStorage.getItem(K_THEME)||'dark'; }catch(e){ console.warn(e);} }

/* Categories */
function defaultCats(){ return [{id:'c1',name:'Reviews',color:'#ffd166'},{id:'c2',name:'Methods',color:'#06d6a0'},{id:'c3',name:'Theory',color:'#118ab2'},{id:'c4',name:'Experiment',color:'#ef476f'},{id:'c5',name:'Hot',color:'#f78c6b'},{id:'c6',name:'Unsorted',color:'#8da3b8'}]; }
function findCatByName(name){ return state.categories.find(c=>c.name.toLowerCase()===name.toLowerCase()); }
function ensureUnsortedId(){ const u=findCatByName('Unsorted'); return u?u.id:state.categories[state.categories.length-1]?.id; }

/* Theme */
function applyTheme(){ if(state.theme==='light') document.body.setAttribute('data-theme','light'); else document.body.removeAttribute('data-theme'); document.getElementById('btn-theme').querySelector('.label').textContent = state.theme==='light' ? '☀️ 浅色' : '🌙 深色'; }

/* Rendering */
function renderAll(){
  renderCategoryList();
  document.getElementById('btn-unsorted').classList.toggle('solid',state.view==='unsorted');
  document.getElementById('btn-board').classList.toggle('solid',state.view==='board'||state.view.startsWith('cat:'));
  if(state.view==='board'){ document.getElementById('board').hidden=false; document.getElementById('cards').hidden=true; buildBoard(); }
  else { document.getElementById('board').hidden=true; document.getElementById('cards').hidden=false; buildCards(); }
  document.getElementById('hint').hidden=state.items.length>0;
  applyTheme();
}
function renderCategoryList(){
  const host=document.querySelector('#category-list');
  const toolbar=host.querySelector('.cat-toolbar'); host.innerHTML=''; host.appendChild(toolbar);
  for(const c of state.categories){
    const tpl=document.getElementById('tpl-category-item').content.cloneNode(true);
    const root=tpl.querySelector('.cat-item');
    root.dataset.cid=c.id;
    root.querySelector('.cat-name').textContent=c.name;
    root.querySelector('.dot').style.background=c.color;
    root.querySelector('.count').textContent=countInCat(c.id);
    const dz=root.querySelector('.dropzone'); dz.dataset.cid=c.id; bindDropzone(dz);
    const nm=root.querySelector('.cat-name');
    nm.addEventListener('blur',()=>{ c.name=nm.textContent.trim()||c.name; saveAll(); renderAll(); });
    root.querySelector('.enter').addEventListener('click',()=>{ state.view='cat:'+c.id; renderAll(); });
    root.querySelector('.clr').addEventListener('click',()=>{ if(confirm(`清空“${c.name}”？`)){ for(const uid of Object.keys(state.assign)){ if(state.assign[uid]===c.id) delete state.assign[uid]; } saveAll(); renderAll(); }});
    root.querySelector('.exp').addEventListener('click',()=> exportBibForCategory(c.id));
    host.appendChild(root);
  }
}
function buildCards(){
  const host=document.getElementById('cards'); host.innerHTML='';
  const q=(state.q||'').toLowerCase();
  let items=currentScopeItems();
  if(q){
    items = items.filter(it=>(
      (it.title||'').toLowerCase().includes(q) ||
      (it.journal||'').toLowerCase().includes(q) ||
      (it.doi||'').toLowerCase().includes(q) ||
      (it.abstract||'').toLowerCase().includes(q) ||
      (it.authors||[]).join(' ').toLowerCase().includes(q)
    ));
  }
  items = sortItems(items, state.sort);
  for(const it of items) host.appendChild(makeCard(it));
}
function sortItems(items,by){
  const arr=items.slice();
  if(by==='date_desc') arr.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  else if(by==='date_asc') arr.sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  else if(by==='title_asc') arr.sort((a,b)=>(a.title||'').localeCompare(b.title||''));
  else if(by==='title_desc') arr.sort((a,b)=>(b.title||'').localeCompare(a.title||''));
  return arr;
}
function makeCard(it){
  const tpl=document.getElementById('tpl-card').content.cloneNode(true);
  const el=tpl.querySelector('.card');
  el.dataset.uid=it.uid;
  // drag anim
  el.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain', it.uid); e.dataTransfer.effectAllowed='move'; requestAnimationFrame(()=>el.classList.add('dragging')); });
  el.addEventListener('dragend',e=>{ e.stopPropagation(); el.classList.remove('dragging'); });
  // badges
  const k=it.journalKey||'Else'; const bj=tpl.querySelector('.badge.journal'); const key4class=(k==='NatPhys'?'NP':k);
  bj.textContent=(k==='NatPhys'?'NP':k); bj.classList.add('j-'+key4class);
  tpl.querySelector('.badge.type').textContent=it.type||'article';
  // category badge
  const cid=state.assign[it.uid]; const cat=state.categories.find(c=>c.id===cid);
  const bc=tpl.querySelector('.badge.cat'); if(cat){ bc.textContent=cat.name; bc.style.background=cat.color; } else { bc.hidden=true; }
  // title/authors/journal
  tpl.querySelector('.title').textContent=it.title||'(无标题)';
  const au=it.authors||[]; const show = au.length<=3? au.join(', ') : `${au[0]} … ${au[au.length-1]}（共 ${au.length} 人）`;
  tpl.querySelector('.authors').innerHTML = `<strong>作者：</strong>${show}${it.doi?`　·　DOI: ${it.doi}`:''}`;
  tpl.querySelector('.journal').textContent=it.journal|| (it.arxiv?'arXiv':'');
  // date
  const dt = it.date ? new Date(it.date) : null;
  tpl.querySelector('.time').textContent = dt ? `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}` : '';
  // abstract
  tpl.querySelector('.abs').innerHTML = `<strong>摘要：</strong>${it.abstract||''}`;
  // links
  const link = it.url || (it.doi?`https://doi.org/${it.doi}`:'') || (it.arxiv?`https://arxiv.org/abs/${it.arxiv}`:'');
  const links = [];
  if(link) links.push(`<a href="${link}" target="_blank" rel="noopener noreferrer nofollow">页面</a>`);
  if(it.arxiv){
    links.push(`<a href="https://arxiv.org/abs/${it.arxiv}" target="_blank" rel="noopener noreferrer nofollow">arXiv</a>`);
    links.push(`<a href="https://arxiv.org/pdf/${it.arxiv}.pdf" target="_blank" rel="noopener noreferrer nofollow">PDF</a>`);
  }
  tpl.querySelector('.links').innerHTML=links.join(' · ');
  // stars
  const st=tpl.querySelector('.star');
  st.addEventListener('click',()=>{ const cur=state.ratings[it.uid]?.manual||0; const next=(cur>=5?0:cur+1); state.ratings[it.uid]={manual:next,auto:0}; saveAll(); updateStars(el,it.uid); });
  // favorite mark (has note)
  const bi=tpl.querySelector('.badge.info');
  const has=(state.notes[it.uid]||'').trim().length>0; bi.hidden=!has;
  // drag category dots
  const dots=tpl.querySelector('.cat-dots'); dots.innerHTML='';
  for(const c of state.categories){ const d=document.createElement('span'); d.className='dot'; d.title=c.name; d.style.background=c.color; d.draggable=true; d.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain', it.uid); e.dataTransfer.setData('dest-cid', c.id); e.dataTransfer.effectAllowed='move'; d.classList.add('dragging'); }); d.addEventListener('dragend',()=> d.classList.remove('dragging')); d.addEventListener('click',()=>{ state.assign[it.uid]=c.id; saveAll(); renderAll(); }); dots.appendChild(d); }
  el.classList.add('tone-'+key4class);
  initStars(el,it.uid);
  return el;
}
function stripBraces(s){ return (s||'').replace(/[{}]/g,''); }

/* Stars */
function autoRatingOf(text){ const n=(text||'').trim().length; const halfSteps=Math.floor(n/50); return Math.min(5, halfSteps*0.5); }
function initStars(el,uid){
  const box=el.querySelector('.stars'); box.innerHTML='';
  const manual=(state.ratings[uid]?.manual)||0;
  const auto=(state.ratings[uid]?.auto)||0;
  for(let i=1;i<=10;i++){
    const b=document.createElement('button'); b.className='starbtn'; b.textContent='★'; b.title=(i*0.5).toFixed(1);
    if(i<=manual*2) b.classList.add('on-manual'); else if(i<=auto*2) b.classList.add('on-auto');
    b.addEventListener('click',()=>{ state.ratings[uid]={manual:i/2,auto:0}; saveAll(); updateStars(el,uid); });
    box.appendChild(b);
  }
}
function updateStars(el,uid){
  const s=el.querySelector('.stars');
  const manual=(state.ratings[uid]?.manual)||0;
  const auto=(state.ratings[uid]?.auto)||autoRatingOf(el.querySelector('.abs')?.textContent||'');
  state.ratings[uid]={manual,auto};
  saveAll();
  const has=(state.notes[uid]||'').trim().length>0; el.querySelector('.badge.info').hidden=!has;
}

/* Drag board */
function buildBoard(){
  const host=document.getElementById('board'); host.innerHTML='';
  for(const c of state.categories){
    const tpl=document.getElementById('tpl-column').content.cloneNode(true);
    const root=tpl.querySelector('.col');
    root.dataset.cid=c.id;
    root.querySelector('.col-head .name').textContent=c.name;
    root.querySelector('.col-head .count').textContent=countInCat(c.id);
    const dz=root.querySelector('.dropzone'); dz.dataset.cid=c.id; bindDropzone(dz);
    const list=root.querySelector('.col-list'); list.innerHTML='';
    for(const it of itemsInCat(c.id)) list.appendChild(makeCard(it));
    root.querySelector('.exp').addEventListener('click',()=> exportBibForCategory(c.id));
    host.appendChild(root);
  }
}
function bindDropzone(dz){
  dz.addEventListener('dragover',e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; dz.classList.add('over'); });
  dz.addEventListener('dragleave',e=>{ e.stopPropagation(); dz.classList.remove('over'); });
  dz.addEventListener('drop',e=>{
    e.preventDefault(); e.stopPropagation(); dz.classList.remove('over'); dz.classList.add('accept'); setTimeout(()=>dz.classList.remove('accept'), 600);
    const uid=e.dataTransfer.getData('text/plain');
    if(uid){ state.assign[uid]=dz.dataset.cid; saveAll(); renderAll(); }
  });
}
function itemsInCat(cid){ return state.items.filter(it=>state.assign[it.uid]===cid); }
function countInCat(cid){ return Object.values(state.assign).filter(x=>x===cid).length; }

/* Import .bib */
async function readFileWithFallbacks(file){
  const buf=await file.arrayBuffer();
  const enc=['utf-8','utf-16le','utf-16be','gb18030','gbk','windows-1252'];
  for(const e of enc){ try{ const dec=new TextDecoder(e); const t=dec.decode(buf); if(t && t.trim().length>0) return t; }catch(err){} }
  return await file.text();
}
async function importBibFile(file){
  try{
    const txt=await readFileWithFallbacks(file);
    document.getElementById('log').textContent=`读取到 ${txt.length} 字符，解析中…`;
    const raw=parseBibTeX(txt);
    document.getElementById('log').textContent=`解析到 ${raw.length} 条目`;
    if(raw.length===0){ alert('未从 .bib 解析到任何条目。'); return; }
    const items=raw.map(toItem).filter(Boolean);
    const map=new Map(state.items.map(x=>[x.uid,x]));
    let added=0, updated=0;
    for(const it of items){
      if(map.has(it.uid)){ const old=map.get(it.uid); Object.assign(old,it); updated++; }
      else { state.items.push(it); added++; }
      if(!state.assign[it.uid]){
        const unsortedId=ensureUnsortedId();
        state.assign[it.uid]=unsortedId;
        if(!state.ratings[it.uid]) state.ratings[it.uid]={manual:0,auto:0};
      }
    }
    saveAll(); renderAll();
    alert(`导入成功：${items.length} 篇（总计 ${state.items.length} 篇），已放入 Unsorted。`);
  }catch(err){ console.error(err); alert('导入失败：'+err.message); }
}
function extractArxiv(fields){
  const eprint=(fields['eprint']||'').trim();
  const arch=(fields['archiveprefix']||'').toLowerCase();
  const url=(fields['url']||'');
  if(arch==='arxiv' && eprint) return eprint.replace(/^arxiv:/i,'').trim();
  const m=url.match(/arxiv\.org\/abs\/([\w\.\-\/]+)/i);
  if(m) return m[1];
  return '';
}
function toItem(entry){
  const f=entry.fields||{};
  const title=f['title']||'';
  const authors=normalizeAuthors(f['author']);
  const journal=f['journal']||f['booktitle']||'';
  const year=f['year']||'';
  const month=f['month']||'';
  const day=f['day']||'';
  const date=f['date']?new Date(f['date']).toISOString():toDateISO(year,month,day);
  const doi=(f['doi']||'').replace(/^https?:\/\/doi\.org\//i,'').trim();
  const url=f['url']||(doi?`https://doi.org/${doi}`:'');
  const arxiv=extractArxiv(f);
  const abstract=cleanAbstract(f['abstract']||'');
  const journalKey=journalKeyOf(journal || (arxiv?'arXiv':''));
  let type=(entry.type || f['entrytype'] || '').toLowerCase();
  if(!type) type = arxiv && !journal ? 'preprint' : 'article';
  const it={title,authors,journal,journalKey,type,date,year,month,doi,url,arxiv,abstract};
  it.uid=makeUID(it);
  return it;
}

/* Export */
function exportJSON(){
  const data={items:state.items,categories:state.categories,assign:state.assign,notes:state.notes,ratings:state.ratings,exportedAt:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  downloadBlob(blob,`biblab-snapshot-${ts()}.json`);
}
function currentScopeItems(){
  const unsortedId=ensureUnsortedId();
  if(state.view==='unsorted') return state.items.filter(it=>state.assign[it.uid]===unsortedId);
  if(state.view.startsWith('cat:')) return itemsInCat(state.view.slice(4));
  return state.items.filter(it=>state.assign[it.uid]===unsortedId);
}
function exportBib(scope='current'){
  let items=[];
  if(scope==='current') items=currentScopeItems(); else items=state.items;
  const seen=new Set();
  const txt=items.map(it=>toBib(it,seen)).join('\n\n');
  const blob=new Blob([txt],{type:'text/plain'});
  downloadBlob(blob,`biblab-export-${ts()}.bib`);
}
function exportBibForCategory(cid){
  const items=itemsInCat(cid);
  const seen=new Set();
  const txt=items.map(it=>toBib(it,seen)).join('\n\n');
  const blob=new Blob([txt],{type:'text/plain'});
  const name=(state.categories.find(c=>c.id===cid)?.name||'cat').replace(/\s+/g,'_');
  downloadBlob(blob,`biblab-${name}-${ts()}.bib`);
}

/* Utils */
function ts(){ const d=new Date(); const pad=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
function downloadBlob(blob,filename){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },0); }
function debounce(fn,ms){ let t=null; return ()=>{ clearTimeout(t); t=setTimeout(fn,ms); }; }

/* Import JSON */
async function importJSONFile(file){
  const txt=await file.text();
  const data=JSON.parse(txt);
  if(data.items && data.categories && data.assign){
    state.items=data.items;
    state.categories=data.categories;
    state.assign=data.assign;
    state.notes=data.notes||{};
    state.ratings=data.ratings||{};
    saveAll(); renderAll();
    alert('JSON 导入成功');
  }else{
    alert('JSON 结构不符合预期：需要 items/categories/assign');
  }
}

/* Clear */
function clearAll(){
  if(!confirm('确认清空本地数据？')) return;
  localStorage.removeItem(K_ITEMS);
  localStorage.removeItem(K_CATS);
  localStorage.removeItem(K_ASG);
  localStorage.removeItem(K_NOTES);
  localStorage.removeItem(K_RATINGS);
  state={items:[],categories:[],assign:{},notes:{},ratings:{},view:'unsorted',q:'',sort:'date_desc',theme:state.theme};
  renderAll();
}

/* ---- Helpers for parsing & cleaning ---- */
function cleanAbstract(s){
  s = (s||'').replace(/<[^>]+>/g,' ');
  s = s.replace(/\s+/g,' ').trim();
  s = s.replace(/^\s*(?:Authors?|Author\(s\))\s*:\s*.*?(?=\.|$)/i,'').trim();
  return s;
}
function toDateISO(year,month,day){
  const y=parseInt(year||''); const m=isNaN(parseInt(month))?1:parseInt(month); const d=isNaN(parseInt(day))?1:parseInt(day);
  if(y) return new Date(Date.UTC(y,(m-1)||0,d||1)).toISOString();
  return '';
}

/* ---- Export: BibTeX —— 这里已按你的要求改过 ---- */
function toBib(it,seen){
  const kind=(it.journal||it.doi)?'article':'misc';
  const key=citeKeyFor(it,seen);

  const fields=[];
  fields.push(`  title = {${it.title||''}}`);
  if((it.authors||[]).length) fields.push(`  author = {${it.authors.join(' and ')}}`);
  if(it.journal) fields.push(`  journal = {${it.journal}}`);
  const year=it.year || (it.date ? new Date(it.date).getUTCFullYear() : '');
  if(year) fields.push(`  year = {${year}}`);
  if(it.doi) fields.push(`  doi = {${it.doi}}`);
  if(it.arxiv){ fields.push(`  eprint = {${it.arxiv}}`); fields.push(`  archivePrefix = {arXiv}`); }
  if(it.url) fields.push(`  url = {${it.url}}`);

  // ✅ 新增摘要（优先 it.abstract，其次 it.summary），去掉花括号防止 BibTeX 解析问题
  const absText = (it.abstract ?? it.summary ?? '').toString().trim();
  if (absText) fields.push(`  abstract = {${absText.replace(/[{}]/g,'')}}`);

  const note=(state.notes[it.uid]||'').trim();
  if(note) fields.push(`  note = {${note.replace(/[{}]/g,'')}}`);

  return `@${kind}{${key},\n${fields.join(',\n')}\n}`;
}

/* ---- Init ---- */
function ensureDefaults(){
  if(!state.categories || state.categories.length===0) state.categories=defaultCats();
  saveAll();
}
function buildBoard(){ /* 已在上面实现 */ }
function bindDropzone(dz){ /* 已在上面实现 */ }

document.addEventListener('DOMContentLoaded',()=>{
  loadAll(); ensureDefaults();
  renderAll();
  document.getElementById('file-bib').addEventListener('change',e=>{ const f=e.target.files[0]; if(f) importBibFile(f); e.target.value=''; });
  document.getElementById('file-json').addEventListener('change',e=>{ const f=e.target.files[0]; if(f) importJSONFile(f); e.target.value=''; });
  document.getElementById('btn-export-json').addEventListener('click',()=>exportJSON());
  document.getElementById('btn-export-bib').addEventListener('click',()=>exportBib('current'));
  document.getElementById('btn-unsorted').addEventListener('click',()=>{ state.view='unsorted'; renderAll(); });
  document.getElementById('btn-board').addEventListener('click',()=>{ state.view='board'; renderAll(); });
  document.getElementById('btn-clear').addEventListener('click',()=> clearAll());
  document.getElementById('q').addEventListener('input',e=>{ state.q=e.target.value; buildCards(); });
  document.getElementById('sort').addEventListener('change',e=>{ state.sort=e.target.value; renderAll(); });
  document.getElementById('btn-theme').addEventListener('click',()=>{ state.theme = state.theme==='light' ? 'dark' : 'light'; saveAll(); applyTheme(); });
  // add category
  document.getElementById('btn-add-cat').addEventListener('click',()=>{
    const name=prompt('新分类名称：','New Category');
    if(!name) return;
    const color=randomPastel();
    const id='c'+Math.random().toString(36).slice(2,8);
    state.categories.push({id,name,color});
    saveAll(); renderAll();
  });
});

/* Random pastel color for new category */
function randomPastel(){
  const h=Math.floor(Math.random()*360);
  const s=60+Math.floor(Math.random()*25);
  const l=78+Math.floor(Math.random()*10);
  return `hsl(${h} ${s}% ${l}%)`;
}
