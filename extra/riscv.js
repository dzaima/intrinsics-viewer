'use strict';

let vSpecFilePath = "data/v-spec.html";

let baseFile = await loadFile("data/rvv-intrinsics-v8.json");
let rvvOps = await execFile("./extra/rvv_ops.js");

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