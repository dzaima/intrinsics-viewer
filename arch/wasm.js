'use strict';

let data;
try {
  data = JSON.parse(await loadFile('data/wasm-1.json'));
} catch (e) {
  console.error(e);
  throw window.noDataFiles;
}

let res = data.intrinsics.map(c=>{
  let {ret, name, args} = c;
  
  let [_, quality, elwidth, elcount, rest] = name.match(/^wasm_(?:v128|([iuf])(\d+)x(\d+))_(.+)/);
  let category = 'TODO';
  let desc, oper;
  
  let keyw = kw => desc = (desc||"") + `<!--${kw}-->`;
  
  {
    let qcat = quality=='f'? 'Float|' : 'Integer|';
    switch (rest) {
      case 'make': case 'const':
        category = 'Data movement|Initialize';
        break;
      case 'splat': case 'const_splat':
        category = 'Data movement|Broadcast';
        keyw('duplicate vdup');
        break;
      
      case 'eq': case 'ne': case 'gt': case 'ge': case 'lt': case 'le':
        category = qcat+'Compare';
        break;
      case 'not': case 'and': case 'or': case 'xor': case 'andnot':
        category = 'Bitwise|Logical';
        break;
      case 'floor': case 'ceil': case 'trunc': case 'nearest':
        category = qcat+'Round';
        break;
      case 'relaxed_min': case 'relaxed_max':
        category = `Float|M${rest.substring(9,11)}imum|Relaxed`;
        desc = `Selects and implementation-defined result for arguments of 0.0 & -0.0, or if an argument is NaN.`;
        break;
      
      case 'bitmask': category = 'Bitwise|Bitmask'; desc = 'Extract top bit from each element.'; keyw('vpmovmskb movemask'); break;
      case 'all_true': category = 'Bitwise|All true'; desc = 'Return if all elements are non-zero.'; break;
      case 'any_true': category = 'Bitwise|Any true'; desc = 'Return if any bit is non-zero.'; break;
      case 'popcnt': category = 'Bitwise|Population count'; break;
      case 'neg': category = qcat+'Negate'; break;
      case 'abs': category = qcat+'Absolute'; break;
      case 'add': category = qcat+'Add|Same-width'; break;
      case 'sub': category = qcat+'Subtract|Same-width'; break;
      case 'mul': category = qcat+'Multiply|Same-width'; break;
      case 'div': category = qcat+'Divide'; break;
      case 'add_sat': category = qcat+'Add|Saturating'; break;
      case 'sub_sat': category = qcat+'Subtract|Saturating'; break;
      case 'min': category = qcat+'Minimum' + (quality=='f'? '|Proper' : ''); break;
      case 'max': category = qcat+'Maximum' + (quality=='f'? '|Proper' : ''); break;
      case 'pmin': category = qcat+'Minimum|Comparison-based'; oper = '// Elementwise:\nresult[i] = b[i] < a[i] ? b[i] : a[i];'; break; // https://webassembly.github.io/spec/core/exec/numerics.html#op-fpmin
      case 'pmax': category = qcat+'Maximum|Comparison-based'; oper = '// Elementwise:\nresult[i] = a[i] < b[i] ? b[i] : a[i];'; break;
      case 'avgr': category = qcat+'Average'; break;
      case 'sqrt': category = qcat+'Square root'; break;
      case 'q15mulr_sat': category = qcat+'Multiply|Shifted rounding'; break; // https://webassembly.github.io/spec/core/exec/numerics.html#op-iq15mulrsat-s
      case 'relaxed_q15mulr': category = qcat+'Multiply|Shifted rounding relaxed'; break;
      
      case 'bitselect':
        category = 'Bitwise|Blend';
        keyw('merge');
        break;
      case 'relaxed_laneselect':
        category = 'Data movement|Blend';
        desc = 'Implementation-defined behavior if mask elements are non-homogenous.<br>See <code>wasm_v128_bitselect</code> for a non-relaxed version.';
        keyw('merge');
        break;
      
      case 'shuffle': category = 'Data movement|Shuffle|Constant'; keyw('permute'); break;
      case 'swizzle':;
        args[1][1] = 's';
        category = 'Data movement|Shuffle|Zeroing';
        desc = 'Shuffles bytes of <code>a</code> by indices at <code>s</code>. Produces 0 for any byte where <code>s[i] > 15</code>.';
        keyw('permute');
        break;
      case 'relaxed_swizzle':
        category = 'Data movement|Shuffle|Relaxed';
        desc = 'Like <code>wasm_i8x16_swizzle</code>, but with unspecified results if <code>s[i] > 15</code>.';
        keyw('permute');
        break;
      
      case 'shl': category = 'Bitwise|Shift left'; break;
      case 'shr': category = 'Bitwise|Shift right'; break;
      case 'extract_lane': category = 'Data movement|Extract'; break;
      case 'extract_lane': category = 'Data movement|Extract'; break;
      case 'replace_lane': category = 'Data movement|Replace lane'; break;
      
      case 'relaxed_madd': case 'relaxed_nmadd': category = 'Float|Multiply-add|Relaxed'; desc = `May or may not be fused.`; keyw('fma fused'); break;
      
      default:
        const alignNote = '<br>The pointer does not need to be aligned.';
        let lB = (k,sep) => {
          let n = rest.substring(k).split('_')[0]/8;
          return `${n}${sep}byte${n==1 || sep==='-'? '' : 's'}`;
        }
        if (rest.startsWith('load')) {
          let sub;
          if (rest === 'load') {
            desc = 'Load 16 bytes.';
            sub = 'Full';
          } else if (rest.includes('splat')) {
            keyw('duplicate vdup');
            desc = `Load and broadcast ${lB(4,' ')} to the entire vector.`;
            sub = 'Broadcast'
          } else if (/_zero$/.test(rest)) {
            desc = `Load ${lB(4,' ')} into the low bytes of the vector. All other bytes are set to zero.`;
            sub = 'Low';
          } else if (/_lane/.test(rest)) {
            desc = `Load ${lB(4,' ')} into the <code>i</code>'th element of <code>vec</code>.`;
            sub = 'Into lane';
          } else if (/^load\d+x\d+$/.test(rest)) {
            let [_, lew, lec] = rest.match(/load(\d+)x(\d+)/);
            desc = `Load ${['zero','one','two',3,'four',5,6,7,'eight'][lec]} ${lew}-bit elements (i.e. a total of ${lew*lec/8} bytes) and ${quality=='u'?'zero':'sign'}-extend each to ${elwidth} bits.`;
            sub = 'Extend';
          } else throw new Error('bad load: '+rest);
          desc+= alignNote;
          category = 'Memory|Load|'+sub;
        } else if (rest.startsWith('store')) {
          
          let sub;
          if (/_lane/.test(rest)) {
            desc = `Store the <code>i</code>'th ${lB(5,'-')} element of <code>vec</code> into the first ${lB(5,' ')} of <code>mem</code>.`;
            sub = 'Into lane';
          } else if (rest === 'store') {
            desc = 'Store 16 bytes.';
            sub = 'Full';
          }
          category = 'Memory|Store|'+sub;
          desc+= alignNote;
        } else if (/^(convert|trunc|extend|narrow|demote|promote|relaxed_trunc)_/.test(rest)) {
          let ps = rest.split('_');
          let sub;
          switch (ps[0] == 'relaxed'? 'relaxed_'+ps[1] : ps[0]) {
            default: throw new Error('Bad name: '+name);
            case 'convert': sub='Integer→float'; break;
            case 'relaxed_trunc': sub='Float→integer|Relaxed'; break;
            case 'trunc': sub='Float→integer|Saturating'; if(ps[1]!='sat') throw new Error('bad '+name); break;
            case 'narrow': sub='Integer|Narrow'; break;
            case 'extend': sub='Integer|Extend'; break;
            case 'demote': sub='Float|Demote'; break;
            case 'promote': sub='Float|Promote'; break;
          }
          category = 'Conversion|'+sub;
        } else if (/^extmul_/.test(rest)) {
          category = 'Integer|Multiply|Widening';
        } else if (/^relaxed_dot_/.test(rest)) {
          category = 'Integer|Dot product|Relaxed';
        } else if (/^dot_/.test(rest)) {
          category = 'Integer|Dot product|Proper';
        } else if (/^extadd_pairwise_/.test(rest)) {
          category = 'Integer|Add|Pairwise widening';
        }
        break;
    }
  }
  
  return {
    raw: c,
    cpu: ['wasm'],
    id: idCounter++,
    
    ret: {type: ret},
    args: args.map(([type, name]) => ({type, name})),
    name: name,
    
    desc,
    header: undefined,
    
    implDesc: oper,
    implInstr: undefined,
    
    archs: [c.ext],
    categories: [category],
  };
});

export function instructions(name) {
  return res.filter(c=>c.cpu.includes(name));
}

export const archOrder = {
  'all|simd128': 0,
};
export const categoryOrder = {
  'all|Integer': 0,
  'all|Float': 1,
  
  'Integer|Add': 0,
  'Integer|Subtract': 1,
  'Integer|Multiply': 2,
  'Integer|Compare': 3,
  'Integer|Minimum': 4,
  'Integer|Maximum': 5,
  'Integer|Negate': 6,
  'Integer|Absolute': 7,
  
  'Float|Add': 0,
  'Float|Subtract': 1,
  'Float|Multiply': 2,
  'Float|Divide': 3,
  'Float|Compare': 4,
  'Float|Minimum': 5,
  'Float|Maximum': 6,
  'Float|Negate': 7,
  'Float|Absolute': 8,
  
  'Bitwise|Logical': 0,
  'Bitwise|Shift left': 1,
  'Bitwise|Shift right': 2,
  
  'Data movement|Shuffle': 0,
  'Data movement|Initialize': 1,
  'Data movement|Blend': 2,
  
  'Conversion|Same-width': 0,
};

export const globalInfo = `
Compiler include: <code>#include &lt;wasm_simd128.h></code><br>
Compiler flags: <code>-msimd128</code>, <code>-mrelaxed-simd</code>, <code>-mfp16</code> respectively for the extensions.<br>
<br>
<a href="https://emscripten.org/docs/porting/simd.html">General info</a><br>
<a href="https://webassembly.github.io/spec/core/appendix/index-instructions.html">Instruction list</a><br>
<a href="https://github.com/WebAssembly/relaxed-simd/blob/main/proposals/relaxed-simd/Overview.md">Relaxed SIMD overview</a><br>

<details>
<summary>
License of data parsed from <a href="https://github.com/llvm/llvm-project/blob/5622f2232b3564e86e207401f6c196ba9ea01fb7/clang/lib/Headers/wasm_simd128.h">the LLVM header</a>
</summary>
<pre>
${data.licenseInfo}
</pre>
</details>
`;
// https://webassembly.github.io/spec/core/exec/instructions.html
