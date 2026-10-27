import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {splitScientificText,formatScientificMath,scientificPlainText,scientificSearchText,renderScientificText} from '../assets/scientific-text.mjs';

const chemical='Ca${}_{3}$(Ru,Ti)${}_{2}$O${}_{7}$';

test('APS chemical formulas display subscripts and remain searchable as ordinary typing',()=>{
  assert.equal(scientificPlainText(chemical),'Ca₃(Ru,Ti)₂O₇');
  assert.equal(scientificSearchText(chemical),'ca3(ru,ti)2o7');
  assert.equal(splitScientificText(chemical).map(t=>t.raw??t.value).join(''),chemical);
  assert.match(formatScientificMath('{}_{3}').html,/<msub>/);
});
test('escaped APS underscores, nested scripts and isotope superscripts are rendered',()=>{
  assert.equal(scientificPlainText('Ca${}\\_{3}$'),'Ca₃');
  assert.equal(scientificPlainText('${}^{229}$Th'),'²²⁹Th');
  assert.equal(scientificPlainText('$\\mathrm{Mg}_{2}\\mathrm{IrH}_{7}$'),'Mg₂IrH₇');
  assert.ok(formatScientificMath('{V}_{\\mathrm{B}}^{−}').html);
  assert.ok(formatScientificMath('3{d}_{{z}^{2}}').html);
});
test('fractions, roots and Greek symbols use mathematical markup',()=>{
  const result=formatScientificMath('\\frac{1}{2}+\\sqrt{x}+α');
  assert.match(result.html,/<mfrac>/);
  assert.match(result.html,/<msqrt>/);
  assert.equal(result.plain,'1/2+√(x)+α');
  assert.equal(formatScientificMath('\\frac{a+b}{c+d}').plain,'(a+b)/(c+d)');
});
test('inline and display delimiters are recognized without escaping surrounding text',()=>{
  const tokens=splitScientificText('A \\(x^2\\) B \\[\\frac{1}{2}\\] C $$E=mc^2$$');
  assert.deepEqual(tokens.filter(t=>t.type==='math').map(t=>t.display),[false,true,true]);
});
test('money and escaped dollar signs are preserved as prose',()=>{
  const money='Fired biologist wins $6 million in defamation lawsuit';
  assert.equal(scientificPlainText(money),money);
  assert.equal(scientificPlainText('$6 million and $8 million'),'$6 million and $8 million');
  assert.equal(scientificPlainText('Cost: \\$5; formula $x$'),'Cost: $5; formula x');
});
test('truncated RSS equations leave the tail intact and earlier equations readable',()=>{
  const tokens=splitScientificText('State $x^2$ with unfinished $\\mathrm{Ca}_{');
  assert.equal(tokens.filter(t=>t.type==='math').length,1);
  assert.equal(tokens.at(-1).value,' with unfinished $\\mathrm{Ca}_{');
  assert.match(scientificPlainText('State $x^2$ with unfinished $\\mathrm{Ca}_{'),/^State x² with unfinished \$/);
});
test('PDF bookmark fallbacks do not appear next to visible titles',()=>{
  assert.equal(scientificPlainText('monoclinic \\texorpdfstring{$\\beta$-Ga$_2$O$_3$}{beta-Ga2O3}'),'monoclinic β-Ga₂O₃');
});
test('bare chemistry, accent commands and degree symbols remain readable',()=>{
  assert.equal(scientificPlainText('\\ce{Fe3GaTe2}'),'Fe₃GaTe₂');
  assert.equal(scientificPlainText('N\\\'eel; Cram\\\'er; 2.4{\\deg}; \\AA'),'Néel; Cramér; 2.4°; Å');
  assert.ok(formatScientificMath('\\ce{Fe3$X$Te2}').html);
  assert.ok(splitScientificText('the \\bar{M} point').find(t=>t.type==='math'));
});
test('fixed aliases and ordinary TeX spacing do not produce red source text',()=>{
  assert.ok(formatScientificMath('\\mathbit{g}').html);
  assert.ok(formatScientificMath('X=\\mathrm{Cl},\\phantom{\\rule{0.16em}{0ex}}\\mathrm{Br}').html);
  assert.equal(formatScientificMath('7&lt;p&lt;30').plain,'7<p<30');
});
test('unknown author macros fall back locally without inventing a definition',()=>{
  const formula=formatScientificMath('\\qvec');
  assert.equal(formula.html,null);
  assert.equal(formula.plain,'\\qvec');
  assert.ok(formatScientificMath('x+1').html);
});
test('untrusted formulas cannot create links, images or arbitrary HTML classes',()=>{
  for(const source of ['\\href{javascript:alert(1)}{x}','\\includegraphics{https://example.org/x.png}','\\htmlClass{evil-injected}{x}']){
    const html=formatScientificMath(source).html||'';
    assert.doesNotMatch(html,/\s(?:href|src)=|class="evil-injected"/i);
  }
});
test('macro expansion, layout dimensions and source length are bounded',()=>{
  assert.equal(formatScientificMath('\\def\\loop{\\loop}\\loop').html,null);
  assert.equal(formatScientificMath('x'.repeat(2001)).html,null);
  assert.doesNotMatch(formatScientificMath('\\rule{10000em}{10000em}').html,/style="[^"]*10000/);
});
test('a macro defined in one paper does not leak into the next paper',()=>{
  formatScientificMath('\\gdef\\siteMacro{7}\\siteMacro');
  assert.equal(formatScientificMath('\\siteMacro').html,null);
});
test('all complete equations in current feed titles are supported',()=>{
  const items=JSON.parse(readFileSync(new URL('../data/articles.json',import.meta.url))).items;
  let count=0;
  for(const item of items){
    for(const token of splitScientificText(item.title||'')){
      if(token.type!=='math')continue;
      count++;
      assert.ok(formatScientificMath(token.value,token.display).html,item.title);
    }
  }
  assert.ok(count>100,'Expected real scientific titles, not an empty fixture');
});
test('the stylesheet only references locally supplied fonts',()=>{
  const css=readFileSync(new URL('../assets/vendor/katex/katex.min.css',import.meta.url),'utf8');
  const urls=[...css.matchAll(/url\(([^)]+)\)/g)].map(m=>m[1]);
  assert.equal(urls.length,20);
  for(const url of urls){assert.ok(!url.startsWith('http'));assert.ok(existsSync(fileURLToPath(new URL('../assets/vendor/katex/'+url,import.meta.url))),url);}
});

class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this._text='';this.innerHTML='';}
  append(child){this.children.push(child);}
  set textContent(text){this.children=[];this._text=text;}
  get textContent(){return this._text+this.children.map(c=>c.textContent||'').join('');}
}
test('keyword highlighting wraps complete rendered math instead of breaking TeX',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};
  try{
    const container=new Element('span');
    renderScientificText(container,'Spin $\\mathrm{Ru}_{2}$ modes',['Ru','Spin']);
    const highlighted=container.children.filter(c=>c.tagName==='MARK');
    assert.equal(highlighted.length,2);
    const math=highlighted.find(c=>c.className==='scientific-math');
    assert.match(math.innerHTML,/<msub>/);
    assert.doesNotMatch(math.innerHTML,/<mark>/);
  }finally{globalThis.document=previous;}
});
test('mixed chemical text and adjacent subscripts form one nonbreaking display cluster',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};
  try{
    const container=new Element('span');
    renderScientificText(container,'Candidate '+chemical+' near a phase transition');
    const clusters=container.children.filter(c=>c.className==='scientific-cluster');
    assert.equal(clusters.length,1);
    assert.equal(clusters[0].children.filter(c=>c.className==='scientific-math').length,3);
    assert.ok(clusters[0].children.some(c=>c.textContent==='(Ru,Ti)'));
  }finally{globalThis.document=previous;}
});
