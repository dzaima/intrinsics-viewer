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
let perPage = 37;


async function loadFile(path) {
  let f = await fetch(path);
  let b = await f.arrayBuffer();
  return new TextDecoder().decode(b);
}


let idCounter = 0;
async function loadIntel() {
  let src = await loadFile("data/intel_intrinsics-1.xml");
  let perfSrc = await loadFile("data/intel_perf2-1.js");
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
    
    VPCLMULQDQ: "AVX512+",
    VAES: "AVX512+",
    GFNI: "AVX512+",
    
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
      if (c.hasAttribute("form")) res+= " "+c.getAttribute("form")
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
      implInstrRaw: implInstrList.join("\n"),
      implTimes: implTimes,
      
      archs: archs,
      categories: filter("category").map(c=>c.textContent),
    };
  });
  let res = [];
  let map = new Map();
  res0.forEach(n => {
    let p = map.get(n.name);
    if (p) {
      if (p.desc==n.desc && p.implInstrRaw==n.implInstrRaw && p.implDesc==n.implDesc && (!p.implTimes) == (!n.implTimes) && [p,n].some(c=>c.archs.length==1 && c.archs[0].endsWith("|KNCNI"))) {
        p.archs = p.archs.concat(n.archs);
        return;
      }
      // console.log("imperfect duplicate? "+n.name);
    } else {
      map.set(n.name, n);
    }
    res.push(n);
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
    
    return {
      raw: c,
      cpu: c.Architectures.map(c => c=="v7"? "armv7" : c=="A32"? "aarch32" : c=="A64"? "aarch64" : c=="MVE"? "Arm MVE" : "arm??"),
      id: idCounter++,
      
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

async function loadRVV() {
  let j = JSON.parse(await loadFile("data/rvv.json"));
  
  function mapn(c, l) {
    let n = c.name;
    for (let i = 0; i < l.length-1; i+= 2) {
      if (n.includes(l[i])) return l[i+1];
    }
    throw 0;
  }
  
  function typeConvert(c) {
    let rf = c.ret.type.includes("float");
    let af = c.args[c.args[0].name=='mask'? 1 : 0].type.includes("float");
    let orig = c.categories[0].split("|")[1];
    let w = orig=='Widening Floating-Point/Integer Type-Convert';
    let n = orig=='Narrowing Floating-Point/Integer Type-Convert';
    let wn = (w? 'widen' : n? 'narrow' : '??');
    if ( rf &&  af) return 'Conversion|Float '+wn;
    if (!rf && !af) return 'Conversion|Integer '+wn;
    if ( rf && !af) return 'Conversion|Integer to float';
    if (!rf &&  af) return 'Conversion|Float to integer';
  }
  
  const categoryMap = {
    'Configuration-Setting and Utility|Set the vl to VLMAX with specific vtype': 'Initialize|Set max vl',
    'Configuration-Setting and Utility|Set vl and vtype': 'Initialize|Set specific vl',
    
    'Stride Segment Load/Store Instructions (Zvlsseg)|Strided Segment Load': 'Load/store|Segment (Zvlsseg)|Strided Load',
    'Stride Segment Load/Store Instructions (Zvlsseg)|Strided Segment Store': 'Load/store|Segment (Zvlsseg)|Strided Store',
    'Unit-Stride Segment Load/Store Instructions (Zvlsseg)|Unit-Stride Segment Load': 'Load/store|Segment (Zvlsseg)|Load',
    'Unit-Stride Segment Load/Store Instructions (Zvlsseg)|Unit-Stride Segment Store': 'Load/store|Segment (Zvlsseg)|Store',
    'Indexed Segment Load/Store Instructions (Zvlsseg)|Indexed Segment Load': 'Load/store|Segment (Zvlsseg)|Indexed Load',
    'Indexed Segment Load/Store Instructions (Zvlsseg)|Indexed Segment Store': 'Load/store|Segment (Zvlsseg)|Indexed Store',
    'Loads and Stores|Indexed Load': 'Load/store|Indexed aka gather|Load',
    'Loads and Stores|Indexed Store': 'Load/store|Indexed aka gather|Store',
    'Loads and Stores|Strided Load': 'Load/store|Strided|Load',
    'Loads and Stores|Strided Store': 'Load/store|Strided|Store',
    'Loads and Stores|Unit-Stride Load': 'Load/store|Load',
    'Loads and Stores|Unit-Stride Store': 'Load/store|Store',
    'Loads and Stores|Unit-stride Fault-Only-First Loads': 'Load/store|Fault-only-first load',
    
    'Mask|count population in mask': 'Mask|Population count',
    'Mask|Element Index': 'Mask|Masked indexes',
    'Mask|Iota': 'Mask|Compress indexes',
    'Mask|Find-first-set mask bit': 'Mask|Find first set',
    'Mask|Set-including-first mask bit': 'Mask|Set including first',
    'Mask|Set-before-first mask bit': 'Mask|Set before first',
    'Mask|Set-only-first mask bit': 'Mask|Set only first',
    'Mask|Mask Load/Store': 'Load/store|Mask',
    'Mask|Mask-Register Logical': c => 'Mask|' + mapn(c,['_vmandn','Logical|ANDN', '_vmnand','Logical|~AND', '_vmxnor','Logical|XNOR', '_vmand','Logical|AND', '_vmclr','Zero', '_vmnor','Logical|NOR', '_vmnot','Logical|NOT', '_vmorn','Logical|ORN', '_vmset','Logical|', '_vmxor','Logical|XOR', '_vmmv','Move', '_vmor','Logical|OR']),
    
    'Permutation|Integer and Floating-Point Scalar Move': c => 'Permutation|' + mapn(c,['_s_x_','Set first', '_x_s_','Extract first', '_s_f_','Set first', '_f_s_','Extract first']),
    'Permutation|Register Gather': c => 'Permutation|Shuffle|' + mapn(c,['_vrgatherei16','16-bit indexes', '_vrgather','8-bit indexes']),
    // 'Permutation|Compress': 'Permutation|Compress',
    'Permutation|Slide1up and Slide1down': c => 'Permutation|Slide|' + mapn(c,['slide1up','Up 1', 'slide1down','Down 1']),
    'Permutation|Slideup':                 'Permutation|Slide|Up N',
    'Permutation|Slidedown':               'Permutation|Slide|Down N',
    
    'Miscellaneous Vector|Initialization': 'Initialize|Set undefined',
    'Miscellaneous Vector|Reinterpret Cast Conversion|Reinterpret between different SEW under the same LMUL': 'Conversion|Reinterpret|Same LMUL',
    'Miscellaneous Vector|Reinterpret Cast Conversion|Reinterpret between different type under the same SEW/LMUL': 'Conversion|Reinterpret|Same LMUL & width',
    'Miscellaneous Vector|Reinterpret Cast Conversion|Reinterpret between vector boolean types and LMUL=1 (m1) vector integer types': 'Conversion|Reinterpret|Boolean',
    'Miscellaneous Vector|Extraction': 'Permutation|Extract',
    'Miscellaneous Vector|Insertion': 'Permutation|Insert',
    'Miscellaneous Vector|LMUL Extension': 'Permutation|LMUL extend',
    'Miscellaneous Vector|LMUL Truncation': 'Permutation|LMUL truncate',
    
    'Reduction|Single-Width Floating-Point Reduction': c => 'Fold|'+mapn(c,['_vfredosum','Ordered sum', '_vfredusum','Unordered sum', '_vfredmax','Max', '_vfredmin','Min']),
    'Reduction|Single-Width Integer Reduction':        c => 'Fold|'+mapn(c,['vredmaxu','Max', 'vredminu','Min', 'vredsum','Sum', 'vredmax','Max', 'vredmin','Min', 'vredand','Bitwise and', 'vredor','Bitwise or', 'vredxor','Bitwise xor']),
    'Reduction|Widening Floating-Point Reduction': 'Fold|Widening float sum',
    'Reduction|Widening Integer Reduction':        'Fold|Widening integer sum',
    
    'Fixed-Point Arithmetic|Narrowing Fixed-Point Clip': 'Fixed-point|Narrowing clip',
    'Fixed-Point Arithmetic|Single-Width Averaging Add and Subtract': 'Fixed-point|Averaging add & subtract',
    'Fixed-Point Arithmetic|Single-Width Fractional Multiply with Rounding and Saturation': 'Fixed-point|Fractional rounding & saturating multiply',
    'Fixed-Point Arithmetic|Single-Width Saturating Add and Subtract': 'Fixed-point|Saturating add & subtract',
    'Fixed-Point Arithmetic|Single-Width Scaling Shift': 'Fixed-point|Scaling shift',
    
    'Floating-Point|Floating-Point Absolute Value': 'Float|Absolute',
    'Floating-Point|Floating-Point Classify': 'Float|Classify',
    'Floating-Point|Floating-Point Compare': 'Float|Compare',
    'Floating-Point|Floating-Point Reciprocal Estimate': 'Float|Estimate reciprocal',
    'Floating-Point|Floating-Point Reciprocal Square-Root Estimate': 'Float|Estimate reciprocal square-root',
    'Floating-Point|Floating-Point Sign-Injection': 'Float|Sign-injection',
    'Floating-Point|Floating-Point Square-Root': 'Float|Square root',
    'Floating-Point|Single-Width Floating-Point Fused Multiply-Add': 'Float|Fused multiply-add',
    'Floating-Point|Floating-Point MIN/MAX':                      c => 'Float|'      +mapn(c,['_vfmin','Min', '_vfmax','Max']),
    'Floating-Point|Single-Width Floating-Point Add/Subtract':    c => 'Float|'      +mapn(c,['_vfadd','Add', '_vfsub','Subtract', '_vfrsub','Subtract', '_vfneg','Negate']),
    'Floating-Point|Single-Width Floating-Point Multiply/Divide': c => 'Float|'      +mapn(c,['_vfdiv','Divide', '_vfrdiv','Divide', '_vfmul','Multiply', '_vfrmul','Multiply']),
    'Floating-Point|Widening Floating-Point Add/Subtract':        c => 'Float|Widen|'+mapn(c,['_vfwadd','Add', '_vfwsub','Subtract']),
    'Floating-Point|Widening Floating-Point Fused Multiply-Add': 'Float|Widen|Fused multiply-add',
    'Floating-Point|Widening Floating-Point Multiply': 'Float|Widen|Multiply',
    'Floating-Point|Narrowing Floating-Point/Integer Type-Convert': typeConvert,
    'Floating-Point|Widening Floating-Point/Integer Type-Convert': typeConvert,
    'Floating-Point|Single-Width Floating-Point/Integer Type-Convert': typeConvert,
    'Floating-Point|Floating-Point Move': c => mapn(c,['_v_f_','Initialize|Broadcast', '_v_v_','Permutation|Move']),
    'Floating-Point|Floating-Point Merge': 'Permutation|Merge',
    
    'Integer Arithmetic|Integer Merge': 'Permutation|Merge',
    'Integer Arithmetic|Integer Divide': 'Integer|Divide',
    'Integer Arithmetic|Integer Add-with-Carry / Subtract-with-Borrow': 'Integer|Add with Carry / Subtract with Borrow',
    'Integer Arithmetic|Single-Width Integer Multiply-Add': 'Integer|Multiply-add',
    'Integer Arithmetic|Widening Integer Multiply-Add': 'Integer|Widen|Multiply-add widening',
    
    'Integer Arithmetic|Integer Move':                          c =>                        mapn(c,['_v_x_','Initialize|Broadcast', '_v_v_','Permutation|Move']),
    'Integer Arithmetic|Widening Integer Add/Subtract':         c => 'Integer|Widen|'     +mapn(c,['_vwaddu','Add widening unsigned', '_vwsubu','Subtract widening unsigned', '_vwadd','Add widening signed', '_vwsub','Subtract widening signed']),
    'Integer Arithmetic|Widening Integer Multiply':             c => 'Integer|Widen|'     +mapn(c,['_vwmulsu', 'Multiply widening signed*unsigned', '_vwmulu', 'Multiply widening unsigned', '_vwmul', 'Multiply widening signed']),
    'Integer Arithmetic|Integer Extension':                     c => 'Integer|Widen|'     +mapn(c,['_vsext','Sign-extend', '_vzext','Zero-extend']),
    'Integer Arithmetic|Single-Width Integer Add and Subtract': c => 'Integer|'           +mapn(c,['_vadd','Add', '_vsub','Subtract', '_vrsub','Subtract', '_vneg','Negate']),
    'Integer Arithmetic|Single-Width Integer Multiply':         c => 'Integer|Multiply|'  +mapn(c,['_vmulhsu','High signed*unsigned', '_vmulhu','High unsigned', '_vmulh','High signed', '_vmul','Same-width']),
    'Integer Arithmetic|Bitwise Logical':                       c => 'Bitwise|'           +mapn(c,['_vand','AND', '_vor','OR', '_vxor','XOR', '_vnot', 'NOT']),
    'Integer Arithmetic|Single-Width Bit Shift':                c => 'Bitwise|'           +mapn(c,['_vsrl','Shift right|logical', '_vsra','Shift right|arithmetic', '_vsll','Shift left']),
    'Integer Arithmetic|Narrowing Integer Right Shift':         c => 'Bitwise|'           +mapn(c,['_vnsrl','Shift right|logical narrowing', '_vnsra','Shift right|arithmetic narrowing']),
    'Integer Arithmetic|Integer Min/Max':                       c => 'Integer|'           +mapn(c,['_vmin','Min', '_vmax','Max']),
    'Integer Arithmetic|Integer Comparison':                    c => 'Integer|Compare|'+mapn(c,['_vmsltu','Unsigned <', '_vmsleu','Unsigned <=', '_vmsgtu','Unsigned >', '_vmsgeu','Unsigned >=', '_vmseq','==', '_vmsne','!=', '_vmslt','Signed <', '_vmsle','Signed <=', '_vmsgt','Signed >', '_vmsge','Signed >=']),
  };
  
  j.forEach(c => {
    function applyCategory(f, t) {
      t = t? "|"+t : "";
      if (typeof f === 'string') return f+t;
      return f(c)+t;
    }
    
    c.id = idCounter++;
    c.categories = c.categories.map(c => {
      c = c.replace(/(^|\|)Vector /g, "$1");
      if (categoryMap[c]) {
        c = applyCategory(categoryMap[c]);
      } else {
        let p = c.split("|");
        let f = categoryMap[p.slice(0,-1).join("|")];
        if (f) c = applyCategory(f, p[p.length-1]);
      }
      return c;
    });
  })
  return j;
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
  
  let count = mkch('span', ['?']);
  let label = mkch('label', [check, display+' (', count, ')'], {cl: ['flex-grow', 'cht-off']});
  
  let row = mkch('div', [
    mkch('span', [group? (group.hidden? ">" : "∨") : ""], {cl:['gr',group?'gr-yes':'gr-no'], onclick: t => {
      group.hidden^= 1;
      t.textContent = group.hidden? ">" : "∨";
    }}),
    label,
  ], {cl: 'flex-horiz'})
  
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
    let check = makeCheckbox(tree.name, key, updateFn, indent)
    
    return {check: check.check, obj: mkch('div', [check.obj, indent]), ch:chRes, leaf:leafRes, setCount: check.setCount, key:key};
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
  let orderArch = {
    'all|SSE': 0,
    'all|AVX+AVX2': 1,
    'all|AVX2+': 2,
    'all|AVX512': 3,
    'all|AVX512+': 4,
    
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
    'Integer|Divide': 3,
    'Integer|Min': 4,
    'Integer|Max': 5,
    'Integer|Negate': 6,
    'Integer|Compare': 7,
    
    'Float|Add': 0,
    'Float|Subtract': 1,
    'Float|Multiply': 2,
    'Float|Divide': 3,
    'Float|Min': 4,
    'Float|Max': 5,
    'Float|Negate': 6,
    'Float|Absolute': 7,
    'Float|Compare': 8,
    
    'Fold|Sum': 0,
    'Fold|Ordered sum': 1,
    'Fold|Unordered sum': 2,
    'Fold|Widening float sum': 3,
    'Fold|Widening integer sum': 4,
    
    'Mask|Logical': 0,
    
    'Load/store|Load': 0,
    'Load/store|Store': 1,
    'Load/store|Indexed aka gather': 2,
    'Load/store|Fault-only-first load': 3,
    
    'Conversion|Integer widen': 0,
    'Conversion|Integer narrow': 1,
    'Conversion|Float widen': 2,
    'Conversion|Float narrow': 3,
    'Conversion|Integer to float': 4,
    'Conversion|Float to integer': 5,
    
    'Bitwise|AND': 0,
    'Bitwise|OR': 1,
    'Bitwise|XOR': 2,
    'Bitwise|NOT': 3,
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
  archListEl.append(curr_archObj.obj);
  
  
  let categories = unique(is1.map(c=>c.categories).flat());
  categoryListEl.textContent = '';
  let categoryGroups = group(categories.map(c => c.split("|")), 'all', orderCategory);
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
      let a0 = c.archs;
      let a1 = a0;
      if (a0.length>1) a1 = a1.filter(c=>!c.endsWith("|KNCNI"));
      let a2 = a1.map(c=>esc(c.split(/\|/g).slice(-1)[0])).join(' + ');
      if (a0.length != a1.length) a2+= " / KNCNI";
      let text = `<br>`;
      text+= `<br>Architecture: <span class="mono">${a2}</span>`;
      text+= `<br>Categor${c.categories.length>1?"ies":"y"}: <span class="mono">${c.categories.map(c=>esc(c.replace(/\|/g,'→'))).join(', ')}</span>`;
      text+= `<br><br>Description:<div class="desc">${c.desc}</div>`;
      if (c.implInstr) text+= `<br>Instruction:<pre>${c.implInstr}</pre>`;
      if (c.implDesc) text+= `<br>Operation:<pre class="operation">${c.implDesc}</pre>`;
      if (c.implTimes) text+= `<br>Performance:<table class="perf-table"></table>`;
      descPlaceEl.innerHTML = text;
      
      if (c.implTimes) descPlaceEl.getElementsByClassName("perf-table")[0].append(mkch('tbody', [
        mkch('tr', ['Architecture', 'Latency', 'Throughput (CPI)'].map(c=>mkch('th',[c]))),
        ...c.implTimes.map(c => {
          let [[k,v]] = Object.entries(c);
          return mkch('tr', [k, v.l, v.t].map(e => mkch('td', [e])));
        })
      ]));
      
      let desc;
      if (c.args.length>7 || c.args==0) {
        desc = [mkRetLine(), ' ', mkFnLine()];
      } else {
        desc = [mkRetLine(), ' ', h('name',c.name), '(\n', ...c.args.map((a,i)=>{
          return mkch('span', ['  ', h('type',a.type), ' '+a.name, ','.repeat(i!=c.args.length-1), a.info? h('comm',' // '+a.info) : '', '\n']);
        }), ')'];
      }
      
      descPlaceEl.insertAdjacentElement('afterBegin', mkch('span', desc, {cl: ['mono', 'code-ws']}));
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

function updateSearch(link=true) {
  let parts = searchFieldEl.value.toLowerCase().split(/ /g);
  let partsOn = parts.filter(c=>!c.startsWith('!'));
  let partsOff = parts.filter(c=>c.startsWith('!')).map(c=>c.substring(1));
  let categorySet = new Set(query_categories);
  let archSet = new Set(query_archs);
  let sName = query_searchInObj.name.checked;
  let sDesc = query_searchInObj.desc.checked;
  let sInst = query_searchInObj.inst.checked;
  let sOper = query_searchInObj.oper.checked;
  let sCatg = query_searchInObj.catg.checked;
  
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
  
  query_found = is1.filter((c) => {
    let a = [];
    if (sName) { a.push(c.name); a.push(c.ret.type); c.args.forEach(c => a.push(c.type)); }
    if (sInst) a.push(c.implInstrRaw);
    if (sDesc) a.push(c.desc);
    if (sOper) a.push(c.implDesc);
    if (sCatg) a.push(c.categories.join(' '));
    a = a.filter(c=>c).map(c=>c.toLowerCase());
    let searchMatch = (
         (partsOn.length==0   ||  partsOn.every (p =>  a.some(cv => cv.includes(p))))
      && (partsOff.length==0  ||  partsOff.every(p => !a.some(cv => cv.includes(p))))
    );
    
    if (!searchMatch) return false;
    
    let categoryMatch = c.categories.some(c => categorySet.has(c));
    let archMatch = c.archs.some(c => archSet.has(c));
    
    if (c.archs      && categoryMatch)     archStore.add(c.archs,      c.id);
    if (c.categories &&     archMatch) categoryStore.add(c.categories, c.id);
    
    return searchMatch && categoryMatch && archMatch;
  });
  
  archStore.write();
  categoryStore.write();
  
  toPage(0);
  resultCountEl.textContent = query_found.length+" result"+(query_found.length==1?"":"s");
  
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

function loadLink(prependSearch = false) {
  let hash = decodeURIComponent(location.hash.slice(1));
  if (hash[0]=='0') {
    let json = JSON.parse(dec(hash.slice(1)));
    
    cpuListEl.value = json.u;
    newCPU(false);
    
    [...json.i].forEach((c,i) => {
      query_searchIn[i][1].checked = c=='1';
    });
    
    if (prependSearch) {
      if (!searchFieldEl.value.includes(json.s)) searchFieldEl.value = json.s + searchFieldEl.value;
    } else {
      searchFieldEl.value = json.s;
    }
    
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

function prettyType(t) {
  let c = t.type;
  c = c.replace(/ +(\**) *$/, "$1");
  c = c.replace(/(.+) const\b/, "const $1");
  t.type = c;
}

(async () => {
  let i1 = await loadIntel();
  console.log("intel parsed");
  let i2 = await loadArm();
  console.log("arm parsed");
  let i3 = await loadRVV();
  console.log("rvv parsed");
  is0 = [...i1, ...i2, ...i3];
  is0.forEach(c => {
    if (c.archs.length==0 || c.categories.length==0) throw new Error(c);
    c.args.forEach(prettyType);
    prettyType(c.ret);
  });
  let cpus = unique(is0.map(c=>c.cpu).flat());
  cpus.forEach((c, i) => {
    cpuListEl.append(new Option(c, c));
  });
  
  loadLink(true);
})();

window.onhashchange=() => loadLink();













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