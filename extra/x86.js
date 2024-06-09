'use strict';
let excludeSVML = true; // remove SVML entries, which are provided by an Intel library and not the CPU

let src, perfSrc;
try {
  src = await loadFile("data/intel_intrinsics-1.xml");
  perfSrc = await loadFile("data/intel_perf2-1.js");
} catch (e) {
  console.error(e);
  throw window.noDataFiles;
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


export function instructions(name) {
  return res1;
}


export const archOrder = {
  'all|SSE': 0,
  'all|AVX+AVX2': 1,
  'all|AVX2+': 2,
  'all|AVX512': 3,
  
  'SSE|MMX': 0,
  'SSE|SSE': 1,
  'SSE|SSE2': 2,
  'SSE|SSE3': 3,
  'SSE|SSSE3': 4,
  'SSE|SSE4.1': 5,
  'SSE|SSE4.2': 6,
  'SSE|SSE+': 7,
  
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

export const categoryOrder = {
  'other|all': 0,
  'other|AMX': 1,
  'other|KNCNI': 2,
};

export const archOpen = new Set(['', 'SSE', 'AVX+AVX2']);
