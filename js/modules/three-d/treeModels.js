// The models are one metre tall; instances scale them to their chosen height.
export function createTreeModels(THREE) {
	const up = new THREE.Vector3(0, 1, 0);

	function addPart(parts, geometry, position, scale, quaternion = new THREE.Quaternion()) {
		const mesh = geometry.index ? geometry.toNonIndexed() : geometry;
		if (mesh !== geometry) geometry.dispose();
		mesh.applyMatrix4(new THREE.Matrix4().compose(position, quaternion, scale));
		parts.push(mesh);
	}

	function branch(parts, start, end, radius, tip = radius * 0.45) {
		const delta = end.clone().sub(start);
		addPart(parts, new THREE.CylinderGeometry(tip, radius, 1, 5),
			start.clone().add(end).multiplyScalar(0.5),
			new THREE.Vector3(1, delta.length(), 1),
			new THREE.Quaternion().setFromUnitVectors(up, delta.normalize()));
	}

	function foliage(parts, x, y, z, width, height, seed) {
		const geometry = new THREE.IcosahedronGeometry(1, 0);
		const positions = geometry.attributes.position;
		for (let i = 0; i < positions.count; i++) {
			const variation = 1 + 0.12 * Math.sin(positions.getX(i) * 11 + positions.getY(i) * 17 + seed);
			positions.setXYZ(i, positions.getX(i) * variation, positions.getY(i) * variation, positions.getZ(i) * variation);
		}
		geometry.computeVertexNormals();
		addPart(parts, geometry, new THREE.Vector3(x, y, z), new THREE.Vector3(width, height, width));
	}

	function broadleaf(bark, leaves, species) {
		const tall = species === 1;
		branch(bark, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.012, 0.86, 0), 0.035, 0.009);
		for (let i = 0; i < 9; i++) {
			const angle = i * 2.399 + species * 0.6;
			const y = 0.42 + (i % 3) * 0.09;
			const length = (tall ? 0.19 : 0.26) * (0.85 + (i % 4) * 0.05);
			const x = Math.cos(angle) * length;
			const z = Math.sin(angle) * length;
			const tip = new THREE.Vector3(x, y + 0.23, z);
			branch(bark, new THREE.Vector3(0, y, 0), tip, 0.013, 0.004);
			foliage(leaves, x, tip.y, z, length * 0.63, 0.12, i);
			foliage(leaves, x * 0.65, tip.y + 0.09, z * 0.65, length * 0.58, 0.115, i + 13);
		}
		foliage(leaves, 0, 0.87, 0, tall ? 0.15 : 0.19, 0.13, species);
	}

	function conifer(bark, leaves) {
		branch(bark, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.98, 0), 0.028, 0.004);
		for (let level = 0; level < 5; level++) {
			const y = 0.34 + level * 0.12;
			const length = 0.28 * (1 - level * 0.15);
			for (let i = 0; i < 6; i++) {
				const angle = i * Math.PI / 3 + level * 0.45;
				const x = Math.cos(angle) * length;
				const z = Math.sin(angle) * length;
				branch(bark, new THREE.Vector3(0, y, 0), new THREE.Vector3(x, y + 0.04, z), 0.007, 0.002);
				foliage(leaves, x * 0.68, y + 0.08, z * 0.68, length * 0.48, 0.095, i + level * 7);
			}
		}
		foliage(leaves, 0, 0.9, 0, 0.075, 0.1, 23);
	}

	function palm(bark, leaves) {
		for (let i = 0; i < 5; i++) {
			const start = new THREE.Vector3(i * 0.003, i * 0.17, 0);
			const end = new THREE.Vector3((i + 1) * 0.003, (i + 1) * 0.17, 0);
			branch(bark, start, end, 0.027 - i * 0.002, 0.024 - i * 0.002);
		}
		const vertices = [];
		const crown = new THREE.Vector3(0.015, 0.85, 0);
		for (let i = 0; i < 10; i++) {
			const angle = i * Math.PI * 2 / 10;
			const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
			const side = new THREE.Vector3(-radial.z, 0, radial.x);
			const point = t => crown.clone().addScaledVector(radial, 0.39 * t).add(new THREE.Vector3(0, 0.12 * Math.sin(Math.PI * t) - 0.14 * t * t, 0));
			for (let j = 0; j < 5; j++) {
				const a = point(j / 5), b = point((j + 1) / 5);
				branch(bark, a, b, 0.003, 0.0015);
				for (const sign of [-1, 1]) {
					const tip = a.clone().lerp(b, 0.65).addScaledVector(side, sign * 0.075 * (1 - j / 6));
					tip.y -= 0.03;
					vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, tip.x, tip.y, tip.z);
				}
			}
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
		geometry.computeVertexNormals();
		leaves.push(geometry);
	}

	function combine(parts) {
		const positions = [], normals = [];
		for (const geometry of parts) {
			positions.push(...geometry.attributes.position.array);
			normals.push(...geometry.attributes.normal.array);
			geometry.dispose();
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
		geometry.computeBoundingSphere();
		return geometry;
	}

	return Array.from({ length: 5 }, (_, species) => {
		const bark = [], leaves = [];
		if (species === 2) conifer(bark, leaves);
		else if (species === 4) palm(bark, leaves);
		else broadleaf(bark, leaves, species);
		return { bark: combine(bark), leaves: combine(leaves) };
	});
}
