'use strict';

let extra_test = false;

function boring(c) {
  return `<span class="boring">${c}</span>`;
}

function tnorm(t) { // "int32_t" → "int32_t"; {type:"int32_t"} → "int32_t"
  return t.type || t;
}
function isvec(t) { // int32_t → false; vint32m2_t → true
  return tnorm(t).startsWith("v");
}
function eltype(t) { // vint32m2_t → int32_t, int16_t → int16_t
  t = tnorm(t);
  if (!isvec(t)) return t;
  return t.slice(1).replace(/mf?\d/,"");
}
function maxval(t) { // vint32m2_t → INT32_MAX; uint16_t → INT16_MAX
  t = eltype(t);
  return t.replace("_t","").toUpperCase() + "_MAX";
}
function minval(t) { // vint32m2_t → INT32_MIN; uint16_t → 0
  t = eltype(t);
  if (t.startsWith("u")) return "0";
  return t.replace("_t","").toUpperCase() + "_MIN";
}
function tshort(t) { // int32_t → i32, float64_t → f64
  t = eltype(t);
  return t.replace(/loat|_t/g, "").replace(/u?int/,c=>c[0]);
}

function hasarg(fn, name) {
  return fn.args.find(c => c.name === name) !== undefined;
}
function farg(fn, name) { // type of argument with the given name
  let r = fn.args.find(c => c.name === name);
  if (!r) throw new Error("Expected "+fn.name+" to have argument named "+name);
  return r.type;
}

function ocall(n, ...args) { // return `n(...args)` or `x` or `nx` (i.e. n=="-", `-x`) depending on `n`
  let x = args[args.length-1];
  if (!n) return x;
  
  let pre = args.slice(0,-1);
  if (/\w/.test(n[0]) || pre.length) return n+"("+[...pre, x].join(", ")+")";
  return n+x;
}
function owd(R, X, x) { // optionally widen x from eltype X to R
  R = eltype(R);
  X = eltype(X);
  if (R == X) return x;
  return `${R[0]=='f'? 'widen' : R[0]=='u'? 'zext' : 'sext'}(${tshort(R)}, ${x})`;
}
function owdq(R, X, x) { // optionally widen x from eltype X to (quality of X, width of R)
  R = eltype(R);
  X = eltype(X);
  R = X.replace(/\d+/, R.match(/\d+/)[0])
  return owd(R, X, x);
}
function owdm(m, X, x) { // widen x from X by factor of m
  let R = X.replace(/\d+/, c => m*c);
  return owd(R, X, x);
}

function vparts(T) { // [width, lmul]
  T = tnorm(T);
  let [_,e,f,m] = T.match(/^\D*(\d+)m(f?)(\d+)_t$/);
  return [+e, f? 1/m : +m];
}
function eparts(T) { // [width, quality]
  T = eltype(T);
  return [+T.match(/\d+/)[0], T[0]];
}


function opmap(fn) {
  let name = fn.name.split('_')[3];
  if (name.includes('add')) return '+';
  if (name.includes('sub')) return '-';
  if (name.includes('mul')) return '*';
  if (name.includes('div')) return '/';
  if (name.includes('rem')) return '%';
  if (name.includes('sll')) return '<<';
  if (name.includes('sra')) return '>>';
  if (name.includes('srl')) return '>>';
  if (name.includes('and')) return '&';
  if (name.includes('xor')) return '^';
  if (name.includes('or')) return '^';
  if (/eq$/.test(name)) return '==';
  if (/ne$/.test(name)) return '!=';
  if (/gtu?$/.test(name)) return '>';
  if (/ltu?$/.test(name)) return '<';
  if (/geu?$/.test(name)) return '≥';
  if (/leu?$/.test(name)) return '≤';
  throw new Error("Unknown operator name in "+name);
}
const raise_invalid = "fflags[NV] = 1; // Invalid Operation FP flag";

const mem_ref = (fn, eln) => {
  if (/_v[ls]e/.test(fn.name)) return `base%M[i%M]`;
  return `%M*(${eln? eltype(farg(fn,eln)) : 'RESE{}'}*)(i*b${/_v[ls][ou]xei/.test(fn.name)? 'index[i]' : 'stride'} + (char*)base)`;
}
const mem_mask_comment = (f) => f.short&&f.short.includes("m")? ` // masked-off indices won't fault` : ``;
const mem_align_comment = (f,l) => {
  let a = eparts(l? f.ret : farg(f,'value'))[0]/8;
  return a==1? `RMELN{}` : `// if the address of any executed ${l?'load':'store'} is not aligned to a${a==8?'n':''} ${a}-byte boundary, an address-misaligned exception may or may not be raised.`
}
const mem_loop = (f) => `for (size_t i = 0; i < vl; i++) {`+(f.name.includes("uxei")? ` // note: "unordered" only applies to non-idempotent memory (i.e. memory-mapped), but otherwise the operation is still sequential` : ``)

function red_op(fn, a, b) {
  let n = (t) => fn.name.includes(t);
  if (n('sum')) return `${a} + ${b}`;
  if (n('xor')) return `${a} ^ ${b}`;
  if (n('or')) return `${a} | ${b}`;
  if (n('and')) return `${a} & ${b}`;
  if (n('min')) return `min(${a}, ${b})`;
  if (n('max')) return `max(${a}, ${b})`;
}

let defs = [
  // same-width & widening float & integer add/sub/mul/div, integer and/or/xor
  [/_vf?w?(add|sub|mul|div|rem|and|or|xor)(s?u)?_[vw][vxf]_/, (f) => `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${owdq(f.ret, farg(f,'op1'), `op1[i]`)} ${opmap(f)} ${owdq(f.ret, farg(f,'op2'), `IDX{op2}`)}};
  }
  TAILLOOP{};
  return res;`],
  
  // multiply-add
  [/_vf?w?n?m(acc|add|sub|sac)(su|us?)?_v[vxf]_/, (f) => `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${
      [
        ['_vmacc_',   '(VS1 * vs2[i]) + vd[i]'],
        ['_vnmsac_', '-(VS1 * vs2[i]) + vd[i]'],
        ['_vmadd_',   '(VS1 * vd[i]) + vs2[i]'],
        ['_vnmsub_', '-(VS1 * vd[i]) + vs2[i]'],
        
        ['_vwmaccu_',  '(WD1 * WD2) + vd[i]'],
        ['_vwmacc_',   '(WD1 * WD2) + vd[i]'],
        ['_vwmaccsu_', '(WD1 * WD2) + vd[i]'],
        ['_vwmaccus_', '(WD1 * WD2) + vd[i]'],
        
        ['vfmacc',   '(VS1 * vs2[i]) + vd[i]'],
        ['vfnmacc', '-(VS1 * vs2[i]) - vd[i]'],
        ['vfmsac',   '(VS1 * vs2[i]) - vd[i]'],
        ['vfnmsac', '-(VS1 * vs2[i]) + vd[i]'],
        ['vfmadd',   '(VS1 * vd[i]) + vs2[i]'],
        ['vfnmadd', '-(VS1 * vd[i]) - vs2[i]'],
        ['vfmsub',   '(VS1 * vd[i]) - vs2[i]'],
        ['vfnmsub', '-(VS1 * vd[i]) + vs2[i]'],
        
        ['_vfwmacc_',   '(VS1 * vs2[i]) + vd[i]'],
        ['_vfwnmacc_', '-(VS1 * vs2[i]) - vd[i]'],
        ['_vfwmsac_',   '(VS1 * vs2[i]) - vd[i]'],
        ['_vfwnmsac_', '-(VS1 * vs2[i]) + vd[i]'],
      ].find(c => f.name.includes(c[0]))[1]
      .replace(/WD(\d)/g, (_,n) => owdq(f.ret, f.args.find(c=>c.name.includes(n)), n==2? 'vs2[i]' : 'VS1'))
      .replace("VS1", hasarg(f,'rs1')?'rs1':'vs1[i]')
    }};${f.name.includes('_vf')? ' // fused' : ''}
  }
  TAILLOOP{};
  return res;`],
  
  // load
  [/_vl(s?e|[ou]xei)\d+_v_/, (f) => `
  VLMAX{RES{}}
  ${mem_align_comment(f,1)}
  RES{} res;
  ${mem_loop(f)}
    res[i] = MASK{${mem_ref(f)}};${mem_mask_comment(f)}
  }
  TAILLOOP{};
  return res;`],
  
  // store
  [/_vs(s?e|[ou]xei)\d+_v_/, (f) => `
  VLMAX{FARG{value}}
  ${mem_align_comment(f,0)}
  ${mem_loop(f)}
    ${f.short==='_m'?`if (mask[i]) `:``}${mem_ref(f,'value')} %M= value[i];${mem_mask_comment(f)}
  }`],
  
  // mask load/store
  [/_v[ls]m_v_/, (f) => { let b=+f.name.split('_v_b')[1]; return `
  VLMAXB{}
  VLMAX{}
  
  ${f.name.includes('_vl')? `vuint8m1_t uints;` : `vuint8m1_t uints = (vuint8m1_t) value;`}
  for (size_t i = 0; i < ceil(vl/8); i++) {
    ${f.name.includes('_vl')? `uints[i] = base%M[i%M]` : `base%M[i%M] %M= uints[i]`};
  }
  RMELN{}
  ${f.name.includes('_vl')? `return (RES{}) uints;` : ``} RMELN{}
  `}],
  
  // fault-only-first
  [/_vle\d+ff_v/, (f) => `
  VLMAX{RES{}}
  ${mem_align_comment(f,1)}
  RES{} res;
  ${f.short&&f.short.includes('m')?'if (mask[0]) ':''}base%M[0%M]; // for the side-effect of faulting
  // after this point, this instruction will never fault
  
  size_t new_vl = /* implementation-defined 1≤new_vl≤vl such that the below doesn't fault */;
  for (size_t i = 0; i < new_vl; i++) {
    res[i] = MASK{base%M[i%M]};
  }
  
  for (size_t i = new_vl; i < vl; i++) res[i] = MASK{anything()};
  TAILLOOP{};
  return res;`],
  
  // shift
  [/_vn?s(ll|ra|rl)_/, (f) => `
  VLMAX{FARG{op1}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${ocall(f.name.includes('_vn')?'trunc':'', tshort(f.ret), `op1[i] ${opmap(f)} (IDX{shift} & ${eparts(farg(f,'op1'))[0]-1})`)}};${/_vn?sr/.test(f.name)? ' // shifts in '+(f.name.includes('sra')? 'sign bits' : 'zeroes') : ''}
  }
  TAILLOOP{};
  return res;`],
  
  // reverse binary:  rsub, rdiv
  [/_vf?r(sub|div)_v[xf]_/, (f) => `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${owd(f.ret, farg(f,'op2'), `op2`)} ${opmap(f)} ${owd(f.ret, farg(f,'op1'), `op1[i]`)}};
  }
  TAILLOOP{};
  return res;`],
  
  // high half of multiplication
  [/_vmulh/, (f) => `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{(${owdm(2, farg(f,'op1'), `op1[i]`)} * ${owdm(2, farg(f,'op2'), `IDX{op2}`)}) >> ${farg(f,'op1').match(/\d+/)[0]}};
  }
  TAILLOOP{};
  return res;`],
  
  // sign injection
  [/_vfsgnj/, (f) => { let w=+f.ret.type.match(/\d+/)[0]; let u='uint'+w+'_t'; let n=f.name.includes('sgnjx')?2:f.name.includes('sgnjn')?1:0; return `
  VLMAX{RES{}}
  
  ${u} sign = 0x${'8'.padEnd(w/4,'0').replace(/.{4}/g, "'$&").replace(/^'/,'')};
  ${n==2? `` : `${u} rest = 0x${'7'.padEnd(w/4,'F').replace(/.{4}/g, "_$&").replace(/^_/,'')};`} RMELN{}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    ${u} a = reinterpret(${tshort(u)}, op1[i]);
    ${u} b = reinterpret(${tshort(u)}, IDX{op2});
    res[i] = reinterpret(${tshort(f.ret)}, ${['(a & rest) | (b & sign)','(a & rest) | ((~b) & sign)','a ^ (b & sign)'][n]});
  }
  TAILLOOP{};
  return res;`}],
  
  // add-with-carry / subtract-with-borrow
  [/_v(ad|sb)c_/, (f) => { let a=f.name.includes('_vadc'); return `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = op1[i] ${'+ IDX{op2} +'.replace(/\+/g,a?'+':'-')} (${a?'carry':'borrow'}in ? 1 : 0);
  }
  TAILLOOP{};
  return res;`}],
  
  // mask out of add-with-carry / subtract-with-borrow
  [/_vm(ad|sb)c_/, (f) => { let a=f.name.includes('_vmadc'); return `
  VLMAX{FARG{op1}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    intinf_t exact = uintinf(op1[i]) ${`+ uintinf(IDX{op2})${f.args.length==3? `` : ` + (${a?'carry':'borrow'}in ? 1 : 0)`}`.replace(/\+/g,a?'+':'-')};
    res[i] = ${a? 'exact ≥ '+maxval(farg(f,'op1').replace(/^vi/,'vui')) : 'exact < 0'};
  }
  TAILLOOP{};
  return res;`}],
  
  // reductions
  [/vf?w?red(?!usum)/, (f) => { let [ew, lm] = vparts(farg(f,'vector')); let ovlen = 2**(2*ew) / (lm * 2**ew); return `
  VLMAX{FARG{vector}}
  RESE{} res = scalar[0];
  for (size_t i = 0; i < vl; i++) {
    ${f.short&&f.short.includes('m')? 'if (mask[i]) ' : ''}res = ${red_op(f, 'res', owd(f.ret, farg(f,'vector'), 'vector[i]'))};${
      f.name.includes('osum')? ' // yes, sequential sum, rounding on each op'
      : f.name.includes('wredsum')? ` // note: can overflow if ${ovlen<=65536? `vl ≥ ≈${ovlen} or if ` : ``}scalar is large enough`
      : ``
    }
  }
  RES{} res_vec;
  res_vec[0] = res;
  BORING{for (size_t i = 1; i < VLMAXG{RES{}}; i++) res[i] = TAIL{};}
  return res_vec;`}],
  
  [/_vfw?redusum/, (f) => { let m=f.short&&f.short.includes('m'); return `
  // TL;DR: sum${m?' non-masked':''} elements in some implementation-defined order with
  //   implementation-defined intermediate types (at least RESE{})
  //   and some additive identities possibly sprinkled in
  VLMAX{FARG{vector}}
  
  RESE{} additive_identity = rounding_mode==ROUND_DOWN ? +0.0 : -0.0;
  
  float_t process(float_t[] items) {
    if (items.length == 1) {
      return items[0];
    }
    float_t[] partA = /* implementation-defined non-empty strict subset of 'items' */;
    float_t[] partB = /* complement subset */;
    floatinf_t resA = process(partA);
    floatinf_t resB = process(partB);
    
    type_t new_type = /* implementation-defined type at least as wide as RESE{} */;
    return round(new_type, resA + resB);
  }
  
  float_t[] all_items = [scalar[0]];
  for (size_t i = 0; i < vl; i++) {
    ${m?`if (mask[i]) {
      if (/* implementation-defined */) all_items.push(additive_identity);
    } else {
      all_items.push(vector[i]);
    }`: `all_items.push(vector[i]);`}
  }
  if (/* implementation-defined */) all_items.push(additive_identity);
  
  RES{} res_vec;
  res_vec[0] = round(RESE{}, process(all_items));
  
  BORING{for (size_t i = 1; i < VLMAXG{RES{}}; i++) res[i] = TAIL{};}
  return res;`}],
  
  // saturating add/sub
  [/_vs(add|sub)u?_v[vx]_/, (f) => `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    intinf_t exact = intinf(op1[i]) ${opmap(f)} intinf(IDX{op2});
    res[i] = clip(${tshort(f.ret)}, exact); // may set RVV_VXSAT
  }
  TAILLOOP{};
  return res;`],
  
  // comparison
  [/_vm[fs](lt|le|gt|ge|eq|ne)u?_/, (f) => { let fl=farg(f,'op1')[1]=='f'; let mf=fl&&f.short; let nt = '=!'.includes(opmap(f)[0])? "isSNaN" : "isNaN"; return `
  VLMAX{FARG{op1}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    ${mf? 'MASKWEE{}' : ''} RMELN{}
    res[i] = ${mf?'':'MASK{'}op1[i] ${opmap(f)} IDX{op2}${mf?'':'}'};
    ${fl? boring(`if (${nt}(op1[i]) || ${nt}(IDX{op2})) ${raise_invalid}`) : ''} RMELN{}
  }
  TAILLOOP{};
  return res;`}],
  
  // broadcast
  [/_vmv_v_x_|_vfmv_v_f_/, `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = src;
  }
  TAILLOOP{};
  return res;`],
  
  // set first
  [/_vmv_s_x_|_vfmv_s_f_/, `
  VLMAX{RES{}}
  RES{} res;
  if (vl > 0) {
    res[0] = src;
    TAILLOOP{1};
  } else {
    res = TAILV{}
  }
  return res;`],
  
  // get first
  [/_vfmv_f_s_|_vmv_x_s_/, `return src[0];`],
  
  // gather
  [/vrgather_vx_/, (f) => `
  VLMAX{RES{}}
  RES{} res;
  RESE{} val = index ≥ vlmax ? ${f.ret.type.includes('fl')? '+0.0' : '0'} : op1[index];
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{val};
  }
  TAILLOOP{};
  return res;`],
  [/vrgather(ei16)?_vv_/, (f) => `
  RES{} res;
  VLMAX{RES{}}
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{index[i] ≥ vlmax ? ${f.ret.type.includes('fl')? '+0.0' : '0'} : op1[index[i]]}; // allows indexing in op1 past vl
  }
  TAILLOOP{};
  return res;`],
  
  // compress
  [/_vcompress_/, `
  VLMAX{RES{}}
  RES{} res;
  size_t c = 0;
  for (size_t i = 0; i < vl; i++) {
    if (mask[i]) {
      res[c] = src[i];
      c++;
    }
  }
  TAILLOOP{c};
  return res;`],
  
  // slide
  [/vf?slide1(up|down)/, (f) => { let d=f.name.includes("down"); return `
  VLMAX{RES{}}
  RES{} res;
  if (vl > 0) {
    res[${d?'vl-1':'0'}] = MASK{value};
    for (size_t i = ${d?'0':'1'}; i < vl${d?'-1':''}; i++) {
      res[i] = MASK{src[i${d?'+':'-'}1]};
    }
  } else {
    res = TAILV{};
  }
  TAILLOOP{c};
  return res;`}],
  [/vslideup/, (f) => { let d=f.name.includes("down"); return `
  VLMAX{RES{}}
  BORING{offset = min(offset, vl);}
  
  RES{} res;
  for (size_t i = 0; i < offset; i++) {
    res[i] = dest[i];
  }
  for (size_t i = offset; i < vl; i++) {${f.short?``:` // i.e. res[offset…vl-1] = src[0…offset-1];`}
    res[i] = MASK{src[i-offset]};
  }
  
  TAILLOOP{c};
  return res;`}],
  [/vslidedown/, (f) => { let d=f.name.includes("down"); return `
  VLMAX{RES{}}
  BORING{offset = min(offset, vl);}
  
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{i+offset ≥ vlmax ? 0 : src[i+offset]};
  }
  
  TAILLOOP{};
  return res;`}],
  
  // merge / blend
  [/_vf?merge_/, `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = mask[i] ? IDX{op2} : op1[i];
  }
  TAILLOOP{};
  return res;`],
  
  // vid
  [/_vid_/, `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{i};
  }
  TAILLOOP{};
  return res;`],
  
  // viota
  [/_viota_/, `
  VLMAX{RES{}}
  RES{} res;
  size_t c = 0;
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    res[i] = c;
    if (op1[i]) c++;
  }
  TAILLOOP{};
  return res;`],
  
  // reinterpret
  [/_vreinterpret_/, `return reinterpret(RES{}, src);`],
  
  // integer min/max
  [/_v(min|max)u?_[vw][vx]_/, (f) => `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${f.name.includes('min')?'min':'max'}(op1[i], IDX{op2})};
  }
  TAILLOOP{};
  return res;`],
  
  // float min/max
  [/_vf(min|max)_v[vf]_/, (f) => `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    RESE{} a = op1[i];
    RESE{} b = IDX{op2};
    if (isNaN(a) && isNaN(b)) {
      res[i] = canonical_qNaN;
    } else if (isNaN(a)) {
      res[i] = b;
    } else if (isNaN(b)) {
      res[i] = a;
    } else if (a==0 && b==0) { // comparing -0.0 and +0.0 as equal
      res[i] = bitwise_eq(a, -0.0) || bitwise_eq(b, -0.0) ? -0.0 : +0.0;
    } else {
      res[i] = a ${f.name.includes('min')?'<':'>'} b ? a : b;
    }
  }
  TAILLOOP{};
  return res;`],
  
  // unary same-width things
  [/_vf?neg_|_vfrsqrt7_|_vfsqrt_|_vfrec7_|_vfabs_|_vnot_|_vmv_v_v_/, (f) => {let n=(c)=>f.name.includes(c); return `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${ocall(n('vmv')?'':n('neg')?'-':n('not')?'~':n('rsqrt7')?'reciprocal_sqrt_estimate':n('rec7')?'reciprocal_estimate':n('sqrt')?'sqrt':n('abs')?'abs':'??', `op1[i]`)}};${n("7")? ' // 7 MSB of precision' : n('abs')? ' // abs(-0.0) is +0.0' : ''}
  }
  TAILLOOP{};
  return res;`}],
  
  // sign-extend, zero-extend, widen, convert
  [/[sz]ext|_vf?w?cvtu?_/, (f) => { let op=hasarg(f,'src')?'src':'op1'; let [rw,rq]=eparts(f.ret); let [ow,oq]=eparts(farg(f,op)); return  `
  VLMAX{${farg(f,op)}}
  ${f.name.includes('_rtz_')?`local_rounding_mode = RTZ; // Round towards zero`:``} RMELN{}
  
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${rw==ow || oq=='f'&&rq!='f'? ocall('convert',tshort(f.ret),op+'[i]') : owd(f.ret, '', op+'[i]')}};
  }
  TAILLOOP{};
  return res;`}],
  
  // narrow
  [/_vf?ncvt_/, (f) => `
  VLMAX{FARG{src}}
  ${f.name.includes('_rod_')?`local_rounding_mode = ROUND_TOWARDS_ODD;`:``} RMELN{}
  
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${f.name.includes('_vf')?'round':'trunc'}(${tshort(f.ret)}, op1[i]})};
  }
  TAILLOOP{};
  return res;`],
  
  
  // float classify
  [/vfclass/, (f) => `
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    RESE{} t = 0;
    ${eltype(farg(f,'op1'))} a = op1[i];
    bool sub = is_subnormal(op1[i]); // false for ±0
    if (a == -∞)     t |= 1<<0; // ==   1 == 0x001
    if (a<0 && !sub) t |= 1<<1; // ==   2 == 0x002; false for ±0.0
    if (a<0 &&  sub) t |= 1<<2; // ==   4 == 0x004; false for ±0.0
    if (a === -0.0)  t |= 1<<3; // ==   8 == 0x008
    if (a === +0.0)  t |= 1<<4; // ==  16 == 0x010
    if (a>0 &&  sub) t |= 1<<5; // ==  32 == 0x020
    if (a>0 && !sub) t |= 1<<6; // ==  64 == 0x040
    if (a == +∞)     t |= 1<<7; // == 128 == 0x080
    if (isSNaN(a))   t |= 1<<8; // == 256 == 0x100
    if (isQNaN(a))   t |= 1<<9; // == 512 == 0x200
    res[i] = t;
  }
  TAILLOOP{};
  return res;`],
  
  // mask bitwise ops
  [/_mm_|_vm(not|mv|set|clr)_m_/, (f) => `
  ${f.name.includes('vmmv')? '// hints that this will be used as a mask' : ''} RMELN{}
  VLMAXB{}
  VLMAX{}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = ${
      [['vmmv', 'op1[i]'], ['vmnot', '!op1[i]'], ['vmset', '1'], ['vmclr', '0'],
      ['vmand' ,   'op1[i] && op2[i]'],
      ['vmnand', '!(op1[i] && op2[i])'],
      ['vmandn',   'op1[i] && !op2[i]'],
      ['vmxor',    'op1[i] ^ op2[i]'],
      ['vmor',     'op1[i] || op2[i]'],
      ['vmnor',  '!(op1[i] || op2[i])'],
      ['vmorn',    'op1[i] || !op2[i]'],
      ['vmxnor', '!(op1[i] ^ op2[i])']].find((c)=>f.name.includes(c[0]))[1]};
  }
  TAILLOOP{};
  return res;`],
  
  // mask fancy ops
  [/_vfirst_m_/, (f) => `
  VLMAXB{}
  VLMAX{}
  for (size_t i = 0; i < vl; i++) {
    if (${f.short?'mask[i] && ':''}op1[i]) return i;
  }
  return -1;`],
  [/_vcpop_m_/, (f) => `
  VLMAXB{}
  VLMAX{}
  RES{} res = 0;
  for (size_t i = 0; i < vl; i++) {
    if (${f.short?'mask[i] && ':''}op1[i]) res++;
  }
  return res;`],
  // [/_vmmv_m_/, `return op1; // hints that op1 will be used as a mask`],
  [/vms[bio]f_m_/, (f) => { let n = f.name.includes("vmsbf")? 0 : f.name.includes("vmsif")? 1 : 2; return `
  VLMAXB{}
  VLMAX{}
  RES{} res;
  bool acc = true;
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    ${n==0?'if (op1[i]) acc = false;':''} RMELN{}
    res[i] = ${['acc', 'acc', 'acc && op1[i]'][n]};
    ${n!=0?'if (op1[i]) acc = false;':''} RMELN{}
  }
  TAILLOOP{};
  return res;`}],
  
  // averaging add/sub
  [/_va(add|sub)u?_/, (f) => `
  VLMAX{RES{}}
  RES{} res;
  
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    intinf_t exact = intinf(op1[i]) ${opmap(f)} intinf(IDX{op2});
    res[i] = rounded_shift_right(exact, 1); // based on RVV_VXRM
  }
  TAILLOOP{};
  return res;`],
  
  // rounding shift
  [/_vssr[al]_/, (f) => `
  VLMAX{RES{}}
  RES{} res;
  
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    res[i] = rounded_shift_right(op1[i], IDX{shift} & ${eparts(f.ret)[0]-1}); // based on RVV_VXRM
  }
  TAILLOOP{};
  return res;`],
  
  // narrowing clip
  [/_vnclipu?_/, (f) => `
  VLMAX{FARG{op1}}
  RES{} res;
  
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    ${eltype(farg(f,'op1'))} tmp = rounded_shift_right(op1[i], IDX{shift} & ${eparts(f.ret)[0]-1}); // based on RVV_VXRM
    res[i] = clip(${tshort(f.ret)}, tmp); // may set RVV_VXSAT
  }
  TAILLOOP{};
  return res;`],
  
  // rounding & saturating multiply
  [/_vsmul_/, (f) => `
  VLMAX{RES{}}
  RES{} res;
  
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    intinf_t exact = intinf(op1[i]) * intinf(IDX{op2});
    intinf_t tmp = rounded_shift_right(exact, ${eparts(f.ret)[0]-1}); // based on RVV_VXRM
    res[i] = clip(${tshort(f.ret)}, tmp); // may set RVV_VXSAT
  }
  TAILLOOP{};
  return res;`],
  
  // setvl
  [/_vsetvl_/, (f) => `
  vlmax = VLMAXG{${f.name.split('vsetvl_')[1].replace('e','vint')+'_t'}};
  if (avl ≤ vlmax) {
    return avl;
  } else if (vlmax < avl ≤ vlmax*2) {
    return /* implementation-defined number in [ceil(avl/2), vlmax] inclusive */
  } else {
    return vlmax;
  }`],
  [/_vsetvlmax_/, (f) => `return VLMAXG{${f.name.split('vsetvlmax_')[1].replace('e','vint')+'_t'}};`],
];

let cleanup = (c) => c.replace(/\n  /g, "\n").replace(/^(\n *)+\n/, "");
defs.forEach(c => { if (typeof c[1] !== 'function') c[1] = cleanup(c[1]); });



function helper_code(s) {
  s = cleanup(s);
  s = s.replace(/BORING{(.*?)}/g, (_,c) => boring(c));
  s = s.replace(/\/\/.*|\/\*.*?\*\//g, c => boring(c));
  return s;
}
function helper_text(s) {
  return `<div style="font-family:sans-serif;white-space:normal">${cleanup(s).trim().replace(/.*/g,'<p>$&</p>')}</div>`;
}
return {
helper: (n, ...args) => {
switch(n) {
case 'clip': {
  let [t] = args;
  return helper_code(`
  ${(t[0]=='u'?'u':'')}int${t.slice(1)}_t clip(${t}, intinf_t exact) {
    if (exact < ${minval(t)}) {
      return ${minval(t)};
      BORING{CSRS[RVV_VXSAT] |= 1;}
    } else if (exact > ${maxval(t)}) {
      return ${maxval(t)};
      BORING{CSRS[RVV_VXSAT] |= 1;}
    } else {
      return exact; // doesn't overflow
    }
  }`)}

case 'vlmax': {
  let [e,l] = args;
  let plf = l => l.startsWith("f")? 1/l.slice(1) : +l
  let frac = plf(l) / e;
  
  let allTypes = [
    '8mf8','8mf4','8mf2','8m1','8m2','8m4','8m8',
    '16mf4','16mf2','16m1','16m2','16m4','16m8',
    '32mf2','32m1','32m2','32m4','32m8',
    '64m1','64m2','64m4','64m8',
    '1m1','1mf2','1mf4','1mf8','1mf16','1mf32','1mf64',
  ].map(c=>c.split('m')).map(([a,b])=>[+a,b]);
  
  let equalTo = allTypes
    .filter(([ce,cl]) => !(ce==e && cl==l) && frac==plf(cl)/ce)
    .map(([e,l]) => `  //   ${e==1? `vlmax(vbool${l.replace('f','')}_t)` : `vlmax(e${e}, m${l})`}`)
    .join('\n');
  
  return helper_code(`
  // vlmax(e${e}, m${l}):
  SEW = ${e}; // single element width in bits
  LMUL = ${l.replace('f','1/')}; // register group size
  vlmax = LMUL*VLEN/SEW = VLEN${frac<1? '/'+(1/frac) : '*'+frac};
  
  // examples:
${[32,64,128,256,512,1024,65536].filter(v => v*frac>=1).map(v => `  //   VLEN=${(v+':').padEnd(6)} vlmax = ${v*frac}`).join('\n')} - maximum possible
  
${equalTo? `  // vlmax(e${e}, m${l}) is equal to:\n${equalTo}` : ``}
`)}

case 'anything': return helper_text(`
  Returns any value of the given type.
  May return a different value on each call.
  Sometimes there may be some more specific set of possible values, but for simplicity <code>anything()</code> is used.
`);

case 'agnostic': return helper_text(`
  Either returns its argument, or a constant whose bitwise value is all ones.
  May make a different choice each call.
  For practical purposes, the result of this should be considered to be undefined. It's only used for purposes of clarity.
  In the future, this may become equivalent to <code>anything()</code>.
`);

case 'intinf_t': return helper_text(`
  A pseudotype of a signed infinite-precision integer.
`);

case 'uintinf': return helper_text(`
  Reinterprets the argument as an unsigned integer, and, zero-extending, widens it to a signed infinite-precision integer.
  For example, both <code>uintinf((int8_t) -100)</code> and <code>uintinf((uint8_t) 155)</code> become the infinite-precision signed integer <code>155</code>.
`);
case 'intinf': return helper_text(`Widens (sign- or zero-extending) the argument to an infinite-precision integer.`);
case 'isQNaN': return helper_text(`Returns whether the argument is any quiet NaN.`);
case 'isSNaN': return helper_text(`Returns whether the argument is any signaling NaN.`);
case 'isNaN': return helper_text(`Returns whether the argument is any NaN - that is, either signaling or quiet.`);

}},



oper: (o, v) => {
  let name = o.name;
  
  let ent = defs.find(c => c[0].test(name));
  if (extra_test) {
    let ms = defs.filter(c => c[0].test(name));
    if (ms.length > 1) console.warn(`multiple matches for ${(v||o).name}: ${ms.map(c=>c[0]).join(', ')}`);
  }
  
  if (ent==undefined) return undefined;
  let s = ent[1];
  let fn = v || o;
  if (typeof s === 'function') s = cleanup(s(fn));
  
  let vsi = v===undefined? (c)=>false : (c) => v.short.includes(c); // variation short includes
  
  let mask = !vsi("m")? 0 : vsi("mu")? 2 : 1; // 0: no masking; 1: agnostic; 2: undisturbed
  let tail = !vsi("tu"); // 0: undisturbed; 1: agnostic
  let basev = hasarg(fn, "maskedoff")? "maskedoff" : hasarg(fn, "vd")? "vd" : fn.name.includes("slideup")? "dest" : "";
  let baseeM = basev? basev+"[i]" : "";
  let baseeT = fn.ret.type.includes("bool")? "" : baseeM;
  
  let agnBase0 = (agn,base) => agn? (base? `agnostic(${base})` : "anything()") : `${base}`;
  let agnBaseM= (agn,base) => boring(agnBase0(agn, baseeM));
  let agnBaseT= (agn,base) => boring(agnBase0(agn, baseeT));
  
  s = s.replace(/%M([=*\[\]])/g, (_,c) => `<span class="op-load">${c}</span>`); // memory ops
  s = s.replace(/RES{}/g, o.ret.type); // return type
  s = s.replace(/RESE{}/g, eltype(o.ret)); // result element
  s = s.replace(/FARG{(.*?)}/g, (_,c) => farg(fn,c)); // find argument with given name
  s = s.replace(/VLMAXB{}/g, c => { let b = +o.name.split('_b')[1]; return `BORING{vlmax = VLEN/${b};} // equal to VLMAXG{vint8m${b<8? 8/b : 'f'+(b/8)}_t}`});
  s = s.replace(/VLMAX(G?){(.*?)}/g, (_,g,c) => {
    let v = 'vlmax' + (c? '(' + vparts(c).reduce((e,m) => `e${e}, m${m<1?'f'+(1/m):m}`) + ')' : '');
    // return g? v : boring(`vl = min(vl, ${v});`); // possibly the intention, but idk
    return g? v : boring(`assume(vl ≤ ${v});`);
  });
  
  s = s.replace(/TAILLOOP{(.*?)};?/g, (_,c) => boring(`for (size_t i = ${c?c:'vl'}; i < vlmax; i++) res[i] = TAIL{};`));
  s = s.replace(/TAIL{}/g, agnBaseT(tail)); // tail element
  s = s.replace(/TAILV{}/g, agnBase0(tail,basev)); // tail vector
  
  s = s.replace(/^( *)MASKWEE{}.*\n/gm, (_,c) => !mask? "" : boring(`${c}if (!mask[i]) {\n${c}  res[i] = ${agnBaseM(mask==1)};\n${c}  continue;\n${c}}\n`)); // mask write early exit
  s = s.replace(/BORING{(.*?)}/g, (_,c) => boring(c));
  s = s.replace(/IDX{(.*?)}/g, (_,c) => isvec(farg(fn,c))? c+"[i]" : c);
  s = s.replace(/MASK{(.*?)}/g, (_,c) => !mask? c : `${boring(`mask[i] ?`)} ${c} ${boring(':')} ${agnBaseM(mask==1)}`);
  
  s = s.replace(/\/\/.*|\/\*.*?\*\//g, c => boring(c));
  while (1) {
    let p = s;
    s = s.replace(/^ *RMELN{} *\n/gm, ""); // remove empty line
    if (s==p) break;
  }
  s = s.replace(/ *RMELN{} */gm, "");
  
  // helper function display
  let h = (name, args='') => `<a onclick="rvv_helper('${name}',${args})">${name}</a>`;
  s = s.replace(/clip\(([ui]\d+), /g, (_, t) => h('clip',`'${t}'`)+`(${t}, `);
  s = s.replace(/vlmax(\(e(\d+), m(f?\d+)\))/g, (_,a, e,m) => h('vlmax',`${+e},'${m}'`)+a);
  s = s.replace(/\b(anything|agnostic|u?intinf|is[SQ]?NaN)\(/g, (_,c) => h(c)+'(');
  s = s.replace(/\b(intinf_t)\b/g, (_,c) => h(c));
  
  return s;
}};