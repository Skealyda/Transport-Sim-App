export function createProceduralTrain(THREE, coachCount, colors = {}) {
	const requestedCount = Number(coachCount);
	const count = Number.isFinite(requestedCount) ? Math.max(1, Math.floor(requestedCount)) : 1;
	const geometries = {
		box: new THREE.BoxGeometry(1, 1, 1),
		wheel: new THREE.CylinderGeometry(1, 1, 1, 12),
		bolt: new THREE.CylinderGeometry(1, 1, 1, 8)
	};
	const materials = {
		locomotive: new THREE.MeshStandardMaterial({ color: colors.locomotive || '#d5e0dc', roughness: 0.62, metalness: 0.2 }),
		coach: new THREE.MeshStandardMaterial({ color: colors.coach || '#3e79a1', roughness: 0.65, metalness: 0.15 }),
		dark: new THREE.MeshStandardMaterial({ color: 0x202a2f, roughness: 0.58, metalness: 0.35 }),
		underframe: new THREE.MeshStandardMaterial({ color: 0x394348, roughness: 0.7, metalness: 0.4 }),
		roof: new THREE.MeshStandardMaterial({ color: 0xb7b9b3, roughness: 0.72, metalness: 0.25 }),
		trim: new THREE.MeshStandardMaterial({ color: 0xcfd5d1, roughness: 0.55, metalness: 0.3 }),
		glass: new THREE.MeshStandardMaterial({ color: 0x172d39, roughness: 0.2, metalness: 0.3 }),
		doorGlass: new THREE.MeshStandardMaterial({ color: 0x244958, roughness: 0.18, metalness: 0.28 }),
		steel: new THREE.MeshStandardMaterial({ color: 0x657074, roughness: 0.34, metalness: 0.78 }),
		headlight: new THREE.MeshBasicMaterial({ color: 0xfff3c9 }),
		redLamp: new THREE.MeshBasicMaterial({ color: 0xb52a24 })
	};
	const train = new THREE.Group();
	train.name = 'procedural-train';
	const features = {};

	function note(feature, amount = 1) {
		features[feature] = (features[feature] || 0) + amount;
	}

	function part(parent, geometry, material, position, scale, rotation = [0, 0, 0], name = '') {
		const mesh = new THREE.Mesh(geometry, material);
		mesh.userData.sharedGeometry = true;
		mesh.position.set(...position);
		mesh.scale.set(...scale);
		mesh.rotation.set(...rotation);
		mesh.name = name;
		mesh.castShadow = material !== materials.glass && material !== materials.doorGlass &&
			material !== materials.headlight && material !== materials.redLamp;
		mesh.receiveShadow = true;
		parent.add(mesh);
		return mesh;
	}

	function instances(parent, geometry, material, transforms, name) {
		const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
		mesh.userData.sharedGeometry = true;
		mesh.name = name;
		const matrix = new THREE.Matrix4();
		const quaternion = new THREE.Quaternion();
		const scale = new THREE.Vector3();
		const position = new THREE.Vector3();
		const rotation = new THREE.Euler();
		transforms.forEach((transform, index) => {
			position.set(...transform.position);
			scale.set(...transform.scale);
			rotation.set(...(transform.rotation || [0, 0, 0]));
			quaternion.setFromEuler(rotation);
			matrix.compose(position, quaternion, scale);
			mesh.setMatrixAt(index, matrix);
		});
		mesh.instanceMatrix.needsUpdate = true;
		mesh.castShadow = material !== materials.glass && material !== materials.doorGlass;
		mesh.receiveShadow = true;
		parent.add(mesh);
		return mesh;
	}

	function box(parent, size, position, material, name = '') {
		return part(parent, geometries.box, material, position, size, [0, 0, 0], name);
	}

	function addBogies(body, length, type) {
		const bogies = new THREE.Group();
		bogies.name = `${type}-bogies`;
		body.add(bogies);
		const zPositions = [-length * 0.32, length * 0.32];
		instances(bogies, geometries.box, materials.underframe,
			zPositions.map(z => ({ position: [0, 0.72, z], scale: [2.55, 0.48, 3.25] })),
			`${type}-bogie-frames`);
		const wheelTransforms = [];
		for (const bogieZ of zPositions) {
			for (const axleOffset of [-0.92, 0.92]) {
				for (const side of [-1, 1]) {
					wheelTransforms.push({
						position: [side * 1.48, 0.48, bogieZ + axleOffset],
						scale: [0.48, 0.2, 0.48],
						rotation: [0, 0, Math.PI / 2]
					});
				}
			}
		}
		instances(bogies, geometries.wheel, materials.dark, wheelTransforms, `${type}-wheels`);
		instances(bogies, geometries.bolt, materials.steel,
			wheelTransforms.map(transform => ({ ...transform, position: [Math.sign(transform.position[0]) * 1.6, transform.position[1], transform.position[2]], scale: [0.12, 0.04, 0.12] })),
			`${type}-wheel-hubs`);
		note('bogies', 2);
		note('wheels', wheelTransforms.length);
	}

	function addCouplers(body, length, type) {
		for (const direction of [-1, 1]) {
			const group = new THREE.Group();
			group.name = `${type}-${direction < 0 ? 'front' : 'rear'}-coupler`;
			group.position.z = direction * (length / 2 + 0.38);
			body.add(group);
			box(group, [0.38, 0.35, 0.75], [0, 0.9, 0], materials.steel);
			box(group, [0.55, 0.46, 0.22], [0, 0.9, direction * 0.35], materials.dark);
			note('couplers');
		}
	}

	function addLocomotive() {
		const body = new THREE.Group();
		const length = 18;
		body.name = 'locomotive';
		body.userData = { trainPart: 'locomotive', trainIndex: 0, length };
		box(body, [3.14, 0.55, 17.2], [0, 0.98, 0], materials.underframe, 'locomotive-underframe');
		box(body, [3.0, 2.45, 12.0], [0, 2.35, 1.8], materials.locomotive, 'locomotive-shell');
		box(body, [3.05, 2.85, 4.9], [0, 2.2, -6.15], materials.locomotive, 'locomotive-cab-shell');
		box(body, [3.12, 0.4, 16.8], [0, 3.82, 0.2], materials.roof, 'locomotive-roof');
		box(body, [3.08, 0.2, 5.1], [0, 3.65, -6.15], materials.dark, 'cab-roof-edge');
		box(body, [2.45, 0.16, 0.1], [0, 2.05, -8.66], materials.trim, 'locomotive-nose-band');

		const windshieldTransforms = [-0.72, 0.72].map(x => ({
			position: [x, 3.02, -8.63],
			scale: [1.18, 1.18, 0.08]
		}));
		instances(body, geometries.box, materials.glass, windshieldTransforms, 'cab-windshields');
		box(body, [0.08, 1.35, 0.09], [0, 3.03, -8.68], materials.dark, 'windshield-divider');
		const sideWindows = [];
		for (const side of [-1, 1]) {
			sideWindows.push(
				{ position: [side * 1.535, 3.0, -7.05], scale: [0.06, 1.08, 1.25] },
				{ position: [side * 1.535, 3.0, -5.55], scale: [0.06, 0.9, 0.72] }
			);
		}
		instances(body, geometries.box, materials.glass, sideWindows, 'cab-side-windows');

		const sideVents = [];
		for (const side of [-1, 1]) {
			for (let index = 0; index < 4; index++) {
				sideVents.push({ position: [side * 1.515, 2.75, -2.2 + index * 1.55], scale: [0.06, 0.86, 0.9] });
			}
		}
		instances(body, geometries.box, materials.dark, sideVents, 'locomotive-side-vents');
		const sideRails = [];
		for (const side of [-1, 1]) {
			for (let index = 0; index < 3; index++) {
				sideRails.push({ position: [side * 1.58, 1.65, 4.5 + index * 0.95], scale: [0.09, 0.65, 0.08] });
			}
		}
		instances(body, geometries.box, materials.trim, sideRails, 'locomotive-side-grilles');

		instances(body, geometries.box, materials.dark, [
			{ position: [-0.65, 4.1, 0.2], scale: [1.0, 0.42, 2.1] },
			{ position: [0.65, 4.1, 0.2], scale: [1.0, 0.42, 2.1] },
			{ position: [0, 4.03, 3.05], scale: [1.7, 0.32, 1.45] }
		], 'roof-equipment');
		instances(body, geometries.box, materials.steel, [
			{ position: [0, 4.28, 0.25], scale: [1.4, 0.12, 1.5] },
			{ position: [0, 4.2, 3.05], scale: [1.9, 0.12, 0.32] }
		], 'roof-equipment-trim');

		const pantograph = new THREE.Group();
		pantograph.name = 'pantograph';
		pantograph.position.set(0, 4.25, -2.0);
		body.add(pantograph);
		box(pantograph, [1.45, 0.12, 0.36], [0, 0, 0], materials.steel, 'pantograph-base');
		part(pantograph, geometries.box, materials.steel, [-0.35, 0.72, 0], [0.09, 1.55, 0.09], [0, 0, -0.45], 'pantograph-left-arm');
		part(pantograph, geometries.box, materials.steel, [0.35, 0.72, 0], [0.09, 1.55, 0.09], [0, 0, 0.45], 'pantograph-right-arm');
		box(pantograph, [1.3, 0.08, 0.12], [0, 1.38, 0], materials.steel, 'pantograph-contact-strip');

		instances(body, geometries.box, materials.headlight, [
			{ position: [-0.92, 2.28, -8.69], scale: [0.38, 0.3, 0.06] },
			{ position: [0.92, 2.28, -8.69], scale: [0.38, 0.3, 0.06] }
		], 'locomotive-headlights');
		instances(body, geometries.box, materials.redLamp, [
			{ position: [-0.92, 2.28, 8.69], scale: [0.25, 0.2, 0.06] },
			{ position: [0.92, 2.28, 8.69], scale: [0.25, 0.2, 0.06] }
		], 'locomotive-tail-lights');
		addBogies(body, length, 'locomotive');
		addCouplers(body, length, 'locomotive');
		note('locomotiveShell');
		note('windshields', 2);
		note('roofEquipment', 3);
		note('pantographs');
		train.add(body);
		return body;
	}

	function addCoach(index) {
		const body = new THREE.Group();
		const length = 22;
		body.name = `coach-${index}`;
		body.userData = { trainPart: 'coach', trainIndex: index, length };
		box(body, [3.18, 0.6, length - 0.6], [0, 0.98, 0], materials.underframe, 'coach-underframe');
		box(body, [3.05, 2.62, length], [0, 2.4, 0], materials.coach, 'coach-shell');
		box(body, [3.12, 0.34, length - 0.3], [0, 3.83, 0], materials.roof, 'coach-roof');
		box(body, [3.1, 0.16, length - 0.1], [0, 1.55, 0], materials.trim, 'coach-waist-stripe');

		const windows = [];
		for (const side of [-1, 1]) {
			for (const z of [-7.0, -4.7, -2.4, -0.1, 2.2, 4.5, 6.8]) {
				windows.push({ position: [side * 1.54, 2.95, z], scale: [0.06, 1.0, 1.55] });
			}
		}
		instances(body, geometries.box, materials.glass, windows, 'coach-windows');

		for (const side of [-1, 1]) {
			for (const z of [-8.8, 8.8]) {
				box(body, [0.08, 2.15, 1.34], [side * 1.55, 2.3, z], materials.trim, 'coach-door-frame');
				box(body, [0.07, 1.95, 1.08], [side * 1.6, 2.22, z], materials.coach, 'coach-door');
				box(body, [0.075, 0.83, 0.78], [side * 1.65, 2.83, z], materials.doorGlass, 'coach-door-window');
			}
		}

		instances(body, geometries.box, materials.roof, [
			{ position: [-0.72, 4.1, -4.8], scale: [1.05, 0.38, 2.1] },
			{ position: [0.72, 4.1, -4.8], scale: [1.05, 0.38, 2.1] },
			{ position: [0, 4.12, 4.2], scale: [1.85, 0.42, 2.8] }
		], 'coach-roof-equipment');
		for (const side of [-1, 1]) {
			box(body, [0.08, 0.55, 2.0], [side * 1.54, 1.0, 0], materials.dark, 'coach-step-fairing');
		}
		addBogies(body, length, 'coach');
		addCouplers(body, length, 'coach');
		note('coaches');
		note('windows', windows.length);
		note('doors', 4);
		train.add(body);
		return body;
	}

	addLocomotive();
	for (let index = 1; index < count; index++) addCoach(index);

	let drawItems = 0;
	let meshCount = 0;
	let instancedMeshes = 0;
	let instancesCount = 0;
	train.traverse(object => {
		if (object.isMesh) {
			meshCount++;
			drawItems++;
			instancesCount++;
		}
		if (object.isInstancedMesh) {
			instancedMeshes++;
			instancesCount += object.count - 1;
		}
	});
	train.userData.proceduralTrain = true;
	train.userData.trainModelResources = { geometries, materials };
	train.userData.trainDiagnostics = {
		vehicleCount: count,
		locomotives: 1,
		coaches: count - 1,
		orderedChildren: train.children.map(body => body.userData.trainPart),
		meshCount,
		drawItems,
		instancedMeshes,
		instances: instancesCount,
		sharedGeometries: Object.keys(geometries).length,
		sharedMaterials: Object.keys(materials).length,
		features: { ...features }
	};
	return train;
}

export function disposeProceduralTrain(train) {
	if (!train?.userData?.proceduralTrain) return;
	train.traverse(object => {
		if (object.isInstancedMesh) object.dispose();
	});
	const resources = train.userData.trainModelResources;
	if (!resources) return;
	Object.values(resources.geometries || {}).forEach(geometry => geometry.dispose());
	Object.values(resources.materials || {}).forEach(material => material.dispose());
	train.userData.trainModelResources = null;
}
