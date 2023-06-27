'use strict';

let argIndexing = 1;
let perPageMin = 10;
let perPageMax = 50;

/*
intrinsic entry:
{
  raw: whatever original form of the object,
  id: idCounter++,
  ref: "unique string within this CPU",
  
  ret: {type:"return type",name:"return name"},
  args: [... {type:"type",name:"name"}],
  name: "intrinsic_function_name",
  
  desc: "description",
  header: "header_name.h",
  
  implDesc: "operation section",
  implInstr: "if immediate is 2:  vadd a,b,b<br>else:<br>  vmul a,b,imm",
  implInstrSearch: "vadd a,b,b\nvmul a,b,imm", // implInstr for searching; will be lowercased automatically
  implTimes: {...someArch: {l:"latency",t:"reciprocal throughput"}},
  
  short: "var0", // defaults to "base"
  variations: [...{
    short: "var",
    args, name, ret, // same structure as outside
    desc, implInstr, implInstrSearch, implDesc, implTimes, // optional, same structure as outside
  }],
  toVar: {...}, // a reference to an entry in variations to go to on click; if present, self is excluded from variationsIncl (for entries is just a "wrapper" around variations)
  
  archs: [..."arch|paths"],
  categories: [..."category|paths"],
}
*/

let cpuLoaderX86_64 = {msg: 'x86-64', loadPath: "./arch/x86.js"};
let cpuLoaderARM    = {msg: 'ARM',    loadPath: "./arch/arm.js"};
let cpuLoaderRISCV  = {msg: 'RISC-V', loadPath: "./arch/riscv.js"};
let cpuLoaderWasm   = {msg: 'wasm'   ,loadPath: "./arch/wasm.js"};
let knownCPUs = [
  {key:'risc-v',  hash:'riscv',   load:cpuLoaderRISCV},
  {key:'wasm',    hash:'wasm',    load:cpuLoaderWasm},
].map(cpu => { cpu.json = JSON.stringify({u: cpu.key, a: cpu.key=='risc-v'? ['v'] : undefined}); return cpu; });



let searchFieldEl = document.getElementById("search-field");
let cpuListEl = document.getElementById("cpu-list");
let archListEl = document.getElementById("arch-list");
let categoryListEl = document.getElementById("category-list");
let resultListEl = document.getElementById("result-list");
let descPlaceEl = document.getElementById("desc-place");
let resultCountEl = document.getElementById("result-count");
let pages1El = document.getElementById("pages-1");
let pages2El = document.getElementById("pages-2");
let pages3El = document.getElementById("pages-3");
let centerInfoEl = document.getElementById("center-info");

let idCounter = 1;

let entries_ccpu = undefined;
let curr_archObj, curr_categoryObj, curr_cpu_name, curr_cpu_info, curr_entry;
let query_archs = [];
let query_categories = [];
let query_found = [];
let query_selVar = undefined;
let query_currPage = 0;
let perPage = 37;
console.log("Variable 'query_found' contains currently found intrinsics");

let extra_test = false;

async function loadFile(path) {
  let f = await fetch(path);
  let b = await f.arrayBuffer();
  return new TextDecoder().decode(b);
}

async function execFile(path) {
  return await import(path);
}
function overloadedName(name) {
  let id = nextID();
  return `<span id="${id}">Overloaded name: <span class="mono h-name">${mkcopy(name,name, `aria-labelledby=${id}`)}</span></span>`
}


function unique(l) {
  return [...new Set(l)];
}



function mkch(n, ch, {cl, id, attrs, onchange, anyclick, onenter, onclick, role, href, innerHTML}={}) {
  let r = document.createElement(n);
  if (undefined!==ch) {
    if (!Array.isArray(ch)) throw new Error('non-list ch');
    r.append(...ch);
  }
  if (undefined!==id) r.id = id;
  if (undefined!==onchange) r.addEventListener('change', () => onchange(r));
  if (undefined!==onclick)  r.addEventListener('click',  () => onclick(r));
  if (undefined!==anyclick) {
    r.tabIndex = 0;
    r.onclick = e => anyclick(r);
    r.addEventListener('keydown', e => {
      if (undefined!==onenter && e.key=='Enter') {
        onenter();
        e.preventDefault();
      } else if (e.key=='Enter' || e.key==' ') {
        e.preventDefault();
        anyclick(r);
      }
    });
  }
  if (undefined!==role) r.role = role;
  if (undefined!==href) r.href = href;
  if (undefined!==attrs) Object.entries(attrs).map(([k,v]) => r.setAttribute(k,v));
  if (undefined!==cl) cl instanceof Array? r.classList.add(...cl) : r.classList.add(cl);
  if (undefined!==innerHTML) r.innerHTML = innerHTML;
  return r;
};
const mk = (n, named={}) => mkch(n, undefined, named);

function docopy(text) {
  navigator.clipboard.writeText(text);
}
function anyclick_key(e, f) {
  if (e.key=='Enter' || e.key==' ') {
    e.preventDefault();
    f();
  }
}
function mkcopy(content, text, attrs='') {
  let hoverMessage = 'Click to copy';
  if (typeof content === 'string') {
    return `<span class="click-copy hover-base" tabindex="0" onclick="docopy('${text}')" onkeydown="anyclick_key(event,()=>docopy('${text}'))" role="button" ${attrs}>
      <span class="hover-text">${hoverMessage}</span>
      ${content}
    </span>`;
  } else {
    return mkch('span', [
      mkch('span', [hoverMessage], {cl:'hover-text'}), content
    ], {cl:['click-copy', 'hover-base'], anyclick: ()=>docopy(text), role: 'button'});
  }
}



function group(list, name, order) {
  if (list.length==1 && list[0].length == 0) {
    return {name};
  } else {
    let uniq = unique(list.map(c=>c[0])).sort((a,b) => {
      let sa = order[name+'|'+a]; if (sa===undefined) sa = 99;
      let sb = order[name+'|'+b]; if (sb===undefined) sb = 99;
      if (sa!=sb) return sa-sb;
      return a.localeCompare(b);
    });
    return {
      name,
      ch: uniq.map(name2 => group(list.filter(c=>c[0]==name2).map(c=>c.slice(1)), name2, order)),
    };
  }
}

let id_counter = 0;
function nextID() { return `autoid_${id_counter++}` }
function makeTree(joiner, desc, allInfo, defaultOpenSet, updated) {
  let openSet = defaultOpenSet;
  let selectedSet = new Set();
  
  function forAll(me, f) {
    f(me);
    if (me.children) me.children.forEach(c => forAll(c, f));
  }
  
  function refresh(me) {
    let mode;
    if (me.children) {
      let opens = me.children.map(refresh);
      mode = opens.every(c=>c===1)? 1 : opens.some(c=>c!==0)? 2 : 0;
    } else {
      mode = selectedSet.has(me.path)? 1 : 0;
    }
    me.check.indeterminate = mode===2;
    if (mode!==2) me.check.checked = mode;
    return mode;
  }
  
  function selectedChanged(link) {
    refresh(all);
    updated([...selectedSet], link);
  }
  
  function deserialize(vals) {
    let trunc = new Set(vals.map(c => c.replace(/^all\|/, '')));
    selectedSet = new Set();
    function rec(curr, on) {
      on = on || trunc.has(curr.path);
      if (curr.children) curr.children.forEach(c => rec(c, on));
      else if (on) selectedSet.add(curr.path);
    }
    rec(all, false);
    selectedChanged(false);
  }
  
  function serialize() {
    function rec(curr) {
      if (curr.check.indeterminate) return curr.children.flatMap(rec);
      return curr.check.checked? [curr.path] : [];
    }
    
    let r = rec(all);
    if (r.length==1 && r[0]=='') return undefined;
    return r;
  }
  
  function mkPart(info, path) {
    let has_ch = !!info.ch;
    let sub_id = has_ch? nextID() : undefined;
    
    let children = has_ch? info.ch.map(ch => mkPart(ch, path===''? ch.name : path+joiner+ch.name)) : undefined;
    
    let isOpen = () => main.ariaExpanded === 'true';
    let setOpen = (v) => {
      main.ariaExpanded = v;
      updateSub();
    };
    
    
    
    let updateSub = () => {
      subMarker.textContent = isOpen()? '∨' : '>';
    };
    let subMarker = mkch('span', [has_ch? '?' : ''], {
      cl: ['gr', has_ch? 'gr-yes' : 'gr-no'],
      role: 'none',
      onclick: has_ch? t => {
        setOpen(!isOpen());
      } : undefined,
      attrs: {'aria-hidden': true},
    });
    
    let selectCheck = mk('input', {attrs: {type:'checkbox', tabindex: -1}, onchange: c => {
      let checked = c.checked;
      forAll(me, c => {
        if (!c.children) checked? selectedSet.add(c.path) : selectedSet.delete(c.path);
      });
      selectedChanged(true);
    }});
    let count = mkch('span', ['?']);
    let selectLabel = mkch('label', [selectCheck, info.name + ' (', count, ')'], {cl: ['flex-grow', 'cht-off']});
    let row = mkch('div', [subMarker, selectLabel], {
      cl: 'flex-horiz',
    });
    
    
    
    let main = mkch('span', [row], {role: 'treeitem', attrs: {
      'aria-owns': sub_id,
      'aria-expanded': openSet.has(path),
      'aria-label': info.name,
      'tabindex': -1,
    }});
    
    let els = [main];
    if (has_ch) {
      updateSub();
      els.push(mkch(
        'ul',
        children.map(ch => mkch('li', ch.els, {role:'none'})),
        {id: sub_id, cl: 'tree-ul', role: 'group'},
      ));
    }
    
    let me = {
      info,
      path,
      els,
      mainEl: main,
      children,
      check: selectCheck,
      isOpen,
      setCount: (n) => {
        if (n) selectLabel.classList.remove('cht-off');
        else   selectLabel.classList.add('cht-off');
        count.textContent = n;
      }
    };
    
    if (children) children.forEach(c => { c.parent = me; });
    
    main.addEventListener('keydown', e => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.shift) return;
      
      function last(me) {
        while (me.children && me.isOpen()) me = me.children[me.children.length-1];
        return me;
      }
      function parentAdj(me, delta) {
        let p = me.parent;
        if (!p) return null;
        let i = p.children.indexOf(me);
        if (i+delta < 0) return p;
        if (i+delta>=p.children.length) return parentAdj(p, delta);
        let r = p.children[i+delta];
        return delta==-1? last(r) : r;
      }
      function up() {
        let adj = parentAdj(me, -1);
        if (adj) adj.mainEl.focus();
      }
      function down() {
        if (children && isOpen()) {
          children[0].mainEl.focus();
        } else {
          let adj = parentAdj(me, 1);
          if (adj) adj.mainEl.focus();
        }
      }
      
      switch (e.key) {
        default:
          return; // don't preventDefault
        case ' ':
          selectCheck.checked^= true;
          selectCheck.dispatchEvent(new Event('change'));
          break;
        case 'Up': case 'ArrowUp':
          up();
          break;
        case 'Down': case 'ArrowDown':
          down();
          break;
        case 'Right': case 'ArrowRight':
          if (children && !isOpen()) setOpen(true);
          else down();
          break;
        case 'Left': case 'ArrowLeft':
          if (children && isOpen()) setOpen(false);
          else if (me.parent) me.parent.mainEl.focus();
          else up();
          break;
        case 'Home':
          all.mainEl.focus();
          break;
        case 'End':
          last(all).mainEl.focus();
          break;
      }
      e.preventDefault();
    });
    
    return me;
  }
  
  let all = mkPart(allInfo, '');
  all.els[0].tabIndex = 0;
  all.els[0].ariaLabel = desc;
  let element = mkch('div', all.els);
  return {
    element,
    forAll: (f) => forAll(all, f),
    all,
    deserialize,
    serialize,
  };
}



async function newCPU() {
  let cpu = cpuListEl.selectedOptions[0].value;
  if (!await setCPU(cpu)) return false;
  
  let archs = unique(entries_ccpu.map(c=>c.archs).flat());
  let archGroups = group(archs.map(c => c.split("|")), 'all', curr_cpu_info.archOrder || {});
  query_archs = [...archs];
  curr_archObj = makeTree('|', 'Select extensions', archGroups, curr_cpu_info.archOpen || new Set(['']), (a, link) => {
    query_archs = a;
    updateSearch(link);
  });
  archListEl.textContent = '';
  if (archs.length > 1) archListEl.append(curr_archObj.element);
  
  
  let categories = unique(entries_ccpu.map(c=>c.categories).flat());
  let categoryGroups = group(categories.map(c => c.split("|")), 'all', curr_cpu_info.categoryOrder || {});
  query_categories = categories;
  curr_categoryObj = makeTree('|', 'Select category', categoryGroups, curr_cpu_info.categoryOpen || new Set(['']), (c, link) => {
    query_categories = c;
    updateSearch(link);
  });
  categoryListEl.textContent = '';
  categoryListEl.append(curr_categoryObj.element);
  
  updateSearch(false);
  return true;
}

async function newDefaultCPU() {
  await newCPU();
  curr_archObj.deserialize(curr_cpu_info.archDefault || ['']);
  curr_categoryObj.deserialize(curr_cpu_info.categoryDefault || ['']);
  updateLink();
}



function esc(s) {
  return new Option(s).innerHTML;
}
function calcPages() {
  return Math.max(1, Math.floor((query_found.length+perPage-1)/perPage));
}
function deltaPage(n) {
  let p = query_currPage+n;
  if (p<0 || p>=calcPages()) return;
  toPage(p);
}

const hl = (h, text) => mkch('span', [text], {cl:'h-'+h});
let mkRetLine = (fn) => hl('type',fn.ret.type);
let mkFnLine = (fn, wrapname=(c=>c)) => mkch('span', [wrapname(hl('name',fn.name)), '(', ...fn.args.flatMap(c=>[hl('type', c.type), ' '+c.name, ', ']).slice(0,-1), ')']);

function refreshGlobalInfo() {
  if (curr_entry === undefined) displayNoEnt(false);
}
function displayNoEnt(link = true) {
  descPlaceEl.innerHTML = curr_cpu_info? (curr_cpu_info.globalInfo || '') : '';
  curr_entry = undefined;
  if (link) updateLink();
}
function displayEnt(ins, fn, link = true) {
  if (fn.toVar) fn = fn.toVar;
  curr_entry = [ins, fn];
  let a0 = fn.archs || ins.archs;
  let a1 = a0;
  if (a0.length>1) a1 = a1.filter(c=>!c.endsWith("|KNCNI"));
  let a2 = a1.map(c=>esc(c.split(/\|/g).filter(c=>c[0]!=='(').slice(-1)[0])).join(' + ');
  if (a0.length != a1.length) a2+= " / KNCNI";
  let text = ``;
  text+= `<br>Architecture: <span class="mono">${a2}</span>`;
  text+= `<br>Categor${ins.categories.length>1?"ies":"y"}: <span class="mono">${ins.categories.map(c=>esc(c.replace(/\|/g,'→'))).join(', ')}</span>`;
  let description = fn.desc||ins.desc;
  if (description) text+= `<br><br>Description:<div class="desc">${description}</div>`;
  
  let implInstr = fn.implInstr;
  if (typeof implInstr === 'function') implInstr = implInstr();
  
  let implDesc = fn.implDesc || ins.implDesc;
  if (typeof implDesc === 'function') implDesc = implDesc();
  
  let implTimes = fn.implTimes || ins.implTimes;
  
  if (implInstr) text+= `<br>Instruction:<pre tabindex="0">${implInstr}</pre>`;
  if (implDesc) text+= `<br>Operation:<pre tabindex="0" class="operation">${implDesc}</pre>`;
  if (implTimes) text+= `<br>Performance:<table class="perf-table"></table>`;
  descPlaceEl.innerHTML = text;
  
  if (implTimes) descPlaceEl.getElementsByClassName("perf-table")[0].append(mkch('tbody', [
    mkch('tr', ['Architecture', 'Latency', 'Throughput (CPI)'].map(c=>mkch('th',[c]))),
    ...implTimes.map(c => {
      let [[k,v]] = Object.entries(c);
      return mkch('tr', [k, v.l, v.t].map(e => mkch('td', [e])));
    })
  ]));
  
  let desc;
  let copyWrap = (c) => mkcopy(c, fn.name);
  if (fn.args.length>7 || fn.args==0) {
    desc = [mkRetLine(fn), ' ', mkFnLine(fn, copyWrap)];
  } else {
    desc = [mkRetLine(fn), ' ', copyWrap(hl('name',fn.name)), '(\n', ...fn.args.map((a,i)=>{
      return mkch('span', ['  ', hl('type',a.type), ' '+a.name, ','.repeat(i!=fn.args.length-1), a.info? hl('comm',mk('span', {innerHTML: ' // '+a.info})) : '', '\n']);
    }), ')'];
  }
  if (ins.variations && ins.variations.length) {
    let mkvar = (fn, short) => mkch('span', [short], {cl: ['mono', 'var-link'], anyclick: () => displayEnt(ins, fn), role: 'button'});
    descPlaceEl.insertAdjacentElement('afterBegin', mkch('span', [
      'Variations: ',
      ...ins.variationsIncl.flatMap((fn, i) => [i?', ':'', mkvar(fn, fn.short || "base")])
    ]));
    descPlaceEl.insertAdjacentElement('afterBegin', mk('br'));
  }
  descPlaceEl.insertAdjacentElement('afterBegin', mk('br'));
  descPlaceEl.insertAdjacentElement('afterBegin', mkch('span', desc, {cl: ['mono', 'code-ws']}));
  if (link) updateLink();
}

function makePageBtn(text, label, action) {
  return mkch('span', [text], {cl: ['page-btn'], anyclick: action, role: 'button', attrs: {'aria-label': label}});
}

document.getElementById("pages-0").append(makePageBtn('«', 'Previous page', () => deltaPage(-1)));
document.getElementById("pages-4").append(makePageBtn('»', 'Next page', () => deltaPage(1)));

function toPage(page) {
  query_currPage = page;
  
  let pages = calcPages();
  
  let makeBtn = (i0) => {
    let i1 = i0+1;
    let r = makePageBtn(i1, `${page===i0? 'Page ' : 'To page '}${i1}${i1==pages? ' - last' : ''}`, () => toPage(i0));
    if (page===i0) {
      r.classList.add('page-curr');
      r.setAttribute('aria-current', 'page');
      r.setAttribute('role', 'none');
    } else if (i1!=1 && i1!=pages) {
      r.setAttribute('tabindex', -1);
    }
    return r;
  }
  
  pages1El.textContent = '';
  pages2El.textContent = '';
  pages3El.textContent = '';
  
  function range(s, e) {
    return Array(e-s).fill().map((c,i)=>i+s);
  }
  
  if (pages < 14) {
    pages2El.append(...range(0, pages).map(makeBtn));
  } else {
    let nL = page<3;
    let nR = page>=pages-3;
    let n = nL||nR;
    pages1El.append(...range(0, n? 5 : 3).map(makeBtn));
    if (!n) pages2El.append(...range(page-2, page+3).map(makeBtn));
    pages3El.append(...range(pages-(n? 5 : 3), pages).map(makeBtn));
  }
  
  resultListEl.textContent = '';
  resultListEl.append(...query_found.slice(page*perPage, (page+1)*perPage).map(ins=>{
    let cvar = ins;
    if (ins.variations && query_selVar) {
      cvar = ins.variations.find(c=>c.short==query_selVar) || cvar;
    }
    let r = mkch('tr', [
      mkch('td', [mkRetLine(cvar)]),
      mkch('td', [mkFnLine(cvar)]),
      // mkch('td', [c.archs.map(c=>c.split(/\|/g).slice(-1)[0]).join("+")]),
    ], {
      anyclick: () => {
        if (curr_entry && curr_entry[0]===ins && curr_entry[1]===cvar) {
          displayNoEnt();
        } else {
          displayEnt(ins, cvar);
        }
      },
      onenter: () => {
        displayEnt(ins, cvar);
        descPlaceEl.focus();
      },
      attrs: {'aria-label': `${cvar.name.replace(/__riscv_/g,'')}(${cvar.args.map(c=>c.type+' '+c.name).join(', ')})${cvar.ret.type? ' returns '+cvar.ret.type : ''}`},
    });
    return r;
  }));
}

let query_searchIn = [
  ['name', document.getElementById("s-name")],
  ['desc', document.getElementById("s-desc")],
  ['inst', document.getElementById("s-inst")],
  ['oper', document.getElementById("s-oper")],
  ['catg', document.getElementById("s-catg")],
];
let query_searchInObj = Object.fromEntries(query_searchIn);

function benchmarkSearch(seconds = 1) {
  let t0 = +new Date();
  let t1;
  let n = 0;
  let limitMS = seconds * 1000;
  while (1) {
    t1 = +new Date();
    if (t1-t0 > limitMS) break;
    updateSearch0();
    n++;
  }
  console.log("average over "+n+" iterations: "+((t1-t0)/n).toFixed(3)+"ms");
}


let searchRequested;
function searchTyped() {
  if (searchRequested === undefined) {
    searchRequested = setTimeout(()=>{
      searchRequested = undefined;
      updateSearch(false);
    }, 1);
  }
}
searchFieldEl.addEventListener('keydown', e => {
  if (e.key == 'Enter' && resultListEl.children.length > 0) {
    resultListEl.children[0].focus();
  }
});

function notifyError(f) {
  try {
    f();
  } catch (e) {
    toCenterInfo(e);
    throw e;
  }
}

function updateSearch(link=true) {
  notifyError(() => {
    updateSearch0();
    if (link) updateLink();
  });
}
function updateSearch0() {
  if (!entries_ccpu) return;
  let parts = []; // space-split parts of [' ',"raw text"] or ['"',"exact text"] or ['/',/regex/]
  { // split the input into parts
    let s = searchFieldEl.value.toLowerCase();
    let i = 0;
    while (i < s.length) {
      let c0 = s[i];
      if (c0=='"' || c0=='/') {
        i++;
        let p = "";
        while (i<s.length && s[i]!=c0) {
          if (s[i]=='\\') {
            if (c0=='/') p+= '\\';
            i++;
          }
          p+= s[i++];
        }
        i++;
        notifyError(() => {
          parts.push([c0,c0=='/'? new RegExp(p) : p]);
        });
      } else {
        let i0 = i;
        while (i<s.length && s[i]!=' ' && s[i]!='"' && s[i]!='/') i++;
        if (i0!=i) parts.push([' ',s.substring(i0, i)]);
        if (i<s.length && s[i]==' ') i++;
      }
    }
  }
  
  const P_NAME = 0;
  const P_RET = 1;
  const P_ARG = 2;
  const P_ARGN = 3;
  const P_DESC = 4;
  const P_INST = 5;
  const P_OPER = 6;
  const P_TYPE = 7;
  const P_ARCH = 8;
  const P_CAT = 9;
  const P_ARGn = (n) => P_CAT + n*2 + 1;
  const P_ARGnN = (n) => P_CAT + n*2 + 2;
  let gsvar = undefined;
  let query;
  { // convert to query
    let i = 0;
    let queryAnd = [];
    let sfldMap = sfld => {
      if (sfld===undefined) return undefined;
      let r = new Array(100).fill(false);
      for (let c of sfld) {
        switch (c) {
          case "name": r[P_NAME] = true; break;
          case "ret":  r[P_RET]  = true; break;
          case "type": r[P_TYPE] = true; break;
          case "arg":  r[P_ARG]  = true; break;
          case "argn": r[P_ARGN] = true; break;
          case "desc": r[P_DESC] = true; break;
          case "ins": case "instr":
          case "inst": r[P_INST] = true; break;
          case "oper": r[P_OPER] = true; break;
          case "cat":  r[P_CAT]  = true; break;
          case "arch": r[P_ARCH] = true; break;
          default:
            let m;
            if (m = c.match(/^arg(\d+)$/))  { let n=m[1]-argIndexing; if(n<0) throw "Bad argument number"; r[P_ARGn (n)] = true; break; }
            if (m = c.match(/^arg(\d+)n$/)) { let n=m[1]-argIndexing; if(n<0) throw "Bad argument number"; r[P_ARGnN(n)] = true; break; }
            throw 'Unknown field named "'+c+'"';
        }
      }
      return r;
    }
    function proc() { // get next query part from the parts list
      let [pt, pv] = parts[i++];
      if (pt=='"') return {type:"exact", val:pv};
      else if (pt=='/') return {type:"regex", val:pv};
      else if (!pv.includes('!') && !pv.includes(':') && pv.startsWith("var=")) {
        if (!gsvar) gsvar = [];
        gsvar.push(pv.substring(4));
        return undefined;
      } else {
        let negate = undefined;
        let sfld = undefined;
        let svar = undefined;
        if (pv.startsWith('!')) {
          negate = true;
          pv = pv.substring(1);
        }
        while (true) {
          let ci = pv.indexOf(':');
          if (ci==-1) break;
          let v = pv.substring(0,ci);
          if (v.startsWith("var=")) {
            svar = svar || [];
            svar.push(v.substring(4));
          } else {
            sfld = sfld || [];
            sfld.push(v);
          }
          pv = pv.substring(ci+1);
        }
        
        let val;
        if (pv.length==0 && i<parts.length) {
          val = proc();
        } else {
          val = {type:"exact", val: pv};
        }
        if (negate===undefined && sfld===undefined && svar===undefined) return val;
        return {type:"upd", negate, sfld, sfldMap: sfldMap(sfld), svar, val};
      }
      i++;
    }
    while (i < parts.length) queryAnd.push(proc());
    queryAnd = queryAnd.filter(c=>c);
    
    let sfld = Object.entries({
      name: query_searchInObj.name.checked,
      ret:  query_searchInObj.name.checked,
      arg:  query_searchInObj.name.checked,
      desc: query_searchInObj.desc.checked,
      inst: query_searchInObj.inst.checked,
      oper: query_searchInObj.oper.checked,
      cat:  query_searchInObj.catg.checked
    }).filter(([a,b])=>b).map(([a,b])=>a);
    query = {
      type: "upd",
      sfld,
      sfldMap: sfldMap(sfld),
      svar: gsvar,
      val: {type: "and", val: queryAnd}
    }
    // console.log(query);
  }
  
  let categorySet = new Set(query_categories);
  let archSet = new Set(query_archs);
  
  function untree(tree) {
    let map = new Map();
    
    function recAdd(curr, apath0) {
      let apath = [...apath0, curr];
      curr.currSet = new Set();
      if (curr.children) curr.children.forEach(c => recAdd(c, apath));
      else map.set(curr.path, apath);
    }
    recAdd(tree.all, []);
    
    return {
      add: (l, id) => {
        // console.log(l, id);
        // l.forEach(e => (map.get(e).children||[]).forEach(e => e.currSet.add(id)))
        l.forEach(c => {
          let g = map.get(c);
          if (g === undefined) throw new Error('Non-uniform category groupness: '+l);
          return g.forEach(e => e.currSet.add(id));
        });
      },
      write: () => tree.forAll(e => {
        e.setCount(e.currSet.size);
        e.currSet = undefined;
      }),
    };
  }
  let archStore = untree(curr_archObj);
  let categoryStore = untree(curr_categoryObj);
  query_selVar = gsvar && gsvar.length==1? gsvar[0] : undefined;
  
  query_found = entries_ccpu.filter((ins) => {
    let vars = ins.variationsIncl;
    function match(part, state) {
      switch(part.type) {
        default:
          throw new Error("Unhandled type "+part.type);
        case "exact":
          return state.where().some(c => c.includes(part.val));
        case "regex":
          return state.where().some(c => part.val.test(c));
        case "and":
          return part.val.every(c => match(c, state));
        case "upd":
          let nstate = {...state};
          if (part.svar) nstate.svar = part.svar;
          if (part.sfldMap) nstate.sfldMap = part.sfldMap;
          if (part.sfld || part.svar) {
            let cached = undefined;
            function get() {
              if (cached) return cached;
              let m = nstate.sfldMap;
              let r = [];
              const addOpt   = v => { if (v!==undefined) r.push(v); };
              const addLower = v => r.push(v.toLowerCase());
              if (m[P_ARCH]) addLower(...ins.archs);
              if (m[P_CAT]) addLower(...ins.categories);
              if (nstate.svar) vars = vars.filter(c => nstate.svar.includes(c.short || "base"));
              vars.forEach(c => {
                if (m[P_INST]) addOpt(c.implInstrSearch);
                if (m[P_DESC]) addOpt(c.descSearch);
                if (m[P_OPER]) addOpt(c.implDescSearch);
                if (m[P_NAME]) r.push(c.nameSearch);
                if (m[P_TYPE] || m[P_RET]) r.push(c.ret.typeSearch);
                c.args.forEach((c,i) => {
                  if (m[P_ARG]  || m[P_ARGn (i)] || m[P_TYPE]) r.push(c.typeSearch);
                  if (m[P_ARGN] || m[P_ARGnN(i)])              r.push(c.nameSearch); // apparently this was a very hot perf spot, which is why there's this funky P_ constant business
                });
              });
              return cached = r;
            }
            nstate.where = () => get();
          }
          let r = match(part.val, nstate);
          return part.negate? !r : r;
          break;
      }
    }
    if (query.svar && !vars.some(c => query.svar.includes(c.short || "base"))) return false;
    if (!match(query, {})) return false;
    
    let categoryMatch = ins.categories.some(c => categorySet.has(c));
    let archMatch = ins.archs.some(c => archSet.has(c));
    
    if (ins.archs      && categoryMatch)     archStore.add(ins.archs,      ins.id);
    if (ins.categories &&     archMatch) categoryStore.add(ins.categories, ins.id);
    
    return categoryMatch && archMatch;
  });
  
  archStore.write();
  categoryStore.write();
  
  let hdr = document.getElementById('main-table-header');
  let left = window.innerHeight - (hdr.getBoundingClientRect().bottom + document.documentElement.scrollTop);
  perPage = Math.min(perPageMax, Math.max(perPageMin, (left / hdr.clientHeight) | 0));
  
  toPage(0);
  resultCountEl.textContent = query_found.length+" result"+(query_found.length==1?"":"s");
  clearCenterInfo();
}

let pushNext = true;
function updateLink() {
  let entval = undefined;
  if (curr_entry) {
    let [eb,ev] = curr_entry;
    entval = eb.cpu[0]+'!'+eb.ref+(eb===ev? '' : '!'+ev.short);
  }
  let i = query_searchIn.map(c=>c[1].checked?"1":"0").join('');
  if (!i.includes('0')) i = undefined;
  let obj = {
    u: curr_cpu_name,
    e: entval,
    a: curr_archObj.serialize(),
    c: curr_categoryObj.serialize(),
    s: searchFieldEl.value || undefined,
    i
  }
  let json = JSON.stringify(obj);
  let cpu = knownCPUs.find(c => c.json == json);
  let hash = cpu? cpu.hash : "0"+compressToURI(json);
  
  let historyArgs = [{}, "", "#"+hash];
  if (pushNext) {
    history.pushState(...historyArgs);
    pushNext = false;
  } else {
    history.replaceState(...historyArgs);
  }
}
addEventListener("popstate", (e) => { pushNext = true; });

async function loadLink() {
  async function loadJSON(json) {
    if (json.s === undefined) json.s = "";
    searchFieldEl.value = json.s;
    
    if (json.e) {
      let [cpu,ref,...varl] = json.e.split('!');
      cpuListEl.value = cpu;
      if (!await setCPU(cpu)) return;
      let ent = entries_ccpu.find(c=>c.ref==ref);
      if (ent) {
        let svar;
        if (varl.length && ent.variations) svar = ent.variations.find(c=>c.short===varl[0]);
        displayEnt(ent, svar || ent, false);
      }
    } else {
      displayNoEnt(false);
    }
    
    cpuListEl.value = json.u;
    if (!await newCPU()) return;
    
    [...(json.i || [])].forEach((c,i) => {
      query_searchIn[i][1].checked = c=='1';
    });
    
    curr_archObj.deserialize(json.a||['']);
    curr_categoryObj.deserialize(json.c||['']);
    updateSearch(false);
  }
  let hash = location.hash.slice(1);
  let cpu = knownCPUs.find(c => c.hash == hash);
  if (cpu) {
    await loadJSON(JSON.parse(cpu.json));
  } else if (hash[0]=='0') {
    await loadJSON(JSON.parse(decompressURI(hash.slice(1))));
  } else {
    await newDefaultCPU();
  }
}

let knownCpuMap = Object.fromEntries(knownCPUs.map(c => [c.key,c.load]));

function toCenterInfo(val) {
  resultListEl.textContent = '';
  if (val instanceof Element) {
    centerInfoEl.textContent = '';
    centerInfoEl.append(val);
  }
  else centerInfoEl.textContent = val;
}
function clearCenterInfo() {
  centerInfoEl.textContent = '';
}

window.noDataFiles = '(no data file message)';
function setCPU(name) {
  curr_cpu_name = name;
  entries_ccpu = undefined;
  let loader = knownCpuMap[curr_cpu_name];
  if (!loader.promise) loader.promise = setCPU0(loader, name);
  return loader.promise.then(ok => {
    loader.promise = undefined;
    return ok;
  });
}
async function setCPU0(loader, name) {
  let noDataMsg = "Data files for "+name+" not available";
  if (loader.noData) {
    toCenterInfo(noDataMsg);
    return false;
  }
  console.log("parsing "+loader.msg);
  resultCountEl.textContent = "loading…";
  toCenterInfo("Loading "+loader.msg+"…");
  
  try {
    loader.loaded_info = await execFile(loader.loadPath);
  } catch (e) {
    if (e === window.noDataFiles) {
      loader.noData = true;
      toCenterInfo(noDataMsg);
      return false;
    } else {
      notifyError(() => { throw e; });
    }
  }
  
  curr_cpu_info = loader.loaded_info || {instructions:[]};
  let entries = entries_ccpu = curr_cpu_info.instructions(name);
  refreshGlobalInfo();
  
  const searchStr = c => c && c.length? c.toLowerCase().replace(/&lt;/g, '<').replace(/overloaded name:|<\/?[a-z][^>]*>/g, '') : undefined; // very crappy HTML filter, but it's all on known data and only for search
  function prepType(t) {
    let c = t.type;
    c = c.replace(/ +(\**) *$/, "$1");
    c = c.replace(/(.+) const\b/, "const $1");
    t.type = c;
    t.typeSearch = searchStr(t.type);
    t.nameSearch = searchStr(t.name);
  }
  entries.forEach(ins => {
    if (ins.archs.length==0 || ins.categories.length==0) { console.warn("No categories or architectures for "+ins.name); }
    let variationsExcl = ins.variations || [];
    ins.variationsIncl = ins.toVar? variationsExcl : [ins, ...variationsExcl];
    if (!ins.id) throw new Error("Intrinsic without ID: "+ins.name);
    ins.variationsIncl.forEach(v => {
      v.args.forEach(prepType);
      prepType(v.ret);
      v.nameSearch = searchStr(v.name);
      v.descSearch = searchStr(v.desc);
      if (!v.implInstrSearch && typeof v.implInstr!=='function') v.implInstrSearch = searchStr(v.implInstr);
      if (!v.implDescSearch && typeof v.implDesc!=='function')  v.implDescSearch = searchStr(v.implDesc);
    });
    
    let ref = ins.name.replace(/^(__riscv_|_mm|wasm_)/,"");
    if (ins.cpu[0]==='x86-64') ref = ins.ret.type+';'+ins.archs.join(';')+';'+ref;
    ins.ref = ref;
  });
  
  if (extra_test) {
    let badEntry = entries.find(c => !c.name || !c.ret.type || c.args.some(c => !c.type || !c.name));
    if (badEntry) console.warn("Warning: bad entry present: "+badEntry.name);
    
    let refs = entries.map(c=>c.ref);
    if (new Set(refs).size != refs.length) console.warn("Warning: non-unique refs in "+name);
    
    unique(entries.map(c=>c.cpu).flat()).forEach(foundCPU => {
      if (!knownCpuMap[foundCPU]) console.warn("Warning: CPU not listed ahead-of-time: "+foundCPU);
    });
  }
  
  console.log("parsed "+loader.msg);
  clearCenterInfo();
  return true;
}

(async () => {
  try {
    knownCPUs.forEach(({key: n}) => {
      cpuListEl.append(new Option(n, n));
    });
    
    await loadLink();
  } catch (e) {
    toCenterInfo(mkch('span', ["Failed to load:\n"+e.message+'\n'+e.stack], {cl: ['mono','code-ws'], attrs: {style: 'text-align:left; display:block;'}}));
    throw e;
  }
})();

window.onhashchange = () => loadLink();



function compressToURI(str) {
  if (!str) return str;
  let bytes = new TextEncoder('utf-8').encode(str);
  let arr = pako.deflateRaw(bytes, {'level': 9});
  let bytestr = [...arr].map(c => String.fromCharCode(c)).join('');
  return btoa(bytestr).replace(/\+/g, '@').replace(/=+/, '');
}

function decompressURI(str) {
  if (!str) return str;
  try {
    let arr = new Uint8Array([...atob(decodeURIComponent(str).replace(/@/g, '+'))].map(c=>c.charCodeAt()));
    return new TextDecoder('utf-8').decode(pako.inflateRaw(arr));
  } catch (e) {
    throw new Error("failed to decode - full link not copied?");
  }
}
