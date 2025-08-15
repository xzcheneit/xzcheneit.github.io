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
  'science':'Science','nature':'Nature','chemical reviews':'Chem','arxiv':'arXiv'
};
const JOURNAL_ABBR=[
  ['physical review letters','PRL'], ['physical review a','PRA'], ['physical review b','PRB'], ['physical review x','PRX'],
  ['physical review research','PRR'], ['nature communications','NC'], ['nature physics','NP'], ['nature materials','NM'],
  ['nature','Nat'], ['science','Sci'], ['national science review','NSR'], ['proceedings of the national academy of sciences','PNAS'],
  ['advanced materials','AM'], ['advanced functional materials','AFM'], ['journal of the american chemical society','JACS'], ['acs nano','ACSNano']
];

/* Helpers */
const $=sel=>document.querySelector(sel);
function toDateISO(y,m,d=1){ const table={'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,'jul':7,'aug':8,'sep':9,'sept':9,'oct':10,'nov':11,'dec':12}; m=(table[String(m).toLowerCase()]||parseInt(m||'1',10)||1); y=parseInt(y||'1970',10)||1970; d=parseInt(d||'1',10)||1; return new Date(Date.UTC(y,m-1,d,0,0,0)).toISOString(); }
function cleanAbstract(s){ return (s||'').replace(/[{}]/g,'').replace(/\\[a-zA-Z]+/g,'').replace(/\s+/g,' ').trim(); }
function normalizeAuthors(s){ if(!s) return []; return s.split(/\band\b/ig).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean); }
function journalKeyOf(name){ if(!name) return 'Else'; const k=name.toLowerCase().trim(); for(const n in JOURNAL_KEY){ if(k.includes(n)) return JOURNAL_KEY[n]; } if(/arxiv/.test(k)) return 'arXiv'; return 'Else'; }
function journalAbbrOf(name){ const k=(name||'').toLowerCase(); for(const [pat,abbr] of JOURNAL_ABBR){ if(k.includes(pat)) return abbr; } if(/arxiv/.test(k)) return 'arXiv'; return 'J'; }
function primaryLink(it){ if(it.url) return it.url; if(it.doi) return `https://doi.org/${it.doi}`; if(it.arxiv) return `https://arxiv.org/abs/${it.arxiv}`; return '#'; }
function fmtDate(iso){ const d=new Date(iso); if(!isFinite(d)) return ''; const y=d.getUTCFullYear(),m=String(d.getUTCMonth()+1).padStart(2,'0'),da=String(d.getUTCDate()).padStart(2,'0'); return `${y}-${m}-${da}`; }
function makeUID(it){ if(it.doi) return 'doi:'+it.doi.toLowerCase(); if(it.arxiv) return 'arxiv:'+it.arxiv.toLowerCase(); const base=(it.title||'')+'|'+(it.year||'')+'|'+(it.journal||''); let h=0; for(let i=0;i<base.length;i++){ h=(h*131+base.charCodeAt(i))>>>0; } return 'h'+h.toString(16); }
function surnameOf(author){ if(!author) return 'anon'; if(author.includes(',')) return author.split(',')[0].trim().replace(/\s+/g,''); const parts=author.trim().split(/\s+/); return parts[parts.length-1]||'anon'; }
function citeKeyFor(it, seen){
  const surname = (it.authors && it.authors.length) ? surnameOf(it.authors[0]) : 'anon';
  const year = it.year || (it.date ? new Date(it.date).getUTCFullYear() : '');
  const j = journalAbbrOf(it.journal || (it.arxiv ? 'arXiv' : ''));
  let key = `${surname}${year}${j}`.replace(/[^A-Za-z0-9]+/g, '');
  let suffix = '';
  let i = 0;
  while (seen.has(key + suffix)) {
    i++;
    suffix = String.fromCharCode(96 + i); // a, b, c...
  }
  seen.add(key + suffix);
  return key + suffix;
}${year}${abbr}`; let suffix=''; let i=0; while(seen.has(key+suffix)){ i++; suffix=String.fromCharCode(96+i); } seen.add(key+suffix); return key+suffix; }

/* Load/Save */
function saveAll(){ localStorage.setItem(K_ITEMS, JSON.stringify(state.items)); localStorage.setItem(K_CATS, JSON.stringify(state.categories)); localStorage.setItem(K_ASG, JSON.stringify(state.assign)); localStorage.setItem(K_NOTES, JSON.stringify(state.notes)); localStorage.setItem(K_RATINGS, JSON.stringify(state.ratings)); localStorage.setItem(K_THEME, state.theme); }
function loadAll(){ try{ state.items=JSON.parse(localStorage.getItem(K_ITEMS)||'[]'); state.categories=JSON.parse(localStorage.getItem(K_CATS)||'[]'); state.assign=JSON.parse(localStorage.getItem(K_ASG)||'{}'); state.notes=JSON.parse(localStorage.getItem(K_NOTES)||'{}'); state.ratings=JSON.parse(localStorage.getItem(K_RATINGS)||'{}'); state.theme=localStorage.getItem(K_THEME)||'dark'; }catch(e){ console.warn(e);} }

/* Categories */
function defaultCats(){ return [{id:'c1',name:'Reviews',color:'#5f6ee6'},{id:'c2',name:'Theory',color:'#57d39b'},{id:'c3',name:'Computation',color:'#6ab0ff'},{id:'c4',name:'Experiment',color:'#ffb86b'},{id:'c5',name:'Methods',color:'#d467ff'},{id:'c6',name:'Unsorted',color:'#8da3b8'}]; }
function findCatByName(name){ return state.categories.find(c=>c.name.toLowerCase()===name.toLowerCase()); }
function ensureUnsortedId(){ const u=findCatByName('Unsorted'); return u?u.id:state.categories[state.categories.length-1]?.id; }

/* Theme */
function applyTheme(){ if(state.theme==='light') document.body.classList.add('theme-light'); else document.body.classList.remove('theme-light'); $('#btn-theme').textContent = state.theme==='light' ? '☀️ 浅色' : '🌙 深色'; }

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
    root.querySelector('.clr').addEventListener('click',()=>{ for(const uid of Object.keys(state.assign)){ if(state.assign[uid]===c.id) delete state.assign[uid]; } saveAll(); renderAll(); });
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
    items = state.items.filter(it=>state.assign[it.uid]===unsortedId);
  }else if(state.view.startsWith('cat:')){
    items = itemsInCat(state.view.slice(4));
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
  const cid=state.assign[it.uid]; const bcat=tpl.querySelector('.badge.category');
  if(cid){ const cat=state.categories.find(c=>c.id===cid); if(cat){ bcat.textContent=cat.name; bcat.hidden=false; } }
  // note indicator
  const bi=tpl.querySelector('.badge.note-indicator');
  if(state.notes[it.uid] && state.notes[it.uid].trim().length>0) bi.hidden=false;
  // content
  tpl.querySelector('.title').textContent=stripBraces(it.title||'(无标题)');
  tpl.querySelector('.authors').textContent=(it.authors||[]).join(', ');
  tpl.querySelector('.journal-name').textContent=it.journal || (it.arxiv?'arXiv':'');
  tpl.querySelector('.date').textContent=fmtDate(it.date||'');
  tpl.querySelector('.abstract').textContent=it.abstract||'';
  // links
  const l0=tpl.querySelector('.lnk.primary'); const l1=tpl.querySelectorAll('.lnk')[1]; const l2=tpl.querySelectorAll('.lnk')[2];
  l0.href=primaryLink(it); l1.href=it.doi?`https://doi.org/${it.doi}`:'#'; l1.style.display=it.doi?'inline-flex':'none';
  l2.href=it.arxiv?`https://arxiv.org/abs/${it.arxiv}`:'#'; l2.style.display=it.arxiv?'inline-flex':'none';
  // notes
  const noteBlock=tpl.querySelector('.note-block'); const noteBtn=tpl.querySelector('.note-toggle'); const ta=tpl.querySelector('.note');
  ta.value=state.notes[it.uid]||'';
  noteBtn.addEventListener('click',e=>{ e.stopPropagation(); noteBlock.hidden=!noteBlock.hidden; if(!noteBlock.hidden) ta.focus(); });
  ta.addEventListener('input', debounce(()=>{
    state.notes[it.uid]=ta.value;
    const auto=autoRatingOf(ta.value);
    const manual=(state.ratings[it.uid]?.manual)||0;
    state.ratings[it.uid]={manual,auto};
    saveAll();
    updateStars(el,it.uid);
    const has=(state.notes[it.uid]||'').trim().length>0; bi.hidden=!has;
  },300));
  // tone
  el.classList.add('tone-'+key4class);
  // stars
  initStars(el,it.uid);
  return el;
}
function stripBraces(s){ return (s||'').replace(/[{}]/g,''); }

/* Stars */
function autoRatingOf(text){ const n=(text||'').trim().length; const halfSteps=Math.floor(n/50); return Math.min(5, halfSteps*0.5); }
function currentRating(uid){ const r=state.ratings[uid]||{manual:0,auto:0}; return Math.max(r.manual||0, r.auto||0); }
function initStars(cardEl, uid){
  if(!state.ratings[uid]) state.ratings[uid]={manual:0,auto:autoRatingOf(state.notes[uid]||'')};
  const bg=cardEl.querySelector('.stars-bg'); const fg=cardEl.querySelector('.stars-fg'); const tt=cardEl.querySelector('.stars-text');
  const setWidth=()=>{ const val=currentRating(uid); fg.style.width=(val/5*100)+'%'; tt.textContent = val ? (val.toFixed(1)+'★') : '0★'; };
  setWidth();
  const rectOf=()=>bg.getBoundingClientRect();
  cardEl.querySelector('.rating').addEventListener('click',e=>{
    const rect=rectOf(); const x=Math.max(0, Math.min(e.clientX-rect.left, rect.width)); const ratio=x/rect.width; const raw=ratio*5; const val=Math.round(raw*2)/2;
    const r=state.ratings[uid]||{manual:0,auto:autoRatingOf(state.notes[uid]||'')}; r.manual=val; state.ratings[uid]=r; saveAll(); setWidth();
  });
}
function updateStars(cardEl, uid){
  const fg=cardEl.querySelector('.stars-fg'); const tt=cardEl.querySelector('.stars-text'); const val=currentRating(uid);
  if(fg) fg.style.width=(val/5*100)+'%'; if(tt) tt.textContent = val ? (val.toFixed(1)+'★') : '0★';
}

/* DnD */
function bindDropzone(dz){
  dz.addEventListener('dragover',e=>{ e.preventDefault(); e.stopPropagation(); dz.classList.add('over'); });
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
    for(const it of items){ map.set(it.uid,it); }
    state.items=Array.from(map.values());
    if(state.categories.length===0) state.categories=defaultCats();
    const unsortedId=ensureUnsortedId();
    for(const it of items){
      state.assign[it.uid]=unsortedId;
      if(!state.ratings[it.uid]) state.ratings[it.uid]={manual:0,auto:0};
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
  const c=state.categories.find(x=>x.id===cid);
  downloadBlob(blob,`biblab-${(c?.name||'cat')}-${ts()}.bib`);
}
function toBib(it,seen){
  const kind = (it.journal || it.doi) ? 'article' : 'misc';
  const key  = citeKeyFor(it,seen);
  const fields = [];
  fields.push(`  title = {${it.title||''}}`);
  if ((it.authors||[]).length) fields.push(`  author = {${it.authors.join(' and ')}}`);
  if (it.journal) fields.push(`  journal = {${it.journal}}`);
  const year = it.year || (it.date ? new Date(it.date).getUTCFullYear() : '');
  if (year) fields.push(`  year = {${year}}`);
  if (it.doi) fields.push(`  doi = {${it.doi}}`);
  if (it.arxiv){ fields.push(`  eprint = {${it.arxiv}}`); fields.push(`  archivePrefix = {arXiv}`); }
  if (it.url) fields.push(`  url = {${it.url}}`);
  if (it.abstract) fields.push(`  abstract = {${String(it.abstract).replace(/[{}]/g,'')}}`);
  const note = (state.notes[it.uid]||'').trim();
  if (note) fields.push(`  note = {${note.replace(/[{}]/g,'')}}`);
  return `@${kind}{${key},
${fields.join(',
')}
}`;
}

/* Utils */
function ts(){ const d=new Date(); const pad=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
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
    alert('快照导入成功');
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

/* Events */
function randomPastel(){ const hues=[190,210,150,120,160,200,30]; const h=hues[Math.floor(Math.random()*hues.length)]; const s=60, l=75; return `hsl(${h} ${s}% ${l}%)`; }
function bindEvents(){
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
  // page-level DnD .bib
  window.addEventListener('dragover',e=>{ e.preventDefault(); e.stopPropagation(); });
  window.addEventListener('drop',e=>{ e.preventDefault(); e.stopPropagation(); const f=e.dataTransfer?.files?.[0]; if(f && /\.bib$|\.txt$/i.test(f.name)) importBibFile(f); });
}

/* Boot */
(function boot(){ loadAll(); if(state.categories.length===0) state.categories=defaultCats(); bindEvents(); renderAll(); applyTheme(); })();
