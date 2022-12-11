data/intel_perf2-1.js:
	mkdir -p data
	curl 'https://www.intel.com/content/dam/develop/public/us/en/include/intrinsics-guide/perf2.js' > data/intel_perf2-1.js

data/intel_intrinsics-1.xml:
	mkdir -p data
	curl 'https://www.intel.com/content/dam/develop/public/us/en/include/intrinsics-guide/data-3-6-3.xml' > data/intel_intrinsics-1.xml

data/arm_intrinsics-1.json:
	mkdir -p data
	curl 'https://developer.arm.com/architectures/instruction-sets/intrinsics/data/intrinsics.json' > data/arm_intrinsics-1.json

data/arm_operations-1.json:
	mkdir -p data
	curl 'https://developer.arm.com/architectures/instruction-sets/intrinsics/data/operations.json' > data/arm_operations-1.json

download: data/arm_intrinsics-1.json data/arm_operations-1.json data/intel_intrinsics-1.xml data/intel_perf2-1.js
