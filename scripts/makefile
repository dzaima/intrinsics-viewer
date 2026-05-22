download-wasm: data-in/llvm-license-1.txt data-in/wasm_simd128-1.h data-in/bqn-libs
download-arm: data-in/gcc-arm_neon-1.h data-in/gcc-arm_fp16-1.h data-in/gcc-arm_bf16-1.h

DOWNLOAD = curl -L -o
GET = mkdir -p data-in; $(DOWNLOAD)

data-in/llvm-license-1.txt:
	$(GET) "$@" 'https://raw.githubusercontent.com/llvm/llvm-project/131a3cfab46ff8eb03ae102a39ea35b7f5e11d1b/LICENSE.TXT'

data-in/wasm_simd128-1.h:
	$(GET) "$@" 'https://raw.githubusercontent.com/llvm/llvm-project/131a3cfab46ff8eb03ae102a39ea35b7f5e11d1b/clang/lib/Headers/wasm_simd128.h'

data-in/gcc-arm_neon-1.h:
	$(GET) "$@" 'https://raw.githubusercontent.com/gcc-mirror/gcc/1bdc9e13987fc7451a4f11cfdf8b6dfb827cf9f5/gcc/config/aarch64/arm_neon.h'

data-in/gcc-arm_fp16-1.h:
	$(GET) "$@" 'https://raw.githubusercontent.com/gcc-mirror/gcc/1bdc9e13987fc7451a4f11cfdf8b6dfb827cf9f5/gcc/config/aarch64/arm_fp16.h'

data-in/gcc-arm_bf16-1.h:
	$(GET) "$@" 'https://raw.githubusercontent.com/gcc-mirror/gcc/1bdc9e13987fc7451a4f11cfdf8b6dfb827cf9f5/gcc/config/aarch64/arm_bf16.h'

data-in/bqn-libs:
	git clone https://github.com/mlochbaum/bqn-libs.git data-in/bqn-libs
