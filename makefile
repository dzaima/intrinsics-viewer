download: download-x86 download-arm download-riscv
download-x86: data/intel_intrinsics-1.xml data/intel_perf2-1.js
download-arm: data/arm_intrinsics-1.json data/arm_operations-1.json
download-riscv: data/rvv_base-3.json data/v-spec.html

data/intel_perf2-1.js:
	mkdir -p data
	curl -L 'https://www.intel.com/content/dam/develop/public/us/en/include/intrinsics-guide/perf2.js' > "$@"

data/intel_intrinsics-1.xml:
	mkdir -p data
	curl -L 'https://www.intel.com/content/dam/develop/public/us/en/include/intrinsics-guide/data-3-6-3.xml' > "$@"

data/arm_intrinsics-1.json:
	mkdir -p data
	curl -L 'https://developer.arm.com/architectures/instruction-sets/intrinsics/data/intrinsics.json' > "$@"

data/arm_operations-1.json:
	mkdir -p data
	curl -L 'https://developer.arm.com/architectures/instruction-sets/intrinsics/data/operations.json' > "$@"

data/rvv_base-3.json:
	mkdir -p data
	curl -L 'https://github.com/dzaima/rvv-intrinsic-doc/releases/download/v5/rvv_base.json' > "$@"

data/v-spec.html:
	mkdir -p data
	curl -L 'https://github.com/dzaima/riscv-v-spec/releases/download/v1/v-spec.html' > "$@"
