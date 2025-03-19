RVV_BASE_VER = v11
download: download-x86 download-arm download-riscv download-wasm
download-x86: data/intel_intrinsics-2.xml data/intel_perf2-1.js
download-arm: data/arm_intrinsics-1.json data/arm_operations-1.json
download-riscv: data/rvv-intrinsics-$(RVV_BASE_VER).json data/v-spec.html data/riscv-crypto-spec-vector.html
download-wasm: data/wasm-1.json

DOWNLOAD = curl -L -o
GET = mkdir -p data; $(DOWNLOAD)

data/intel_perf2-1.js:
	$(GET) "$@" 'https://www.intel.com/content/dam/develop/public/us/en/include/intrinsics-guide/perf2.js'

data/intel_intrinsics-2.xml:
	$(GET) "$@" 'https://www.intel.com/content/dam/develop/public/us/en/include/intrinsics-guide/data-3-6-9.xml'

data/arm_intrinsics-1.json:
	$(GET) "$@" 'https://developer.arm.com/architectures/instruction-sets/intrinsics/data/intrinsics.json'

data/arm_operations-1.json:
	$(GET) "$@" 'https://developer.arm.com/architectures/instruction-sets/intrinsics/data/operations.json'

data/rvv-intrinsics-$(RVV_BASE_VER).json:
	$(GET) "$@" 'https://github.com/dzaima/rvv-intrinsic-doc/releases/download/$(RVV_BASE_VER)/rvv-intrinsics-$(RVV_BASE_VER).json'

data/v-spec.html:
	$(GET) "$@" 'https://github.com/dzaima/riscv-v-spec/releases/download/v1/v-spec.html'

data/riscv-crypto-spec-vector.html:
	$(GET) "$@" 'https://github.com/dzaima/riscv-v-spec/releases/download/v1/riscv-crypto-spec-vector.html'

data/wasm-1.json:
	$(GET) "$@" 'https://github.com/dzaima/dzaima.github.io/releases/download/wasm-v1/wasm-1.json'
