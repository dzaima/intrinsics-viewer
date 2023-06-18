## x86-64, ARM, and RISC-V V intrinsics viewer

### Usage:
1. `make download` (or some of `make download-x86`, `make download-arm`, `make download-riscv`)
2. open `index.html`

### Search functionality
Search is done by splitting the input on spaces, and expecting each to appear in at least one of the selected "Search in:" categories. Additionally, a "!" prepended to a word will instead expect no category to contain it. For example, `_mm512 sqrt _pd !_mask` will exclude masking instructions from the AVX-512 packed double sqrt search.