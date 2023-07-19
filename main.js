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
  }]
  
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


let idCounter = 0;
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
  
  let res1 = [];
  {
    let map = new Map();
    res0.forEach(n => {
      if (!n.archs.length || !(n.archs[0].includes("AVX512") || n.archs[0].includes("KNCNI"))) { res1.push(n); return; }
      let key = n.archs[0] + ';' + n.name.replace(/_mask[z23]?_/, "_");
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
        v1.sort((a,b) => a.name.length-b.name.length);
        if (v1.length>1 && v1[0].name.length==v1[1].name.length) throw new Error("equal first lengths");
        res1[pos] = v1[0];
        let v2 = v1[0].variations = v1.slice(1);
        v1.map((c,i) => {
          let f = c.name.match(/_(mask[z23]?)_/);
          c.short = f? f[1] : "base";
          if (c.short=="base" && i!=0) throw new Error("base not first");
        });
      }
    });
  }
  
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
      let i = c.lastIndexOf(' ');
      return ({type: c.substring(0, i), name: c.substring(i+1)});
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
      name: c.name,
      
      desc: c.description + (nativeOpNEON? "" : "<br>"+nativeOperation),
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
  /// let policiesFile;
  try {
    baseFile = await loadFile("data/rvv_base-3.json");
    /// policiesFile = await loadFile("data/rvv_policies.json");
    rvvOps = new Function(await loadFile("extra/rvv_ops.js"))();
    /// rvvOps = {oper:()=>undefined,helper:()=>undefined};
  } catch (e) {
    console.log(e);
    return null;
  }
  
  rvv_helper = (name, ...args) => {
    let prev_entry = curr_entry;
    descPlaceEl.innerHTML = `<a class="rvv-helper-back">back</a><pre>${rvvOps.helper(name, ...args)}</pre>`;
    descPlaceEl.getElementsByClassName('rvv-helper-back')[0].onclick = () => displayEnt(...prev_entry, false);
  };
  
  // category transformation map
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
    
    'Stride Segment Load/Store Instructions (Zvlsseg)|Strided Segment Load': 'Load/store|Segment|Strided Load',
    'Stride Segment Load/Store Instructions (Zvlsseg)|Strided Segment Store': 'Load/store|Segment|Strided Store',
    'Unit-Stride Segment Load/Store Instructions (Zvlsseg)|Unit-Stride Segment Load': c => 'Load/store|Segment|' + mapn(c,['ff_','Fault-only-first load', 'seg','Load']),
    'Unit-Stride Segment Load/Store Instructions (Zvlsseg)|Unit-Stride Segment Store': 'Load/store|Segment|Store',
    'Indexed Segment Load/Store Instructions (Zvlsseg)|Indexed Segment Load': 'Load/store|Segment|Indexed Load',
    'Indexed Segment Load/Store Instructions (Zvlsseg)|Indexed Segment Store': 'Load/store|Segment|Indexed Store',
    'Loads and Stores|Indexed Load':  c => 'Load/store|Indexed|Load/gather '   + mapn(c,['_vlox','ordered', '_vlux','unordered']),
    'Loads and Stores|Indexed Store': c => 'Load/store|Indexed|Store/scatter ' + mapn(c,['_vsox','ordered', '_vsux','unordered']),
    'Loads and Stores|Strided Load': 'Load/store|Strided|Load',
    'Loads and Stores|Strided Store': 'Load/store|Strided|Store',
    'Loads and Stores|Unit-Stride Load': 'Load/store|Load',
    'Loads and Stores|Unit-Stride Store': 'Load/store|Store',
    'Loads and Stores|Unit-stride Fault-Only-First Loads': 'Load/store|Fault-only-first load',
    
    'Mask|count population in mask': 'Mask|Population count',
    'Mask|Element Index': 'Initialize|Element indices',
    'Mask|Iota': 'Initialize|Cumulative indices',
    'Mask|Find-first-set mask bit': 'Mask|Find first set',
    'Mask|Set-including-first mask bit': 'Mask|Set including first',
    'Mask|Set-before-first mask bit': 'Mask|Set before first',
    'Mask|Set-only-first mask bit': 'Mask|Set only first',
    'Mask|Mask Load/Store': 'Load/store|Mask',
    'Mask|Mask-Register Logical': c => 'Mask|' + mapn(c,['_vmandn','Logical|ANDN', '_vmnand','Logical|NAND', '_vmxnor','Logical|XNOR', '_vmand','Logical|AND', '_vmclr','Zero', '_vmset','One', '_vmnor','Logical|NOR', '_vmnot','Logical|NOT', '_vmorn','Logical|ORN', '_vmxor','Logical|XOR', '_vmmv','Hint', '_vmor','Logical|OR']),
    
    'Permutation|Integer and Floating-Point Scalar Move': c => mapn(c,['_s_x_','Initialize|Set first', '_x_s_','Permutation|Extract first', '_s_f_','Initialize|Set first', '_f_s_','Permutation|Extract first']),
    'Permutation|Register Gather': c => 'Permutation|' + mapn(c,['_vrgatherei16','Shuffle|16-bit indices', '_vrgather_vv_','Shuffle|Equal-width', '_vrgather_vx_','Broadcast one']),
    'Permutation|Slide1up and Slide1down': c => 'Permutation|Slide|' + mapn(c,['slide1up','Up 1', 'slide1down','Down 1']),
    'Permutation|Slideup':                 'Permutation|Slide|Up N',
    'Permutation|Slidedown':               'Permutation|Slide|Down N',
    
    'Miscellaneous Vector|Initialization': 'Initialize|Set undefined',
    'Miscellaneous Vector|Reinterpret Cast Conversion|Reinterpret between different SEW under the same LMUL': 'Conversion|Reinterpret|Same LMUL',
    'Miscellaneous Vector|Reinterpret Cast Conversion|Reinterpret between different type under the same SEW/LMUL': 'Conversion|Reinterpret|Same LMUL & width',
    'Miscellaneous Vector|Reinterpret Cast Conversion|Reinterpret between vector boolean types and LMUL=1 (m1) vector integer types': 'Conversion|Reinterpret|Boolean',
    'Miscellaneous Vector|Extraction': c => 'Permutation|' + (/x\d(_|$)/.test(c.name)? 'Tuple|' : '') + 'Extract',
    'Miscellaneous Vector|Insertion':  c => 'Permutation|' + (/x\d(_|$)/.test(c.name)? 'Tuple|' : '') + 'Insert',
    'Miscellaneous Vector|LMUL Extension': 'Permutation|LMUL extend',
    'Miscellaneous Vector|LMUL Truncation': 'Permutation|LMUL truncate',
    
    'Reduction|Single-Width Floating-Point Reduction': c => 'Fold|'+mapn(c,['_vfredosum','Sequential sum', '_vfredusum','Tree sum', '_vfredmax','Max', '_vfredmin','Min']),
    'Reduction|Single-Width Integer Reduction':        c => 'Fold|'+mapn(c,['vredmaxu','Max', 'vredminu','Min', 'vredsum','Sum', 'vredmax','Max', 'vredmin','Min', 'vredand','Bitwise and', 'vredor','Bitwise or', 'vredxor','Bitwise xor']),
    'Reduction|Widening Floating-Point Reduction': 'Fold|Widening float sum',
    'Reduction|Widening Integer Reduction':        'Fold|Widening integer sum',
    
    'Fixed-Point Arithmetic|Narrowing Fixed-Point Clip': 'Fixed-point|Narrowing clip',
    'Fixed-Point Arithmetic|Single-Width Averaging Add and Subtract': 'Fixed-point|Averaging add & subtract',
    'Fixed-Point Arithmetic|Single-Width Fractional Multiply with Rounding and Saturation': 'Fixed-point|Fractional rounding & saturating multiply',
    'Fixed-Point Arithmetic|Single-Width Saturating Add and Subtract': c => { let p=mapn(c,['_vsadd_','Add|Saturating signed', '_vsaddu_','Add|Saturating unsigned', '_vssub_','Subtract|Saturating signed', '_vssubu_','Subtract|Saturating unsigned']); return ['Integer|','Fixed-point|'].map(c=>c+p); },
    'Fixed-Point Arithmetic|Single-Width Scaling Shift': 'Fixed-point|Scaling shift',
    
    'Floating-Point|Floating-Point Absolute Value': 'Float|Absolute',
    'Floating-Point|Floating-Point Classify': 'Float|Classify',
    'Floating-Point|Floating-Point Reciprocal Estimate': 'Float|Estimate reciprocal',
    'Floating-Point|Floating-Point Reciprocal Square-Root Estimate': 'Float|Estimate reciprocal square-root',
    'Floating-Point|Floating-Point Sign-Injection': 'Float|Sign-injection',
    'Floating-Point|Floating-Point Square-Root': 'Float|Square root',
    'Floating-Point|Single-Width Floating-Point Fused Multiply-Add': 'Float|Fused multiply-add',
    'Floating-Point|Floating-Point Compare':                      c => 'Float|Compare|'+mapn(c, ['_vmfeq','==', '_vmfne','!=', '_vmflt','<', '_vmfle','<=', '_vmfgt','>', '_vmfge','>=']),
    'Floating-Point|Floating-Point MIN/MAX':                      c => 'Float|'        +mapn(c,['_vfmin','Min', '_vfmax','Max']),
    'Floating-Point|Single-Width Floating-Point Add/Subtract':    c => 'Float|'        +mapn(c,['_vfadd','Add', '_vfsub','Subtract', '_vfrsub','Subtract', '_vfneg','Negate']),
    'Floating-Point|Single-Width Floating-Point Multiply/Divide': c => 'Float|'        +mapn(c,['_vfdiv','Divide', '_vfrdiv','Divide', '_vfmul','Multiply', '_vfrmul','Multiply']),
    'Floating-Point|Widening Floating-Point Add/Subtract':        c => 'Float|Widen|'  +mapn(c,['_vfwadd','Add', '_vfwsub','Subtract']),
    'Floating-Point|Widening Floating-Point Fused Multiply-Add': 'Float|Widen|Fused multiply-add',
    'Floating-Point|Widening Floating-Point Multiply': 'Float|Widen|Multiply',
    'Floating-Point|Narrowing Floating-Point/Integer Type-Convert': typeConvert,
    'Floating-Point|Widening Floating-Point/Integer Type-Convert': typeConvert,
    'Floating-Point|Single-Width Floating-Point/Integer Type-Convert': typeConvert,
    'Floating-Point|Floating-Point Move': c => mapn(c,['_v_f_','Initialize|Broadcast', '_v_v_','Permutation|Move']),
    'Floating-Point|Floating-Point Merge': 'Permutation|Merge',
    
    'Integer Arithmetic|Integer Merge': 'Permutation|Merge',
    'Integer Arithmetic|Integer Divide': c => 'Integer|Divide|'+mapn(c,['_vdiv_','Divide signed', '_vdivu_','Divide unsigned', '_vrem_','Remainder signed', '_vremu_','Remainder unsigned']),
    'Integer Arithmetic|Integer Add-with-Carry / Subtract-with-Borrow': c => 'Integer|Carry / borrow|'+mapn(c,['_vadc_','Add', '_vsbc_','Subtract', '_vmadc_','Add carry-out', '_vmsbc_','Subtract borrow-out']),
    'Integer Arithmetic|Single-Width Integer Multiply-Add': 'Integer|Multiply-add|Same-width',
    'Integer Arithmetic|Widening Integer Multiply-Add': 'Integer|Multiply-add|Widening',
    
    'Integer Arithmetic|Integer Move':                          c =>                     mapn(c,['_v_x_','Initialize|Broadcast', '_v_v_','Permutation|Move']),
    'Integer Arithmetic|Widening Integer Add/Subtract':         c => 'Integer|'         +mapn(c,['_vwaddu','Add|Widening unsigned', '_vwsubu','Subtract|Widening unsigned', '_vwadd','Add|Widening signed', '_vwsub','Subtract|Widening signed']),
    'Integer Arithmetic|Widening Integer Multiply':             c => 'Integer|'         +mapn(c,['_vwmulsu', 'Multiply|Widening signed*unsigned', '_vwmulu', 'Multiply|Widening unsigned', '_vwmul', 'Multiply|Widening signed']),
    'Integer Arithmetic|Integer Extension':                     c => 'Integer|'         +mapn(c,['_vsext','Sign-extend', '_vzext','Zero-extend']),
    'Integer Arithmetic|Single-Width Integer Add and Subtract': c => 'Integer|'         +mapn(c,['_vadd','Add|Same-width', '_vsub','Subtract|Same-width', '_vrsub','Subtract|Same-width', '_vneg','Negate']),
    'Integer Arithmetic|Single-Width Integer Multiply':         c => 'Integer|Multiply|'+mapn(c,['_vmulhsu','High signed*unsigned', '_vmulhu','High unsigned', '_vmulh','High signed', '_vmul','Same-width']),
    'Integer Arithmetic|Bitwise Logical':                       c => 'Bitwise|'         +mapn(c,['_vand','AND', '_vor','OR', '_vxor','XOR', '_vnot', 'NOT']),
    'Integer Arithmetic|Single-Width Bit Shift':                c => 'Bitwise|'         +mapn(c,['_vsrl','Shift right|logical', '_vsra','Shift right|arithmetic', '_vsll','Shift left']),
    'Integer Arithmetic|Narrowing Integer Right Shift':         c => 'Bitwise|'         +mapn(c,['_vnsrl','Shift right|logical narrowing', '_vnsra','Shift right|arithmetic narrowing']),
    'Integer Arithmetic|Integer Min/Max':                       c => 'Integer|'         +mapn(c,['_vmin','Min', '_vmax','Max']),
    'Integer Arithmetic|Integer Comparison':                    c => 'Integer|Compare|' +mapn(c,['_vmsltu','Unsigned <', '_vmsleu','Unsigned <=', '_vmsgtu','Unsigned >', '_vmsgeu','Unsigned >=', '_vmseq','==', '_vmsne','!=', '_vmslt','Signed <', '_vmsle','Signed <=', '_vmsgt','Signed >', '_vmsge','Signed >=']),
  };
  
  // map specification references pt.1
  const specMap = {
                                                "set-vl-and-vtype-functions": "sec-vector-config",
                                       "set-vl-to-vlmax-with-specific-vtype": "sec-vector-config",
                                          "74-vector-unit-stride-operations": "_vector_unit_stride_instructions",
                                    "75-vector-strided-loadstore-operations": "_vector_strided_instructions",
                                    "76-vector-indexed-loadstore-operations": "_vector_indexed_instructions",
                          "77-unit-stride-fault-only-first-loads-operations": "_unit_stride_fault_only_first_loads",
                          "121-vector-single-width-integer-add-and-subtract": "_vector_single_width_integer_add_and_subtract",
                        "122-vector-widening-integer-addsubtract-operations": "_vector_widening_integer_addsubtract",
                                   "123-vector-integer-extension-operations": "_vector_integer_extension",
        "124-vector-integer-add-with-carry--subtract-with-borrow-operations": "_vector_integer_add_with_carry_subtract_with_borrow_instructions",
                                     "125-vector-bitwise-logical-operations": "_vector_bitwise_logical_instructions",
                              "126-vector-single-width-bit-shift-operations": "_vector_single_width_shift_instructions",
                       "127-vector-narrowing-integer-right-shift-operations": "_vector_narrowing_integer_right_shift_instructions",
                                  "128-vector-integer-comparison-operations": "_vector_integer_compare_instructions",
                                      "129-vector-integer-minmax-operations": "_vector_integer_minmax_instructions",
                      "1210-vector-single-width-integer-multiply-operations": "_vector_single_width_integer_multiply_instructions",
                                     "1211-vector-integer-divide-operations": "_vector_integer_divide_instructions",
                          "1212-vector-widening-integer-multiply-operations": "_vector_widening_integer_multiply_instructions",
                  "1213-vector-single-width-integer-multiply-add-operations": "_vector_single_width_integer_multiply_add_instructions",
                      "1214-vector-widening-integer-multiply-add-operations": "_vector_widening_integer_multiply_add_instructions",
                                      "1216-vector-integer-merge-operations": "_vector_integer_merge_instructions",
                                       "1217-vector-integer-move-operations": "_vector_integer_move_instructions",
                       "131-vector-single-width-saturating-add-and-subtract": "_vector_single_width_saturating_add_and_subtract",
                        "132-vector-single-width-averaging-add-and-subtract": "_vector_single_width_averaging_add_and_subtract",
  "133-vector-single-width-fractional-multiply-with-rounding-and-saturation": "_vector_single_width_fractional_multiply_with_rounding_and_saturation",
                          "134-vector-single-width-scaling-shift-operations": "_vector_single_width_scaling_shift_instructions",
                          "135-vector-narrowing-fixed-point-clip-operations": "_vector_narrowing_fixed_point_clip_instructions",
             "142-vector-single-width-floating-point-addsubtract-operations": "_vector_single_width_floating_point_addsubtract_instructions",
                 "143-vector-widening-floating-point-addsubtract-operations": "_vector_widening_floating_point_addsubtract_instructions",
          "144-vector-single-width-floating-point-multiplydivide-operations": "_vector_single_width_floating_point_multiplydivide_instructions",
                    "145-vector-widening-floating-point-multiply-operations": "_vector_widening_floating_point_multiply",
      "146-vector-single-width-floating-point-fused-multiply-add-operations": "_vector_single_width_floating_point_fused_multiply_add_instructions",
          "147-vector-widening-floating-point-fused-multiply-add-operations": "_vector_widening_floating_point_fused_multiply_add_instructions",
                          "148-vector-floating-point-square-root-operations": "_vector_floating_point_square_root_instruction",
      "149-vector-floating-point-reciprocal-square-root-estimate-operations": "_vector_floating_point_reciprocal_square_root_estimate_instruction",
                 "1410-vector-floating-point-reciprocal-estimate-operations": "_vector_floating_point_reciprocal_estimate_instruction",
                              "1411-vector-floating-point-minmax-operations": "_vector_floating_point_minmax_instructions",
                      "1412-vector-floating-point-sign-injection-operations": "_vector_floating_point_sign_injection_instructions",
                             "1413-vector-floating-point-compare-operations": "_vector_floating_point_compare_instructions",
                            "1414-vector-floating-point-classify-operations": "_vector_floating_point_classify_instruction",
                               "1415-vector-floating-point-merge-operations": "_vector_floating_point_merge_instruction",
                                "1416-vector-floating-point-move-operations": "sec-vector-float-move",
           "1417-single-width-floating-pointinteger-type-convert-operations": "_single_width_floating_pointinteger_type_convert_instructions",
               "1418-widening-floating-pointinteger-type-convert-operations": "_widening_floating_pointinteger_type_convert_instructions",
              "1419-narrowing-floating-pointinteger-type-convert-operations": "_narrowing_floating_pointinteger_type_convert_instructions",
                      "151-vector-single-width-integer-reduction-operations": "sec-vector-integer-reduce",
               "153-vector-single-width-floating-point-reduction-operations": "sec-vector-float-reduce",
                          "152-vector-widening-integer-reduction-operations": "sec-vector-integer-reduce-widen",
                   "154-vector-widening-floating-point-reduction-operations": "sec-vector-float-reduce-widen",
                               "161-vector-mask-register-logical-operations": "sec-mask-register-logical",
                                "162-vector-count-population-in-mask-vcpopm": "_vector_count_population_in_mask_vcpop_m",
                                        "163-vfirst-find-first-set-mask-bit": "_vfirst_find_first_set_mask_bit",
                                      "164-vmsbfm-set-before-first-mask-bit": "_vmsbf_m_set_before_first_mask_bit",
                                   "165-vmsifm-set-including-first-mask-bit": "_vmsif_m_set_including_first_mask_bit",
                                        "166-vmsofm-set-only-first-mask-bit": "_vmsof_m_set_only_first_mask_bit",
                                                "168-vector-iota-operations": "_vector_iota_instruction",
                                       "169-vector-element-index-operations": "_vector_element_index_instruction",
                                        "171-integer-scalar-move-operations": "_integer_scalar_move_instructions",
                                              "173-vector-slide-operationsU": "_vector_slideup_instructions",
                                              "173-vector-slide-operationsD": "_vector_slidedown_instructions",
                             "173-vector-slide1up-and-slide1down-functionsD": "_vector_slide1down_instruction",
                             "173-vector-slide1up-and-slide1down-functionsU": "_vector_slide1up",
                                     "174-vector-register-gather-operations": "_vector_register_gather_instructions",
                                            "175-vector-compress-operations": "_vector_compress_instruction",
  };
  
  // mini descriptions & "implementations"
  let miniDocs = {
    'set-vl-and-vtype-functions': c => ["Returns a number less than or equal to <code>avl</code>, specifying how many elements of the given type should be processed.", undefined],
    'set-vl-to-vlmax-with-specific-vtype': c => ["Returns the maximum number of elements of the specified type to process.", undefined],
    'reinterpret-cast-conversion-functions': c => [undefined, ""],
    'vector-lmul-extension-and-truncation-functions': c => [c.name.includes("vlmul_ext")? "Returns a vector whose low part is the argument, and the upper part is undefined." : "Returns a low portion of the argument.", ""],
    'vector-initialization-functions': c => ["Returns an undefined vector value of the specified type.", undefined],
    'vector-insertion-functions': c => [c.name.includes("x")? "Creates a copy of the tuple with a specific element replaced." : "Inserts a lower-LMUL vector to part of a higher-LMUL one. This is equivalent to writing over part of the register group of the <code>desc</code> argument.", ""],
    'vector-extraction-functions': c => [c.name.includes("x")? "Extracts an element of the tuple." : "Extracts a part of the register group of <code>src</code>.", ""],
  };
  
  let implicitMasked = [ // categories where a maskedoff argument isn't added separately
    'Permutation|Slide|Up N',
    'Integer|Multiply-add',
    'Float|Fused multiply-add',
    'Float|Widen|Fused multiply-add',
  ];
  
  
  let res = JSON.parse(baseFile);
  /// let {data:policyMap, def:policyDef, types:policyTypes} = JSON.parse(policiesFile);
  /// let implicitCount = 0; // sanity check counter
  
  // process entries
  res.forEach(ins => {
    let c = ins;
    
    c.categories = c.categories.map(c => c.endsWith("|non-masked")? c.substring(0,c.length-11): c);
    c.id = idCounter++;
    c.implInstr = c.implInstrRaw? c.implInstrRaw.replace(/\n/g, '<br>') : undefined;
    
    // transform categories
    c.categories = c.categories.flatMap(ct => {
      ct = ct.replace(/(^|\|)Vector /g, "$1");
      let n = categoryMap[ct];
      return n===undefined? ct : (typeof n === 'string')? n : n(c);
    });
    // process variations
    if (ins.policies) {
      ins.variations = ins.policies.map(s => {
        let obj = {
          name: ins.name + s.s,
          short: s.s,
          ret: ins.ret,
          
          args: s.a.map(a => {
            if (typeof a === 'number') return ins.args[a];
            if (typeof a === 'object') return a;
            return {name: a.startsWith('vbool')? 'mask' : 'maskedoff', type: a};
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
    
    let docVal, specRef;
    if (c.implDesc) {
      let match = c.implDesc.match(/\.\.\/rvv-intrinsic-api.md#+(.+)/);
      if (!match) throw new Error("expected API reference for "+c.name);
      let apiRef = match[1];
      if (c.categories[0].includes("Slide|Down")) apiRef+= "D";
      if (c.categories[0].includes("Slide|Up")) apiRef+= "U";
      docVal = miniDocs[apiRef];
      specRef = specMap[apiRef];
    } else {
      specRef = 'sec-aos'; // TODO more specific
    }
    
    if (docVal) {
      let [desc, oper] = docVal(c);
      if (desc!==undefined) c.desc = desc;
      docVal = oper;
    }
    
    if (c.overloaded) c.desc = `Overloaded name: <span class="mono h-name">${mkcopy(c.overloaded,c.overloaded)}</span><br>${c.desc}`;
    
    // add implementation description aka operation, and new instr if available
    let newOp = rvvOps.oper(c);
    c.implDesc = newOp? newOp.oper : !docVal? undefined : `<div style="font-family:sans-serif;white-space:normal">${docVal}</div>`;
    if (newOp && newOp.instrHTML!==undefined) {
      c.implInstrSearch = newOp.instrSearch;
      c.implInstr = () => rvvOps.oper(c).instrHTML;
    }
    
    // reference spec
    if (c.name.includes("_vfmv_s_f_")) specRef = '_floating_point_scalar_move_instructions'; // map specification references pt.2
    if (c.name.includes("vncvt_x_x_w_")) specRef = '_vector_narrowing_integer_right_shift_instructions';
    if (c.name.includes("_vwcvt")) specRef = '_vector_widening_integer_addsubtract';
    if (specRef) c.desc = `<a target="_blank" href="${specFilePath}#${specRef}">Specification</a><br>`+c.desc
  });
  /// if (implicitCount!=828) console.warn("Unexpected count of intrinsics with implicit maskedoff argument: "+implicitCount);
  

  function addCsrOp(ret, name, args, desc, oper) {
    res.push({
      id: idCounter++,
      ret: {type: ret}, args, name,
      desc, implDesc: oper,
      archs: ['rvv'], categories: ["Initialize|CSR"],
    });
  }
  let csrdef = `
    enum RVV_CSR {
      RVV_VSTART = 0,
      RVV_VXSAT = 1,
      RVV_VXRM = 2,
      RVV_VCSR = 3,
    };\n`.replace(/\n    /g,"\n").slice(1);
  addCsrOp("unsigned long", "__riscv_vlenb", [], "Get VLEN in bytes", "return VLEN/8;");
  addCsrOp("unsigned long", "__riscv_vread_csr", [{type:"enum RVV_CSR",name:"csr"}], "Read a CSR", csrdef+"return CSRS[csr];");
  addCsrOp("void", "__riscv_vwrite_csr", [{type:"enum RVV_CSR",name:"csr"}, {type:"unsigned long", name:"value"}], "Set a CSR", csrdef+"CSRS[csr] = value;");
  
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
    
    'Bitwise|Shift left': 0,
    'Bitwise|AND': 1,
    'Bitwise|OR': 2,
    'Bitwise|XOR': 3,
    'Bitwise|NOT': 4,
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
      mkvar(ins, ins.short || 'base'),
      ...ins.variations.flatMap(fn => [', ', mkvar(fn, fn.short)])
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
  const P_CAT = 8;
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
          case "inst": r[P_INST] = true; break;
          case "oper": r[P_OPER] = true; break;
          case "cat":  r[P_CAT]  = true; break;
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
              if (m[P_INST]) addOpt(ins.implInstrSearch);
              if (m[P_DESC]) addOpt(ins.descSearch);
              if (m[P_OPER]) addOpt(ins.implDescSearch);
              if (m[P_CAT]) addLower(...ins.categories);
              if (nstate.svar) vars = vars.filter(c => nstate.svar.includes(c.short || "base"));
              vars.forEach(c => {
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
    is.forEach(c => {
      if (c.archs.length==0 || c.categories.length==0) { console.warn("No categories or architectures for "+c.name); }
      c.variationsIncl = [c, ...(c.variations || [])];
      c.variationsIncl.forEach(v => {
        v.args.forEach(prepType);
        prepType(v.ret);
        v.nameSearch = searchStr(v.name);
        v.descSearch = searchStr(v.desc);
        if (!v.implInstrSearch && typeof v.implInstr!=='function') v.implInstrSearch = searchStr(v.implInstr);
        if (!v.implDescSearch && typeof v.implDesc!=='function')  v.implDescSearch = searchStr(v.implDesc);
      });
      
      let ref = c.name.replace(/^(__riscv_|_mm)/,"");
      if (c.cpu[0]==='x86-64') ref = c.ret.type+';'+c.archs.join(';')+';'+ref;
      c.ref = ref;
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