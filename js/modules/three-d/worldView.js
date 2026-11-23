import { createWorldRoute } from './worldRoute.js';
import { generateCorridorScenery } from './scenery.js';
import { pointInPolygon } from './geoScenery.js';
import { createTreeModels } from './treeModels.js';
import { createHillField } from './hills.js';
import { showWorldNotice } from './worldNotices.js';
import { createCabControls } from './cabControls.js';
import { createFramePacer } from '../framePacing.js';
import { createProceduralTrain, disposeProceduralTrain } from './trainModel.js';
import { readGraphicsTelemetry, resolveGraphicsQuality } from '../graphicsQuality.js';

const DEG = Math.PI / 180;
const METRES = 111195;
const SCENERY_CHUNK_METRES = 320;

function local(point, origin) {
	const longitude = ((point.lng - origin.lng + 540) % 360) - 180;
	return { x: longitude * Math.cos(origin.lat * DEG) * METRES, z: -(point.lat - origin.lat) * METRES };
}

// Approximate solar direction from UTC and position, independent of the device time zone.
export function solarDirection(date, lat, lng) {
	const start = Date.UTC(date.getUTCFullYear(), 0, 0);
	const day = (date.getTime() - start) / 86400000;
	const declination = 23.44 * DEG * Math.sin(2 * Math.PI * (day - 81) / 365.24);
	const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
	const hourAngle = (utcHours + lng / 15 - 12) * 15 * DEG;
	const latitude = lat * DEG;
	return {
		east: -Math.cos(declination) * Math.sin(hourAngle),
		north: Math.cos(latitude) * Math.sin(declination) - Math.sin(latitude) * Math.cos(declination) * Math.cos(hourAngle),
		up: Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle)
	};
}

export function solarElevation(date, lat, lng) {
	return Math.asin(Math.max(-1, Math.min(1, solarDirection(date, lat, lng).up)));
}

export function tunnelLightingBand(distance, stations) {
	if (stations.some(station => Math.abs(station.distance - distance) <= 100)) return 3;
	const phase = ((distance % 32) + 32) % 32;
	const fromLamp = Math.min(phase, 32 - phase);
	return fromLamp <= 4 ? 2 : fromLamp <= 12 ? 1 : 0;
}

export function createWorldView(THREE, container, state, onError, cabActions) {
	const cabAssistButton = document.getElementById('world3dAssist');
	const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
	function currentGraphicsConfig(quality = state.graphicsQuality || 'balanced') {
		return resolveGraphicsQuality(quality, {
			devicePixelRatio: window.devicePixelRatio || 1,
			mobile: !!state.isMobileDevice,
			performanceMode: !!state.performanceModeEnabled,
			viewportWidth: window.innerWidth
		});
	}
	let graphics = currentGraphicsConfig();
	renderer.setPixelRatio(graphics.pixelRatio);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	renderer.shadowMap.enabled = graphics.shadows;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.setClearColor(0xa6cce2);
	container.appendChild(renderer.domElement);
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0xa6cce2);
	scene.fog = new THREE.Fog(0xa6cce2, graphics.fogNear, graphics.fogFar);
	const camera = new THREE.PerspectiveCamera(57, 1, 0.1, graphics.maxViewDistance);
	const skyUniforms = {
		zenith: { value: new THREE.Color(0x4f91bf) },
		horizon: { value: new THREE.Color(0xc8e1e8) },
		sunDirection: { value: new THREE.Vector3(0, 1, 0) },
		sunIntensity: { value: 1 }
	};
	const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.ShaderMaterial({
		uniforms: skyUniforms,
		vertexShader: 'varying vec3 vDirection; void main(){ vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
		fragmentShader: 'uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDirection; uniform float sunIntensity; varying vec3 vDirection; void main(){ vec3 d=normalize(vDirection); float h=smoothstep(-0.08,0.7,d.y); vec3 color=mix(horizon,zenith,h); float sun=pow(max(dot(d,normalize(sunDirection)),0.0),384.0)*sunIntensity; gl_FragColor=vec4(color+vec3(1.0,0.83,0.55)*sun,1.0); }',
		side: THREE.BackSide,
		depthWrite: false,
		fog: false
	}));
	sky.frustumCulled = false;
	scene.add(sky);
	const ambient = new THREE.HemisphereLight(0xe4f4ff, 0x6d7045, 1.4);
	scene.add(ambient);
	const sun = new THREE.DirectionalLight(0xffe6bc, 2.2);
	sun.position.set(-80, 160, -120);
	sun.castShadow = renderer.shadowMap.enabled;
	sun.shadow.mapSize.set(graphics.shadowMapSize, graphics.shadowMapSize);
	Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 1, far: 500 });
	sun.shadow.camera.updateProjectionMatrix();
	sun.shadow.bias = -0.0004;
	scene.add(sun);
	scene.add(sun.target);
	const tunnelLights = [new THREE.PointLight(0xffdca2, 0, 120, 2)];
	tunnelLights[0].castShadow = false;
	tunnelLights.forEach(light => scene.add(light));
	const headlight = new THREE.SpotLight(0xfff2d0, 0, 220, 0.48, 0.6, 2);
	headlight.castShadow = false;
	headlight.target = new THREE.Object3D();
	scene.add(headlight, headlight.target);
	const grassCanvas = document.createElement('canvas');
	grassCanvas.width = 256;
	grassCanvas.height = 256;
	const grassContext = grassCanvas.getContext('2d');
	grassContext.fillStyle = '#91aa69';
	grassContext.fillRect(0, 0, 256, 256);
	let grassSeed = 193;
	for (let i = 0; i < 6000; i++) {
		grassSeed = (Math.imul(grassSeed, 1664525) + 1013904223) >>> 0;
		const x = grassSeed & 255;
		const y = (grassSeed >>> 8) & 255;
		grassContext.fillStyle = i % 3 === 0 ? '#758f56' : i % 3 === 1 ? '#a4b77a' : '#829b5e';
		grassContext.fillRect(x, y, 2, 1);
	}
	const grassTexture = new THREE.CanvasTexture(grassCanvas);
	grassTexture.colorSpace = THREE.SRGBColorSpace;
	grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
	grassTexture.repeat.set(250, 250);
	const concreteCanvas = document.createElement('canvas');
	concreteCanvas.width = concreteCanvas.height = 128;
	const concreteContext = concreteCanvas.getContext('2d');
	concreteContext.fillStyle = '#d4d4cd';
	concreteContext.fillRect(0, 0, 128, 128);
	concreteContext.fillStyle = '#c4c6bf';
	concreteContext.fillRect(0, 0, 128, 2);
	concreteContext.fillRect(0, 63, 128, 2);
	concreteContext.fillRect(0, 0, 2, 64);
	concreteContext.fillRect(64, 64, 2, 64);
	let concreteSeed = 317;
	for (let i = 0; i < 1200; i++) {
		concreteSeed = (Math.imul(concreteSeed, 1664525) + 1013904223) >>> 0;
		concreteContext.fillStyle = i % 2 ? '#c9cac3' : '#dcddd5';
		concreteContext.fillRect(concreteSeed & 127, (concreteSeed >>> 8) & 127, 1, 1);
	}
	const concreteTexture = new THREE.CanvasTexture(concreteCanvas);
	concreteTexture.colorSpace = THREE.SRGBColorSpace;
	let satelliteTexture = null;
	let satelliteScenery = null;

	const materials = {
		grass: new THREE.MeshLambertMaterial({ map: grassTexture }),
		ballast: new THREE.MeshLambertMaterial({ color: 0x5b5a50 }),
		rail: new THREE.MeshStandardMaterial({ color: 0xb7bdbe, metalness: 0.55, roughness: 0.5 }),
		sleeper: new THREE.MeshLambertMaterial({ color: 0x51483c }),
		trunk: new THREE.MeshLambertMaterial({ color: 0x665038 }),
		leaf: new THREE.MeshLambertMaterial({ color: 0x44784c }),
		leafLight: new THREE.MeshLambertMaterial({ color: 0x638d50 }),
		leafDark: new THREE.MeshLambertMaterial({ color: 0x28583c }),
		flower: new THREE.MeshLambertMaterial({ color: 0xc97483 }),
		leafGold: new THREE.MeshLambertMaterial({ color: 0xb49b4e }),
		palmLeaf: new THREE.MeshLambertMaterial({ color: 0x62834a, side: THREE.DoubleSide }),
		wall: new THREE.MeshLambertMaterial({ color: 0xd7d1b9 }),
		roof: new THREE.MeshLambertMaterial({ color: 0x91664c }),
		tunnel: new THREE.MeshLambertMaterial({ color: 0x90999a, map: concreteTexture, side: THREE.DoubleSide }),
		tunnelDim: new THREE.MeshLambertMaterial({ color: 0x90999a, map: concreteTexture, emissive: 0x24211d, side: THREE.DoubleSide }),
		tunnelMid: new THREE.MeshLambertMaterial({ color: 0x90999a, map: concreteTexture, emissive: 0x3e3730, side: THREE.DoubleSide }),
		tunnelLit: new THREE.MeshLambertMaterial({ color: 0x90999a, map: concreteTexture, emissive: 0x66543e, side: THREE.DoubleSide }),
		stationWall: new THREE.MeshLambertMaterial({ color: 0xd4d8d1, map: concreteTexture, emissive: 0x55554a, side: THREE.DoubleSide }),
		stationAccent: new THREE.MeshLambertMaterial({ color: 0x245e75, emissive: 0x15313b }),
		stationColumn: new THREE.MeshLambertMaterial({ color: 0xe4ded0, emissive: 0x49463b }),
		platform: new THREE.MeshLambertMaterial({ color: 0xbfc4bf, emissive: 0x44443b }),
		edge: new THREE.MeshBasicMaterial({ color: 0xe6c64f }),
		lamp: new THREE.MeshBasicMaterial({ color: 0xfff5cc }),
		water: new THREE.MeshLambertMaterial({ color: 0x568b99, side: THREE.DoubleSide }),
		farmland: new THREE.MeshLambertMaterial({ color: 0xa59b63, side: THREE.DoubleSide }),
		cropland: new THREE.MeshLambertMaterial({ color: 0x6f934d }),
		furrow: new THREE.MeshLambertMaterial({ color: 0x847b4c }),
		hill: new THREE.MeshLambertMaterial({ color: 0x7d9d89 }),
		window: new THREE.MeshStandardMaterial({ color: 0x243b4a, roughness: 0.25, metalness: 0.2 }),
		dark: new THREE.MeshLambertMaterial({ color: 0x303a3e }),
		white: new THREE.MeshLambertMaterial({ color: 0xe4ded0 })
	};
	const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), materials.grass);
	const treeModels = createTreeModels(THREE);
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = -0.12;
	ground.receiveShadow = true;
	scene.add(ground);
	const hills = new THREE.Group();
	const hillInstances = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 8), materials.hill, 49);
	hillInstances.count = 0;
	hills.add(hillInstances);
	scene.add(hills);

	let world = null;
	let hillField = null;
	let routeSnapshot = null;
	let scenery = null;
	let train = null;
	let origin = null;
	let cell = null;
	let mode = 'chase';
	let zoom = 1;
	let raf = 0;
	let disposed = false;
	let trainKey = '';
	let frameCount = 0;
	let lastTimestamp = 0;
	let frameAverage = 16.7;
	let fpsStart = 0;
	let fpsFrames = 0;
	let qualityScale = graphics.pixelRatio;
	let lastPerformanceMode = !!state.performanceModeEnabled;
	let lastGraphicsQuality = state.graphicsQuality || 'balanced';
	let lastAdaptiveChangeAt = 0;
	let adaptiveReductions = 0;
	let geoScenery = null;
	let orbitYaw = 0;
	let orbitPitch = 0;
	let pointer = null;
	const frameReady = createFramePacer();
	let weatherKey = '';
	let environmentTime = 0;
	let groundOpeningCount = 0;
	const skyColor = new THREE.Color();
	const precipGeometry = new THREE.BufferGeometry();
	const precipPositions = new Float32Array(500 * 3);
	for (let i = 0; i < precipPositions.length; i += 3) {
		precipPositions[i] = Math.sin(i * 19.7) * 42;
		precipPositions[i + 1] = (i * 13.7) % 35;
		precipPositions[i + 2] = Math.cos(i * 11.3) * 42;
	}
	precipGeometry.setAttribute('position', new THREE.BufferAttribute(precipPositions, 3));
	const precipitation = new THREE.Points(precipGeometry, new THREE.PointsMaterial({ color: 0xddeeff, size: 0.18, transparent: true, opacity: 0.7, depthWrite: false }));
	precipitation.visible = false;
	scene.add(precipitation);
	const cab = new THREE.Group();
	camera.add(cab);
	scene.add(camera);
	const cabControls = createCabControls(THREE, camera, renderer.domElement, state, cabActions);
	const passengerBodyGeometry = new THREE.CylinderGeometry(0.24, 0.3, 0.95, 6);
	const passengerHeadGeometry = new THREE.SphereGeometry(0.2, 8, 6);
	const passengerBodyMaterials = [0x2563a6, 0x9b3f52, 0xd28a31, 0x47724b]
		.map(color => new THREE.MeshLambertMaterial({ color }));
	const passengerHeadMaterial = new THREE.MeshLambertMaterial({ color: 0xc98e69 });
	const passengerAnimations = [];
	const pendingPassengerFlows = [];

	function applyGraphicsQuality(quality = state.graphicsQuality || 'balanced') {
		graphics = currentGraphicsConfig(quality);
		state.graphicsQualityConfig = graphics;
		qualityScale = graphics.pixelRatio;
		lastAdaptiveChangeAt = performance.now();
		adaptiveReductions = 0;
		renderer.setPixelRatio(qualityScale);
		renderer.shadowMap.enabled = graphics.shadows;
		camera.far = graphics.maxViewDistance;
		sky.scale.setScalar(graphics.maxViewDistance * 0.82);
		camera.updateProjectionMatrix();
		scene.fog.near = graphics.fogNear;
		scene.fog.far = graphics.fogFar;
		sun.castShadow = graphics.shadows;
		if (sun.shadow.mapSize.width !== graphics.shadowMapSize) {
			sun.shadow.mapSize.set(graphics.shadowMapSize, graphics.shadowMapSize);
			sun.shadow.map?.dispose();
			sun.shadow.map = null;
		}
		precipGeometry.setDrawRange(0, Math.round(500 * graphics.sceneDetail));
		grassTexture.anisotropy = Math.min(graphics.maxAnisotropy, renderer.capabilities.getMaxAnisotropy());
		satelliteTexture && (satelliteTexture.anisotropy = grassTexture.anisotropy);
		cell = null;
	}
	applyGraphicsQuality();

	function box(parent, width, height, length, material, x, y, z) {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, length), material);
		mesh.receiveShadow = true;
		mesh.position.set(x, y, z);
		parent.add(mesh);
		return mesh;
	}

	// Cab framing is camera-relative; functional controls are overlaid on its console.
	box(cab, 4.8, 0.8, 0.8, materials.dark, 0, -1.05, -2.0);
	box(cab, 0.18, 3.2, 0.25, materials.dark, -1.8, 0, -2.1);
	box(cab, 0.18, 3.2, 0.25, materials.dark, 1.8, 0, -2.1);
	box(cab, 4.0, 0.2, 0.25, materials.dark, 0, 1.05, -2.1);
	for (const x of [-1.4, 1.4]) {
		box(cab, 0.7, 0.32, 0.04, materials.window, x, -0.72, -1.57);
		box(cab, 0.38, 0.04, 0.05, materials.edge, x, -0.7, -1.54);
	}
	cab.visible = false;

	function disposeGroup(group) {
		if (!group) return;
		scene.remove(group);
		if (group.userData.proceduralTrain) {
			disposeProceduralTrain(group);
			return;
		}
		group.traverse(object => {
			if (object.isInstancedMesh) object.dispose();
			if (object.geometry && !object.userData.sharedGeometry) object.geometry.dispose();
			if (object.userData.ownedMaterial) {
				object.material.map?.dispose();
				object.material.dispose();
			}
		});
	}

	function rebuildTrain() {
		disposeGroup(train);
		const count = Math.max(1, state.trainCoaches?.length || 1);
		train = createProceduralTrain(THREE, count, window.trainColors || {});
		scene.add(train);
	}

	function setInstance(mesh, index, position, quaternion, scale) {
		const matrix = new THREE.Matrix4().compose(position, quaternion, scale);
		mesh.setMatrixAt(index, matrix);
	}

	function addInstances(group, geometry, material, transforms, sharedGeometry = false) {
		if (!transforms.length) {
			if (!sharedGeometry) geometry.dispose();
			return;
		}
		const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
		mesh.userData.sharedGeometry = sharedGeometry;
		mesh.castShadow = material === materials.trunk || material === materials.leaf || material === materials.leafLight ||
			material === materials.leafDark || material === materials.flower || material === materials.leafGold ||
			material === materials.palmLeaf || material === materials.wall || material === materials.tunnel;
		mesh.receiveShadow = material === materials.ballast || material === materials.sleeper ||
			[materials.tunnel, materials.tunnelDim, materials.tunnelMid, materials.tunnelLit, materials.stationWall].includes(material);
		transforms.forEach((transform, index) => setInstance(mesh, index, transform.position, transform.quaternion, transform.scale));
		mesh.instanceMatrix.needsUpdate = true;
		group.add(mesh);
		return mesh;
	}

	function transformAt(distance, yOffset = 0) {
		const pose = world.path.poseAt(distance, 2);
		const point = local(pose, origin);
		const h0 = world.heightAt(distance - 2);
		const h1 = world.heightAt(distance + 2);
		const rotation = new THREE.Euler(Math.atan2(h1 - h0, 4), -pose.bearing * DEG, 0, 'YXZ');
		return {
			position: new THREE.Vector3(point.x, world.heightAt(distance) + yOffset, point.z),
			quaternion: new THREE.Quaternion().setFromEuler(rotation),
			scale: new THREE.Vector3(1, 1, 1)
		};
	}

	function addStation(group, station) {
		const pose = world.path.poseAt(station.distance);
		const point = local(pose, origin);
		const stationGroup = new THREE.Group();
		stationGroup.userData.stationIndex = station.index;
		stationGroup.position.set(point.x, world.heightAt(station.distance), point.z);
		stationGroup.rotation.y = -pose.bearing * DEG;
		const parts = new Map();
		function stationBox(width, height, length, material, x, y, z) {
			if (!parts.has(material)) parts.set(material, []);
			parts.get(material).push({
				position: new THREE.Vector3(x, y, z),
				quaternion: new THREE.Quaternion(),
				scale: new THREE.Vector3(width, height, length)
			});
		}
		for (const side of [-1, 1]) {
			stationBox(5, 1, 190, materials.platform, side * 4.5, 0.5, 0);
			stationBox(0.2, 0.04, 190, materials.edge, side * 2.05, 1.03, 0);
			stationBox(0.3, 0.06, 190, materials.stationColumn, side * 2.5, 1.04, 0);
			stationBox(0.12, 0.65, 190, materials.stationAccent, side * 7.72, 3.9, 0);
			stationBox(0.12, 0.12, 190, materials.lamp, side * 7.71, 5.2, 0);
			for (let z = -80; z <= 80; z += 20) {
				stationBox(0.55, 5, 0.55, materials.stationColumn, side * 6.3, 3.5, z);
				stationBox(0.68, 0.22, 0.68, materials.stationAccent, side * 6.3, 1.22, z);
				stationBox(2.8, 0.13, 0.45, materials.lamp, side * 4.4, 6.4, z);
				stationBox(0.08, 2.3, 0.06, materials.stationAccent, side * 7.65, 2.3, z);
				if (z % 40 === 0) {
					stationBox(1.1, 0.18, 3.5, materials.dark, side * 5, 1.65, z + 6);
					stationBox(0.15, 0.55, 2.8, materials.dark, side * 5, 1.3, z + 6);
				}
			}
		}
		for (const [material, transforms] of parts) {
			addInstances(stationGroup, new THREE.BoxGeometry(1, 1, 1), material, transforms).receiveShadow = true;
		}
		const canvas = document.createElement('canvas');
		canvas.width = 512;
		canvas.height = 96;
		const ctx = canvas.getContext('2d');
		ctx.fillStyle = '#164e6b';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = '#ffffff';
		ctx.font = 'bold 42px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(station.name, 256, 62, 480);
		const texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		const signMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
		const signs = [];
		for (const side of [-1, 1]) {
			for (const z of [-60, 0, 60]) {
				signs.push({
					position: new THREE.Vector3(side * 7.55, 4.2, z),
					quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
					scale: new THREE.Vector3(5.2, 1, 0.08)
				});
			}
		}
		addInstances(stationGroup, new THREE.BoxGeometry(1, 1, 1), signMaterial, signs).userData.ownedMaterial = true;
		group.add(stationGroup);
	}

	function animatePassengerFlow({ stopIndex, boarded = 0, alighted = 0 }) {
		const stationGroup = scenery?.children.find(child => child.userData.stationIndex === stopIndex);
		if (!stationGroup) {
			pendingPassengerFlows.push({ flow: { stopIndex, boarded, alighted }, expiresAt: performance.now() + 5000 });
			return;
		}
		const addPeople = (count, entering) => {
			const visibleCount = Math.min(10, Math.max(0, Math.floor(count)));
			for (let i = 0; i < visibleCount; i++) {
				const side = i % 2 === 0 ? 1 : -1;
				const person = new THREE.Group();
				const body = new THREE.Mesh(passengerBodyGeometry, passengerBodyMaterials[i % passengerBodyMaterials.length]);
				const head = new THREE.Mesh(passengerHeadGeometry, passengerHeadMaterial);
				body.userData.sharedGeometry = true;
				body.position.y = 0.48;
				head.userData.sharedGeometry = true;
				head.userData.sharedMaterial = true;
				head.position.y = 1.1;
				person.add(body, head);
				const fromX = entering ? side * 5 : side * 1.7;
				const toX = entering ? side * 1.7 : side * 5;
				const z = -38 + ((i * 17) % 76);
				person.position.set(fromX, 1, z);
				stationGroup.add(person);
				passengerAnimations.push({ person, stationGroup, fromX, toX, z, startedAt: performance.now(), duration: 2200 });
			}
		};
		addPeople(boarded, true);
		addPeople(alighted, false);
	}

	function flushPendingPassengerFlows() {
		const now = performance.now();
		for (const pending of pendingPassengerFlows.splice(0)) {
			if (pending.expiresAt <= now) continue;
			const stationGroup = scenery?.children.find(child => child.userData.stationIndex === pending.flow.stopIndex);
			if (stationGroup) animatePassengerFlow(pending.flow);
			else pendingPassengerFlows.push(pending);
		}
	}

	function updatePassengerAnimations(timestamp) {
		for (let i = passengerAnimations.length - 1; i >= 0; i--) {
			const animation = passengerAnimations[i];
			const progress = Math.max(0, Math.min(1, (timestamp - animation.startedAt) / animation.duration));
			animation.person.position.x = animation.fromX + (animation.toX - animation.fromX) * progress;
			if (progress >= 1) {
				animation.stationGroup.remove(animation.person);
				passengerAnimations.splice(i, 1);
			}
		}
	}

	function addPortal(group, portal) {
		const pose = world.path.poseAt(portal.coverDistance);
		const point = local(pose, origin);
		const frame = new THREE.Group();
		frame.position.set(point.x, world.heightAt(portal.coverDistance), point.z);
		frame.rotation.y = -pose.bearing * DEG;
		for (const side of [-1, 1]) {
			box(frame, 0.9, 7.6, 1.3, materials.tunnel, side * 8, 3.8, 0);
			box(frame, 1.4, 0.2, 1.6, materials.dark, side * 8, 0.6, 0);
			const wing = box(frame, 0.55, 7.6, 7.5, materials.wall,
				side * 9.8, 3.8, -portal.direction * 3.1);
			wing.rotation.y = side * -portal.direction * 0.18;
			box(frame, 0.22, 0.32, 7.5, materials.stationAccent,
				side * 7.55, 0.65, -portal.direction * 3.1);
		}
		box(frame, 16.8, 0.9, 1.3, materials.tunnel, 0, 7.6, 0);
		box(frame, 4, 0.18, 0.08, materials.edge, 0, 6.9, portal.direction * 0.68);
		frame.userData.portal = true;
		group.add(frame);
	}

	function rebuildGround(distance) {
		const shape = new THREE.Shape();
		shape.moveTo(-2500, -2500);
		shape.lineTo(2500, -2500);
		shape.lineTo(2500, 2500);
		shape.lineTo(-2500, 2500);
		shape.closePath();
		for (const portal of world.portals) {
			if (Math.abs(portal.distance - distance) > 1300) continue;
			const start = Math.max(0, Math.min(world.path.length, portal.distance - portal.direction * 8));
			const end = Math.max(0, Math.min(world.path.length, portal.coverDistance + portal.direction * 16));
			if (Math.abs(end - start) < 1) continue;
			const left = [], right = [];
			const count = Math.ceil(Math.abs(end - start) / 10);
			for (let i = 0; i <= count; i++) {
				const pose = world.path.poseAt(start + (end - start) * i / count, 3);
				const point = local(pose, origin);
				const angle = pose.bearing * DEG;
				const dx = Math.cos(angle) * 9.5, dz = Math.sin(angle) * 9.5;
				left.push([point.x + dx, -(point.z + dz)]);
				right.push([point.x - dx, -(point.z - dz)]);
			}
			const hole = new THREE.Path();
			for (const [i, point] of [...left, ...right.reverse()].entries()) {
				if (i === 0) hole.moveTo(point[0], point[1]);
				else hole.lineTo(point[0], point[1]);
			}
			hole.closePath();
			shape.holes.push(hole);
		}
		const geometry = new THREE.ShapeGeometry(shape);
		groundOpeningCount = shape.holes.length;
		const uv = geometry.attributes.uv;
		for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 5000 + 0.5, uv.getY(i) / 5000 + 0.5);
		ground.geometry.dispose();
		ground.geometry = geometry;
	}

	function addMappedFeatures(group) {
		if (!geoScenery) return;
		const buildings = [];
		const roofs = [];
		let mappedCount = 0;
		for (const record of geoScenery.records) {
			const kind = record.categories.includes('building') ? 'building'
				: record.categories.includes('water') ? 'water'
					: record.categories.includes('farmland') ? 'farmland' : null;
			if (!kind) continue;
			for (const polygon of record.polygons) {
				const coords = polygon.outer.map(point => local(point, origin));
				let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
				for (const point of coords) {
					minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
					minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
				}
				if (minX > 1200 || maxX < -1200 || minZ > 1200 || maxZ < -1200) continue;
				if (kind === 'building') {
					let start = Infinity, end = -Infinity, nearTrack = false;
					for (const point of polygon.outer) {
						const projected = world.path.project(point);
						start = Math.min(start, projected.distance);
						end = Math.max(end, projected.distance);
						if (projected.error < 12) { nearTrack = true; break; }
					}
					if (nearTrack) continue;
					start = Math.max(0, start);
					end = Math.min(world.path.length, end);
					let crossesTrack = false;
					for (let d = start; d <= end; d += 10) {
						if (pointInPolygon(world.path.pointAt(d), polygon)) { crossesTrack = true; break; }
					}
					if (crossesTrack) continue;
				}
				const height = Math.min(60, record.heightMetres || (record.levels ? record.levels * 3 : 6));
				if (kind === 'building') {
					buildings.push({
						position: new THREE.Vector3((minX + maxX) / 2, height / 2, (minZ + maxZ) / 2),
						quaternion: new THREE.Quaternion(),
						scale: new THREE.Vector3(Math.max(4, maxX - minX), height, Math.max(4, maxZ - minZ))
					});
					roofs.push({
						position: new THREE.Vector3((minX + maxX) / 2, height + 0.2, (minZ + maxZ) / 2),
						quaternion: new THREE.Quaternion(),
						scale: new THREE.Vector3(Math.max(4.2, maxX - minX + 0.3), 0.35, Math.max(4.2, maxZ - minZ + 0.3))
					});
					mappedCount++;
					continue;
				}
				const shape = new THREE.Shape();
				coords.forEach((point, index) => {
					if (index === 0) shape.moveTo(point.x, -point.z);
					else shape.lineTo(point.x, -point.z);
				});
				for (const hole of polygon.holes) {
					const path = new THREE.Path();
					hole.forEach((point, index) => {
						const projected = local(point, origin);
						if (index === 0) path.moveTo(projected.x, -projected.z);
						else path.lineTo(projected.x, -projected.z);
					});
					shape.holes.push(path);
				}
				const geometry = new THREE.ShapeGeometry(shape);
				const mesh = new THREE.Mesh(geometry, materials[kind]);
				mesh.castShadow = false;
				mesh.receiveShadow = true;
				mesh.rotation.x = -Math.PI / 2;
				mesh.position.y = kind === 'water' ? 0.01 : kind === 'farmland' ? 0.005 : 0;
				mesh.userData.mappedFeature = kind;
				group.add(mesh);
				mappedCount++;
			}
		}
		addInstances(group, new THREE.BoxGeometry(1, 1, 1), materials.wall, buildings);
		addInstances(group, new THREE.BoxGeometry(1, 1, 1), materials.roof, roofs);
		group.userData.mappedFeatureCount = mappedCount;
	}

	function updateSatelliteMapping() {
		if (!satelliteTexture || !satelliteScenery || !origin) return;
		const span = satelliteScenery.canvas.width * satelliteScenery.metresPerPixel;
		const offset = local(origin, satelliteScenery.center);
		satelliteTexture.repeat.set(5000 / span, 5000 / span);
		satelliteTexture.offset.set(
			0.5 + (offset.x - 2500) / span,
			0.5 + (-offset.z - 2500) / span
		);
		satelliteTexture.needsUpdate = true;
	}

	function rebuildScenery(distance) {
		for (const animation of passengerAnimations) animation.stationGroup.remove(animation.person);
		disposeGroup(scenery);
		scenery = new THREE.Group();
		origin = world.path.pointAt(distance);
		updateSatelliteMapping();
		const hillSamples = hillField(origin);
		hillInstances.count = hillSamples.length;
		hillSamples.forEach((hill, index) => {
			const point = local(hill, origin);
			setInstance(hillInstances, index, new THREE.Vector3(point.x, -65, point.z),
				new THREE.Quaternion(), new THREE.Vector3(hill.width, hill.height, hill.length));
		});
		hillInstances.instanceMatrix.needsUpdate = true;
		hillInstances.computeBoundingSphere();
		ground.position.set(0, -0.12, 0);
		rebuildGround(distance);
		const rails = [], railBases = [], ballast = [], sleepers = [], cutWalls = [], cutFloors = [], fixtures = [], poles = [], wires = [];
		const tunnelRibs = [], tunnelServices = [], tunnelMarkers = [];
		const walls = Array.from({ length: 4 }, () => []);
		const ceilings = Array.from({ length: 4 }, () => []);
		const floors = Array.from({ length: 4 }, () => []);
		const rearExtent = Math.max(220, (state.trainCoaches?.length || 1) * 23 + 80);
		const routeStep = graphics.sceneDetail < 0.8 ? 12 : 8;
		const sectionLength = routeStep + 0.15;
		const start = Math.floor((distance - rearExtent) / routeStep) * routeStep;
		const end = Math.min(world.path.length + 100, distance + Math.min(900, graphics.maxViewDistance));
		for (let d = start; d <= end; d += routeStep) {
			const t = transformAt(d, 0.06);
			ballast.push({ ...t, scale: new THREE.Vector3(4.5, 0.22, sectionLength) });
			for (const side of [-1, 1]) {
				const offset = new THREE.Vector3(side * 0.838, 0.25, 0).applyQuaternion(t.quaternion);
				rails.push({ ...t, position: t.position.clone().add(offset), scale: new THREE.Vector3(0.1, 0.14, sectionLength) });
				railBases.push({ ...t, position: t.position.clone().add(offset).add(new THREE.Vector3(0, -0.07, 0)), scale: new THREE.Vector3(0.22, 0.045, sectionLength) });
			}

			if (world.heightAt(d) < 0) {
				const floorOffset = new THREE.Vector3(0, -0.18, 0).applyQuaternion(t.quaternion);
				const band = tunnelLightingBand(d, world.stations);
				(world.isTunnelAt(d) ? floors[band] : cutFloors).push({ ...t, position: t.position.clone().add(floorOffset), scale: new THREE.Vector3(20, 0.2, sectionLength) });
				const wallHeight = world.isTunnelAt(d) ? 7.3 : Math.max(0.1, -world.heightAt(d));
				for (const side of [-1, 1]) {
					const offset = new THREE.Vector3(side * 8, wallHeight / 2, 0).applyQuaternion(t.quaternion);
					(world.isTunnelAt(d) ? walls[band] : cutWalls).push({ ...t, position: t.position.clone().add(offset), scale: new THREE.Vector3(0.4, wallHeight, sectionLength) });
				}
			}
			if (world.isTunnelAt(d)) {
				const offset = new THREE.Vector3(0, 7.2, 0).applyQuaternion(t.quaternion);
				ceilings[tunnelLightingBand(d, world.stations)].push({ ...t, position: t.position.clone().add(offset), scale: new THREE.Vector3(16, 0.4, sectionLength) });
				if (graphics.sceneDetail >= 0.8 && tunnelLightingBand(d, world.stations) !== 3) {
					for (const side of [-1, 1]) {
						const service = new THREE.Vector3(side * 7.73, 2.2, 0).applyQuaternion(t.quaternion);
						tunnelServices.push({ ...t, position: t.position.clone().add(service), scale: new THREE.Vector3(0.16, 0.18, sectionLength) });
						const rib = new THREE.Vector3(side * 7.72, 3.65, 0).applyQuaternion(t.quaternion);
						tunnelRibs.push({ ...t, position: t.position.clone().add(rib), scale: new THREE.Vector3(0.16, 7.1, 0.12) });
						if (Math.round(d) % 32 === 0) {
							const marker = new THREE.Vector3(side * 7.62, 1.1, 0).applyQuaternion(t.quaternion);
							tunnelMarkers.push({ ...t, position: t.position.clone().add(marker), scale: new THREE.Vector3(0.05, 0.28, 0.6) });
						}
					}
					const crown = new THREE.Vector3(0, 6.96, 0).applyQuaternion(t.quaternion);
					tunnelRibs.push({ ...t, position: t.position.clone().add(crown), scale: new THREE.Vector3(15.5, 0.14, 0.12) });
				}
				if (Math.round(d) % 32 === 0) {
					fixtures.push({ ...t, position: t.position.clone().add(new THREE.Vector3(0, 6.95, 0).applyQuaternion(t.quaternion)), scale: new THREE.Vector3(2, 0.08, 0.5) });
				}
			} else {
				if (Math.round(d) % 40 === 0) {
					poles.push({ ...t, position: t.position.clone().add(new THREE.Vector3(3.2, 3.5, 0).applyQuaternion(t.quaternion)), scale: new THREE.Vector3(0.18, 7, 0.18) });
				}
				wires.push({ ...t, position: t.position.clone().add(new THREE.Vector3(0, 6.2, 0).applyQuaternion(t.quaternion)), scale: new THREE.Vector3(0.035, 0.035, sectionLength) });
			}
		}
		const sleeperStep = graphics.sceneDetail < 0.8 ? 1.05 : 0.65;
		for (let d = Math.floor((distance - rearExtent) / sleeperStep) * sleeperStep;
			d <= Math.min(world.path.length + 100, distance + Math.min(500, graphics.maxViewDistance)); d += sleeperStep) {
			sleepers.push({ ...transformAt(d, 0.16), scale: new THREE.Vector3(2.8, 0.14, 0.24) });
		}
		for (const [list, material] of [[ballast, materials.ballast], [rails, materials.rail], [railBases, materials.rail], [sleepers, materials.sleeper], [cutWalls, materials.tunnel], [cutFloors, materials.tunnel], [fixtures, materials.lamp], [poles, materials.dark], [wires, materials.dark], [tunnelRibs, materials.dark], [tunnelServices, materials.rail], [tunnelMarkers, materials.edge]]) {
			addInstances(scenery, new THREE.BoxGeometry(1, 1, 1), material, list);
		}
		const tunnelMaterials = [materials.tunnelDim, materials.tunnelMid, materials.tunnelLit, materials.stationWall];
		for (let band = 0; band < tunnelMaterials.length; band++) {
			for (const parts of [walls, ceilings, floors]) {
				addInstances(scenery, new THREE.BoxGeometry(1, 1, 1), tunnelMaterials[band], parts[band]);
			}
		}
		const lightBase = Math.round(distance / 128) * 128;
		tunnelLights.forEach(light => {
			const d = lightBase;
			light.position.copy(transformAt(d, 6.7).position);
			light.intensity = world.isTunnelAt(d) ? (tunnelLightingBand(d, world.stations) === 3 ? 900 : 450) : 0;
			light.userData.distance = d;
		});
		for (const station of world.stations) {
			if (Math.abs(station.distance - distance) < 1100) addStation(scenery, station);
		}
		for (const portal of world.portals) {
			if (Math.abs(portal.distance - distance) < 1100) addPortal(scenery, portal);
		}
		const trees = [[], [], [], [], []], shrubs = [], rocks = [], buildings = [[], [], []], roofs = [];
		const fields = [[], []], furrows = [];
		const rebuildingUnderground = world.isTunnelAt(distance);
		if (!rebuildingUnderground) addMappedFeatures(scenery);
		else if (geoScenery) scenery.userData.mappedFeatureCount = geoScenery.records.length;
		for (let sample = Math.max(0, distance - 160); sample <= Math.min(world.path.length, distance + 800); sample += 400) {
			if (world.heightAt(sample) < -1) continue;
			const generated = generateCorridorScenery(world.path, sample, graphics.sceneDetail < 0.9);
			for (const tree of generated.trees) {
				const kind = geoScenery?.classify(tree).category;
				if (kind && kind !== 'forest') continue;
				const p = local(tree, origin);
				const pos = new THREE.Vector3(p.x, 0, p.z);
				const q = new THREE.Quaternion();
				const angle = (Math.sin(tree.lat * 1263.1 + tree.lng * 831.7) * 43758.5453) % (2 * Math.PI);
				const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
				trees[tree.species].push({ position: pos, quaternion: rotation, scale: new THREE.Vector3(tree.height, tree.height, tree.height) });
				if (tree.species === 1) shrubs.push({ position: pos.clone().add(new THREE.Vector3(4, 0.55, -3)), quaternion: q, scale: new THREE.Vector3(1.7, 0.8, 1.4) });
				if (tree.species === 2) rocks.push({ position: pos.clone().add(new THREE.Vector3(-3, 0.35, 4)), quaternion: q, scale: new THREE.Vector3(1.1, 0.55, 0.8) });
			}
			for (const building of generated.buildings) {
				if (geoScenery?.classify(building).category) continue;
				const p = local(building, origin);
				const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -building.bearing * DEG, 0));
				buildings[building.variant].push({ position: new THREE.Vector3(p.x, building.height / 2, p.z), quaternion: q, scale: new THREE.Vector3(9, building.height, 8) });
				roofs.push({ position: new THREE.Vector3(p.x, building.height + 0.3, p.z), quaternion: q, scale: new THREE.Vector3(9.7, 0.6, 8.7) });
			}
			for (const field of generated.fields) {
				if (geoScenery?.classify(field).category) continue;
				const p = local(field, origin);
				const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -field.bearing * DEG, 0));
				fields[field.variant].push({ position: new THREE.Vector3(p.x, 0.005, p.z), quaternion: q, scale: new THREE.Vector3(90, 0.02, 65) });
				for (let row = -4; row <= 4; row++) {
					const offset = new THREE.Vector3(row * 9, 0.02, 0).applyQuaternion(q);
					furrows.push({ position: new THREE.Vector3(p.x, 0.02, p.z).add(offset), quaternion: q, scale: new THREE.Vector3(0.35, 0.02, 64) });
				}
			}
		}
		for (let i = 0; i < trees.length; i++) {
			addInstances(scenery, treeModels[i].bark, materials.trunk, trees[i], true);
			addInstances(scenery, treeModels[i].leaves,
				[materials.leaf, materials.leafLight, materials.leafDark, materials.flower, materials.palmLeaf][i], trees[i], true);
		}
		addInstances(scenery, new THREE.IcosahedronGeometry(1, 1), materials.leafDark, shrubs);
		addInstances(scenery, new THREE.IcosahedronGeometry(1, 0), materials.tunnel, rocks);
		for (let i = 0; i < fields.length; i++) addInstances(scenery, new THREE.BoxGeometry(1, 1, 1), [materials.farmland, materials.cropland][i], fields[i]);
		addInstances(scenery, new THREE.BoxGeometry(1, 1, 1), materials.furrow, furrows);
		for (let i = 0; i < buildings.length; i++) addInstances(scenery, new THREE.BoxGeometry(1, 1, 1), [materials.wall, materials.white, materials.roof][i], buildings[i]);
		addInstances(scenery, new THREE.BoxGeometry(1, 1, 1), materials.roof, roofs);
		scene.add(scenery);
		for (let i = passengerAnimations.length - 1; i >= 0; i--) {
			const animation = passengerAnimations[i];
			const stationGroup = scenery.children.find(child =>
				child.userData.stationIndex === animation.stationGroup.userData.stationIndex);
			if (!stationGroup) passengerAnimations.splice(i, 1);
			else {
				animation.stationGroup = stationGroup;
				stationGroup.add(animation.person);
			}
		}
		flushPendingPassengerFlows();
	}

	function updateRoute() {
		const manual = !!state.manualControlState?.isManualMode;
		if (routeSnapshot && routeSnapshot.route === state.route && routeSnapshot.smooth === state.smoothRoute &&
			(routeSnapshot.manual === manual || (!manual && state.index >= state.route.length - 1))) return;
		world = createWorldRoute(state.route, state.smoothRoute, manual && !state.manualUsesSmoothRoute);
		hillField = createHillField(world.path);
		routeSnapshot = { route: state.route, smooth: state.smoothRoute, manual };
		cell = null;
	}

	function resize() {
		const width = container.clientWidth;
		const height = container.clientHeight;
		if (!width || !height) return;
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		cabControls.resize(camera.aspect);
	}

	function render(timestamp) {
		if (disposed || document.hidden) { raf = 0; return; }
		try {
			const targetFPS = state.performanceModeEnabled ? Math.min(state.targetFPS || 60, 30) : state.targetFPS || 60;
			if (!frameReady(timestamp, targetFPS)) {
				raf = requestAnimationFrame(render);
				return;
			}
			if (lastPerformanceMode !== !!state.performanceModeEnabled) {
				lastPerformanceMode = !!state.performanceModeEnabled;
				applyGraphicsQuality(lastGraphicsQuality);
				resize();
			} else if (lastGraphicsQuality !== (state.graphicsQuality || 'balanced')) {
				lastGraphicsQuality = state.graphicsQuality || 'balanced';
				applyGraphicsQuality(lastGraphicsQuality);
				resize();
			}
			updateRoute();
			const distance = world.distanceAt(state.index, state.progress);
			const tunnelDepth = Math.max(0, -world.heightAt(distance));
			state.currentTunnelDepth = tunnelDepth;
			state.currentTrackGrade = world.gradeAt(distance) * 100;
			state.currentTrackSection = world.isTunnelAt(distance) ? 'Tunnel' : world.isRampAt(distance) ? 'Ramp' : 'Surface';
			const key = `${state.trainCoaches?.length || 1}:${window.trainColors?.locomotive}:${window.trainColors?.coach}`;
			if (key !== trainKey) { trainKey = key; rebuildTrain(); cell = null; }
			const nextCell = Math.floor(distance / SCENERY_CHUNK_METRES);
			if (nextCell !== cell) {
				cell = nextCell;
				rebuildScenery(nextCell * SCENERY_CHUNK_METRES);
			}
			for (let i = 0; i < train.children.length; i++) {
				const t = transformAt(distance - (i ? 20 + (i - 1) * 23 : 0));
				train.children[i].position.copy(t.position);
				train.children[i].quaternion.copy(t.quaternion);
				train.children[i].visible = mode !== 'cab' || i !== 0;
			}
			const pose = world.path.poseAt(distance);
			const heading = pose.bearing * DEG;
			const forward = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
			const vehicleTransform = transformAt(distance);
			const vehicle = vehicleTransform.position;
			const underground = world.isTunnelAt(distance);
			const shadows = graphics.shadows;
			renderer.shadowMap.enabled = shadows;
			const cabManual = mode === 'cab' && !!state.manualControlState?.isManualMode;
			document.body.classList.toggle('world3d-cab-view', mode === 'cab');
			document.body.classList.toggle('world3d-cab-manual', cabManual);
			if (cabAssistButton.hidden === cabManual) cabAssistButton.hidden = !cabManual;
			cab.visible = mode === 'cab';
			cabControls.update(timestamp, mode === 'cab');
			if (timestamp - environmentTime > 5000 || !environmentTime) {
				environmentTime = timestamp;
				const weather = state.weatherCardState?.currentWeatherData;
				const condition = weather && !weather.unavailable ? weather.condition : null;
				if (condition !== weatherKey) {
					weatherKey = condition;
					showWorldNotice('world3dWeather', condition ? `Weather: ${condition}` : 'Weather unavailable');
				}
			}
			const solar = solarDirection(new Date(), pose.lat, pose.lng);
			const elevation = Math.asin(Math.max(-1, Math.min(1, solar.up)));
			const daylight = Math.max(0, Math.min(1, (elevation + 0.08) / 0.35));
			sun.castShadow = shadows && !underground && daylight > 0;
			const overcast = /rain|drizzle|thunder|cloud|snow|fog|mist/i.test(weatherKey || '');
			const shelter = THREE.MathUtils.smoothstep(-world.heightAt(distance), 5, 9);
			const intensity = daylight * (overcast ? 0.48 : 1);
			ambient.intensity = THREE.MathUtils.lerp(0.16 + intensity * 1.25, 0.09, shelter);
			sun.intensity = intensity * 2.2 * (1 - shelter);
			sun.position.set(solar.east * 220, Math.max(1, solar.up * 220), -solar.north * 220);
			skyColor.setHex(overcast ? 0x8297a0 : 0xa6cce2).multiplyScalar(0.18 + daylight * 0.82);
			scene.background.copy(skyColor);
			scene.fog.color.copy(skyColor);
			scene.fog.near = overcast ? Math.min(260, graphics.fogNear) : graphics.fogNear;
			scene.fog.far = overcast ? Math.min(850, graphics.fogFar) : graphics.fogFar;
			sky.position.copy(camera.position);
			skyUniforms.zenith.value.setHex(overcast ? 0x536975 : 0x4f91bf).multiplyScalar(0.35 + daylight * 0.65);
			skyUniforms.horizon.value.copy(skyColor);
			skyUniforms.sunDirection.value.set(solar.east, solar.up, -solar.north);
			skyUniforms.sunIntensity.value = daylight * (overcast ? 0.12 : 1);
			renderer.toneMappingExposure = THREE.MathUtils.lerp(0.78 + daylight * 0.25, 1.12, 1 - shelter);
			headlight.position.copy(vehicle).add(new THREE.Vector3(0, 2.2, 0));
			headlight.target.position.copy(transformAt(distance + 100, 1.2).position);
			headlight.intensity = underground ? 900 : (daylight < 0.3 ? 650 : 180);
			headlight.target.updateMatrixWorld();
			precipitation.visible = !underground && /rain|drizzle|thunder|snow/i.test(weatherKey || '');
			precipitation.material.size = /snow/i.test(weatherKey || '') ? 0.45 : 0.18;
			precipitation.position.set(vehicle.x, vehicle.y - (timestamp * 0.012 % 20), vehicle.z);
			if (mode === 'cab') {
				camera.position.copy(vehicle).add(new THREE.Vector3(0, 3.7, -7).applyQuaternion(vehicleTransform.quaternion));
				camera.lookAt(transformAt(distance + 60, 3.3).position);
			} else {
				const trainLength = train.children.length > 1 ? 35 + (train.children.length - 2) * 23 : 12;
				const back = Math.max(32 * zoom, trainLength + 22);
				const rearDistance = distance - back;
				const rear = transformAt(rearDistance).position;
				const shelterBehind = THREE.MathUtils.smoothstep(-world.heightAt(rearDistance), 1, 8.5);
				const height = THREE.MathUtils.lerp(Math.max(3, (13 + orbitPitch * (mode === 'free' ? 10 : 0)) * zoom), 4.2, shelterBehind);
				const orbit = mode === 'free' ? orbitYaw * (1 - shelterBehind) : 0;
				const direction = new THREE.Vector3(Math.sin(heading + orbit), 0, -Math.cos(heading + orbit));
				camera.position.copy(rear).addScaledVector(direction.clone().sub(forward), -back);
				camera.position.y += height;
				camera.lookAt(transformAt(distance + 8, 2).position);
			}
			updatePassengerAnimations(timestamp);
			renderer.render(scene, camera);
			frameCount++;
			if (!fpsStart) fpsStart = timestamp;
			fpsFrames++;
			if (timestamp - fpsStart >= 1000) {
				state.renderFPS = Math.round(fpsFrames * 1000 / (timestamp - fpsStart));
				document.getElementById('renderFps').textContent = String(state.renderFPS);
				fpsStart = timestamp;
				fpsFrames = 0;
			}
			if (lastTimestamp) {
				frameAverage = frameAverage * 0.97 + Math.min(100, timestamp - lastTimestamp) * 0.03;
				const targetFrameTime = 1000 / Math.max(1, targetFPS);
				const canLowerResolution = adaptiveReductions === 0
					&& timestamp - lastAdaptiveChangeAt >= 12000
					&& frameAverage > targetFrameTime * 2
					&& qualityScale > graphics.minPixelRatio;
				if (canLowerResolution) {
					qualityScale = Math.max(graphics.minPixelRatio, qualityScale - 0.15);
					lastAdaptiveChangeAt = timestamp;
					adaptiveReductions++;
					renderer.setPixelRatio(qualityScale);
					resize();
				}
			}
			lastTimestamp = timestamp;
			raf = requestAnimationFrame(render);
		} catch (error) {
			raf = 0;
			onError(error);
		}
	}

	function visibilityChanged() {
		lastTimestamp = 0;
		fpsStart = 0;
		fpsFrames = 0;
		frameReady.reset();
		if (!document.hidden && !raf && !disposed) raf = requestAnimationFrame(render);
	}
	function contextLost(event) {
		event.preventDefault();
		onError(new Error('The 3D graphics context was lost. Return to 2D and try again.'));
	}
	function pointerDown(event) {
		if (mode === 'cab' && state.manualControlState?.isManualMode && cabControls.pointerDown(event)) {
			pointer = { id: event.pointerId, cab: true };
			renderer.domElement.setPointerCapture(event.pointerId);
			event.preventDefault();
			return;
		}
		if (mode !== 'free') return;
		pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
		renderer.domElement.setPointerCapture(event.pointerId);
	}
	function pointerMove(event) {
		if (!pointer || pointer.id !== event.pointerId) return;
		if (pointer.cab) { cabControls.pointerMove(event); return; }
		orbitYaw += (event.clientX - pointer.x) * 0.008;
		orbitPitch = Math.max(-0.8, Math.min(2, orbitPitch + (event.clientY - pointer.y) * 0.01));
		pointer.x = event.clientX;
		pointer.y = event.clientY;
	}
	function pointerUp(event) {
		if (pointer?.id === event.pointerId) {
			if (pointer.cab) cabControls.pointerUp();
			pointer = null;
		}
	}
	const resizeObserver = new ResizeObserver(resize);
	resizeObserver.observe(container);
	window.addEventListener('resize', resize);
	document.addEventListener('visibilitychange', visibilityChanged);
	renderer.domElement.addEventListener('webglcontextlost', contextLost);
	renderer.domElement.addEventListener('pointerdown', pointerDown);
	renderer.domElement.addEventListener('pointermove', pointerMove);
	renderer.domElement.addEventListener('pointerup', pointerUp);
	renderer.domElement.addEventListener('pointercancel', pointerUp);
	resize();
	raf = requestAnimationFrame(render);
	return {
		setMode(value) { mode = value; },
		setGeoScenery(value) { geoScenery = value; cell = null; },
		setSatelliteScenery(imagery) {
			satelliteTexture?.dispose();
			satelliteScenery = imagery;
			state.worldSatelliteMosaic = imagery;
			satelliteTexture = new THREE.CanvasTexture(imagery.canvas);
			satelliteTexture.colorSpace = THREE.SRGBColorSpace;
			satelliteTexture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
			materials.grass.map = satelliteTexture;
			materials.grass.needsUpdate = true;
			updateSatelliteMapping();
		},
		animatePassengerFlow,
		setGraphicsQuality(quality) {
			lastGraphicsQuality = quality;
			applyGraphicsQuality(quality);
			resize();
		},
		zoom(inward) { zoom = Math.max(0.6, Math.min(3, zoom * (inward ? 0.8 : 1.25))); },
		cabWheel(event) { return mode === 'cab' && state.manualControlState?.isManualMode && cabControls.wheel(event); },
		toggleWipers() { return cabControls.toggleWipers(); },
		toggleCabDisplays(visible) { return cabControls.toggleDisplays(visible); },
		getStats() { return { frames: frameCount, distance: world?.distanceAt(state.index, state.progress), stationCount: world?.stations.length, portalCount: world?.portals.length,
			underground: world?.isTunnelAt(world.distanceAt(state.index, state.progress)), weather: weatherKey || null, groundOpenings: groundOpeningCount,
			trackHeight: world?.heightAt(world.distanceAt(state.index, state.progress)), cameraHeight: camera.position.y,
			targetFPS: state.performanceModeEnabled ? Math.min(state.targetFPS || 60, 30) : state.targetFPS || 60,
			pixelRatio: renderer.getPixelRatio(),
			wipers: cabControls.getWipers(),
			cabDisplays: cabControls.getDisplaysVisible(),
			passengerAnimations: passengerAnimations.length,
			precipitation: precipitation.visible, tunnelShadows: false,
			...readGraphicsTelemetry(renderer, graphics),
			frameTime: frameAverage,
			train: train?.userData.trainDiagnostics || null,
			ramp: world?.isRampAt(world.distanceAt(state.index, state.progress)),
			gradePercent: (world?.gradeAt(world.distanceAt(state.index, state.progress)) || 0) * 100,
			tunnelLights: tunnelLights.filter(light => light.intensity > 0).map(light => ({ distance: light.userData.distance, intensity: light.intensity })),
			headlightIntensity: headlight.intensity,
			dynamicLights: (tunnelLights.some(light => light.intensity > 0) ? 1 : 0) + (headlight.intensity > 0 ? 1 : 0),
			visibleStationCount: scenery?.children.filter(child => Number.isInteger(child.userData.stationIndex)).length || 0,
			satelliteTiles: satelliteScenery?.loaded || 0,
			stationMeshCount: scenery?.children.filter(child => Number.isInteger(child.userData.stationIndex))
				.reduce((count, station) => count + station.children.filter(child => child.isMesh).length, 0) || 0,
			drawCalls: renderer.info.render.calls, mappedFeatures: scenery?.userData.mappedFeatureCount || 0 }; },
		dispose() {
			disposed = true;
			if (raf) cancelAnimationFrame(raf);
			window.removeEventListener('resize', resize);
			resizeObserver.disconnect();
			document.removeEventListener('visibilitychange', visibilityChanged);
			renderer.domElement.removeEventListener('webglcontextlost', contextLost);
			renderer.domElement.removeEventListener('pointerdown', pointerDown);
			renderer.domElement.removeEventListener('pointermove', pointerMove);
			renderer.domElement.removeEventListener('pointerup', pointerUp);
			renderer.domElement.removeEventListener('pointercancel', pointerUp);
			disposeGroup(scenery);
			disposeGroup(train);
			state.worldSatelliteMosaic = null;
			passengerBodyGeometry.dispose();
			passengerHeadGeometry.dispose();
			passengerBodyMaterials.forEach(material => material.dispose());
			passengerHeadMaterial.dispose();
			cabControls.dispose();
			sky.geometry.dispose();
			sky.material.dispose();
			cab.traverse(object => object.geometry?.dispose());
			precipGeometry.dispose();
			precipitation.material.dispose();
			ground.geometry.dispose();
			hills.traverse(object => object.geometry?.dispose());
			hillInstances.dispose();
			treeModels.forEach(model => { model.bark.dispose(); model.leaves.dispose(); });
			grassTexture.dispose();
			satelliteTexture?.dispose();
			concreteTexture.dispose();
			Object.values(materials).forEach(material => material.dispose());
			renderer.dispose();
			renderer.domElement.remove();
		}
	};
}
