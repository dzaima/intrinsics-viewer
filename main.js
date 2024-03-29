'use strict';

let argIndexing = 1;
let perPageMin = 10;
let perPageMax = 50;

/*
intrinsic entry:
{
  raw: whatever original form of the object,
  cpu: ["CPU"],
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

let cpuLoaderX86_64 = {msg: 'x86-64', load: loadIntel};
let cpuLoaderARM    = {msg: 'ARM',    load: loadArm};
let cpuLoaderRISCV  = {msg: 'RISC-V', load: loadRVV};
let knownCPUs = [
  ['x86-64',  cpuLoaderX86_64],
  ['Arm MVE', cpuLoaderARM],
  ['armv7',   cpuLoaderARM],
  ['aarch32', cpuLoaderARM],
  ['aarch64', cpuLoaderARM],
  ['risc-v',  cpuLoaderRISCV],
];



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

let entries_all = [];
let entries_ccpu = undefined;
let curr_archObj, curr_categoryObj, curr_cpu, curr_entry;
let query_archs = [];
let query_categories = [];
let query_found = [];
let query_selVar = undefined;
let query_currPage = 0;
let perPage = 37;

let extra_test = false;

async function loadFile(path) {
  let f = await fetch(path);
  let b = await f.arrayBuffer();
  return new TextDecoder().decode(b);
}
function overloadedName(name) {
  return `Overloaded name: <span class="mono h-name">${mkcopy(name,name)}</span>`
}


let excludeSVML = true; // remove SVML entries, which are provided by an Intel library and not the CPU
async function loadIntel() {
  let src, perfSrc;
  try {
    src = await loadFile("data/intel_intrinsics-1.xml");
    perfSrc = await loadFile("data/intel_perf2-1.js");
  } catch(e) {
    return null;
  }
  let perf = JSON.parse(perfSrc.substring(perfSrc.indexOf('{')).replace(/,\s*}/g,'}').replace(/,\s*]/g,']').replace(/\{l:"/g, '{"l":"').replace(/",t:"/g, '","t":"'));
  
  let type = (c) => {
    let name = c.getAttribute("varname");
    
    let type = c.getAttribute("type")
      .replace("unsigned ", "u")
      .replace(/__int32\b/g, "int32_t")
      .replace(/__int64\b/g, "int64_t")
      .replace(/long long\b/g, "int64_t")
      .replace(/char\b/g, "int8_t")
      .replace(/short\b/g, "int16_t")
      .replace(/int\b/g, "int32_t")
    ;
    if (type==="unsigned") type = "uint32_t";
    
    let info = '';
    let mw = c.getAttribute("memwidth");
    if (mw) info+= "Used memory bytes: " + mw/8;
    
    let iw = c.getAttribute("immwidth");
    if (iw) info+= (info?"; ":"")+"Used bits: " + iw;
    
    return {
      name: name,
      type: type,
      info: info,
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
    
    VPCLMULQDQ: "AVX512",
    VAES: "AVX512",
    GFNI: "AVX512",
    
    KNCNI: "other",
    
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
  let res0 = [...xml.children[0].children].map(e=>{
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
    
    let instrs = filter("instruction");
    let implInstrList = instrs.map(c => {
      let res = c.getAttribute("name").toLowerCase();
      if (c.hasAttribute("form")) res+= " "+c.getAttribute("form");
      return esc(res);
    });
    if (e.getAttribute("sequence")==="TRUE") {
      if (implInstrList.length==0) implInstrList = ["(sequence)"];
      else implInstrList = implInstrList.map(c => c+" (sequence)");
    }
    
    let implTimes = instrs.map(c=>perf[c.getAttribute("xed")]).filter(c=>c);
    // if (implTimes.length>1) console.log(instrs.map(c=>c.getAttribute("xed"))); // TODO do something about this
    implTimes = implTimes.length? implTimes[0] : undefined;
    
    let archs = filter("CPUID").map(c=>c.textContent).map(c=>{
      if (e.getAttribute("tech")==='SVML') return "SVML|"+c;
      let pre = archPre[c];
      if (pre) return pre+"|"+c;
      if (c.startsWith("AVX512")) return "AVX512|"+c;
      if (c.startsWith("AMX")) return "other|AMX|"+c;
      if (c.startsWith("SSE") || c.startsWith("SSSE")) return "SSE|"+c;
      return c;
    });
    if (archs.length==0) archs = ['other|all'];
    if (archs.length > 1 && archs.every(c=>c.includes('512'))) archs = archs.filter(c=>c!='AVX512|AVX512F'); // remove reduntant AVX512F arch requirements for things that imply that otherwise
    
    let implDesc = takeOpt("operation", c=>c.textContent);
    if(implDesc) while(" \n\t".includes(implDesc[implDesc.length-1])) implDesc = implDesc.substring(0, implDesc.length-1);
    
    let parameters = filter("parameter").map(type);
    if (parameters.length==1 && parameters[0].type=='void') parameters = [];
    
    return {
      raw: e,
      cpu: ["x86-64"],
      id: idCounter++,
      
      ret: type(take("return")),
      args: parameters,
      name: e.getAttribute("name"),
      
      desc: take("description").textContent,
      header: takeOpt("header", c=>c.textContent),
      
      implDesc: implDesc,
      implInstr: implInstrList.join("<br>"),
      implInstrSearch: implInstrList.join("\n"),
      implTimes: implTimes,
      
      archs: archs,
      categories: filter("category").map(c=>c.textContent),
    };
  });
  
  if (excludeSVML) res0 = res0.filter(c=>!c.archs.some(c=>c.includes('SVML')));
  
  let res1 = [];
  {
    let mapB = new Map();
    let mapX = new Map();
    let add = (map, key, val, ...pre) => { // returns whether this is a new entry
      let l = map.get(key);
      if (!l) {
        map.set(key, l = []);
        l.push(...pre, val);
        return true;
      }
      l.push(val);
      return false;
    }
    
    res0.forEach(n => {
      let key1 = n.name.replace(/^(_mm\d*)_mask[z23]?_/, "$1_");
      if (!n.archs.length || !(n.archs[0].includes("AVX512") || n.archs[0].includes("KNCNI"))) {
        add(mapX, key1, n);
        n.short = "base";
        res1.push(n);
        return;
      }
      
      let key = n.archs[0]+';'+key1;
      if (add(mapB, key, n, res1.length)) res1.push("??");
    });
    
    mapB.forEach((v,k) => {
      let pos = v[0];
      if (v.length==2) {
        res1[pos] = v[1];
      } else {
        let v1 = v.slice(1);
        v1.sort((a,b) => a.name.length-b.name.length);
        if (v1.length>1 && v1[0].name.length==v1[1].name.length) throw new Error("equal first lengths");
        v1.map((c,i) => {
          let f = c.name.match(/_(mask[z23]?)_/);
          c.short = f? f[1] : "base";
          if (c.short=="base" && i!=0) throw new Error("base not first");
        });
        
        let v2 = [...(mapX.get(k.split(';')[1]) || []), ...v1];
        
        let opts = v2.map((c) => c.name.match(/_mask([z23]?)_/));
        let optsF = opts.filter(c=>c);
        
        let dec = optsF.map(c=>c[1]).join('');
        let exName = optsF[0].input.replace(/_mask([z23]?)_/, opts.includes(null)? '[_mask]_' : `_mask[${dec}]_`);
        
        let exArch = v1[0];
        
        res1[pos] = {
          id: idCounter++,
          name: exName,
          ret: v2[0].ret,
          args: v2[0].args,
          archs: exArch.archs, cpu: exArch.cpu, categories: exArch.categories,
          variations: v2,
          toVar: exArch,
        };
      }
    });
  }
  
  res1.sort((a,b) => [a,b].map(c => {
    let a0 = c.archs[0];
    let a0i = (e) => a0.includes(e);
    return (c.name.startsWith('_mm')?'0':'1') + (a0i('MMX')||a0i('AES')||a0i('KEYLOCKER')||a0i('SHA')? '~' : a0i('SSE')?'1':'0') + a0 + '__' + c.name.replace(/\[z]|\[?_maskz?]?/g, '') + (c.name.includes('[')?'1':'0');
  }).reduce((a,b)=>(a>b)-(a<b)));
  
  return res1;
}
async function loadArm() {
  let intrinsics, operations;
  try {
    intrinsics = await loadFile("data/arm_intrinsics-1.json");
    operations = await loadFile("data/arm_operations-1.json");
  } catch (e) {
    return null;
  }
  intrinsics = JSON.parse(intrinsics);
  operations = JSON.parse(operations);
  let operationMap = {};
  operations.forEach(c => {
    operationMap[c.item.id] = c.item.content;
  });
  
  let categoryMap = {
    'Logical|NAND': 'Logical|NAND',
    'Logical|NOR': 'Logical|NOR',
    'Logical|Bitwise NOT': 'Logical|NOT',
    'Logical|Logical NOT': 'Logical|NOT',
    'Logical|Exclusive OR': 'Logical|XOR',
    'Logical|Exclusive OR and rotate': 'Logical|XOR+rotate',
    'Logical|Rotate and exclusive OR': 'Logical|XOR+rotate',
    'Logical|Bit clear and exclusive OR': 'Logical|ANDN+XOR',
    'Logical|AND-NOT': 'Logical|ANDN',
    'Logical|OR-NOT': 'Logical|ORN',
    'Logical|Saturating Negate': 'Arithmetic|Negate|Saturating negation',
    'Logical|Negate': 'Arithmetic|Negate|Negation',
    
    
    'Vector manipulation|Set all lanes to the same value': 'Vector manipulation|Broadcast',
    'Move|Vector move': 'Vector manipulation|Broadcast',
    
    'Table lookups|Extended table lookup': 'Table lookup|Extended table lookup',
    'Table lookups|Table lookup': 'Table lookup|Table lookup',
    
    'Bit manipulation|Bitwise clear': 'Logical|ANDN',
    
    'Compare|Bitwise not equal to zero': 'Compare|Bitwise Test',
    
    'Compare|Bitwise equal': 'Compare|==',
    'Compare|Equal to': 'Compare|==',
    'Compare|Bitwise equal to zero': 'Compare|==',
    'Compare|Not equal to': 'Compare|!=',
  };
  
  let optMap = (c, f) => c===undefined? c : f(c);
  let res0 = intrinsics.map(c=>{
    let implInstr = optMap(c.instructions, c=>c.map(c => {
      return esc(c.preamble+"\n  "+c.list.map(c => c.base_instruction.toLowerCase()+" "+c.operands).join("\n  "));
    }).join("<br>"));
    let implInstrSearch = optMap(c.instructions, c=>c.map(c => {
      return c.list.map(c => c.base_instruction.toLowerCase()+" "+c.operands).join("\n");
    }).join("\n"));
    
    let args = c.arguments.map(c=>{
      let i = Math.max(c.lastIndexOf(' '), c.lastIndexOf('*'));
      return ({type: c.substring(0, i+1), name: c.substring(i+1)});
    });
    if (args.length==1 && args[0].type=='void') args = [];
    
    if (c.Arguments_Preparation) {
      let argMap = Object.fromEntries(args.map(c=>[c.name, c]));
      Object.entries(c.Arguments_Preparation).forEach(([k,v]) => {
        if (!argMap[k]) return;
        if (v.hasOwnProperty("minimum") && v.hasOwnProperty("maximum")) argMap[k].info = "range: ["+v.minimum+";"+v.maximum+"]";
      });
    }
    
    let category = c.instruction_group
      .replace(/^Vector arithmetic\|/, "Arithmetic\|")
      .replace(/^Scalar arithmetic\|/, "With scalar\|")
      .replace(/^Arithmetic\|Across vector arithmetic\|/, "Arithmetic\|Fold\|")
      .replace(/^Arithmetic\|Pairwise arithmetic\|/, "Arithmetic\|Pairwise\|")
      .replace(/^Shift\|/, "Logical|Shift|")
      .replace(/^(Compare multiple|Fault suppression|Predication|Prefetch|Vector length|Vector tuple manipulation)\|/, c => "SVE|"+c)
    ;
    
    if (category.startsWith("Compare|")) {
      category = category
        .replace(/Compare\|Absolute /, "Compare|Absolute|")
        .replace(/greater than or equal to( zero)?/i, c=>">=")
        .replace(/less than or equal to( zero)?/i, c=>"<=")
        .replace(/less than( zero)?/i, c=>"<")
        .replace(/greater than( zero)?/i, c=>">")
      ;
    }
    
    if (categoryMap[category]) category = categoryMap[category];
    if (c.name.startsWith('vmaxnmq_') || c.name.startsWith('vmaxnm_')) category = "Arithmetic|Maximum";
    
    let categories = [category];
    let nativeOpNEON = (c.Operation || "").startsWith("Neon");
    let nativeOperation = c.Operation? operationMap[c.Operation].replace(/^<h4>Operation<\/h4>/, "<br>").replace(/<h4>/g,'<span class="arm-header">').replace(/<\/h4>/g, '</span>') : "";
    
    return {
      raw: c,
      cpu: c.Architectures.map(c => c=="v7"? "armv7" : c=="A32"? "aarch32" : c=="A64"? "aarch64" : c=="MVE"? "Arm MVE" : "arm??"),
      id: idCounter++,
      
      ret: {type: c.return_type.value},
      args: args,
      name: c.name.replace(/\[|]/g,""),
      
      desc: (c.name.includes("[")? overloadedName(c.name.replace(/\[[^\]]+]/g,"")) + "<br>" : "") + c.description + (nativeOpNEON? "" : "<br>"+nativeOperation),
      header: undefined,
      
      implDesc: nativeOpNEON? nativeOperation : undefined,
      implInstr: implInstr,
      implInstrSearch: implInstrSearch,
      
      archs: [c.SIMD_ISA],
      categories: categories,
    };
  });
  
  let res1 = [];
  {
    let map = new Map();
    res0.forEach(n => {
      if (!n.archs.length || !n.archs[0].includes("sve")) { res1.push(n); return; }
      let key = n.archs[0] + ';' + n.name.replace(/_[mxz]$/, "");
      let l = map.get(key);
      if (!l) {
        map.set(key, l = []);
        l.push(res1.length);
        res1.push("??");
      }
      l.push(n);
    });
    map.forEach((v,k) => {
      let pos = v[0];
      if (v.length==2) {
        res1[pos] = v[1];
      } else {
        let v1 = v.slice(1);
        v1.sort((a,b) => {
          let d = a.name.length-b.name.length;
          if (d) return d;
          return a<b;
        });
        res1[pos] = v1[0];
        let v2 = v1[0].variations = v1.slice(1);
        v1.map((c,i) => {
          let f = c.name.match(/(_[mxz])$/);
          c.short = f? f[1] : "base";
          if (c.short=="base" && i!=0) throw new Error("base not first");
        });
      }
    });
  }
  
  
  return res1;
}

let rvv_helper = undefined;
async function loadRVV() {
  let specFilePath = "data/v-spec.html";
  let baseFile, rvvOps;
  try {
    baseFile = await loadFile("data/rvv_base-5.json");
    rvvOps = new Function(await loadFile("extra/rvv_ops.js"))();
  } catch (e) {
    console.error(e);
    return null;
  }
  
  rvv_helper = (name, ...args) => {
    let prev_entry = curr_entry;
    descPlaceEl.innerHTML = `<a class="rvv-helper-back">back</a><pre>${rvvOps.helper(name, ...args)}</pre>`;
    descPlaceEl.getElementsByClassName('rvv-helper-back')[0].onclick = () => displayEnt(...prev_entry, false);
  };
  
  let res = JSON.parse(baseFile);
  
  // process entries
  res.forEach(ins => {
    let c = ins;
    
    let fxarg = arg => {
      if (arg.name == 'vm') arg.name = 'mask';
      return arg;
    }
    c.args.forEach(fxarg);
    
    c.id = idCounter++;
    c.implInstr = c.implInstrRaw? c.implInstrRaw.replace(/\n/g, '<br>') : undefined;
    
    // process variations
    if (ins.policies) {
      ins.variations = ins.policies.map(s => {
        let obj = {
          name: ins.name + s.s,
          short: s.s,
          ret: ins.ret,
          
          args: s.a.map(a => {
            if (typeof a === 'number') return ins.args[a];
            if (typeof a === 'object') return fxarg(a);
            return {name: a.startsWith('vbool')? 'mask' : 'vd', type: a};
          }),
        };
        
        obj.implDesc = () => rvvOps.oper(c, obj)?.oper;
        obj.implInstr = () => rvvOps.oper(c, obj)?.instrHTML;
        if (extra_test) rvvOps.oper(c, obj); // make sure oper generation works for all variations
        
        return obj;
      });
    }
    
    [ins, ...(ins.variations || [])].forEach(v => {
      v.args.forEach(a => {
        if (a.info==='__RISCV_FRM' || a.info=='__RISCV_VXRM') a.info = `<a onclick="rvv_helper('${a.info}')">${a.info}</a>`
      });
    });
    
    let newOp = rvvOps.oper(c);
    if (!newOp) throw new Error("No rvvOps for "+c.name);
    c.desc = newOp.desc || '';
    c.specRef = newOp.specRef;
    c.implDesc = newOp.oper;
    if (newOp.instrHTML !== undefined) {
      c.implInstrSearch = newOp.instrSearch;
      c.implInstr = () => rvvOps.oper(c).instrHTML;
    }
    c.categories = newOp.categories;
    if (c.overloaded) c.desc = `${overloadedName(c.overloaded)}<br>${c.desc}`;
    if (c.specRef) c.desc = `<a target="_blank" href="${specFilePath}#${newOp.specRef}">Specification</a><br>${c.desc}`;
    
  });
  
  rvvOps.initialized();

  function addSimpleOp(ret, name, args, desc, oper) {
    res.push({
      id: idCounter++,
      ret: {type: ret}, args, name,
      desc, implDesc: oper,
      archs: ['rvv'], categories: ["Initialize|General"],
    });
  }
  addSimpleOp("unsigned long", "__riscv_vlenb", [], "Get VLEN in bytes", "return VLEN/8;");
  
  res.forEach(c => {
    c.cpu = ['risc-v'];
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



function mkch(n, ch, {cl, id, attrs, onclick, href, innerHTML}={}) {
  let r = document.createElement(n);
  if (ch) r.append(...ch);
  if (id) r.id = id;
  if (onclick) r.onclick = e => { onclick(r); }
  if (href) r.href = href;
  if (attrs) Object.entries(attrs).map(([k,v]) => r.setAttribute(k,v));
  if (cl) cl instanceof Array? r.classList.add(...cl) : r.classList.add(cl);
  if (innerHTML) r.innerHTML = innerHTML
  return r;
};
const mk = (n, named={}) => mkch(n, undefined, named);

function docopy(text) {
  navigator.clipboard.writeText(text);
}
function mkcopy(content, text) {
  let hoverMessage = 'Click to copy';
  if (typeof content === 'string') return `<span class="click-copy hover-base" onclick="docopy('${text}')"><span class="hover-text">${hoverMessage}</span>${content}</span>`;
  return mkch('span', [mkch('span', [hoverMessage], {cl:'hover-text'}), content], {cl:['click-copy', 'hover-base'], onclick: ()=>docopy(text)});
}


function makeCheckbox(display, key, updated, group) {
  let check = mk('input', {attrs:{type: "checkbox"}, onclick: c => {
    if (group) {
      let on = c.checked;
      [...group.getElementsByTagName('input')].forEach(e => {
        e.checked = on;
      });
    }
    updated();
  }});
  check.checked = true;
  
  let count = mkch('span', ['?']);
  let label = mkch('label', [check, display+' (', count, ')'], {cl: ['flex-grow', 'cht-off']});
  
  let row = mkch('div', [
    mkch('span', [group? (group.hidden? ">" : "∨") : ""], {cl:['gr',group?'gr-yes':'gr-no'], onclick: t => {
      group.hidden^= 1;
      t.textContent = group.hidden? ">" : "∨";
    }}),
    label,
  ], {cl: 'flex-horiz'});
  
  return {check: check, obj: row, key: key, setCount: (n) => {
    if (n) label.classList.remove('cht-off');
    else   label.classList.add('cht-off');
    count.textContent = n;
  }};
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
    let check = makeCheckbox(tree.name, key, updateFn, indent);
    
    return {check: check.check, obj: mkch('div', [check.obj, indent]), ch:chRes, leaf:leafRes, setCount: check.setCount, key:key};
  }
  res = step(tree, '');
  res.updateFn = updateFn;
  return res;
}



async function newCPU() {
  let cpu = cpuListEl.selectedOptions[0].value;
  entries_ccpu = undefined;
  if (!await setCPU(cpu)) return false;
  entries_ccpu = entries_all.filter(c=>c.cpu.includes(cpu));
  
  let archs = unique(entries_ccpu.map(c=>c.archs).flat());
  let orderArch = {
    'all|SSE': 0,
    'all|AVX+AVX2': 1,
    'all|AVX2+': 2,
    'all|AVX512': 3,
    
    'SSE|MMX':0,
    'SSE|SSE':1,
    'SSE|SSE2':2,
    'SSE|SSE3':3,
    'SSE|SSSE3':4,
    
    'AVX512|AVX512F': 0,
    'AVX512|AVX512CD': 1,
    'AVX512|AVX512ER': 2,
    'AVX512|AVX512PF': 3,
    'AVX512|AVX512VL': 4,
    'AVX512|AVX512DQ': 5,
    'AVX512|AVX512BW': 6,
    'AVX512|AVX512IFMA52': 7,
    'AVX512|AVX512_VBMI': 8,
    'AVX512|AVX512_4VNNIW': 9,
    'AVX512|AVX512_4FMAPS': 10,
    'AVX512|AVX512VPOPCNTDQ': 11,
    'AVX512|AVX512_VNNI': 12,
    'AVX512|AVX512_BF16': 13,
    'AVX512|AVX512_VBMI2': 14,
    'AVX512|AVX512_BITALG': 15,
    'AVX512|AVX512_VP2INTERSECT': 16,
  };
  
  let orderCategory = {
    // x86-64
    'other|all':0,
    'other|AMX':1,
    'other|KNCNI':2,
    
    // ARM
    'Logical|AND': 0,
    'Logical|OR': 1,
    'Logical|XOR': 2,
    'Logical|NOT': 3,
    'Logical|ANDN': 4,
    'Logical|ORN': 5,
    
    'all|Arithmetic':0,
    'all|Logical':1,
    'all|Vector manipulation':2,
    
    // rvv
    'Arithmetic|Add':0,
    'Arithmetic|Subtract':1,
    'Arithmetic|Multiply':2,
    
    'all|Integer':0,
    'all|Float':1,
    'all|Fold':2,
    'all|Mask':3,
    'all|Bitwise':4,
    'all|Load/store':5,
    'all|Permutation':6,
    'all|Initialize':7,
    'all|Conversion':8,
    
    'Integer|Add': 0,
    'Integer|Subtract': 1,
    'Integer|Multiply': 2,
    'Integer|Min': 3,
    'Integer|Max': 4,
    'Integer|Negate': 5,
    'Integer|Compare': 6,
    'Integer|Carry / borrow': 7,
    'Integer|Multiply-add': 8,
    'Integer|Divide': 9,
    'Multiply|Same-width': 0,
    
    'Float|Add': 0,
    'Float|Subtract': 1,
    'Float|Multiply': 2,
    'Float|Divide': 3,
    'Float|Min': 4,
    'Float|Max': 5,
    'Float|Negate': 6,
    'Float|Absolute': 7,
    'Float|Compare': 8,
    
    'Compare|==': 0,
    
    'Fold|Sum': 0,
    'Fold|Sequential sum': 1,
    'Fold|Tree sum': 2,
    'Fold|Widening float sum': 3,
    'Fold|Widening integer sum': 4,
    
    'Mask|Logical': 0,
    'Mask|Find first set': 1,
    'Mask|Population count': 2,
    'Mask|Set before first': 3,
    'Mask|Set including first': 4,
    'Mask|Set only first': 5,
    
    'Permutation|Shuffle': 0,
    'Permutation|Slide': 1,
    
    'Load/store|Load': 0,
    'Load/store|Store': 1,
    'Load/store|Indexed': 2,
    'Load/store|Fault-only-first load': 3,
    
    'Conversion|Integer widen': 0,
    'Conversion|Integer narrow': 1,
    'Conversion|Float widen': 2,
    'Conversion|Float narrow': 3,
    'Conversion|Integer to float': 4,
    'Conversion|Float to integer': 5,
    'Integer to float|Same-width result': 0,
    'Float to integer|Same-width result': 0,
    
    'Bitwise|Shift left': 0,
    'Bitwise|AND': 1,
    'Bitwise|OR': 2,
    'Bitwise|XOR': 3,
    'Bitwise|NOT': 4,
    
    'Fixed-point|Saturating add': 0,
    'Fixed-point|Saturating subtract': 1,
  };
  let openByDefault = new Set([
    'all',
    'SSE', 'AVX+AVX2',
  ]);
  archListEl.textContent = '';
  let archGroups = group(archs.map(c => c.split("|")), 'all', orderArch);
  query_archs = [...archs];
  curr_archObj = makeTree(archGroups, openByDefault, (a, link) => {
    query_archs = a;
    updateSearch(link);
  });
  if (archs.length > 1) archListEl.append(curr_archObj.obj);
  
  
  let categories = unique(entries_ccpu.map(c=>c.categories).flat());
  categoryListEl.textContent = '';
  let categoryGroups = group(categories.map(c => c.split("|")), 'all', orderCategory);
  query_categories = categories;
  curr_categoryObj = makeTree(categoryGroups, openByDefault, (c, link) => {
    query_categories = c;
    updateSearch(link);
  });
  categoryListEl.append(curr_categoryObj.obj);
  
  updateSearch(false);
  return true;
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
function displayNoEnt(link = true) {
  descPlaceEl.innerText = "";
  curr_entry = undefined;
  if (link) updateLink();
}
function displayEnt(ins, fn, link = true) {
  if (fn.toVar) fn = fn.toVar;
  curr_entry = [ins, fn];
  let a0 = fn.archs || ins.archs;
  let a1 = a0;
  if (a0.length>1) a1 = a1.filter(c=>!c.endsWith("|KNCNI"));
  let a2 = a1.map(c=>esc(c.split(/\|/g).slice(-1)[0])).join(' + ');
  if (a0.length != a1.length) a2+= " / KNCNI";
  let text = ``;
  text+= `<br>Architecture: <span class="mono">${a2}</span>`;
  text+= `<br>Categor${ins.categories.length>1?"ies":"y"}: <span class="mono">${ins.categories.map(c=>esc(c.replace(/\|/g,'→'))).join(', ')}</span>`;
  text+= `<br><br>Description:<div class="desc">${fn.desc||ins.desc}</div>`;
  
  let implInstr = fn.implInstr;
  if (typeof implInstr === 'function') implInstr = implInstr();
  
  let implDesc = fn.implDesc || ins.implDesc;
  if (typeof implDesc === 'function') implDesc = implDesc();
  
  let implTimes = fn.implTimes || ins.implTimes;
  
  if (implInstr) text+= `<br>Instruction:<pre>${implInstr}</pre>`;
  if (implDesc) text+= `<br>Operation:<pre class="operation">${implDesc}</pre>`;
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
      return mkch('span', ['  ', hl('type',a.type), ' '+a.name, ','.repeat(i!=fn.args.length-1), a.info? hl('comm',mkch('span', [], {innerHTML: ' // '+a.info})) : '', '\n']);
    }), ')'];
  }
  if (ins.variations && ins.variations.length) {
    let mkvar = (fn, short) => mkch('span', short, {cl: ['mono', 'var-link'], onclick: () => displayEnt(ins, fn)});
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
function toPage(page) {
  query_currPage = page;
  
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
    ]);
    r.onclick = () => {
      if (curr_entry && curr_entry[0]===ins && curr_entry[1]===cvar) {
        displayNoEnt();
      } else {
        displayEnt(ins, cvar);
      }
    }
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

function updateSearch(link=true) {
  try {
    updateSearch0();
    if (link) updateLink();
  } catch (e) {
    console.error(e);
    toCenterInfo(e);
  }
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
        try {
          parts.push([c0,c0=='/'? new RegExp(p) : p]);
        } catch (e) {
          console.error(e);
          toCenterInfo(e);
          return;
        }
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
  const P_ARGn = (n) => P_CAT + n*2;
  const P_ARGnN = (n) => P_CAT + n*2 + 1;
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
  
  function untree(c) {
    let objs = [];
    function rec(c, ps) {
      let ps2 = [...ps, c];
      objs.push(c, ...c.leaf);
      return [...c.ch.flatMap(e => rec(e, ps2)), ...c.leaf.map(e => [e.key, [...ps2, e]])];
    }
    let es = rec(c, []);
    objs.forEach(e => e.currSet=new Set());
    let map = Object.fromEntries(es);
    return {
      add: (l, id) => l.forEach(e => map['all|'+e].forEach(e => e.currSet.add(id))),
      write: () => objs.forEach(e => {
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
  function ser(x) {
    if (x===undefined) return ["all"];
    if (x.check.indeterminate) return [...x.ch.flatMap(ser), ...x.leaf.filter(c=>c.check.checked).map(c=>c.key)];
    return x.check.checked? [x.key] : [];
  }
  function ser1(x) {
    let r = ser(x);
    if (r.length==1 && r[0]=="all") return undefined;
    return r;
  }
  let entval = undefined;
  if (curr_entry) {
    let [eb,ev] = curr_entry;
    entval = eb.cpu[0]+'!'+eb.ref+(eb===ev? '' : '!'+ev.short);
  }
  let obj = {
    u: curr_cpu,
    e: entval,
    a: ser1(curr_archObj),
    c: ser1(curr_categoryObj),
    s: searchFieldEl.value || undefined,
    i: query_searchIn.map(c=>c[1].checked?"1":"0").join('')
  }
  let json = JSON.stringify(obj);
  
  let historyArgs = [{}, "", "#0"+enc(json)];
  if (pushNext) {
    history.pushState(...historyArgs);
    pushNext = false;
  } else {
    history.replaceState(...historyArgs);
  }
}
addEventListener("popstate", (e) => { pushNext = true; });

async function loadLink() {
  let hash = decodeURIComponent(location.hash.slice(1));
  if (hash[0]=='0') {
    let json = JSON.parse(dec(hash.slice(1)));
    if (json.s === undefined) json.s = "";
    searchFieldEl.value = json.s;
    
    if (json.e) {
      let [cpu,ref,...varl] = json.e.split('!');
      cpuListEl.value = cpu;
      if (!await setCPU(cpu)) return;
      let ent = entries_all.find(c=>c.ref==ref);
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
    
    [...json.i].forEach((c,i) => {
      query_searchIn[i][1].checked = c=='1';
    });
    
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
    selTree(curr_archObj, json.a||["all"]);
    selTree(curr_categoryObj, json.c||["all"]);
    updateSearch(false);
  } else {
    newCPU();
  }
}

let knownCpuMap = Object.fromEntries(knownCPUs);

function toCenterInfo(text) {
  resultListEl.textContent = '';
  centerInfoEl.textContent = text;
}
function clearCenterInfo() {
  centerInfoEl.textContent = '';
}
async function setCPU(name) {
  curr_cpu = name;
  let loader = knownCpuMap[curr_cpu];
  
  let noDataMsg = "Data files for CPU "+name+" not available";
  if (loader.started) {
    if (loader.noData) {
      toCenterInfo(noDataMsg);
      return false;
    }
    return true;
  }
  loader.started = true;
  console.log("parsing "+loader.msg);
  resultCountEl.textContent = "loading…";
  toCenterInfo("Loading "+loader.msg+"…");
  
  let is = await loader.load();
  if (is === null) {
    loader.noData = true;
    toCenterInfo(noDataMsg);
    return false;
  } else {
    const searchStr = c => c && c.length? c.toLowerCase().replace(/&lt;/g, '<') : undefined;
    function prepType(t) {
      let c = t.type;
      c = c.replace(/ +(\**) *$/, "$1");
      c = c.replace(/(.+) const\b/, "const $1");
      t.type = c;
      t.typeSearch = searchStr(t.type);
      t.nameSearch = searchStr(t.name);
    }
    is.forEach(ins => {
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
      
      let ref = ins.name.replace(/^(__riscv_|_mm)/,"");
      if (ins.cpu[0]==='x86-64') ref = ins.ret.type+';'+ins.archs.join(';')+';'+ref;
      ins.ref = ref;
    });
    
    let badEntry = is.find(c => !c.name || !c.ret.type || c.args.some(c => !c.type || !c.name));
    if (badEntry) console.warn("Warning: bad entry present: "+badEntry.name);
    
    let refs = is.map(c=>c.ref);
    if (new Set(refs).size != refs.length) console.warn("Warning: non-unique refs in "+name);
    
    
    entries_all = entries_all.concat(is);
    
    unique(entries_all.map(c=>c.cpu).flat()).forEach(foundCPU => {
      if (!knownCpuMap[foundCPU]) console.warn("Warning: CPU not listed ahead-of-time: "+foundCPU);
    });
    
    console.log("parsed "+loader.msg);
    clearCenterInfo();
    return true;
  }
}

(async () => {
  try {
    knownCPUs.forEach(([n,f]) => {
      cpuListEl.append(new Option(n, n));
    });
    
    await loadLink();
  } catch (e) {
    document.getElementById('search-table').insertAdjacentElement('afterEnd', mkch('span', "Failed to load:\n"+e.stack, {cl: ['mono','code-ws']}));
    throw e;
  }
})();

window.onhashchange = () => loadLink();













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
    throw new Error("failed to decode - full link not copied?");
  }
}

function arrToB64(arr) {
  let bytestr = "";
  arr.forEach(c => bytestr+= String.fromCharCode(c));
  return btoa(bytestr).replace(/\+/g, "@").replace(/=+/, "");
}
function b64ToArr(str) {
  return new Uint8Array([...atob(decodeURIComponent(str).replace(/@/g, "+"))].map(c=>c.charCodeAt()));
}

function deflate(arr) {
  return pako.deflateRaw(arr, {"level": 9});
}
function inflate(arr) {
  return pako.inflateRaw(arr);
}