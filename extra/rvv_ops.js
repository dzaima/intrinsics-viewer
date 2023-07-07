'use strict';

let extra_test = false;

function boring(c) {
  return `<span class="boring">${c}</span>`;
}

function tnorm(t) { // 'int32_t' → 'int32_t'; {type:'int32_t'} → 'int32_t'
  return t.type || t;
}
function isvec(t) { // int32_t → false; vint32m2_t → true; vint32m2x2_t → true
  return tnorm(t).startsWith("v");
}
function istuple(t) { // int32_t → false; vint32m2_t → false; vint32m2x2_t → true
  return tnorm(t).includes("x");
}

function xparts(T) { // 'vint32m2x3_t' → [3, 'vint32m2_t']
  let r = /x(\d+)/;
  T = tnorm(T);
  return [T.match(r)[1], T.replace(r,'')];
}
function vparts(T) { // [width, lmul]
  T = tnorm(T);
  if (istuple(T)) T = xparts(T)[1];
  let [_,e,f,m] = T.match(/^\D*(\d+)m(f?)(\d+)_t$/);
  return [+e, f? 1/m : +m];
}
function eparts(T) { // [width, quality]
  T = eltype(T);
  return [+T.match(/\d+/)[0], T[0]];
}

function eltype(t) { // vint32m2_t → int32_t; int16_t → int16_t; vint32m2x2_t → int32_t
  t = tnorm(t);
  if (!isvec(t)) return t;
  return t.slice(1).replace(/mf?\d+(x\d+)?/,"");
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
function argn(fn, ...names) { // which of the given argument names fn has
  for (let name of names) {
    let r = fn.args.find(c => c.name === name);
    if (r) return r.name;
  }
  throw new Error("Expected "+fn.name+" to have an argument named "+name.join(' or '));
}
function farg(fn, ...names) { // type of argn(fn, ...names)
  let name = argn(fn, ...names);
  let r = fn.args.find(c => c.name === name);
  if (!r) throw new Error("Expected "+fn.name+" to have an argument named "+name.join(' or '));
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

function tfull(t) { // i32 → int32_t
  let [tw, tq] = eparts(t);
  return `${tq=='u'?'u':''}int${tw}_t`
}
function fmtmul(f) { // 2 → m2; 0.25 → mf4
  if (f>=1) return 'm'+f;
  return 'mf'+(1/f);
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
  if (name.includes('or')) return '|';
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
  let seg = fn.name.match(/seg(\d+)/);
  if (seg) seg = +seg[1];
  if (/_v[ls](e|seg)/.test(fn.name)) return `base%M[i${seg? `*${seg} + o` : ''}%M]`;
  let ptr = `(${eln? eltype(farg(fn,eln)) : 'RESE{}'}*)(i*b${/riscv_v[ls][ou]x/.test(fn.name)? 'index[i]' : 'stride'} + (char*)base)`;
  return seg? `(${ptr})%M[o%M]` : '%M*'+ptr;
}
const mem_mask_comment = (f) => f.short&&f.short.includes("m")? ` // masked-off indices won't fault` : ``;
const mem_align_comment = (f,l) => {
  let a = eparts(l? f.ret : farg(f,'v_tuple','value'))[0]/8;
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
[/_vf?w?(add|sub|mul|div|rem|and|or|xor)(s?u)?_[vw][vxf]_/, (f) => { let minew = Math.min(eparts(farg(f,'op1'))[0], eparts(farg(f,'op2'))[0]); return `
  INSTR{VLSET int${minew}${fmtmul(minew * vparts(farg(f,'op1')).reduce((lw,lm)=>lm/lw))}_t; BASE DST, R_op1, R_op2, MASK}
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${owdq(f.ret, farg(f,'op1'), `op1[i]`)} ${opmap(f)} ${owdq(f.ret, farg(f,'op2'), `IDX{op2}`)}};
  }
  TAILLOOP{};
  return res;`
}],

// multiply-add
[/_vf?w?n?m(acc|add|sub|sac)(su|us?)?_v[vxf]_/, (f) => `
  INSTR{VLSET ${farg(f,'vs2')}; BASE R_vd, R_${hasarg(f,'vs1')?'v':'r'}s1, R_vs2, MASK}
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
  return res;`
],


// segment load, strided load, indexed load
[/vl(|s|[ou]x)seg\dei?\d+_/, (f) => { let [x,vt] = xparts(f.ret); return `
  INSTR{VLSET RES{}; BASE DST, (R_base)${hasarg(f,'bindex')?', R_bindex':''}${hasarg(f,'bstride')?', R_bstride':''}, MASK}
  VLMAX{${vt}}
  ${mem_align_comment(f,1)}
  RES{} res;
  for (int o = 0; o < ${x}; o++) {
    ${vt} curr;
    for (size_t i = 0; i < vl; i++) {
      curr[i] = MASK{${mem_ref(f)}};${mem_mask_comment(f)}
    }
    TAILLOOP{};
    res[o] = curr;
  }
  return res;`
}],
// segment store, stided store, indexed store
[/vs(|s|[ou]x)seg\dei?\d+_/, (f) => { let [x,vt] = xparts(farg(f,'v_tuple')); return `
  INSTR{VLSET FARG{v_tuple}; BASE R_v_tuple, (R_base)${hasarg(f,'bindex')?', R_bindex':''}${hasarg(f,'bstride')?', R_bstride':''}, MASK}
  VLMAX{${vt}}
  ${mem_align_comment(f,0)}
  for (int o = 0; o < ${x}; o++) {
    ${vt} curr = v_tuple[o];
    for (size_t i = 0; i < vl; i++) {
      ${f.short==='_m'?`if (mask[i]) `:``}${mem_ref(f,'v_tuple')} %M= curr[i];${mem_mask_comment(f)}
    }
  }
  return res;`
}],
// segment fault-only-first load
[/vlseg\de\d+ff_/, (f) => { let [x,vt] = xparts(f.ret); return `
  INSTR{VLSET RES{}; BASE DST, (R_base), MASK; csrr R_new_vl, vl // or used as vl directly}
  VLMAX{${vt}}
  ${mem_align_comment(f,1)}
  RES{} res;
  ${f.short&&f.short.includes('m')?'if (mask[0]) ':''}for (int o = 0; o < ${x}; o++) base%M[o%M]; // for the side-effect of faulting
  // after this point, this instruction will never fault
  
  size_t new_vl = /* implementation-defined 1 ≤ new_vl ≤ vl */;
  for (int o = 0; o < ${x}; o++) {
    ${vt} curr;
    for (size_t i = 0; i < new_vl; i++) {
      curr[i] = MASK{${mem_ref(f)}};
    }
    
    for (size_t i = new_vl; i < vl; i++) curr[i] = MASK{anything()};
    BORING{for (size_t i = vl; i < vlmax; i++) curr[i] = TAIL{};}
    res[i] = curr;
  }
  return res;`
}],

// load, strided load, indexed load
[/_vl(s?e|[ou]xei)\d+_v_/, (f) => `
  INSTR{VLSET RES{}; BASE DST, (R_base)${hasarg(f,'bindex')?', R_bindex':''}${hasarg(f,'bstride')?', R_bstride':''}, MASK}
  VLMAX{RES{}}
  ${mem_align_comment(f,1)}
  RES{} res;
  ${mem_loop(f)}
    res[i] = MASK{${mem_ref(f)}};${mem_mask_comment(f)}
  }
  TAILLOOP{};
  return res;`
],

// store, stided store, indexed store
[/_vs(s?e|[ou]xei)\d+_v_/, (f) => `
  INSTR{VLSET FARG{value}; BASE R_value, (R_base)${hasarg(f,'bindex')?', R_bindex':''}${hasarg(f,'bstride')?', R_bstride':''}, MASK}
  VLMAX{FARG{value}}
  ${mem_align_comment(f,0)}
  ${mem_loop(f)}
    ${f.short==='_m'?`if (mask[i]) `:``}${mem_ref(f,'value')} %M= value[i];${mem_mask_comment(f)}
  }`
],

// mask load/store
[/_v[ls]m_v_/, (f) => { let b=+f.name.split('_v_b')[1]; let ld=f.name.includes('_vl'); return `
  INSTR{VLSET VLMAXBG{}; BASE ${ld? 'DST' : 'R_value'}, (R_base)${hasarg(f,'bindex')?', R_bindex':''}, MASK}
  VLMAXB{}
  VLMAX{}
  
  ${ld? `vuint8m1_t uints;` : `vuint8m1_t uints = (vuint8m1_t) value;`}
  for (size_t i = 0; i < ceil(vl/8); i++) {
    ${ld? `uints[i] = base%M[i%M]` : `base%M[i%M] %M= uints[i]`};
  }
  RMELN{}
  ${ld? `return (RES{}) uints;` : ``} RMELN{}`
}],

// fault-only-first
[/_vle\d+ff_v/, (f) => `
  INSTR{VLSET RES{}; BASE DST, (R_base), MASK; csrr R_new_vl, vl // or used as vl directly}
  VLMAX{RES{}}
  ${mem_align_comment(f,1)}
  RES{} res;
  ${f.short&&f.short.includes('m')?'if (mask[0]) ':''}base%M[0%M]; // for the side-effect of faulting
  // after this point, this instruction will never fault
  
  size_t new_vl = /* implementation-defined 1 ≤ new_vl ≤ vl */;
  for (size_t i = 0; i < new_vl; i++) {
    res[i] = MASK{base%M[i%M]};
  }
  
  for (size_t i = new_vl; i < vl; i++) res[i] = MASK{anything()};
  TAILLOOP{};
  return res;`
],

// shift
[/_vn?s(ll|ra|rl)_/, (f) => `
  INSTR{VLSET RES{}; BASE DST, R_op1, R_shift, MASK}
  VLMAX{FARG{op1}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${ocall(f.name.includes('_vn')?'trunc':'', tshort(f.ret), `op1[i] ${opmap(f)} (IDX{shift} & ${eparts(farg(f,'op1'))[0]-1})`)}};${/_vn?sr/.test(f.name)? ' // shifts in '+(f.name.includes('sra')? 'sign bits' : 'zeroes') : ''}
  }
  TAILLOOP{};
  return res;`
],

// reverse binary: rsub, rdiv
[/_vf?r(sub|div)_v[xf]_/, (f) => `
  INSTR{VLSET RES{}; BASE DST, R_op1, R_op2, MASK}
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${owd(f.ret, farg(f,'op2'), `op2`)} ${opmap(f)} ${owd(f.ret, farg(f,'op1'), `op1[i]`)}};
  }
  TAILLOOP{};
  return res;`
],

// high half of multiplication
[/_vmulh/, (f) => `
  INSTR{VLSET RES{}; BASE DST, R_op1, R_op2, MASK}
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{(${owdm(2, farg(f,'op1'), `op1[i]`)} * ${owdm(2, farg(f,'op2'), `IDX{op2}`)}) >> ${farg(f,'op1').match(/\d+/)[0]}};
  }
  TAILLOOP{};
  return res;`
],

// sign injection
[/_vfsgnj/, (f) => { let w=+f.ret.type.match(/\d+/)[0]; let u='uint'+w+'_t'; let n=f.name.includes('sgnjx')?2:f.name.includes('sgnjn')?1:0; return `
  INSTR{VLSET RES{}; BASE DST, R_op1, R_op2, MASK}
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
  return res;`
}],

// add-with-carry / subtract-with-borrow
[/_v(ad|sb)c_/, (f) => { let a=f.name.includes('_vadc'); let inn=(a?'carry':'borrow')+'in'; return `
  INSTR{VLSET RES{}; BASE DST, R_op1, R_op2, R_${inn}}
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = op1[i] ${'+ IDX{op2} +'.replace(/\+/g,a?'+':'-')} (${inn} ? 1 : 0);
  }
  TAILLOOP{};
  return res;`
}],

// mask out of add-with-carry / subtract-with-borrow
[/_vm(ad|sb)c_/, (f) => { let a=f.name.includes('_vmadc'); let inn = f.args.length==3? '' : (a?'carry':'borrow')+'in'; return `
  INSTR{VLSET FARG{op1}; BASE DST, R_op1, R_op2${inn? ', R_'+inn : ''}}
  VLMAX{FARG{op1}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    intinf_t exact = uintinf(op1[i]) ${`+ uintinf(IDX{op2})${inn? ` + (${inn} ? 1 : 0)` : ''}`.replace(/\+/g,a?'+':'-')};
    res[i] = ${a? 'exact ≥ '+maxval(farg(f,'op1').replace(/^vi/,'vui')) : 'exact < 0'};
  }
  TAILLOOP{};
  return res;`
}],

// reductions
[/vf?w?red(?!usum)/, (f) => { let [ew, lm] = vparts(farg(f,'vector')); let ovlen = 2**(2*ew) / (lm * 2**ew); return `
  INSTR{VLSET FARG{vector}; BASE DST, R_vector, R_scalar, MASK}
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
  return res_vec;`
}],

[/_vfw?redusum/, (f) => { let m=f.short&&f.short.includes('m'); return `
  INSTR{VLSET FARG{vector}; BASE DST, R_vector, R_scalar, MASK}
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
  return res;`
}],

// saturating add/sub
[/_vs(add|sub)u?_v[vx]_/, (f) => `
  INSTR{VLSET RES{}; BASE DST, R_op1, R_op2, MASK}
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    intinf_t exact = intinf(op1[i]) ${opmap(f)} intinf(IDX{op2});
    res[i] = clip(${tshort(f.ret)}, exact); // may set RVV_VXSAT
  }
  TAILLOOP{};
  return res;`
],

// comparison
[/_vm[fs](lt|le|gt|ge|eq|ne)u?_/, (f) => { let fl=farg(f,'op1')[1]=='f'; let mf=fl&&f.short; let nt = '=!'.includes(opmap(f)[0])? "isSNaN" : "isNaN"; return `
  INSTR{VLSET FARG{op1}; ${(()=>{
    let vv = f.name.includes('_vv_');
    let ge = f.name.includes('vmsge');
    let gt = f.name.includes('vmsgt');
    let u = f.name.includes('u_v')? 'u' : '';
    if (gt? !vv : !ge) return 'BASE DST, R_op1, R_op2, MASK';
    if (ge && vv) return 'vmsle'+u+'.vv DST, R_op2, R_op1, MASK';
    if (gt && vv) return 'vmslt'+u+'.vv DST, R_op2, R_op1, MASK';
    if (ge && !vv) return 'vmslt'+u+'.vx DST, R_op1, R_op2, MASK; vmnot.m DST, DST // better sequences exist if op2 is a constant';
    return '???';
  })()}}
  VLMAX{FARG{op1}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    ${mf? 'MASKWEE{}' : ''} RMELN{}
    res[i] = ${mf?'':'MASK{'}op1[i] ${opmap(f)} IDX{op2}${mf?'':'}'};
    ${fl? boring(`if (${nt}(op1[i]) || ${nt}(IDX{op2})) ${raise_invalid}`) : ''} RMELN{}
  }
  TAILLOOP{};
  return res;`
}],

// broadcast
[/_vmv_v_x_|_vfmv_v_f_/, `
  INSTR{VLSET RES{}; BASE DST, R_src}
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = src;
  }
  TAILLOOP{};
  return res;`
],

// set first
[/_vmv_s_x_|_vfmv_s_f_/, `
  INSTR{VLSET RES{}; BASE DST, R_src}
  VLMAX{RES{}}
  RES{} res;
  if (vl > 0) {
    res[0] = src;
    TAILLOOP{1};
  } else {
    res = TAILV{}
  }
  return res;`
],

// get first
[/_vfmv_f_s_|_vmv_x_s_/, (f) => { let elt=tshort(f.ret); return `
  INSTR{VLSET FARG{src}; BASE DST, R_src${elt=='u8'? '; zext.b DST,DST' : elt=='u16'||elt=='u32'? `; slli DST, DST, ${64-elt.slice(1)}; srli DST, DST, ${64-elt.slice(1)}` : ''}}
  return src[0];`
}],

// gather
[/vrgather_vx_/, (f) => `
  INSTR{VLSET RES{}; BASE DST, R_op1, R_index, MASK}
  VLMAX{RES{}}
  RES{} res;
  RESE{} val = index ≥ vlmax ? ${f.ret.type.includes('fl')? '+0.0' : '0'} : op1[index];
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{val};
  }
  TAILLOOP{};
  return res;`
],
[/vrgather(ei16)?_vv_/, (f) => `
  INSTR{VLSET RES{}; BASE DST, R_op1, R_${argn(f,'index','op2')}, MASK}
  RES{} res;
  VLMAX{RES{}}
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{index[i] ≥ vlmax ? ${f.ret.type.includes('fl')? '+0.0' : '0'} : op1[index[i]]}; // allows indexing in op1 past vl
  }
  TAILLOOP{};
  return res;`
],

// compress
[/_vcompress_/, `
  INSTR{VLSET RES{}; BASE DST, R_src, R_mask, MASK}
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
  return res;`
],

// slide
[/vf?slide1(up|down)/, (f) => { let d=f.name.includes("down"); return `
  INSTR{VLSET RES{}; BASE DST, R_src, R_value, MASK}
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
  return res;`
}],
[/vslideup/, (f) => { let d=f.name.includes("down"); return `
  INSTR{VLSET RES{}; BASE DST, R_src, R_offset, MASK}
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
  return res;`
}],
[/vslidedown/, (f) => { let d=f.name.includes("down"); return `
  INSTR{VLSET RES{}; BASE DST, R_src, R_offset, MASK}
  VLMAX{RES{}}
  BORING{offset = min(offset, vl);}
  
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{i+offset ≥ vlmax ? 0 : src[i+offset]};
  }
  
  TAILLOOP{};
  return res;`
}],

// merge / blend
[/_vf?merge_/, `
  INSTR{VLSET RES{}; BASE DST, R_op1, R_op2, R_mask}
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = mask[i] ? IDX{op2} : op1[i];
  }
  TAILLOOP{};
  return res;`
],

// vid
[/_vid_/, `
  INSTR{VLSET RES{}; BASE DST, MASK}
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{i};
  }
  TAILLOOP{};
  return res;`
],

// viota
[/_viota_/, `
  INSTR{VLSET RES{}; BASE DST, R_op1, MASK}
  VLMAX{RES{}}
  RES{} res;
  size_t c = 0;
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    res[i] = c;
    if (op1[i]) c++;
  }
  TAILLOOP{};
  return res;`
],

// reinterpret
[/_vreinterpret_/, `return reinterpret(RES{}, src);`],

// integer min/max
[/_v(min|max)u?_[vw][vx]_/, (f) => `
  INSTR{VLSET RES{}; BASE DST, R_op1, R_op2, MASK}
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${f.name.includes('min')?'min':'max'}(op1[i], IDX{op2})};
  }
  TAILLOOP{};
  return res;`
],

// float min/max
[/_vf(min|max)_v[vf]_/, (f) => `
  INSTR{VLSET RES{}; BASE DST, R_op1, R_op2, MASK}
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
  return res;`
],

// unary same-width things
[/_vf?neg_|_vfrsqrt7_|_vfsqrt_|_vfrec7_|_vfabs_|_vnot_|_vmv_v_v_/, (f) => {let n=(c)=>f.name.includes(c); return `
  INSTR{VLSET RES{}; BASE DST, R_${argn(f,'op1','src')}, MASK}
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${ocall(n('vmv')?'':n('neg')?'-':n('not')?'~':n('rsqrt7')?'reciprocal_sqrt_estimate':n('rec7')?'reciprocal_estimate':n('sqrt')?'sqrt':n('abs')?'abs':'??', `op1[i]`)}};${n("7")? ' // 7 MSB of precision' : n('abs')? ' // abs(-0.0) is +0.0' : ''}
  }
  TAILLOOP{};
  return res;`
}],

// sign-extend, zero-extend, widen, convert
[/[sz]ext|_vf?w?cvtu?_/, (f) => { let op=argn(f,'src','op1'); let [rw,rq]=eparts(f.ret); let [ow,oq]=eparts(farg(f,op)); return  `
  INSTR{VLSET ${f.name.includes('ext_')? 'RES{}' : farg(f,op)}; BASE DST, R_${op}, MASK}
  VLMAX{${farg(f,op)}}
  ${f.name.includes('_rtz_')?`local_rounding_mode = RTZ; // Round towards zero`:``} RMELN{}
  
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${rw==ow || oq=='f'&&rq!='f'? ocall('convert',tshort(f.ret),op+'[i]') : owd(f.ret, '', op+'[i]')}};
  }
  TAILLOOP{};
  return res;`
}],

// narrow
[/_vf?ncvt_/, (f) => `
  INSTR{VLSET RES{}; BASE DST, R_src, MASK}
  VLMAX{FARG{src}}
  ${f.name.includes('_rod_')?`local_rounding_mode = ROUND_TOWARDS_ODD;`:``} RMELN{}
  
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${f.name.includes('_vf')?'round':'trunc'}(${tshort(f.ret)}, op1[i]})};
  }
  TAILLOOP{};
  return res;`
],


// float classify
[/vfclass/, (f) => `
  INSTR{VLSET RES{}; BASE DST, R_op1, MASK}
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
  return res;`
],

// mask bitwise ops
[/_mm_|_vm(not|mv|set|clr)_m_/, (f) => `
  INSTR{VLSET VLMAXBG{}; BASE DST${hasarg(f,'op1')? ', R_op1' : ''}${f.name.includes('_mm_')? ', R_op2' : ''}}
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
  return res;`
],

// mask fancy ops
[/_vfirst_m_/, (f) => `
  INSTR{VLSET VLMAXBG{}; BASE DST, R_op1, MASK}
  VLMAXB{}
  VLMAX{}
  for (size_t i = 0; i < vl; i++) {
    if (${f.short?'mask[i] && ':''}op1[i]) return i;
  }
  return -1;`
],
[/_vcpop_m_/, (f) => `
  INSTR{VLSET VLMAXBG{}; BASE DST, R_op1, MASK}
  VLMAXB{}
  VLMAX{}
  RES{} res = 0;
  for (size_t i = 0; i < vl; i++) {
    if (${f.short?'mask[i] && ':''}op1[i]) res++;
  }
  return res;`
],
[/vms[bio]f_m_/, (f) => { let n = f.name.includes("vmsbf")? 0 : f.name.includes("vmsif")? 1 : 2; return `
  INSTR{VLSET VLMAXBG{}; BASE DST, R_op1, MASK}
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
  return res;`
}],

// averaging add/sub
[/_va(add|sub)u?_/, (f) => `
  INSTR{VLSET RES{}; INIT csrwi vxrm, <vxrm>; BASE DST, R_op1, R_op2, MASK}
  VLMAX{RES{}}
  RES{} res;
  
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    intinf_t exact = intinf(op1[i]) ${opmap(f)} intinf(IDX{op2});
    res[i] = trunc(${tshort(f.ret)}, rounded_shift_right(intinf_t, exact, 1, vxrm)};
  }
  TAILLOOP{};
  return res;`
],

// rounding shift
[/_vssr[al]_/, (f) => `
  INSTR{VLSET RES{}; INIT csrwi vxrm, <vxrm>; BASE DST, R_op1, R_shift, MASK}
  VLMAX{RES{}}
  RES{} res;
  
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    res[i] = rounded_shift_right(${eltype(f.ret)}, op1[i], IDX{shift} & ${eparts(f.ret)[0]-1}, vxrm);
  }
  TAILLOOP{};
  return res;`
],

// narrowing clip
[/_vnclipu?_/, (f) => `
  INSTR{VLSET RES{}; INIT csrwi vxrm, <vxrm>; BASE DST, R_op1, R_shift, MASK}
  VLMAX{FARG{op1}}
  RES{} res;
  
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    ${eltype(farg(f,'op1'))} tmp = rounded_shift_right(${eltype(farg(f,'op1'))}, op1[i], IDX{shift} & ${eparts(f.ret)[0]-1}, vxrm);
    res[i] = clip(${tshort(f.ret)}, tmp); // may set RVV_VXSAT
  }
  TAILLOOP{};
  return res;`
],

// rounding & saturating multiply
[/_vsmul_/, (f) => `
  VLMAX{RES{}}
  INSTR{VLSET RES{}; INIT csrwi vxrm, <vxrm>; BASE DST, R_op1, R_op2, MASK}
  RES{} res;
  
  for (size_t i = 0; i < vl; i++) {
    MASKWEE{} RMELN{}
    intinf_t exact = intinf(op1[i]) * intinf(IDX{op2});
    intinf_t tmp = rounded_shift_right(intinf_t, exact, ${eparts(f.ret)[0]-1}, vxrm);
    res[i] = clip(${tshort(f.ret)}, tmp); // may set RVV_VXSAT
  }
  TAILLOOP{};
  return res;`
],

// setvl
[/_vsetvl_/, (f) => { let t = f.name.split('vsetvl_')[1].replace('e','vint')+'_t'; return `
  INSTR{VLSET ${t}}
  vlmax = VLMAXG{${t}};
  if (avl ≤ vlmax) {
    return avl;
  } else if (vlmax < avl ≤ vlmax*2) {
    return /* implementation-defined number in [ceil(avl/2), vlmax] inclusive */
  } else {
    return vlmax;
  }`
}],
[/_vsetvlmax_/, (f) => { let t = f.name.split('vsetvlmax_')[1].replace('e','vint')+'_t'; return `
  INSTR{VLSET ${t}}
  return VLMAXG{${t}};`
}],

];

let miniHTMLEscape = (c) => c.replace(/&/g, '&amp;').replace(/<(?!span)/g, '&lt;'); // allow intentional inline HTML usage, but escape most things
let cleanup = (c) => miniHTMLEscape(c.replace(/\n  /g, "\n").replace(/^(\n *)+\n/, ""));
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
  ${tfull(t)} clip(${t}, intinf_t exact) {
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
  EEW = ${e}; // element width in bits
  EMUL = ${l.replace('f','1/')}; // register group size
  vlmax = EMUL*VLEN/EEW = VLEN${frac<1? '/'+(1/frac) : '*'+frac};
  
  // examples:
${[32,64,128,256,512,1024,65536].filter(v => v*frac>=1).map(v => `  //   VLEN=${(v+':').padEnd(6)} vlmax = ${v*frac}`).join('\n')} - maximum possible
  
${equalTo? `  // vlmax(e${e}, m${l}) is equal to:\n${equalTo}` : ``}
`)}

case 'rounded_shift_right': {
  let [t] = args;
  t = t.slice(1);
  return helper_code(`
  ${t} rounded_shift_right(${t} x, size_t shift, unsigned int vxrm) {
    if (shift == 0) return x;
    
    ${t} last = 1 << (shift-1); // mask of the most-significant shifted out bit
    bool carry = (x&last)!=0; // the value of the most-significant shifted out bit
    
    bool shiftLSB = ((x >> shift) & 1) != 0; // least-significant bit of a rounded-down shift
    
    bool increment;
    switch (vxrm) {
      case __RISCV_VXRM_RNU: { // vxrm == 0; round to nearest up
        increment = carry;
        break;
      }
      case __RISCV_VXRM_RNE: { // vxrm == 1; round to nearest even
        increment = carry && ((x&(last-1)) != 0 || shiftLSB); // x[shift-1] && (x[shift-2:0]!=0 || x[shift])
        break;
      }
      case __RISCV_VXRM_RDN: { // vxrm == 2; round down
        increment = false; // i.e. result is just a regular x >> shift
        break;
      }
      case __RISCV_VXRM_ROD: { // vxrm == 3; round to odd
        increment = (x & ((1<<shift)-1) != 0) && !shiftLSB; // !x[shift] && x[shift-1:0]!=0
        break;
      }
    }
    return (x >> shift) + (increment ? 1 : 0);
  }`)}

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
  
  if (ent==undefined) return undefined;
  let s = ent[1];
  let fn = v || o;
  if (typeof s === 'function') s = cleanup(s(fn));
  
  let vsi = v===undefined? (c)=>false : (c) => v.short.includes(c); // variation short includes
  
  let mask = !vsi("m")? 0 : vsi("mu")? 2 : 1; // 0: no masking; 1: agnostic; 2: undisturbed
  let tail = !vsi("tu"); // 0: undisturbed; 1: agnostic
  let basev = hasarg(fn, "maskedoff")? "maskedoff" : hasarg(fn, "vd")? "vd" : fn.name.includes("slideup")? "dest" : "";
  let baseeM = basev? basev+(farg(fn,basev).includes('x')? '[o]' : '')+'[i]' : '';
  let baseeT = fn.ret.type.includes("bool")? "" : baseeM;
  
  let agnBase0 = (agn,base) => agn? (base? `agnostic(${base})` : "anything()") : `${base}`;
  let agnBaseM= (agn,base) => boring(agnBase0(agn, baseeM));
  let agnBaseT= (agn,base) => boring(agnBase0(agn, baseeT));
  
  s = s.replace(/%M([=*\[\]])/g, (_,c) => `<span class="op-load">${c}</span>`); // memory ops
  s = s.replace(/RES{}/g, o.ret.type); // return type
  s = s.replace(/RESE{}/g, eltype(o.ret)); // result element
  s = s.replace(/FARG{(.*?)}/g, (_,c) => farg(fn,c)); // find argument with given name
  s = s.replace(/VLMAXBG{}/g, c => { let b = +o.name.split('_b')[1]; return `vint8m${b<8? 8/b : 'f'+(b/8)}_t`; });
  s = s.replace(/VLMAXB{}/g, c => { let b = +o.name.split('_b')[1]; return `BORING{vlmax = VLEN/${b};} // equal to VLMAXG{vint8m${b<8? 8/b : 'f'+(b/8)}_t}`});
  s = s.replace(/VLMAX(G?){(.*?)}/g, (_,g,c) => {
    let v = 'vlmax' + (c? '(' + vparts(c).reduce((e,m) => `e${e}, ${fmtmul(m)}`) + ')' : '');
    // return g? v : boring(`vl = min(vl, ${v});`); // possibly the intention, but idk
    return g? v : boring(`assume(vl ≤ ${v});`);
  });
  
  // generate assembler instruction
  let instrArr = undefined;
  let procInstr = (all) => {
    let post;
    let test = (p) => all.startsWith(p)? (post=all.slice(p.length), 1) : 0;
    if (test('VLSET ')) { // automated vlseti generation from intrinsic name & given type
      let [ew,lm] = vparts(post);
      let setter = fn.name.includes('_vsetvl');
      let vl = setter? (hasarg(fn,'avl')? 'x[avl]' : 'zero') : hasarg(fn,'vl')? 'x[vl]' : '0';
      return [0, `vset${vl==='0'?'i':''}vli ${setter? 'xd' : 'zero'}, ${vl}, e${ew}, m${lm<1? 'f'+(1/lm) : lm}, ${tail?'ta':'tu'}, ${mask==2?'mu':'ma'}`];
    }
    if (test('INIT ')) {
      return [0, procInstr(post)[1]];
    }
    all = all.replace(/\bBASE\b/, () => o.name.replace('__riscv_','').split(/_([iuf]\d+mf?\d+(x\d+)?|b\d+)+(_|$)/)[0].replace(/_/g,'.')); // base assembly instruction name
    all = all.replace(/, MASK/, () => mask? ', v0.t' : ''); // mask argument if policy asks for it
    all = all.replace(/\bR_(\w+)\b/g, (_,c) => { let t = farg(fn,c)[0]; return (t=='v'? 'v' : t=='f'? 'f' : 'x')+'['+c+']'; }); // argument registers
    all = all.replace(/\bDST\b/g, basev? `v[${basev}]` : `vd`); // destination register
    return [1, all];
  }
  s = s.replace(/ *INSTR{(.*)} *\n/, (_,c) => {
    instrArr = c.split("; ").map(procInstr);
    if (instrArr.length==1) instrArr[0][0] = 1;
    return '';
  });
  
  s = s.replace(/TAILLOOP{(.*?)};?/g, (_,c) => boring(`for (size_t i = ${c?c:'vl'}; i < vlmax; i++) res[i] = TAIL{};`));
  s = s.replace(/TAIL{}/g, agnBaseT(tail)); // tail element
  s = s.replace(/TAILV{}/g, agnBase0(tail,basev)); // tail vector
  
  s = s.replace(/^( *)MASKWEE{}.*\n/gm, (_,c) => !mask? "" : boring(`${c}if (!mask[i]) {\n${c}  res[i] = ${agnBaseM(mask==1)};\n${c}  continue;\n${c}}\n`)); // mask write early exit
  s = s.replace(/BORING{(.*?)}/g, (_,c) => boring(c));
  s = s.replace(/IDX{(.*?)}/g, (_,c) => isvec(farg(fn,c))? c+"[i]" : c);
  s = s.replace(/MASK{(.*?)}/g, (_,c) => {
    if (!mask) return c;
    if (c == agnBase0(mask==1, baseeM)) return c; // prevent pointless things like `mask[i] ? anything() : anything()`
    return `${boring(`mask[i] ?`)} ${c} ${boring(':')} ${agnBaseM(mask==1)}`
  });
  
  s = s.replace(/\/\/.*|\/\*.*?\*\//g, c => boring(c));
  while (1) {
    let p = s;
    s = s.replace(/^ *RMELN{} *\n/gm, ""); // remove empty line
    if (s==p) break;
  }
  s = s.replace(/ *RMELN{} */gm, "");
  
  // helper function display
  let h = (name, args='') => `<a onclick="rvv_helper('${name}',${args})">${name}</a>`;
  
  // non-trivial helper functions
  s = s.replace(/\bclip\(([ui]\d+), /g, (_, t) => h('clip',`'${t}'`)+`(${t}, `);
  s = s.replace(/\bvlmax(\(e(\d+), m(f?\d+)\))/g, (_,a, e,m) => h('vlmax',`${+e},'${m}'`)+a);
  s = s.replace(/\brounded_shift_right\((\w+), /g, (_,a) => h('rounded_shift_right', `'x${a}'`)+'('); // prepended x to prevent intinf_t being matched
  
  // simpler helper functions & values
  s = s.replace(/\b(anything|agnostic|u?intinf|is[SQ]?NaN)\(/g, (_,c) => h(c)+'(');
  s = s.replace(/\b(intinf_t)\b/g, (_,c) => h(c));
  
  if (extra_test) {
    let ms = defs.filter(c => c[0].test(name));
    if (ms.length != 1) console.warn(`multiple matches for ${fn.name}: ${ms.map(c=>c[0]).join(', ')}`);
    if (instrArr) {
      
      // compare vsetvl setup with known
      if (o.implInstrRaw) {
        let setvl = instrArr.map(c=>c[1]).filter(c => c.includes('vset'))[0];
        if (setvl) {
          let setvl0 = o.implInstrRaw.split('\n').filter(c => c.includes('vset'))[0];
          let process = (c) => {
            c = c.split(/, ?e/)[1].replace(/ /g,'');
            if (v) c = c.replace(/,t.,m./, ''); // variations shouldn't compare their policies with the base
            return c;
          }
          if (process(setvl) != process(setvl0)) throw new Error(`bad setvl for ${fn.name}: known '${process(setvl0)}', generated '${process(setvl)}'`);
        }
        if (!v) {
          let prep = (c) => c.map(c=>c.split(' ')[0]).sort().filter(c=>!/^vf?mv|^sd$/.test(c));
          let knownStarts = o.implInstrRaw.split('\n');
          knownStarts = knownStarts.slice(knownStarts.findIndex(c => c.startsWith('vset')));
          knownStarts = prep(knownStarts);
          let genStarts = prep(instrArr.map(c=>c[1]));
          if (knownStarts.join(' ') != genStarts.join(' ')) {
            if (!/vneg|_vncvt_x_x_w|_vmfg[et]_vv|vmv_x_s_u32/.test(fn.name)) { // assembler pseudoinstruction & zero-extension differences
              console.warn('mismatched known & generated instr bases for '+fn.name);
            }
          }
        }
      }
      
      // verify all arguments of the intrinsic are present somewhere in the result
      let allInstrs = instrArr.map(c=>c[1]).join('');
      fn.args.map(c=>c.name).filter(c=>c!='vl' && c!='mask').forEach(a => {
        if (!allInstrs.includes(a)) throw new Error('argument '+a+' not used in '+fn.name);
      });
      
      // make sure masking is included
      if ((mask!=0) != allInstrs.includes('v0.t')) throw new Error('bad mask in '+fn.name);
    }
  }
  
  return {
    oper: s,
    instrSearch: !instrArr? undefined : instrArr.map(c=>c[1]).join('\n'),
    instrHTML: !instrArr? undefined : instrArr.map(([i,c]) => i? c.replace(/\/\/.*/, boring) : boring(c)).join('\n'),
  };
}};