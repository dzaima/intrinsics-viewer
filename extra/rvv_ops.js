'use strict';

const extra_test = false;

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
  return [T.includes('bool')? 1 : +T.match(/\d+/)[0], T[0]];
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
  throw new Error("Expected "+fn.name+" to have an argument named "+names.join(' or '));
}
function farg(fn, ...names) { // type of argn(fn, ...names)
  let name = argn(fn, ...names);
  let r = fn.args.find(c => c.name === name);
  if (!r) throw new Error("Expected "+fn.name+" to have an argument named "+names.join(' or '));
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

let immArgMap = {
  'vadc.vxm':      ['vadc.vim'],
  'vadd.vx':       ['vadd.vi'],
  'vsub.vx':       ['vadd.vi', -15, 16],
  'vand.vx':       ['vand.vi'],
  'vmadc.vx':      ['vmadc.vi'],
  'vmadc.vxm':     ['vmadc.vim'],
  'vmerge.vxm':    ['vmerge.vim'],
  'vmseq.vx':      ['vmseq.vi'],
  'vmsgt.vx':      ['vmsgt.vi'],
  'vmslt.vx':      ['vmsle.vi', -15, 16],
  'vmsgtu.vx':     ['vmsgtu.vi'],
  'vmsle.vx':      ['vmsle.vi'],
  'vmsleu.vx':     ['vmsleu.vi'],
  'vmsne.vx':      ['vmsne.vi'],
  'vmv.v.x':       ['vmv.v.i'],
  'vnclip.wx':     ['vnclip.wi', -1, 31],
  'vnclipu.wx':    ['vnclipu.wi', -1, 31],
  'vnsra.wx':      ['vnsra.wi', -1, 31],
  'vnsrl.wx':      ['vnsrl.wi', -1, 31],
  'vor.vx':        ['vor.vi'],
  'vrgather.vx':   ['vrgather.vi', -1, 31],
  'vrsub.vx':      ['vrsub.vi'],
  'vsadd.vx':      ['vsadd.vi'],
  'vsaddu.vx':     ['vsaddu.vi'],
  'vslidedown.vx': ['vslidedown.vi', -1, 31],
  'vslideup.vx':   ['vslideup.vi', -1, 31],
  'vsll.vx':       ['vsll.vi', -1, 31],
  'vsra.vx':       ['vsra.vi', -1, 31],
  'vsrl.vx':       ['vsrl.vi', -1, 31],
  'vssra.vx':      ['vssra.vi', -1, 31],
  'vssrl.vx':      ['vssrl.vi', -1, 31],
  'vxor.vx':       ['vxor.vi'],
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
  if (/geu?$/.test(name)) return '>=';
  if (/leu?$/.test(name)) return '<=';
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
const fvhas = (f, t) => {
  if (!f || !f.short) return false;
  let p = f.short.split('_');
  if (p.includes(t)) return true;
  p = p[p.length-1];
  return p.includes(t);
}
const mem_mask_comment = (f) => fvhas(f, "m")? ` // masked-off indices won't fault` : ``;
const mem_align_comment = (f,l) => {
  // let a = eparts(l? f.ret : farg(f,'v_tuple','value'))[0]/8;
  // return a==1? `RMELN{}` : `// if the address of any executed ${l?'load':'store'} is not aligned to a${a==8?'n':''} ${a}-byte boundary, an address-misaligned exception may or may not be raised.`
  return '';
}
const mem_loop = (f) => `for (size_t i = 0; i < vl; i++) {`+(f.name.includes("uxei")? ` // note: "unordered" only applies to non-idempotent memory (e.g. MMIO), but otherwise the operation is still sequential` : ``)

function mapn(f, l) {
  let name = f.name;
  if (extra_test) {
    let c = 0;
    for (let i = 0; i < l.length; i+= 2) c+= l[i].test(name);
    if (c != 1) throw new Error(c+" matches in "+f.name);
  }
  for (let i = 0; i < l.length; i+= 2) {
    if (l[i].test(name)) return l[i+1];
  }
  throw new Error("didn't find in "+f.name);
}
function typeConvertCat(c) {
  let [rw, rq] = eparts(c.ret);
  let [aw, aq] = eparts(c.args[c.args[0].name=='mask'? 1 : 0]);
  let rf = rq=='f';
  let af = aq=='f';
  let w = rw>aw;
  let n = rw<aw;
  let wn = (w? 'widen' : n? 'narrow' : '??');
  let wc = (w? 'Wider result' : n? 'Narrower result' : 'Same-width result');
  if ( rf &&  af) return 'Conversion|Float '+wn;
  if (!rf && !af) return 'Conversion|Integer '+wn;
  if ( rf && !af) return 'Conversion|Integer to float|'+wc;
  if (!rf &&  af) return 'Conversion|Float to integer|'+wc;
}
function loadStoreCat(c) {
  let [_, l, strided, _2, ord, seg] = c.name.match(/_v([ls])(s)?(([ou])x)?(seg\d+)?ei?\d+_/);
  return 'Load/store|' + (seg? 'Segment|' : '') + (
    ord?
      `Indexed|${l=='l'? 'Load/gather' : 'Store/scatter'} ${ord=='o'?'ordered':'unordered'}`
    :
      (strided?'Strided|':'') + (l=='l'?'Load':'Store')
  );
}

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
[/_vf?w?(add|sub|mul|div|rem|and|or|xor)(s?u)?_[vw][vxf]_/, (f) => {
  let minew = Math.min(eparts(farg(f,'op1'))[0], eparts(farg(f,'op2'))[0]);
  
  return `
  REF{${mapn(f,[
    /_v(add|sub)/,     '_vector_single_width_integer_add_and_subtract',
    /_vw(add|sub)/,    '_vector_widening_integer_addsubtract',
    /_v(and|or|xor)_/, '_vector_bitwise_logical_instructions',
    /_vmul/,           '_vector_single_width_integer_multiply_instructions',
    /_v(div|rem)/,     '_vector_integer_divide_instructions',
    /_vwmul/,          '_vector_widening_integer_multiply_instructions',
    /_vf(add|sub)/,    '_vector_single_width_floating_point_addsubtract_instructions',
    /_vfw(add|sub)/,   '_vector_widening_floating_point_addsubtract_instructions',
    /_vf(mul|div)/,    '_vector_single_width_floating_point_multiplydivide_instructions',
    /_vfwmul/,         '_vector_widening_floating_point_multiply'])}}
  CAT{${mapn(f,[
    /_vadd/,     'Integer|Add|Same-width',
    /_vsub/,     'Integer|Subtract|Same-width',
    /_vwadd_/,   'Integer|Add|Widening signed',
    /_vwaddu_/,  'Integer|Add|Widening unsigned',
    /_vwsub_/,   'Integer|Subtract|Widening signed',
    /_vwsubu_/,  'Integer|Subtract|Widening unsigned',
    /_vdiv_/,    'Integer|Divide|Divide signed',
    /_vdivu_/,   'Integer|Divide|Divide unsigned',
    /_vrem_/,    'Integer|Divide|Remainder signed',
    /_vremu_/,   'Integer|Divide|Remainder unsigned',
    /_vwmul_/,   'Integer|Multiply|Widening signed',
    /_vwmulu_/,  'Integer|Multiply|Widening unsigned',
    /_vwmulsu_/, 'Integer|Multiply|Widening signed*unsigned',
    /_vand_/,    'Bitwise|AND',
    /_vor_/,     'Bitwise|OR',
    /_vxor_/,    'Bitwise|XOR',
    /_vmul/,     'Integer|Multiply|Same-width',
    /_vfadd/,    'Float|Add',
    /_vfsub/,    'Float|Subtract',
    /_vfwadd/,   'Float|Widen|Add',
    /_vfwsub/,   'Float|Widen|Subtract',
    /_vfmul/,    'Float|Multiply',
    /_vfdiv/,    'Float|Divide',
    /_vfwmul/,   'Float|Widen|Multiply'])}}
  INSTR{VLSET int${minew}${fmtmul(minew * vparts(farg(f,'op1')).reduce((lw,lm)=>lm/lw))}_t; FRMI0{}; BASE DST, R_op1, R_op2, MASK IMMALT{op2}; FRMI1{}}
  VLMAX{RES{}}
  FRM{}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${owdq(f.ret, farg(f,'op1'), `op1[i]`)} ${opmap(f)} ${owdq(f.ret, farg(f,'op2'), `IDX{op2}`)}};
  }
  TAILLOOP{};
  return res;`
}],

// multiply-add
[/_vf?w?n?m(acc|add|sub|sac)(su|us?)?_v[vxf]_/, (f) => `
  REF{${mapn(f,[
    /_vn?m/, '_vector_single_width_integer_multiply_add_instructions',
    /_vwm/, '_vector_widening_integer_multiply_add_instructions',
    /_vfn?m/, '_vector_single_width_floating_point_fused_multiply_add_instructions',
    /_vfwn?m/, '_vector_widening_floating_point_fused_multiply_add_instructions'])}}
  CAT{${mapn(f,[
    /_vn?m/, 'Integer|Multiply-add|Same-width',
    /_vwm/, 'Integer|Multiply-add|Widening',
    /_vfn?m/, 'Float|Fused multiply-add',
    /_vfwn?m/, 'Float|Widen|Fused multiply-add'])}}
  INSTR{VLSET ${farg(f,'vs2')}; FRMI0{}; BASE R_vd, R_${hasarg(f,'vs1')?'v':'r'}s1, R_vs2, MASK; FRMI1{}}
  VLMAX{RES{}}
  FRM{}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${
      [
        ['_vmacc_',   '(VS1 * vs2[i]) + vd[i]'],
        ['_vnmsac_', '-(VS1 * vs2[i]) + vd[i]'],
        ['_vmadd_',   '(vd[i] * VS1) + vs2[i]'],
        ['_vnmsub_', '-(vd[i] * VS1) + vs2[i]'],
        
        ['_vwmaccu_',  '(WD1 * WD2) + vd[i]'],
        ['_vwmacc_',   '(WD1 * WD2) + vd[i]'],
        ['_vwmaccsu_', '(WD1 * WD2) + vd[i]'],
        ['_vwmaccus_', '(WD1 * WD2) + vd[i]'],
        
        ['vfmacc',   '(VS1 * vs2[i]) + vd[i]'],
        ['vfnmacc', '-(VS1 * vs2[i]) - vd[i]'],
        ['vfmsac',   '(VS1 * vs2[i]) - vd[i]'],
        ['vfnmsac', '-(VS1 * vs2[i]) + vd[i]'],
        ['vfmadd',   '(vd[i] * VS1) + vs2[i]'],
        ['vfnmadd', '-(vd[i] * VS1) - vs2[i]'],
        ['vfmsub',   '(vd[i] * VS1) - vs2[i]'],
        ['vfnmsub', '-(vd[i] * VS1) + vs2[i]'],
        
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


// segment load, segment strided load, segment indexed load
[/vl(|s|[ou]x)seg\dei?\d+_/, (f) => { let [x,vt] = xparts(f.ret); return `
  REF{sec-aos}
  CAT{${loadStoreCat(f)}}
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
// segment store, segment stided store, segment indexed store
[/vs(|s|[ou]x)seg\dei?\d+_/, (f) => { let [x,vt] = xparts(farg(f,'v_tuple')); return `
  REF{sec-aos}
  CAT{${loadStoreCat(f)}}
  INSTR{VLSET FARG{v_tuple}; BASE R_v_tuple, (R_base)${hasarg(f,'bindex')?', R_bindex':''}${hasarg(f,'bstride')?', R_bstride':''}, MASK}
  VLMAX{${vt}}
  ${mem_align_comment(f,0)}
  for (int o = 0; o < ${x}; o++) {
    ${vt} curr = v_tuple[o];
    for (size_t i = 0; i < vl; i++) {
      ${fvhas(f,'m')?`if (mask[i]) `:``}${mem_ref(f,'v_tuple')} %M= curr[i];${mem_mask_comment(f)}
    }
  }
  return res;`
}],
// segment fault-only-first load
[/vlseg\de\d+ff_/, (f) => { let [x,vt] = xparts(f.ret); return `
  REF{sec-aos}
  CAT{Load/store|Segment|Fault-only-first load}
  INSTR{VLSET RES{}; BASE DST, (R_base), MASK; csrr R_new_vl, vl // or used as vl directly}
  VLMAX{${vt}}
  ${mem_align_comment(f,1)}
  RES{} res;
  ${fvhas(f,'m')?'if (mask[0]) ':''}for (int o = 0; o < ${x}; o++) base%M[o%M]; // for the side-effect of faulting
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
  REF{${mapn(f,[
    /_vle/, '_vector_unit_stride_instructions',
    /_vls/, '_vector_strided_instructions',
    /_vl[ou]/, '_vector_indexed_instructions'])}}
  CAT{${loadStoreCat(f)}}
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
  REF{${mapn(f,[
    /_vse/, '_vector_unit_stride_instructions',
    /_vss/, '_vector_strided_instructions',
    /_vs[ou]/, '_vector_indexed_instructions'])}}
  CAT{${loadStoreCat(f)}}
  INSTR{VLSET FARG{value}; BASE R_value, (R_base)${hasarg(f,'bindex')?', R_bindex':''}${hasarg(f,'bstride')?', R_bstride':''}, MASK}
  VLMAX{FARG{value}}
  ${mem_align_comment(f,0)}
  ${mem_loop(f)}
    ${fvhas(f,'m')?`if (mask[i]) `:``}${mem_ref(f,'value')} %M= value[i];${mem_mask_comment(f)}
  }`
],

// mask load/store
[/_v[ls]m_v_/, (f) => { let b=+f.name.split('_v_b')[1]; let ld=f.name.includes('_vl'); return `
  REF{_vector_unit_stride_instructions}
  CAT{Load/store|Mask}
  INSTR{VLSET VLMAXBG{}; BASE ${ld? 'DST' : 'R_value'}, (R_base)${hasarg(f,'bindex')?', R_bindex':''}, MASK}
  VLMAXB{}
  
  ${ld? `vuint8m1_t uints;` : `vuint8m1_t uints = (vuint8m1_t) value;`}
  for (size_t i = 0; i < ceil(vl/8); i++) {
    ${ld? `uints[i] = base%M[i%M]` : `base%M[i%M] %M= uints[i]`};
  }
  RMELN{}
  ${ld? `return (RES{}) uints;` : ``} RMELN{}`
}],

// fault-only-first
[/_vle\d+ff_v/, (f) => `
  REF{_unit_stride_fault_only_first_loads}
  CAT{Load/store|Fault-only-first load}
  INSTR{VLSET RES{}; BASE DST, (R_base), MASK; csrr R_new_vl, vl // or used as vl directly}
  VLMAX{RES{}}
  ${mem_align_comment(f,1)}
  RES{} res;
  ${fvhas(f,'m')?'if (mask[0]) ':''}base%M[0%M]; // for the side-effect of faulting
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
  REF{${f.name.includes('_vn')? '_vector_narrowing_integer_right_shift_instructions' : '_vector_single_width_shift_instructions'}}
  CAT{Bitwise|${mapn(f,[/_vsl/,'Shift left', /_vn?sra/,'Shift right|arithmetic', /_vn?srl/,'Shift right|logical'])}${f.name.includes('_vn')? ' narrowing' : ''}}
  INSTR{VLSET RES{}; BASE DST, R_op1, R_shift, MASK IMMALT{shift, FARG{op1}}}
  VLMAX{FARG{op1}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${ocall(f.name.includes('_vn')?'trunc':'', tshort(f.ret), `op1[i] ${opmap(f)} (IDX{shift} & ${eparts(farg(f,'op1'))[0]-1})`)}};${/_vn?sr/.test(f.name)? ' // shifts in '+(f.name.includes('sra')? 'sign bits' : 'zeroes') : ''}
  }
  TAILLOOP{};
  return res;`
],

// reverse arith: rsub, rdiv
[/_vf?r(sub|div)_v[xf]_/, (f) => `
  REF{${mapn(f,[
    /_vrsub/, '_vector_single_width_integer_add_and_subtract',
    /_vfrsub/, '_vector_single_width_floating_point_addsubtract_instructions',
    /_vfrdiv/, '_vector_single_width_floating_point_multiplydivide_instructions'])}}
  CAT{${mapn(f,[/_vrsub/,'Integer|Subtract|Same-width', /_vfrsub/,'Float|Subtract', /_vfrdiv/,'Float|Divide'])}}
  INSTR{VLSET RES{}; FRMI0{}; BASE DST, R_op1, R_op2, MASK IMMALT{op2}; FRMI1{}}
  VLMAX{RES{}}
  FRM{}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${owd(f.ret, farg(f,'op2'), `op2`)} ${opmap(f)} ${owd(f.ret, farg(f,'op1'), `op1[i]`)}};
  }
  TAILLOOP{};
  return res;`
],

// high half of multiplication
[/_vmulh/, (f) => `
  REF{_vector_single_width_integer_multiply_instructions}
  CAT{Integer|Multiply|${mapn(f,[/_vmulhsu_/,'High signed*unsigned', /_vmulhu_/,'High unsigned', /_vmulh_/,'High signed', /_vmul_/,'Same-width'])}}
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
  REF{_vector_floating_point_sign_injection_instructions}
  CAT{Float|Sign-injection}
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
  REF{_vector_integer_add_with_carry_subtract_with_borrow_instructions}
  CAT{Integer|Carry / borrow|${a? 'Add' : 'Subtract'}}
  INSTR{VLSET RES{}; BASE DST, R_op1, R_op2, R_${inn} IMMALT{op2}}
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
  REF{_vector_integer_add_with_carry_subtract_with_borrow_instructions}
  CAT{Integer|Carry / borrow|${a? 'Add carry-out' : 'Subtract borrow-out'}}
  INSTR{VLSET FARG{op1}; BASE DST, R_op1, R_op2${inn? ', R_'+inn : ''} IMMALT{op2}}
  VLMAX{FARG{op1}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    intinf_t exact = uintinf(op1[i]) ${`+ uintinf(IDX{op2})${inn? ` + (${inn} ? 1 : 0)` : ''}`.replace(/\+/g,a?'+':'-')};
    res[i] = ${a? 'exact > '+maxval(farg(f,'op1').replace(/^vi/,'vui')) : 'exact < 0'};
  }
  TAILLOOP{};
  return res;`
}],

// reductions
[/_vf?w?red(?!usum)/, (f) => {
  let [ew, lm] = vparts(farg(f,'vector'));
  let ovl = 2**(2*ew) / (2**ew);
  let ovlen = ovl*ew/lm;
  return `
  REF{${mapn(f,[
    /_vred/, 'sec-vector-integer-reduce',
    /_vwred/, 'sec-vector-integer-reduce-widen',
    /_vfred/, 'sec-vector-float-reduce',
    /_vfwred/, 'sec-vector-float-reduce-widen'])}}
  CAT{Fold|${mapn(f,[
    /vredsum/, 'Sum',
    /vwredsum/, 'Widening integer sum',
    /redmax/, 'Max',
    /redmin/, 'Min',
    /redand/, 'Bitwise and',
    /redor/, 'Bitwise or',
    /redxor/, 'Bitwise xor',
    /vfredosum/, 'Sequential sum',
    /vfwredosum/, 'Widening sequential sum'])}}
  INSTR{VLSET FARG{vector}; FRMI0{}; BASE DST, R_vector, R_scalar, MASK; FRMI1{}}
  VLMAX{FARG{vector}}
  FRM{}
  RESE{} res = scalar[0];
  for (size_t i = 0; i < vl; i++) {
    ${fvhas(f,'m')? 'if (mask[i]) ' : ''}res = ${red_op(f, 'res', owd(f.ret, farg(f,'vector'), 'vector[i]'))};${
      f.name.includes('osum')? ' // yes, sequential sum, rounding on each op'
      : f.name.includes('wredsum')? ` // note: can overflow if ${ovlen<=65536? `vl ≥ ≈${ovl} (VLEN ≥ ${ovlen}) or if ` : ``}scalar is large enough`
      : ``
    }
  }
  RES{} res_vec;
  res_vec[0] = res;
  BORING{for (size_t i = 1; i < VLMAXG{RES{}}; i++) res[i] = TAIL{};}
  return res_vec;`
}],

[/_vfw?redusum/, (f) => { let m=fvhas(f,'m'); return `
  REF{${f.name.includes('_vfw')? 'sec-vector-float-reduce-widen' : 'sec-vector-float-reduce'}}
  CAT{Fold|${f.name.includes('_vfw')? 'Widening tree' : 'Tree'} sum}
  INSTR{VLSET FARG{vector}; FRMI0{}; BASE DST, R_vector, R_scalar, MASK; FRMI1{}}
  // TL;DR: sum${m?' non-masked':''} elements in some implementation-defined order with
  //   implementation-defined intermediate types (at least RESE{})
  //   and some additive identities possibly sprinkled in
  VLMAX{FARG{vector}}
  
  FRM{}
  RESE{} additive_identity = ${fvhas(f,'rm')? 'frm' : 'dynamic_rounding_mode'}==__RISCV_FRM_RDN ? +0.0 : -0.0;
  
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
  REF{_vector_single_width_saturating_add_and_subtract}
  CAT{Fixed-point|Saturating ${f.name.includes('_vsadd')? 'add' : 'subtract'}|${/u_v[vx]_/.test(f.name)? 'Unsigned' : 'Signed'}}
  CAT{Integer|${f.name.includes('_vsadd')? 'Add' : 'Subtract'}|Saturating ${/u_v[vx]_/.test(f.name)? 'unsigned' : 'signed'}}
  INSTR{VLSET RES{}; BASE DST, R_op1, R_op2, MASK IMMALT{op2}}
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
  REF{${f.name.includes('_vmf')? '_vector_floating_point_compare_instructions' : '_vector_integer_compare_instructions'}}
  CAT{${f.name.includes('_vmf')? 'Float' : 'Integer'}|Compare|${/_vm(f|seq|sne)/.test(f.name)? '' : /_vm[a-z]+u_/.test(f.name)? 'Unsigned ' : 'Signed '}${opmap(f)}}
  INSTR{VLSET FARG{op1}; ${(()=>{
    let vv = f.name.includes('_vv_');
    let ge = f.name.includes('vmsge');
    let gt = f.name.includes('vmsgt');
    let u = f.name.includes('u_v')? 'u' : '';
    if (gt? !vv : !ge) return 'BASE DST, R_op1, R_op2, MASK IMMALT{op2}';
    if (ge && vv) return 'vmsle'+u+'.vv DST, R_op2, R_op1, MASK IMMALT{op2}';
    if (gt && vv) return 'vmslt'+u+'.vv DST, R_op2, R_op1, MASK IMMALT{op2}';
    if (ge && !vv) return 'vmslt'+u+'.vx DST, R_op1, R_op2, MASK IMMALT{op2}; vmnot.m DST, DST // better sequences exist if op2 is a constant';
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
[/_vmv_v_x_|_vfmv_v_f_/, (f) => `
  REF{${f.name.includes('_vfmv_v_f_')? 'sec-vector-float-move' : '_vector_integer_move_instructions'}}
  CAT{Initialize|Broadcast}
  INSTR{VLSET RES{}; BASE DST, R_src IMMALT{src}}
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = src;
  }
  TAILLOOP{};
  return res;`
],

// set first
[/_vmv_s_x_|_vfmv_s_f_/, (f) => `
  REF{${/_s_f_/.test(f.name)? '_floating_point_scalar_move_instructions' : '_integer_scalar_move_instructions'}}
  CAT{Initialize|Set first}
  INSTR{VLSET RES{}; BASE DST, R_src}
  VLMAX{RES{}}
  RES{} res;
  if (vl > 0) {
    res[0] = src;
    TAILLOOP{1};
  } else {
    res = TAILV{};
  }
  return res;`
],

// get first
[/_vfmv_f_s_|_vmv_x_s_/, (f) => { let elt=tshort(f.ret); return `
  REF{_integer_scalar_move_instructions}
  CAT{Permutation|Extract first}
  INSTR{VLSET FARG{src}; BASE DST, R_src${elt=='u8'? '; zext.b DST,DST' : elt=='u16'||elt=='u32'? `; slli DST, DST, ${64-elt.slice(1)}; srli DST, DST, ${64-elt.slice(1)}` : ''}}
  return src[0];`
}],

// gather
[/vrgather_vx_/, (f) => `
  REF{_vector_register_gather_instructions}
  CAT{Permutation|Broadcast one}
  INSTR{VLSET RES{}; BASE DST, R_op1, R_index, MASK IMMALT{index}}
  VLMAX{RES{}}
  RES{} res;
  RESE{} val = index >= vlmax ? ${f.ret.type.includes('fl')? '+0.0' : '0'} : op1[index];
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{val};
  }
  TAILLOOP{};
  return res;`
],
[/vrgather(ei16)?_vv_/, (f) => `
  REF{_vector_register_gather_instructions}
  CAT{Permutation|Shuffle|${f.name.includes('ei16')? '16-bit indices' : 'Equal-width'}}
  INSTR{VLSET RES{}; BASE DST, R_op1, R_index, MASK}
  VLMAX{RES{}}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{index[i] >= vlmax ? ${f.ret.type.includes('fl')? '+0.0' : '0'} : op1[index[i]]}; // ${
      (farg(f,'index').includes('int8')? 'warning: uint8 limits indices to ≤255, use vrgatherei16 to avoid; ' : '') + 'can index in op1 past vl'
    }
  }
  TAILLOOP{};
  return res;`
],

// compress
[/_vcompress_/, `
  REF{_vector_compress_instruction}
  CAT{Permutation|Compress}
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
  REF{${f.name.includes('1up')? '_vector_slide1up' : '_vector_slide1down_instruction'}}
  CAT{Permutation|Slide|${f.name.includes('1up')? 'Up' : 'Down'} 1}
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
  REF{_vector_slideup_instructions}
  CAT{Permutation|Slide|Up N}
  INSTR{VLSET RES{}; BASE DST, R_src, R_offset, MASK IMMALT{value}}
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
  REF{_vector_slidedown_instructions}
  CAT{Permutation|Slide|Down N}
  INSTR{VLSET RES{}; BASE DST, R_src, R_offset, MASK IMMALT{value}}
  VLMAX{RES{}}
  BORING{offset = min(offset, vl);}
  
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{i+offset >= vlmax ? 0 : src[i+offset]};
  }
  
  TAILLOOP{};
  return res;`
}],

// merge / blend
[/_vf?merge_/, (f) => `
  REF{${f.name.includes('m_f')? '_vector_floating_point_merge_instruction' : '_vector_integer_merge_instructions'}}
  CAT{Permutation|Merge}
  INSTR{VLSET RES{}; BASE DST, R_op1, R_op2, R_mask IMMALT{op2}}
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
  REF{_vector_element_index_instruction}
  CAT{Initialize|Element indices}
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
  REF{_vector_iota_instruction}
  CAT{Initialize|Cumulative indices}
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
[/_vreinterpret_/, (f) => {
  let [rw, rq] = eparts(f.ret);
  let [aw, aq] = eparts(farg(f,'src'));
  return `
  CAT{Conversion|Reinterpret|${rw==1||aw==1? 'Boolean' : rw==aw? 'Same LMUL & width' : 'Same LMUL & sign'}}
  return reinterpret(RES{}, src);`
}],

// integer min/max
[/_v(min|max)u?_[vw][vx]_/, (f) => `
  REF{_vector_integer_minmax_instructions}
  CAT{Integer|${f.name.includes('_vmin')? 'Min' : 'Max'}}
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
[/_vf(min|max)_v[vf]_/, (f) => { let min = f.name.includes('min'); return `
  REF{_vector_floating_point_minmax_instructions}
  CAT{Float|${f.name.includes('_vfmin')? 'Min' : 'Max'}}
  INSTR{VLSET RES{}; BASE DST, R_op1, R_op2, MASK}
  VLMAX{RES{}}
  RES{} res;
  // follows IEEE 754-2019 ${min?'minimum':'maximum'}Number, is commutative even for -0.0 and varying input NaN bit patterns
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
    } else {
      // considering -0.0 to be less than +0.0:
      res[i] = a ${min?'<':'>'} b ? a : b;
    }
  }
  TAILLOOP{};
  return res;`
}],

// unary same-width things
[/_vf?neg_|_vfrsqrt7_|_vfsqrt_|_vfrec7_|_vfabs_|_vnot_|_vmv_v_v_/, (f) => {
  let n=(c)=>f.name.includes(c);
  let mapped = mapn(f,[
    /_vnot_/,        ['Bitwise|NOT', '_vector_bitwise_logical_instructions'],
    /_vneg_/,        ['Integer|Negate', '_vector_single_width_integer_add_and_subtract'],
    /_vmv_v_v_[iu]/, ['Permutation|Move', '_vector_integer_move_instructions'],
    /_vfneg_/,       ['Float|Negate', '_vector_single_width_floating_point_addsubtract_instructions'],
    /_vfsqrt_/,      ['Float|Square root', '_vector_floating_point_square_root_instruction'],
    /_vfrsqrt7_/,    ['Float|Estimate reciprocal square-root', '_vector_floating_point_reciprocal_square_root_estimate_instruction'],
    /_vfrec7_/,      ['Float|Estimate reciprocal', '_vector_floating_point_reciprocal_estimate_instruction'],
    /_vfabs_/,       ['Float|Absolute', '_vector_floating_point_sign_injection_instructions'],
    /_vmv_v_v_f/,    ['Permutation|Move', 'sec-vector-float-move']])
  return `
  REF{${mapped[1]}}
  CAT{${mapped[0]}}
  INSTR{VLSET RES{}; FRMI0{}; BASE DST, R_${argn(f,'op1','src')}, MASK; FRMI1{}}
  VLMAX{RES{}}
  FRM{}
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${ocall(n('vmv')?'':n('neg')?'-':n('not')?'~':n('rsqrt7')?'reciprocal_sqrt_estimate':n('rec7')?'reciprocal_estimate':n('sqrt')?'sqrt':n('abs')?'abs':'??', argn(f,'op1','src')+'[i]')}};${n("7")? ' // 7 MSB of precision' : n('abs')? ' // abs(-0.0) is +0.0' : ''}
  }
  TAILLOOP{};
  return res;`
}],

// sign-extend, zero-extend, widen, convert
[/[sz]ext|_vf?[wn]?cvtu?_/, (f) => {
  let op=argn(f,'src','op1');
  let [rw,rq]=eparts(f.ret);      let rqf = rq=='f';
  let [ow,oq]=eparts(farg(f,op)); let oqf = oq=='f';
  
  return `
  REF{${mapn(f,[
    /_v[sz]ext/, '_vector_integer_extension',
    /_vfcvt_/, '_single_width_floating_pointinteger_type_convert_instructions',
    /_vwcvt/, '_vector_widening_integer_addsubtract',
    /_vfwcvt_/, '_widening_floating_pointinteger_type_convert_instructions',
    /_vfncvt_/, '_narrowing_floating_pointinteger_type_convert_instructions',
    /_vncvt/, '_vector_narrowing_integer_right_shift_instructions'])}}
  CAT{${f.name.includes('_vsext')? 'Integer|Sign-extend' : f.name.includes('_vzext')? 'Integer|Zero-extend' : typeConvertCat(f)}}
  INSTR{VLSET ${f.name.includes('ext_')? 'RES{}' : farg(f,op)}; FRMI0{}; BASE DST, R_${op}, MASK; FRMI1{}}
  VLMAX{${farg(f,op)}}
  FRM{}${'' /* TODO force-add local rounding mode for dynamic? */}
  ${f.name.includes('_rtz_')?`local_rounding_mode = RTZ; // Round towards zero`:``} RMELN{}
  ${f.name.includes('_rod_')?`local_rounding_mode = ROUND_TOWARDS_ODD;`:``} RMELN{}
  
  RES{} res;
  for (size_t i = 0; i < vl; i++) {
    res[i] = MASK{${
      rw<ow && !oqf && !rqf? ocall('trunc', op+'[i]')
      : rw>ow && !oqf && !rqf? owd(f.ret, '', op+'[i]')
      : ocall(rqf && oqf && rw<ow? 'round' : 'convert', tshort(f.ret), op+'[i]')
        
    }};${oqf && !rqf? ' // saturated, NaN behaves as +∞' : rw>ow && rqf? ' // lossless' : ''}
  }
  TAILLOOP{};
  return res;`
}],

// float classify
[/vfclass/, (f) => `
  REF{_vector_floating_point_classify_instruction}
  CAT{Float|Classify}
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
  REF{sec-mask-register-logical}
  CAT{Mask|${mapn(f,[/_vmandn/,'Logical|ANDN', /_vmnand/,'Logical|NAND', /_vmxnor/,'Logical|XNOR', /_vmand_/,'Logical|AND', /_vmclr/,'Zero', /_vmset/,'One', /_vmnor/,'Logical|NOR', /_vmnot/,'Logical|NOT', /_vmorn/,'Logical|ORN', /_vmxor/,'Logical|XOR', /_vmmv/,'Hint', /_vmor_/,'Logical|OR'])}}
  INSTR{VLSET VLMAXBG{}; BASE DST${hasarg(f,'op1')? ', R_op1' : ''}${f.name.includes('_mm_')? ', R_op2' : ''}}
  ${f.name.includes('vmmv')? '// hints that this will be used as a mask' : ''} RMELN{}
  VLMAXB{}
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
  REF{_vfirst_find_first_set_mask_bit}
  CAT{Mask|Find first set}
  INSTR{VLSET VLMAXBG{}; BASE DST, R_op1, MASK}
  VLMAXB{}
  for (size_t i = 0; i < vl; i++) {
    if (${fvhas(f,'m')?'mask[i] && ':''}op1[i]) return i;
  }
  return -1;`
],
[/_vcpop_m_/, (f) => `
  REF{_vector_count_population_in_mask_vcpop_m}
  CAT{Mask|Population count}
  INSTR{VLSET VLMAXBG{}; BASE DST, R_op1, MASK}
  VLMAXB{}
  RES{} res = 0;
  for (size_t i = 0; i < vl; i++) {
    if (${fvhas(f,'m')?'mask[i] && ':''}op1[i]) res++;
  }
  return res;`
],
[/vms[bio]f_m_/, (f) => { let n = f.name.includes("vmsbf")? 0 : f.name.includes("vmsif")? 1 : 2; return `
  REF{${mapn(f,[
    /_vmsbf/, '_vmsbf_m_set_before_first_mask_bit',
    /_vmsif/, '_vmsif_m_set_including_first_mask_bit',
    /_vmsof/, '_vmsof_m_set_only_first_mask_bit'])}}
  CAT{Mask|${mapn(f,[/_vmsbf/,'Set before first',/_vmsif/,'Set including first',/_vmsof/,'Set only first'])}}
  INSTR{VLSET VLMAXBG{}; BASE DST, R_op1, MASK}
  VLMAXB{}
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
  REF{_vector_single_width_averaging_add_and_subtract}
  CAT{Fixed-point|Averaging ${/_vasub/.test(f.name)?'subtract':'add'}|${/u_/.test(f.name)?'Unsigned':'Signed'}}
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
  REF{_vector_single_width_scaling_shift_instructions}
  CAT{Fixed-point|Scaling right shift|${/_vssra_/.test(f.name)? 'Arithmetic' : 'Logical'}}
  INSTR{VLSET RES{}; INIT csrwi vxrm, <vxrm>; BASE DST, R_op1, R_shift, MASK IMMALT{shift, FARG{op1}}}
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
  REF{_vector_narrowing_fixed_point_clip_instructions}
  CAT{Fixed-point|Saturating narrowing clip|${/clipu/.test(f.name)? 'Unsigned' : 'Signed'}}
  INSTR{VLSET RES{}; INIT csrwi vxrm, <vxrm>; BASE DST, R_op1, R_shift, MASK IMMALT{shift, FARG{op1}}}
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
  REF{_vector_single_width_fractional_multiply_with_rounding_and_saturation}
  CAT{Fixed-point|Fractional rounding & saturating multiply}
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
  REF{sec-vector-config}
  DESC{Returns a number less than or equal to <code>avl</code>, specifying how many elements of the given type should be processed.}
  CAT{Initialize|Set specific vl}
  INSTR{VLSET ${t}}
  vlmax = VLMAXG{${t}};
  if (avl <= vlmax) {
    return avl;
  } else if (vlmax < avl < vlmax*2) {
    return /* implementation-defined number in [ceil(avl/2), vlmax] inclusive */;
  } else {
    return vlmax;
  }`
}],
[/_vsetvlmax_/, (f) => { let t = f.name.split('vsetvlmax_')[1].replace('e','vint')+'_t'; return `
  REF{sec-vector-config}
  DESC{Returns the maximum number of elements of the specified type to process.}
  CAT{Initialize|Set max vl}
  INSTR{VLSET ${t}}
  return VLMAXG{${t}};`
}],
[/_vlmul_ext/, `
  DESC{Returns a vector whose low part is the argument, and the upper part is undefined.}
  CAT{Permutation|LMUL extend}
  OPER_UNDEF`
],
[/_vlmul_trunc/, `
  DESC{Returns a low portion of the argument.}
  CAT{Permutation|LMUL truncate}
  OPER_UNDEF`
],
[/_vundefined/, (f) => `
  DESC{Returns an undefined value of the specified type.}
  CAT{Initialize|Undefined|${f.name.includes('x')? 'Tuple' : 'Vector'}}
  OPER_UNDEF`
],

[/_vset_v_.+x/, `
  DESC{Creates a copy of the tuple with a specific element replaced.}
  CAT{Permutation|Tuple|Insert}
  OPER_UNDEF`
],
[/_vget_v_.+x/, `
  DESC{Extracts an element of the tuple.}
  CAT{Permutation|Tuple|Extract}
  OPER_UNDEF`
],
[/_vcreate_v_.+x/, `
  DESC{Creates a tuple from elements.}
  CAT{Permutation|Tuple|Create}
  OPER_UNDEF`
],

[/_vset_v_[^x]+$/, (f) => {
  let arg = farg(f,'val');
  let [wr,lr] = vparts(f.ret);
  let [wa,la] = vparts(arg);
  return `
  DESC{Inserts a lower-LMUL vector to part of a higher-LMUL one. This is equivalent to writing over part of the register group of the <code>desc</code> argument.}
  CAT{Permutation|Register group|Insert}
  size_t count = VLMAXG{${arg}}; // number of elements in val
  size_t off = count * index;
  
  RES{} res;
  for (size_t i = 0; i < off; i++) {
    res[i] = dest[i];
  }
  
  for (size_t i = 0; i < count; i++) {
    res[i + off] = src[i];
  }
  
  for (size_t i = off+count; i < count*${lr/la}; i++) { // count*${lr/la} == vlmax(res) == VLMAXG{RES{}}
    res[i] = dest[i];
  }`
}],
[/_vget_v_[^x]+$/, `
  DESC{Extracts a part of the register group of <code>src</code>.}
  CAT{Permutation|Register group|Extract}
  size_t count = VLMAXG{RES{}}; // number of elements in the result
  size_t off = count * index;
  
  RES{} res;
  for (size_t i = 0; i < count; i++) {
    res[i] = src[off + i];
  }`
],
[/_vcreate_v_[^x]+$/, (f) => {
  let arg = farg(f,'v0');
  let [wr,lr] = vparts(f.ret);
  let [wa,la] = vparts(arg);
  return `
  DESC{Creates a vector from subregisters.}
  CAT{Permutation|Register group|Create}
  size_t count = VLMAXG{${arg}}; // number of elements in each argument
  
  RES{} res;
  ${new Array(lr/la).fill().map((_,j) =>
    `for (size_t i = 0; i < count; i++) res[i${j==0? `` : j==1? ` + count` : ` + count*${j}`}] = v${j}[i];`
  ).join('\n')}`
}],
];

let miniHTMLEscape = (c) => c.replace(/&/g, '&amp;').replace(/<(?!\/?(span|code))/g, '&lt;'); // allow intentional inline HTML usage, but escape most things
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
initialized: () => {
  if (extra_test) {
    for (let [k,v] of Object.entries(immArgMap)) {
      if (!v.used) console.warn(`unused immArgMap for ${k} → ${v}`);
    }
  }
},

helper: (n, ...args) => {
switch(n) {
case 'clip': {
  let [t] = args;
  return helper_code(`
  ${tfull(t)} clip(${t}, intinf_t exact) {
    if (exact < ${minval(t)}) {
      BORING{CSRS[RVV_VXSAT] |= 1;}
      return ${minval(t)};
    } else if (exact > ${maxval(t)}) {
      BORING{CSRS[RVV_VXSAT] |= 1;}
      return ${maxval(t)};
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
  SEW = ${e}; // element width in bits
  LMUL = ${l.replace('f','1/')}; // register group size
  vlmax = LMUL*VLEN/SEW = VLEN${frac<1? '/'+(1/frac) : '*'+frac};
  
  // examples:
${[32,64,128,256,512,1024,65536].filter(v => v*frac>=1).map(v => `  //   VLEN=${(v+':').padEnd(6)} vlmax = ${v*frac}`+(
  v==65536? ' - maximum possible'
  : v==128? ' - minimum for "v" extension'
  : v== 64? ' - minimum for "Zvl64b"'
  : v== 32? ' - minimum for "Zvl32b"' : ''
)).join('\n')}
  
${equalTo? `  // vlmax(e${e}, m${l}) is equal to:\n${equalTo}` : ``}
`)}


case '__RISCV_VXRM': return helper_code(`
  enum __RISCV_VXRM {
    __RISCV_VXRM_RNU = 0, // round to nearest, ties to up
    __RISCV_VXRM_RNE = 1, // round to nearest, ties to even
    __RISCV_VXRM_RDN = 2, // round down
    __RISCV_VXRM_ROD = 3, // round to odd
  };
`);
case '__RISCV_FRM': return helper_code(`
  enum __RISCV_FRM {
    __RISCV_FRM_RNE = 0, // Round to nearest, ties to even
    __RISCV_FRM_RTZ = 1, // Round towards zero
    __RISCV_FRM_RDN = 2, // Round down (towards -∞)
    __RISCV_FRM_RUP = 3, // Round up (towards +∞)
    __RISCV_FRM_RMM = 4, // Round to nearest, ties to max magnitude
  };
`);

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
      case __RISCV_VXRM_RNU: { // vxrm == 0; round to nearest, ties to up
        increment = carry;
        break;
      }
      case __RISCV_VXRM_RNE: { // vxrm == 1; round to nearest, ties to even
        increment = carry && ((x&(last-1)) != 0 || shiftLSB);
        // equivalently: increment = x[shift-1] && (x[shift-2:0]!=0 || x[shift]);
        break;
      }
      case __RISCV_VXRM_RDN: { // vxrm == 2; round down
        increment = false;
        // equivalently, just: return x >> shift;
        break;
      }
      case __RISCV_VXRM_ROD: { // vxrm == 3; round to odd
        increment = (x & ((1<<shift)-1) != 0) && !shiftLSB;
        // equivalently: increment = !x[shift] && x[shift-1:0]!=0;
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
  May make a different choice on each call.
  This describes the precise requirement of the architecture specification for purposes of clarity; for practical purposes, the result of this should be considered to be undefined like <code>anything()</code>.
  The intrinsics may in the future allow the compiler to arbitrarily change agnostic values, making this method truly equal to <code>anything()</code>.
`);

case 'intinf_t': return helper_text(`
  A pseudotype of a signed infinite-precision integer.
`);

case 'uintinf': return helper_text(`
  Reinterprets the argument as an unsigned integer, and, zero-extending, widens it to a signed infinite-precision integer.
  For example, both <code>uintinf((int8_t) -100)</code> and <code>uintinf((uint8_t) 155)</code> become the infinite-precision signed integer <code>155</code>.
`);
case 'intinf': return helper_text(`Widens (sign- or zero-extending depending on type) the argument to an infinite-precision integer.`);
case 'isQNaN': return helper_text(`Returns whether the argument is any quiet NaN.`);
case 'isSNaN': return helper_text(`Returns whether the argument is any signaling NaN.`);
case 'isNaN': return helper_text(`Returns whether the argument is any NaN - that is, either signaling or quiet, with any payload and sign.`);

}},


oper: (o, v) => {
  let name = o.name;
  
  let ent = defs.find(c => c[0].test(name));
  
  if (ent==undefined) return undefined;
  let s = ent[1];
  let fn = v || o;
  if (typeof s === 'function') s = cleanup(s(fn));
  
  let mask = !fvhas(v,"m")? 0 : fvhas(v,"mu")? 2 : 1; // 0: no masking; 1: agnostic; 2: undisturbed
  let tail = !fvhas(v,"tu"); // 0: undisturbed; 1: agnostic
  let basev = hasarg(fn, "vd")? "vd" : fn.name.includes("slideup")? "dest" : "";
  let baseeM = basev? basev+(farg(fn,basev).includes('x')? '[o]' : '')+'[i]' : '';
  let baseeT = fn.ret.type.includes("bool")? "" : baseeM;
  
  // let agnBase0 = (agn,base) => agn? (base? `agnostic(${base})` : "anything()") : `${base}`;
  let agnBase0 = (agn,base) => agn? "anything()" : `${base}`;
  let agnBaseM = (agn,base) => boring(agnBase0(agn, baseeM));
  let agnBaseT = (agn,base) => boring(agnBase0(agn, baseeT));
  
  // helper function display
  let h = (name, args='') => `<a onclick="rvv_helper('${name}',${args})">${name}</a>`;
  
  s = s.replace(/%M([=*\[\]])/g, (_,c) => `<span class="op-load">${c}</span>`); // memory ops
  s = s.replace(/RES{}/g, o.ret.type); // return type
  s = s.replace(/RESE{}/g, eltype(o.ret)); // result element
  s = s.replace(/FARG{(.*?)}/g, (_,c) => farg(fn,c)); // find argument with given name
  s = s.replace(/VLMAXBG{}/g, c => { let b = +o.name.split('_b')[1]; return `vint8m${b<8? 8/b : 'f'+(b/8)}_t`; });
  s = s.replace(/VLMAXB{}/g, c => {
    let b = +o.name.split('_b')[1];
    let t = `vint8m${b<8? 8/b : 'f'+(b/8)}_t`;
    return `BORING{vlmax = VLEN/${b};} // equal to VLMAXG{${t}}\nVLMAXI{${t}}`;
  });
  s = s.replace(/VLMAX(I?)(G?){(.*?)}/g, (_,i,g,c) => {
    let e, m;
    if (c) {
      [e, m] = vparts(c);
      m = fmtmul(m);
    } else if (!g) throw new Error("bad VLMAX{}");
    let v = 'vlmax' + (c && !i? `(e${e}, ${m})` : '');
    return g? v : boring(`if (vl > ${v}) vl = __riscv_vsetvl_e${e}${m}(vl);`);
  });
  s = s.replace(/FRMI0{}(; )?/, (_,c='') => fvhas(fn,"rm")? boring('fsrmi xtmp, &lt;frm>'+c) : '');
  s = s.replace(/FRMI1{}(; )?/, (_,c='') => fvhas(fn,"rm")? boring('fsrm xtmp'+c) : '');
  
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
    if (test('INIT ')) return [0, procInstr(post)[1]];
    let base = o.name.replace('__riscv_','').split(/_([iuf]\d+mf?\d+(x\d+)?|b\d+)+(_|$)/)[0].replace(/_/g,'.');
    all = all.replace(/\bBASE\b/, base); // base assembly instruction name
    all = all.replace(/ IMMALT{(\w+)(, (\w+))?}/, (_,r,_2,sh) => {
      let nv = immArgMap[base];
      if (!nv) return '';
      if (extra_test) nv.used = true;
      if (sh && vparts(sh)[0]-1 <= nv[2]) return ` // or ${nv[0]} if ${r} is constant`;
      return ` // or ${nv[0]} if constant ${nv[1]==-1? `` : `${nv[1]===undefined? -16 : nv[1]} ≤ `}${r} ≤ ${nv[2]||15}`;
    })
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
  let specRef, desc;
  let categories = [];
  s = s.replace(/^ *REF{(.*)}\n/m, (_,c) => { specRef = c; return ''; })
  s = s.replace(/^ *DESC{(.*)}\n/m, (_,c) => { desc = c; return ''; })
  s = s.replace(/^ *CAT{(.*)}\n/mg, (_,c) => { categories.push(c.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')); return ''; })
  
  s = s.replace(/TAILLOOP{(.*?)};?/g, (_,c) => boring(`for (size_t i = ${c?c:'vl'}; i < vlmax; i++) res[i] = TAIL{};`));
  s = s.replace(/TAIL{}/g, agnBaseT(tail)); // tail element
  s = s.replace(/TAILV{}/g, agnBase0(tail,basev)); // tail vector
  
  s = s.replace(/FRM{}/, c => fvhas(fn,"rm")? boring('local_rounding_mode = frm; // '+h('__RISCV_FRM')) : 'RMELN{}');
  s = s.replace(/^( *)MASKWEE{}.*\n/gm, (_,c) => !mask? "" : boring(`${c}if (!mask[i]) {\n${c}  res[i] = ${agnBaseM(mask==1)};\n${c}  continue;\n${c}}\n`)); // mask write early exit
  s = s.replace(/BORING{(.*?)}/g, (_,c) => boring(c));
  s = s.replace(/IDX{(.*?)}/g, (_,c) => isvec(farg(fn,c))? c+'[i]' : c);
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
  
  // non-trivial helper functions
  s = s.replace(/\bclip\(([ui]\d+), /g, (_, t) => h('clip',`'${t}'`)+`(${t}, `);
  s = s.replace(/\bvlmax(\(e(\d+), m(f?\d+)\))/g, (_,a, e,m) => h('vlmax',`${+e},'${m}'`)+a);
  s = s.replace(/\brounded_shift_right\((\w+), /g, (_,a) => h('rounded_shift_right', `'x${a}'`)+'('); // prepended x to prevent intinf_t being matched
  
  // simpler helper functions & values
  s = s.replace(/\b(anything|agnostic|u?intinf|is[SQ]?NaN)\(/g, (_,c) => h(c)+'(');
  s = s.replace(/\b(intinf_t)\b/g, (_,c) => h(c));
  
  if (s.includes('OPER_UNDEF')) s = '';
  
  if (extra_test) {
    let ms = defs.filter(c => c[0].test(name));
    if (ms.length != 1) console.warn(`multiple matches for ${fn.name}: ${ms.map(c=>c[0]).join(', ')}`);
    let instrEmpty = instrArr? instrArr.map(c=>c[1]).join('').length==0 : 0;
    if (instrArr && instrEmpty) console.warn(`unexpected empty instruction for ${fn.name}`);
    if (instrArr && !instrEmpty) {
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
      
      // verify arguments being present in instruction
      let allInstrs = instrArr.map(c=>c[1]).join('');
      fn.args.map(c=>c.name).filter(c=>c!='vl' && c!='mask').forEach(a => {
        if (!allInstrs.includes(a)) throw new Error('argument '+a+' not used in instruction of '+fn.name);
      });
      
      // make sure masking is included
      if ((mask!=0) != allInstrs.includes('v0.t')) throw new Error('bad mask in '+fn.name);
    }
    
    if (s) {
      // verify arguments being present in operation
      fn.args.map(c=>c.name).forEach(a => {
        if (!new RegExp(`\\b${a}\\b`).test(s)) throw new Error('argument '+a+' not used in operation of '+fn.name);
      });
    }
  }
  
  return {
    oper: s,
    specRef: specRef,
    desc: desc,
    categories: categories,
    instrSearch: !instrArr? undefined : instrArr.map(c=>c[1]).join('\n').replace(/&lt;/g, '<'),
    instrHTML: !instrArr? undefined : instrArr.map(([i,c]) => i? c.replace(/\/\/.*/, boring) : boring(c)).join('\n'),
  };
}};