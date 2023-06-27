## x86-64, ARM, and RISC-V V intrinsics viewer

### Usage:
1. `make download` (or some of `make download-x86`, `make download-arm`, `make download-riscv`)
2. open `index.html`

### Search

Searching is done by finding entries that match all space-separated things. Things can be:

- regular text (`add`), quoted text (`"add packed"`), regex (`/\bmul/`);
- the above, in a specific field: `ret:int8`, `arg:/int\d+_t/`, etc (if no field is specified, the checkboxes are used);
- the above, negated: `!ret:void`, `!add`, `!name:maskz`, etc.

Additionally, `var=[name]` will default the whole search to a specific variation.

### Searchable fields

term          | checkbox    | description
--------------|-------------|-------------
`name:`       | intrinsic   | intrinsic name
`ret:`        | intrinsic   | return value
`arg:`        | intrinsic   | argument type
`type:`       | intrinsic   | any result or argument type
`argn:`       | —           | argument name
`arg[N]n:`    | —           | n-th (1-indexed) argument name, e.g. `arg3n:/\bmask\b/`
`arg[N]:`     | —           | n-th (1-indexed) argument type
`desc:`       | description | description
`inst:`       | instruction | instruction
`oper:`       | operation   | operation
`cat:`        | caregory    | category (`\|`-separated)
`var=[name]:` | —           | search in specific variation, e.g. `var=base:arg:bool`

### Search examples

General:

- `arg:*`: intrinsics taking pointer arguments
- `!arg1n:`: intrinsics taking no arguments

x86-64 AVX-512:

- `var=base:name:mask name:_mm512`: 512-bit intrinsics with "mask" in the name that's not in a variation

ARM NEON:

- `name:q_`: keep only 128-bit intrinsics

RISC-V rvv:

- `var=_m`: maskable intrinsics
- `var=base arg:vbool` or `var=base:arg:vbool`: non-masked intrinsics taking a boolean vector argument
- `!name:/_.(8|16|64)m/ !name:/mf?[248]$/ !name:/_b(1|2|4|16|32|64)$/`: discard repetitive intrinsics, keep LMUL=1, 32-bit element
- `!argn:/vl$/`: intrinsics that don't require a specified VL