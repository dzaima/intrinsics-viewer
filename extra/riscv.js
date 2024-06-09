'use strict';

let vSpecFilePath = "data/v-spec.html";

let baseFile, rvvOps;
try {
  baseFile = await loadFile("data/rvv-intrinsics-v8.json");
  rvvOps = await execFile("./extra/rvv_ops.js");
} catch (e) {
  console.error(e);
  throw window.noDataFiles;
}

window.rvv_helper = (name, ...args) => {
  let prev_entry = curr_entry;
  descPlaceEl.innerHTML = `<a class="rvv-helper-back">back</a><pre>${rvvOps.helper(name, ...args)}</pre>`;
  descPlaceEl.getElementsByClassName('rvv-helper-back')[0].onclick = () => displayEnt(...prev_entry, false);
};

let instructions = JSON.parse(baseFile);

// process entries
instructions.forEach(ins => {
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
  if (c.specRef) c.desc = `<a target="_blank" href="${vSpecFilePath}#${newOp.specRef}">Specification</a><br>${c.desc}`;
  
});

rvvOps.initialized();

function addSimpleOp(ret, name, args, desc, oper) {
  instructions.push({
    id: idCounter++,
    ret: {type: ret}, args, name,
    desc, implDesc: oper,
    archs: ['v'], categories: ["Initialize|General"],
  });
}
addSimpleOp("unsigned long", "__riscv_vlenb", [], "Get VLEN in bytes", "return VLEN/8;");

instructions.forEach(c => {
  c.cpu = ['risc-v'];
});

export { instructions };

export const archOrder = {
  'all|v': 0,
  'all|Zvfh - f16': 1,
  'all|Zvfbfwma - bf16': 2,
};
export const categoryOrder = {
  'Arithmetic|Add': 0,
  'Arithmetic|Subtract': 1,
  'Arithmetic|Multiply': 2,
  
  'all|Integer': 0,
  'all|Float': 1,
  'all|Fold': 2,
  'all|Mask': 3,
  'all|Bitwise': 4,
  'all|Memory': 5,
  'all|Permutation': 6,
  'all|Initialize': 7,
  'all|Conversion': 8,
  
  'Integer|Add': 0,
  'Integer|Subtract': 1,
  'Integer|Multiply': 2,
  'Integer|Compare': 3,
  'Integer|Min': 4,
  'Integer|Max': 5,
  'Integer|Negate': 6,
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
  
  'Memory|Load': 0,
  'Memory|Store': 1,
  'Memory|Indexed': 2,
  'Memory|Fault-only-first load': 3,
  
  'Conversion|Integer widen': 0,
  'Conversion|Integer narrow': 1,
  'Conversion|Float widen': 2,
  'Conversion|Float narrow': 3,
  'Conversion|Integer to float': 4,
  'Conversion|Float to integer': 5,
  'Integer to float|Same-width result': 0,
  'Float to integer|Same-width result': 0,
  
  'Bitwise|Shift left': 0,
  'Bitwise|Shift right': 1,
  'Bitwise|AND': 2,
  'Bitwise|OR': 3,
  'Bitwise|XOR': 4,
  'Bitwise|NOT': 5,
  
  'Fixed-point|Saturating add': 0,
  'Fixed-point|Saturating subtract': 1,
};
