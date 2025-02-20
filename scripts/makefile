download-wasm: data-in/llvm-license-1.txt data-in/wasm_simd128-1.h data-in/bqn-libs

DOWNLOAD = curl -L -o
GET = mkdir -p data-in; $(DOWNLOAD)

data-in/llvm-license-1.txt:
	$(GET) "$@" 'https://raw.githubusercontent.com/llvm/llvm-project/131a3cfab46ff8eb03ae102a39ea35b7f5e11d1b/LICENSE.TXT'

data-in/wasm_simd128-1.h:
	$(GET) "$@" 'https://raw.githubusercontent.com/llvm/llvm-project/131a3cfab46ff8eb03ae102a39ea35b7f5e11d1b/clang/lib/Headers/wasm_simd128.h'

data-in/bqn-libs:
	git clone https://github.com/mlochbaum/bqn-libs.git data-in/bqn-libs