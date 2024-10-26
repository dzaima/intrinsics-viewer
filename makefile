RVV_BASE_VER = v10
download: download-x86 download-arm download-riscv
download-x86: data/intel_intrinsics-1.xml data/intel_perf2-1.js
download-arm: data/arm_intrinsics-1.json data/arm_operations-1.json
download-riscv: data/rvv-intrinsics-$(RVV_BASE_VER).json data/v-spec.html data/riscv-crypto-spec-vector.html

DOWNLOAD = curl -L -o

data/intel_perf2-1.js:
	mkdir -p data
	$(DOWNLOAD) "$@" 'https://www.intel.com/content/dam/develop/public/us/en/include/intrinsics-guide/perf2.js'

data/intel_intrinsics-1.xml:
	mkdir -p data
	$(DOWNLOAD) "$@" 'https://www.intel.com/content/dam/develop/public/us/en/include/intrinsics-guide/data-3-6-9.xml'

data/arm_intrinsics-1.json:
	mkdir -p data
	$(DOWNLOAD) "$@" 'https://developer.arm.com/architectures/instruction-sets/intrinsics/data/intrinsics.json'

data/arm_operations-1.json:
	mkdir -p data
	$(DOWNLOAD) "$@" 'https://developer.arm.com/architectures/instruction-sets/intrinsics/data/operations.json'

data/rvv-intrinsics-$(RVV_BASE_VER).json:
	mkdir -p data
	$(DOWNLOAD) "$@" 'https://github.com/dzaima/rvv-intrinsic-doc/releases/download/$(RVV_BASE_VER)/rvv-intrinsics-$(RVV_BASE_VER).json'

data/v-spec.html:
	mkdir -p data
	$(DOWNLOAD) "$@" 'https://github.com/dzaima/riscv-v-spec/releases/download/v1/v-spec.html'

data/riscv-crypto-spec-vector.html:
	mkdir -p data
	$(DOWNLOAD) "$@" 'https://github.com/dzaima/riscv-v-spec/releases/download/v1/riscv-crypto-spec-vector.html'
