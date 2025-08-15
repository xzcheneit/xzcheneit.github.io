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
  'science':'Science','nature':'Nature','new journal of physics':'NJP',
  'nano letters':'NanoLett','prx quantum':'PRXQ','phys. rev. e':'PRE',
  'chinese physics letters':'CPL','chinese physics b':'CPB','national science review':'NSR',
  'arxiv':'arXiv'
};
function journalKeyOf(j){
  const s=(j||'').toLowerCase().trim(); return JOURNAL_KEY[s]||Object.entries(JOURNAL_KEY).find(([k])=>s.includes(k))?.[1]||'Else';
}
function journalAbbrOf(j){ return journalKeyOf(j); }

/* Name helpers */
function surnameOf(n){
  if(!n) return 'Anon';
  // input may be "Given Family" or "Family, Given"
  const s=String(n).trim();
  if(!s) return 'Anon';
  if(s.includes(',')) return s.split(',')[0].trim().replace(/\s+/g,'');
  const parts=s.split(/\s+/);
  return (parts[parts.length-1]||'Anon').replace(/[^A-Za-z0-9]/g,'');
}

/* Bib key: 第一作者姓 + 年份 + 期刊缩写（PRL/PRB/NC/…），冲突自动 a/b/c */
function citeKeyFor(it, seen){
  const first=(it.authors||[])[0]||'Anon';
  const sur=surnameOf(first);
  const y=(it.year || (it.date? new Date(it.date).getUTCFullYear():''))||'';
  const abbr=journalAbbrOf(it.journal || (it.arxiv?'arXiv':''));
  let key=`${sur}${y}${abbr}`.replace(/[^A-Za-z0-9]+/g,'');
  let suf='',i=0; while(seen.has(key+suf)){ i++; suf=String.fromCharCode(96+i); } // a,b,c...
  seen.add(key+suf); return key+suf;
}

/* Load/Save */
function saveAll(){ localStorage.setItem(K_ITEMS, JSON.stringify(state.items)); localStorage.setItem(K_CATS, JSON.stringify(state.categories)); localStorage.setItem(K_ASG, JSON.stringify(state.assign)); localStorage.setItem(K_NOTES, JSON.stringify(state.notes)); localStorage.setItem(K_RATINGS, JSON.stringify(state.ratings)); localStorage.setItem(K_THEME, state.theme); }
function loadAll(){ try{ state.items=JSON.parse(localStorage.getItem(K_ITEMS)||'[]'); state.categories=JSON.parse(localStorage.getItem(K_CATS)||'[]'); state.assign=JSON.parse(localStorage.getItem(K_ASG)||'{}'); state.notes=JSON.parse(localStorage.getItem(K_NOTES)||'{}'); state.ratings=JSON.parse(localStorage.getItem(K_RATINGS)||'{}'); state.theme=localStorage.getItem(K_THEME)||'dark'; }catch(e){ console.warn(e);} }

/* Categories */
function defaultCats(){ return [{id:'c1',name:'Reviews',color:'#b6a3ff'},{id:'c2',name:'Theory',color:'#7cc8ff'},{id:'c3',name:'Experiment',color:'#9fe29f'},{id:'c4',name:'Method',color:'#ffd37a'},{id:'c5',name:'Applications',color:'#ff9eb5'},{id:'c6',name:'Unsorted',color:'#8da3b8'}]; }
function findCatByName(name){ return state.categories.find(c=>c.name.toLowerCase()===name.toLowerCase()); }
function ensureUnsortedId(){ const u=findCatByName('Unsorted'); return u?u.id:state.categories[state.categories.length-1]?.id; }

/* Theme */
function applyTheme(){ if(state.theme==='light') document.body.classList.add('light'); else document.body.classList.remove('light'); document.getElementById('btn-theme').textContent = state.theme==='light' ? '☀️ 浅色' : '🌙 深色'; }

/* Rendering */
function renderAll(){
  renderCategoryList();
  $('#btn-unsorted').classList.toggle('solid',state.view==='unsorted');
  $('#btn-board').classList.toggle('solid',state.view==='board'||state.view.startsWith('cat:'));
  if(state.view==='board'){ $('#board').hidden=false; $('#cards').hidden=true; buildBoard(); }
  else { $('#board').hidden=true; $('#cards').hidden=false; buildCards(); }
  $('#hint').hidden=state.items.length>0;
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
    root.querySelector('.clr').addEventListener('click',()=>{ if(confirm('清空该分类？')){ for(const [uid,cid] of Object.entries(state.assign)) if(cid===c.id) delete state.assign[uid]; saveAll(); renderAll(); }});
    root.querySelector('.exp').addEventListener('click',()=> exportBibForCategory(c.id));
    host.appendChild(tpl);
  }
}
function buildBoard(){
  const host=document.querySelector('#board'); host.innerHTML='';
  for(const c of state.categories){
    const col=document.getElementById('tpl-board-column').content.cloneNode(true);
    const root=col.querySelector('.col'); root.dataset.cid=c.id;
    col.querySelector('.name').textContent=c.name;
    col.querySelector('.dot').style.background=c.color;
    const dz=col.querySelector('.dropzone'); dz.dataset.cid=c.id; bindDropzone(dz);
    const items=itemsInCat(c.id);
    col.querySelector('.count').textContent=items.length;
    for(const it of sortItems(items,'date_desc')) dz.appendChild(makeCard(it));
    col.querySelector('.name').addEventListener('blur',()=>{ c.name=col.querySelector('.name').textContent.trim()||c.name; saveAll(); renderAll(); });
    col.querySelector('.exp').addEventListener('click',()=> exportBibForCategory(c.id));
    host.appendChild(col);
  }
}
function buildCards(){
  const host=document.querySelector('#cards'); host.innerHTML='';
  let items=[];
  if(state.view==='unsorted'){
    const unsortedId=ensureUnsortedId();
    items=state.items.filter(it=>state.assign[it.uid]===unsortedId);
  }else if(state.view.startsWith('cat:')){
    const cid=state.view.slice(4);
    items=itemsInCat(cid);
  }else{
    const unsortedId=ensureUnsortedId();
    items=state.items.filter(it=>state.assign[it.uid]===unsortedId);
  }
  const q=state.q.trim().toLowerCase();
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
  el.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain',it.uid); e.stopPropagation(); requestAnimationFrame(()=>el.classList.add('dragging')); });
  el.addEventListener('dragend',e=>{ e.stopPropagation(); el.classList.remove('dragging'); });
  // badges
  const k=it.journalKey||'Else'; const bj=tpl.querySelector('.badge.journal'); const key4class=(k==='NatPhys'?'NP':k);
  bj.textContent=(k==='NatPhys'?'NP':k); bj.classList.add('j-'+key4class);
  tpl.querySelector('.badge.type').textContent=it.type||'article';
  // category badge
  const bc=tpl.querySelector('.badge.cat'); const cid=state.assign[it.uid]; const cat=state.categories.find(c=>c.id===cid);
  if(cat){ bc.textContent=cat.name; bc.style.background=cat.color; } else { bc.textContent='Unsorted'; }

  // title
  const a=tpl.querySelector('.title a'); a.textContent=it.title||'(no title)'; a.href=it.url||it.doi?`https://doi.org/${it.doi}`:'#';

  // meta 行：作者 + doi
  const meta=tpl.querySelector('.meta');
  const list=(it.authors||[]); const n=list.length;
  let authors='';
  if(n===0) authors='-';
  else if(n<=3) authors=list.join(', ');
  else authors=`${list[0]} … ${list[n-1]}（共 ${n} 人）`;
  meta.innerHTML = `<strong>作者：</strong>${authors}${it.doi?`　·　DOI: ${it.doi}`:''}`;

  // 摘要
  const abs=tpl.querySelector('.abs');
  abs.innerHTML = `<strong>摘要：</strong>${it.abstract||''}`;

  // time
  tpl.querySelector('.time').textContent = (it.date||'').replace('T',' ').replace(/\..*/,'');

  // star state
  updateStars(tpl, it.uid);

  return el;
}
function stripBraces(s){ return (s||'').replace(/[{}]/g,''); }

/* Stars */
function autoRatingOf(text){ const n=(text||'').trim().length; const halfSteps=Math.floor(n/50); return Math.min(5, halfSteps*0.5); }
function initStars(root,uid){
  const auto=autoRatingOf(state.notes[uid]||'');
  const box=root.querySelector('.stars'); box.innerHTML='';
  for(let i=1;i<=10;i++){
    const b=document.createElement('button'); b.className='star'; b.textContent='★'; b.dataset.v=i;
    if(i<=Math.round((state.ratings[uid]?.manual||0)*2) || (!state.ratings[uid] && i<=Math.round(auto*2))) b.classList.add('on');
    b.addEventListener('click',()=>{ const v=i/2; state.ratings[uid]={manual:v,auto}; saveAll(); updateStars(root,uid); });
    box.appendChild(b);
  }
  const bi=root.querySelector('.badge.note');
  bi.hidden = !(state.notes[uid]||'').trim().length>0;
}
function updateStars(root,uid){
  const stars=[...root.querySelectorAll('.star')];
  const manual=state.ratings[uid]?.manual||0;
  const auto=autoRatingOf(state.notes[uid]||'');
  const v=Math.max(manual, auto);
  stars.forEach((b,i)=> b.classList.toggle('on', i < Math.round(v*2)) );
}

/* Board (drag & drop) */
function bindDropzone(dz){
  dz.addEventListener('dragover',e=>{ e.preventDefault(); dz.classList.add('over'); });
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
    $('#log').textContent=`读取到 ${txt.length} 字符，解析中…`;
    const raw=parseBibTeX(txt);
    $('#log').textContent=`解析到 ${raw.length} 条目`;
    if(raw.length===0){ alert('未从 .bib 解析到任何条目。'); return; }
    const items=raw.map(toItem).filter(Boolean);
    const map=new Map(state.items.map(x=>[x.uid,x]));
    const unsortedId=ensureUnsortedId();
    let newCount=0;
    for(const it of items){
      if(!map.has(it.uid)){ state.items.push(it); state.assign[it.uid]=unsortedId; newCount++; }
    }
    saveAll();
    renderAll();
    alert(`导入成功：${newCount} 篇（总计 ${state.items.length} 篇），已放入 Unsorted。`);
  }catch(err){ console.error(err); alert('导入失败：'+err.message); }
}
function normalizeAuthors(s){
  if(!s) return [];
  const t=String(s);
  if(t.includes(' and ')) return t.split(/\s+and\s+/).map(x=>x.trim()).filter(Boolean);
  return t.split(/\s*,\s*/).map(x=>x.trim()).filter(Boolean);
}
function toDateISO(year,month,day){
  const y=Number(year)||0, m=isNaN(Number(month))?0:Number(month), d=isNaN(Number(day))?1:Number(day)||1;
  if(!y) return '';
  const mm = (Number.isInteger(m) && m>=1 && m<=12) ? m : 1;
  const dd = (Number.isInteger(d) && d>=1 && d<=31) ? d : 1;
  return new Date(Date.UTC(y,mm-1,dd)).toISOString();
}
function cleanAbstract(s){
  return String(s||'').replace(/\s+/g,' ').trim();
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
  const cat=state.categories.find(c=>c.id===cid);
  downloadBlob(blob,`biblab-export-${(cat?.name||'Category')}-${ts()}.bib`);
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

/* UID */
function makeUID(it){
  const base=[it.title||'',(it.authors||[]).join(';'),it.journal||'',it.year||'',it.doi||'',it.arxiv||''].join('|').toLowerCase();
  let h=0; for(let i=0;i<base.length;i++){ h=((h<<5)-h)+base.charCodeAt(i); h|=0; }
  return 'u'+(h>>>0).toString(36);
}

/* ---- 关键：导出 BibTeX（含摘要 abstract；bibkey=姓+年+期刊缩写） ---- */
function toBib(it,seen){
  const kind=(it.journal||it.doi)?'article':'misc';

  // bibkey 规则
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

  // 摘要：优先 it.abstract，其次 it.summary；去掉花括号防 BibTeX 报错
  const absText=(it.abstract ?? it.summary ?? '').toString().trim();
  if(absText) fields.push(`  abstract = {${absText.replace(/[{}]/g,'')}}`);

  const note=(state.notes[it.uid]||'').trim();
  if(note) fields.push(`  note = {${note.replace(/[{}]/g,'')}}`);

  return `@${kind}{${key},\n${fields.join(',\n')}\n}`;
}

/* Init */
function $(s,el=document){ return el.querySelector(s); }
function $$(s,el=document){ return [...el.querySelectorAll(s)]; }

function init(){
  loadAll();
  if(state.categories.length===0){ state.categories=defaultCats(); }
  renderAll();

  // 文件导入/导出
  $('#file-bib').addEventListener('change',e=>{ const f=e.target.files[0]; if(f) importBibFile(f); e.target.value=''; });
  $('#file-json').addEventListener('change',e=>{ const f=e.target.files[0]; if(f) importJSONFile(f); e.target.value=''; });
  $('#btn-export-json').addEventListener('click',()=>exportJSON());
  $('#btn-export-bib').addEventListener('click',()=>exportBib('current'));
  $('#btn-unsorted').addEventListener('click',()=>{ state.view='unsorted'; renderAll(); });
  $('#btn-board').addEventListener('click',()=>{ state.view='board'; renderAll(); });
  $('#btn-clear').addEventListener('click',()=> clearAll());
  $('#q').addEventListener('input',e=>{ state.q=e.target.value; buildCards(); });
  $('#sort').addEventListener('change',e=>{ state.sort=e.target.value; renderAll(); });
  $('#btn-theme').addEventListener('click',()=>{ state.theme = state.theme==='light' ? 'dark' : 'light'; saveAll(); applyTheme(); });
  // add category
  $('#btn-add-cat').addEventListener('click',()=>{
    const name=prompt('新分类名称：','New Category');
    if(!name) return;
    const color=randomPastel();
    const id='c'+Math.random().toString(36).slice(2,8);
    state.categories.push({id,name,color});
    saveAll(); renderAll();
  });
}
function randomPastel(){
  const h=Math.floor(Math.random()*360);
  return `hsl(${h} 70% 85%)`;
}
window.addEventListener('DOMContentLoaded',init);
