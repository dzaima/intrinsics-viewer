'use strict';

let intrinsics, operations;
try {
  intrinsics = JSON.parse(await loadFile("data/arm_intrinsics-1.json"));
  operations = JSON.parse(await loadFile("data/arm_operations-1.json"));
} catch (e) {
  console.error(e);
  throw window.noDataFiles;
}

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
  }).join("\n").toLowerCase());
  
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
    args,
    name: c.name.replace(/\[|]/g,""),
    
    desc: (c.name.includes("[")? overloadedName(c.name.replace(/\[[^\]]+]/g,"")) + "<br>" : "") + c.description + (nativeOpNEON? "" : "<br>"+nativeOperation),
    header: undefined,
    
    implDesc: nativeOpNEON? nativeOperation : undefined,
    implInstr,
    implInstrSearch,
    
    archs: [c.SIMD_ISA],
    categories,
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

export function instructions(name) {
  return res1.filter(c=>c.cpu.includes(name));
}

export const categoryOrder = {
  'Logical|Shift': 0,
  'Logical|AND': 1,
  'Logical|OR': 2,
  'Logical|XOR': 3,
  'Logical|NOT': 4,
  'Logical|ANDN': 5,
  'Logical|ORN': 6,
  
  'all|Arithmetic': 0,
  'all|Logical': 1,
  'all|Vector manipulation': 2,
};
