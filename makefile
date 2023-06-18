download: data/arm_intrinsics-1.json data/arm_operations-1.json data/intel_intrinsics-1.xml data/intel_perf2-1.js data/rvv.json data/rvv_policies.json data/v-spec.html

data/intel_perf2-1.js:
	mkdir -p data
	curl -L 'https://www.intel.com/content/dam/develop/public/us/en/include/intrinsics-guide/perf2.js' > data/intel_perf2-1.js

data/intel_intrinsics-1.xml:
	mkdir -p data
	curl -L 'https://www.intel.com/content/dam/develop/public/us/en/include/intrinsics-guide/data-3-6-3.xml' > data/intel_intrinsics-1.xml

data/arm_intrinsics-1.json:
	mkdir -p data
	curl -L 'https://developer.arm.com/architectures/instruction-sets/intrinsics/data/intrinsics.json' > data/arm_intrinsics-1.json

data/arm_operations-1.json:
	mkdir -p data
	curl -L 'https://developer.arm.com/architectures/instruction-sets/intrinsics/data/operations.json' > data/arm_operations-1.json

data/rvv.json:
	mkdir -p data
	curl -L 'https://github.com/dzaima/rvv-intrinsic-doc/releases/download/v2/rvv_base.json' > data/rvv_base.json
data/rvv_policies.json:
	mkdir -p data
	curl -L 'https://github.com/dzaima/rvv-intrinsic-doc/releases/download/v2/rvv_policies.json' > data/rvv_policies.json

data/v-spec.html:
	mkdir -p data
	curl -L 'https://github.com/dzaima/riscv-v-spec/releases/download/v1/v-spec.html' > data/v-spec.html
