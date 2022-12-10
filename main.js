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

let is0;
let is1;
let curr_archObj, curr_categoryObj, curr_cpu;
let query_archs = [];
let query_categories = [];
let query_found = [];
let query_currPage = 0;
let perPage = 35;


async function loadFile(path) {
  let f = await fetch(path);
  let b = await f.arrayBuffer();
  return new TextDecoder().decode(b);
}

async function loadIntel() {
  let src = await loadFile("data/intel_intrinsics-1.xml");
  
  let type = (c) => {
    let type = c.getAttribute("type")
      .replace("unsigned ", "u")
      .replace(/__int64\b/g, "int64_t")
      .replace(/char\b/g, "int8_t")
      .replace(/short\b/g, "int16_t")
      .replace(/int\b/g, "int32_t")
    ;
    
    return {
      name: c.getAttribute("varname"),
      type: type,
    };
  };
  
  let archPre = {
    MMX: "SSE",
    
    AVX: "AVX+AVX2",
    AVX2: "AVX+AVX2",
    
    PCLMULQDQ: "SSE|SSE+",
    AES: "SSE|SSE+",
    SHA: "SSE|SSE+",
    
    FMA: "AVX2+",
    AVX_VNNI: "AVX2+",
    FP16C: "AVX2+",
    
    VPCLMULQDQ: "AVX512+",
    VAES: "AVX512+",
    GFNI: "AVX512+",
    
    KNCNI: "AVX512",
    
    BMI1: "bitmanip",
    BMI2: "bitmanip",
    POPCNT: "bitmanip",
    LZCNT: "bitmanip",
    
    ADX: "other",
    CET_SS: "other",
    CLDEMOTE: "other",
    CLFLUSHOPT: "other",
    CLWB: "other",
    CRC32: "other",
    ENQCMD: "other",
    FSGSBASE: "other",
    FXSR: "other",
    HRESET: "other",
    INVPCID: "other",
    KEYLOCKER: "SSE|SSE+",
    KEYLOCKER_WIDE: "SSE|SSE+",
    MONITOR: "other",
    MOVBE: "other",
    MOVDIR64B: "other",
    MOVDIRI: "other",
    MPX: "other",
    PCONFIG: "other",
    PREFETCHWT1: "other",
    RDPID: "other",
    RDRAND: "other",
    RDSEED: "other",
    RDTSCP: "other",
    RTM: "other",
    SERIALIZE: "other",
    TSC: "other",
    TSXLDTRK: "other",
    UINTR: "other",
    WAITPKG: "other",
    WBNOINVD: "other",
    XSAVE: "other",
    XSAVEC: "other",
    XSAVEOPT: "other",
    XSS: "other",
  };
  
  let xml = new DOMParser().parseFromString(src, "text/xml");
  let res = [...xml.children[0].children].map(e=>{
    let ch = [...e.children];
    let assert = cond => {
      if (!cond) throw new Error("bad element: "+e.outerHTML);
    }
    let filter = (n) => ch.filter(c => c.tagName==n);
    let take = (n) => {
      let r = filter(n);
      assert(r.length==1);
      return r[0];
    }
    let takeOpt = (n, f) => {
      let r = filter(n);
      assert(r.length<=1);
      if (r.length==1) return f(r[0]);
      return undefined;
    }
    
    let implInstrList = filter("instruction").map(c=>esc(c.getAttribute("name").toLowerCase()+" "+c.getAttribute("form")));
    if (e.getAttribute("sequence")==="TRUE") {
      if (implInstrList.length==0) implInstrList = ["(sequence)"];
      else implInstrList = implInstrList.map(c => c+" (sequence)");
    }
    
    let archs = filter("CPUID").map(c=>c.textContent).map(c=>{
      if (e.getAttribute("tech")==='SVML') return "SVML|"+c;
      let pre = archPre[c];
      if (pre) return pre+"|"+c;
      if (c.startsWith("AVX512")) return "AVX512|"+c;
      if (c.startsWith("AMX")) return "other|AMX|"+c;
      if (c.startsWith("SSE") || c.startsWith("SSSE")) return "SSE|"+c;
      return c;
    });
    
    let implDesc = takeOpt("operation", c=>c.textContent);
    if(implDesc) while(" \n\t".includes(implDesc[implDesc.length-1])) implDesc = implDesc.substring(0, implDesc.length-1);
    
    return {
      raw: e,
      cpu: ["x86-64"],
      
      ret: type(take("return")),
      args: filter("parameter").map(type),
      name: e.getAttribute("name"),
      
      desc: take("description").textContent,
      header: takeOpt("header", c=>c.textContent),
      
      implDesc: implDesc,
      implInstr: implInstrList.join("<br>"),
      
      archs: archs,
      categories: filter("category").map(c=>c.textContent),
    };
  });
  return res;
}
async function loadArm() {
  let intrinsics = JSON.parse(await loadFile("data/arm_intrinsics-1.json"));
  let operations = JSON.parse(await loadFile("data/arm_operations-1.json"));
  let operationMap = {};
  operations.forEach(c => {
    operationMap[c.item.id] = c.item.content;
  });
  
  let categoryMap = {
    'Logical|NAND': 'Logical|~AND',
    'Logical|NOR': 'Logical|~OR',
    'Logical|Bitwise NOT': 'Logical|NOT',
    'Logical|Logical NOT': 'Logical|NOT',
    'Logical|Exclusive OR': 'Logical|XOR',
    'Logical|Exclusive OR and rotate': 'Logical|XOR+rotate',
    'Logical|Rotate and exclusive OR': 'Logical|XOR+rotate',
    'Logical|Bit clear and exclusive OR': 'Logical|ANDN+XOR',
    'Logical|AND-NOT': 'Logical|ANDN',
    'Logical|OR-NOT': 'Logical|ORN',
    
    
    'Vector manipulation|Set all lanes to the same value': 'Vector manipulation|Broadcast',
    'Move|Vector move': 'Vector manipulation|Broadcast',
    
    'Table lookups|Extended table lookup': 'Table lookup|Extended table lookup',
    'Table lookups|Table lookup': 'Table lookup|Table lookup',
    
    'Bit manipulation|Bitwise clear': 'Logical|ANDN',
    
    'Compare|Bitwise not equal to zero': 'Compare|Bitwise Test',
    
    'Compare|Bitwise equal': 'Compare|x==y',
    'Compare|Equal to': 'Compare|x==y',
    'Compare|Bitwise equal to zero': 'Compare|To zero|x==0',
    'Compare|Not equal to': 'Compare|x!=y',
  };
  
  let optMap = (c, f) => c===undefined? c : f(c);
  let res = intrinsics.map(c=>{
    let implInstr = optMap(c.instructions, c=>c.map(c => {
      return esc(c.preamble+"\n  "+c.list.map(c => c.base_instruction.toLowerCase()+" "+c.operands).join("\n  "));
    }).join("<br>"));
    let implInstrRaw = optMap(c.instructions, c=>c.map(c => {
      return c.list.map(c => c.base_instruction.toLowerCase()+" "+c.operands).join("\n");
    }).join("\n"));
    
    let args = c.arguments.map(c=>{
      let i = c.lastIndexOf(' ');
      return ({type: c.substring(0, i), name: c.substring(i+1)});
    });
    
    let category = c.instruction_group
      .replace(/^Vector arithmetic\|/, "Arithmetic\|")
      .replace(/^Scalar arithmetic\|/, "With scalar\|")
      .replace(/^Arithmetic\|Across vector arithmetic\|/, "Arithmetic\|Fold\|")
      .replace(/^Arithmetic\|Pairwise arithmetic\|/, "Arithmetic\|Pairwise\|")
      .replace(/Compare\|Absolute /, "Compare|Absolute|")
      .replace(/greater than or equal to( zero)?/i, c=>c.includes("zero")? "To zero|x>=0" : "x>=y")
      .replace(/less than or equal to( zero)?/i, c=>c.includes("zero")? "To zero|x<=0" : "x<=y")
      .replace(/less than( zero)?/i, c=>c.includes("zero")? "To zero|x<0" : "x<y")
      .replace(/greater than( zero)?/i, c=>c.includes("zero")? "To zero|x>0" : "x>y")
      .replace(/^(Compare multiple|Fault suppression|Predication|Prefetch|Vector length|Vector tuple manipulation)\|/, c => "SVE|"+c)
      .replace(/^Shift\|/, "Logical|Shift|");
    if (categoryMap[category]) category = categoryMap[category];
    
    let categories = [category];
    
    return {
      raw: c,
      cpu: c.Architectures.map(c => c=="v7"? "armv7" : c=="A32"? "aarch32" : c=="A64"? "aarch64" : c=="MVE"? "Arm MVE" : "arm??"),
      
      ret: {type: c.return_type.value},
      args: args,
      name: c.name,
      
      desc: c.description,
      header: undefined,
      
      implDesc: c.Operation? operationMap[c.Operation] : undefined,
      implInstr: implInstr,
      implInstrRaw: implInstrRaw,
      
      archs: [c.SIMD_ISA],
      categories: categories,
    };
  });
  return res;
}

function unique(l) {
  return [...new Set(l)];
}

function group(list, name, order) {
  let leaf = list.filter(c=>c.length==1).map(c=>c[0]);
  let chel = list.filter(c=>c.length>1);
  
  let uniq = unique(chel.map(c=>c[0]));
  
  let cmp = (a,b) => {
    let sa = order[name+'|'+a]; if (sa===undefined) sa = 99;
    let sb = order[name+'|'+b]; if (sb===undefined) sb = 99;
    if (sa!=sb) return sa-sb;
    return a.localeCompare(b);
  };
  leaf.sort(cmp);
  uniq.sort(cmp);
  
  return {
    ch: uniq.map(c=>group(chel.filter(e=>e[0]==c).map(e=>e.slice(1)), c, order)),
    leaf: leaf,
    name: name,
  };
}



const mkch = (n, ch, {cl, id, attrs, onclick, href}={}) => {
  let r = document.createElement(n);
  if (ch) r.append(...ch);
  if (id) r.id = id;
  if (onclick) r.onclick = e => { onclick(r); }
  if (href) r.href = href;
  if (attrs) Object.entries(attrs).map(([k,v]) => r.setAttribute(k,v));
  if (cl) cl instanceof Array? r.classList.add(...cl) : r.classList.add(cl);
  return r;
};
const mk = (n, named={}) => mkch(n, undefined, named);



function makeCheckbox(display, key, updated, group) {
  let check = mk('input', {attrs:{type: "checkbox"}, onclick: c => {
    if (group) {
      let on = c.checked;
      [...group.getElementsByTagName('input')].forEach(e => {
        e.checked = on;
      });
    }
    updated();
  }})
  check.checked = true;
  
  let row = mkch('div', [
    mkch('span', [group? (group.hidden? ">" : "∨") : ""], {cl:['gr',group?'gr-yes':'gr-no'], onclick: t => {
      group.hidden^= 1;
      t.textContent = group.hidden? ">" : "∨";
    }}),
    mkch('label', [check, display], {cl: 'flex-grow'}),
  ], {cl: 'flex-horiz'})
  
  return {check: check, obj: row, key: key};
}

function jp(a, b) {
  return a? a+"|"+b : b;
}

function makeTree(tree, ob, update) {
  let res;
  function updateFn(link=true) {
    let rec = (c) => { // 1:off 2:on 3:indeterminate
      let chRes = c.ch.map(c => rec(c));
      let status = [
        ...c.leaf.map(c=>c.check.checked?2:1),
        ...chRes.map(c=>c[0]),
      ].reduce((a,b)=>a|b, 0);
      
      let cc = c.check;
      if (status==3) cc.indeterminate = true;
      else {
        cc.indeterminate = false;
        cc.checked = status==2;
      }
      return [status, [...chRes.flatMap(c=>c[1]), ...c.leaf.filter(c=>c.check.checked).map(c=>c.key)]];
    }
    update(rec(res)[1].map(c=>c.substring(4)), link);
  }
  function step(tree, prefix) {
    let key = jp(prefix, tree.name);
    let chRes = tree.ch.map(c=>step(c, key));
    let leafRes = tree.leaf.map(c => makeCheckbox(c, jp(key,c), updateFn, undefined));
    let contents = mkch('div', [...chRes, ...leafRes].map(c=>c.obj));
    
    let indent = mkch('div', [contents], {cl:'indent'});
    if (!ob.has(tree.name)) indent.hidden = true;
    let check = makeCheckbox(tree.name, key, updateFn, indent)
    
    return {check: check.check, obj: mkch('div', [check.obj, indent]), ch:chRes, leaf:leafRes, key:key};
  }
  res = step(tree, '');
  res.updateFn = updateFn;
  return res;
}



function newCPU(link=true) {
  if (!is0) return;
  let cpu = cpuListEl.selectedOptions[0].value;
  curr_cpu = cpu;
  is1 = is0.filter(c=>c.cpu.includes(cpu));
  
  let archs = unique(is1.map(c=>c.archs).flat());
  let preferredOrder = {
    "all|SSE": 0,
    "all|AVX+AVX2": 1,
    "all|AVX2+": 2,
    "all|AVX512": 3,
    "all|AVX512+": 4,
    
    "SSE|MMX":0,
    "SSE|SSE":1,
    "SSE|SSE2":2,
    "SSE|SSE3":3,
    "SSE|SSSE3":4,
    
    "AVX512|AVX512F": 0,
    
    "Logical|Negate": 0,
    "Logical|Saturating Negate": 1,
    "Logical|AND": 2,
    "Logical|OR": 3,
    "Logical|XOR": 4,
    "Logical|NOT": 5,
    "Logical|ANDN": 6,
    "Logical|ORN": 7,
    
    'all|Arithmetic':0,
    'all|Logical':1,
    'all|Vector manipulation':2,
    
    'Arithmetic|Add':0,
    'Arithmetic|Subtract':1,
    'Arithmetic|Multiply':2,
  };
  let openByDefault = new Set([
    'all',
    'SSE', 'AVX+AVX2',
  ]);
  archListEl.textContent = '';
  let archGroups = group(archs.map(c => c.split("|")), 'all', preferredOrder);
  query_archs = [...archs];
  curr_archObj = makeTree(archGroups, openByDefault, (a, link) => {
    query_archs = a;
    updateSearch(link);
  });
  archListEl.append(curr_archObj.obj);
  
  
  let categories = unique(is1.map(c=>c.categories).flat());
  categoryListEl.textContent = '';
  let categoryGroups = group(categories.map(c => c.split("|")), 'all', preferredOrder);
  query_categories = categories;
  curr_categoryObj = makeTree(categoryGroups, openByDefault, (c, link) => {
    query_categories = c;
    updateSearch(link);
  });
  categoryListEl.append(curr_categoryObj.obj);
  
  updateSearch(link);
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
function toPage(page) {
  query_currPage = page;
  const h = (h, text) => mkch('span', [text], {cl:'h-'+h});
  
  let pages = calcPages();
  
  let makeBtn = (n) => {
    let r = mkch('span', [n+1], {cl: ['page-btn'], onclick: () => toPage(n)});
    if (page===n) r.classList.add('page-curr');
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
    let n = nL||nR
    pages1El.append(...range(0, n? 5 : 3).map(makeBtn));
    if (!n) pages2El.append(...range(page-2, page+3).map(makeBtn));
    pages3El.append(...range(pages-(n? 5 : 3), pages).map(makeBtn));
  }
  
  resultListEl.textContent = '';
  resultListEl.append(...query_found.slice(page*perPage, (page+1)*perPage).map(c=>{
    let mkRetLine = () => h('type',c.ret.type);
    let mkFnLine = () => mkch('span', [h('name',c.name), '(', ...c.args.flatMap(c=>[h('type', c.type), ' '+c.name, ', ']).slice(0,-1), ')']);
    let r = mkch('tr', [
      mkch('td', [mkRetLine()]),
      mkch('td', [mkFnLine()]),
      // mkch('td', [c.archs.map(c=>c.split(/\|/g).slice(-1)[0]).join("+")]),
    ]);
    r.onclick = () => {
      console.log(c);
      let text = `<br>`;
      text+= `<br>Architecture: <span class="mono">${c.archs.map(c=>esc(c.split(/\|/g).slice(-1)[0])).join(' + ')}</span><br>`;
      text+= `<br>Description:<div class="desc">${c.desc}</div>`;
      if (c.implInstr) text+= `<br>Instruction:<pre>${c.implInstr}</pre>`;
      if (c.implDesc) text+= `<br>Operation:<pre>${c.implDesc}</pre>`;
      
      descPlaceEl.innerHTML = text;
      descPlaceEl.insertAdjacentElement('afterBegin', mkch('span', [mkRetLine(), ' ', mkFnLine()], {cl: 'mono'}));
    }
    return r;
  }));
}

let query_searchIn = [
  ['name', document.getElementById("s-name")],
  ['desc', document.getElementById("s-desc")],
  ['inst', document.getElementById("s-inst")],
  ['oper', document.getElementById("s-oper")],
];
let query_searchInObj = Object.fromEntries(query_searchIn);

function updateSearch(link=true) {
  let parts = searchFieldEl.value.toLowerCase().split(/ /g);
  let categorySet = new Set(query_categories);
  let archSet = new Set(query_archs);
  let sName = query_searchInObj.name.checked;
  let sDesc = query_searchInObj.desc.checked;
  let sInst = query_searchInObj.inst.checked;
  let sOper = query_searchInObj.oper.checked;
  query_found = is1.filter((c) => {
    if (!c.categories.some(c => categorySet.has(c))) return false;
    if (!c.archs.some(c => archSet.has(c))) return false;
    let a = [];
    if (sName) { a.push(c.name); a.push(c.ret.type); c.args.forEach(c => a.push(c.type)); };
    if (sInst) a.push(c.implInstrRaw);
    if (sDesc) a.push(c.desc);
    if (sOper) a.push(c.implDesc);
    a = a.filter(c=>c).map(c=>c.toLowerCase());
    if (parts.length>0 && !parts.every(p => a.some(cv => cv.includes(p)))) return false;
    return true;
  });
  
  toPage(0);
  resultCountEl.textContent = query_found.length;
  
  if (link) updateLink();
}

function updateLink() {
  function ser(x) {
    if (x.check.indeterminate) return [...x.ch.flatMap(ser), ...x.leaf.filter(c=>c.check.checked).map(c=>c.key)];
    return x.check.checked? [x.key] : [];
  }
  let obj = {
    u: curr_cpu,
    a: ser(curr_archObj),
    c: ser(curr_categoryObj),
    s: searchFieldEl.value,
    p: query_currPage,
    i: query_searchIn.map(c=>c[1].checked?"1":"0").join('')
  }
  let json = JSON.stringify(obj);
  history.pushState({}, "", "#0"+enc(json));
}

function loadLink() {
  let hash = decodeURIComponent(location.hash.slice(1));
  if (hash[0]=='0') {
    let json = JSON.parse(dec(hash.slice(1)));
    console.log(json);
    
    cpuListEl.value = json.u;
    newCPU(false);
    
    [...json.i].forEach((c,i) => {
      query_searchIn[i][1].checked = c=='1';
    });
    
    searchFieldEl.value = json.s;
    
    function selTree(t, vs) {
      let set = new Set(vs);
      function rec(c, on) {
        if (set.has(c.key)) on = true;
        c.check.checked = on;
        c.ch.forEach(n => rec(n, on));
        c.leaf.forEach(n => n.check.checked = on || set.has(n.key));
      }
      rec(t);
      t.updateFn(false);
    }
    selTree(curr_archObj, json.a);
    selTree(curr_categoryObj, json.c);
    updateSearch(false);
  } else {
    newCPU(false);
  }
}

(async () => {
  let i1 = await loadIntel();
  console.log("intel parsed");
  let i2 = await loadArm();
  console.log("arm parsed");
  is0 = [...i1, ...i2];
  let cpus = unique(is0.map(c=>c.cpu).flat());
  cpus.forEach((c, i) => {
    cpuListEl.append(new Option(c, c));
  });
  
  loadLink();
})();

window.onhashchange=loadLink;













function enc(str) {
  if (!str) return str;
  let bytes = new TextEncoder("utf-8").encode(str);
  return arrToB64(deflate(bytes));
}
function dec(str) {
  if (!str) return str;
  try {
    return new TextDecoder("utf-8").decode(inflate(b64ToArr(str)));
  } catch (e) {
    return "failed to decode - full link not copied?";
  }
}

function arrToB64(arr) {
  var bytestr = "";
  arr.forEach(c => bytestr+= String.fromCharCode(c));
  return btoa(bytestr).replace(/\+/g, "@").replace(/=+/, "");
}
function b64ToArr(str) {
  return new Uint8Array([...atob(decodeURIComponent(str).replace(/@/g, "+"))].map(c=>c.charCodeAt()))
}

function deflate(arr) {
  return pako.deflateRaw(arr, {"level": 9});
}
function inflate(arr) {
  return pako.inflateRaw(arr);
}