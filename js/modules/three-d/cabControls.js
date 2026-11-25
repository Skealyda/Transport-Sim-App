const CONTROL_ACTIONS = ['limit', 'power', 'brake', 'doors', 'horn', 'wiper', 'autopilot', 'emergency', 'screens'];
const TELEMETRY_INTERVAL = 100;
const NAV_INTERVAL = 180;

function finiteNumber(value, fallback = 0) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

function pointCoordinates(point) {
	const source = point?.latlng || point;
	if (Array.isArray(source)) return { lat: finiteNumber(source[0]), lng: finiteNumber(source[1]) };
	if (source && Number.isFinite(Number(source.lat)) && Number.isFinite(Number(source.lng))) {
		return { lat: Number(source.lat), lng: Number(source.lng) };
	}
	return null;
}

function segmentDistanceKm(state, index) {
	const smooth = state.segmentSmoothDistances?.[index];
	const normal = state.segmentDistances?.[index];
	if (Number.isFinite(smooth) && smooth > 0) return smooth;
	if (Number.isFinite(normal) && normal > 0) return normal;
	const from = pointCoordinates(state.route?.[index]);
	const to = pointCoordinates(state.route?.[index + 1]);
	if (!from || !to) return 0;
	const radians = Math.PI / 180;
	const latitude = (to.lat - from.lat) * radians;
	const longitude = (to.lng - from.lng) * radians;
	const a = Math.sin(latitude / 2) ** 2
		+ Math.cos(from.lat * radians) * Math.cos(to.lat * radians) * Math.sin(longitude / 2) ** 2;
	return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nextStop(state) {
	const route = state.route || [];
	const start = Math.min(route.length - 1, Math.max(0, Math.floor(finiteNumber(state.index)) + 1));
	for (let index = start; index < route.length; index++) {
		if ((route[index]?.type || 'stop') === 'stop') return { index, point: route[index] };
	}
	return route.length ? { index: route.length - 1, point: route.at(-1) } : { index: -1, point: null };
}

function distanceToStopKm(state, stopIndex) {
	if (stopIndex < 0) return 0;
	const routeIndex = clamp(Math.floor(finiteNumber(state.index)), 0, Math.max(0, (state.route?.length || 1) - 1));
	const progress = clamp(finiteNumber(state.progress), 0, 1);
	let distance = 0;
	if (routeIndex < stopIndex) distance += segmentDistanceKm(state, routeIndex) * (1 - progress);
	for (let index = routeIndex + 1; index < stopIndex; index++) distance += segmentDistanceKm(state, index);
	return Math.max(0, distance);
}

function durationLabel(seconds) {
	const value = Math.round(Math.max(0, finiteNumber(seconds)));
	if (value < 1) return '--';
	const hours = Math.floor(value / 3600);
	const minutes = Math.floor((value % 3600) / 60);
	const remaining = value % 60;
	if (hours) return `${hours}h ${minutes}m`;
	return minutes ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

function distanceLabel(kilometres) {
	const value = Math.max(0, finiteNumber(kilometres));
	return value >= 10 ? `${value.toFixed(1)} km` : `${(value * 1000).toFixed(0)} m`;
}

function scheduleValue(state) {
	const direct = state.scheduleStatus || state.schedule?.status || state.telemetrySchedule;
	if (typeof direct === 'string') return direct;
	if (direct?.label) return direct.label;
	const element = globalThis.document?.getElementById?.('telemetrySchedule');
	return element?.textContent?.trim() || 'No timetable';
}

function trainPosition(state) {
	const route = state.route || [];
	const index = clamp(Math.floor(finiteNumber(state.index)), 0, Math.max(0, route.length - 1));
	const progress = clamp(finiteNumber(state.progress), 0, 1);
	const smooth = state.smoothRoute || [];
	if (smooth.length > 2 && smooth.every(point => Number.isFinite(Number(point.originalIndex)))) {
		let low = 0;
		let high = smooth.length - 1;
		while (low < high) {
			const middle = (low + high) >>> 1;
			const point = smooth[middle];
			const belongsBefore = point.originalIndex < index
				|| (point.originalIndex === index && finiteNumber(point.originalProgress) < progress);
			if (belongsBefore) low = middle + 1;
			else high = middle;
		}
		const current = smooth[low];
		const previous = smooth[Math.max(0, low - 1)];
		const currentPoint = pointCoordinates(current);
		const previousPoint = pointCoordinates(previous);
		let fraction = 0;
		if (current.originalIndex === previous.originalIndex && current.originalProgress !== previous.originalProgress) {
			fraction = (progress - finiteNumber(previous.originalProgress))
				/ (finiteNumber(current.originalProgress) - finiteNumber(previous.originalProgress));
		} else if (current.originalIndex > index && previous.originalIndex === index) {
			const gap = 1 - finiteNumber(previous.originalProgress);
			fraction = gap > 0.0001 ? (progress - finiteNumber(previous.originalProgress)) / gap : 1;
		} else if (current !== previous) {
			fraction = 1;
		}
		fraction = clamp(fraction, 0, 1);
		return currentPoint && previousPoint ? {
			lat: previousPoint.lat + (currentPoint.lat - previousPoint.lat) * fraction,
			lng: previousPoint.lng + (currentPoint.lng - previousPoint.lng) * fraction
		} : null;
	}
	const from = pointCoordinates(route[index]);
	const to = pointCoordinates(route[Math.min(index + 1, route.length - 1)]) || from;
	return from && to ? {
		lat: from.lat + (to.lat - from.lat) * progress,
		lng: from.lng + (to.lng - from.lng) * progress
	} : null;
}

export function buildCabTelemetry(state = {}) {
	const control = state.manualControlState || {};
	const stop = nextStop(state);
	const distance = distanceToStopKm(state, stop.index);
	const speed = Math.max(0, finiteNumber(control.currentSpeed, finiteNumber(state.currentDisplaySpeed)));
	const limit = Math.max(0, finiteNumber(control.targetSpeed, finiteNumber(control.maxSpeed)));
	const calculation = state.timeCalculations || globalThis.window?.timeCalculations;
	let etaSeconds = Number(calculation?.timeToNextStop);
	if (!Number.isFinite(etaSeconds) || etaSeconds < 0) {
		const estimateSpeed = speed > 1 ? speed : limit > 0 ? limit : 30;
		etaSeconds = distance / Math.max(1, estimateSpeed) * 3600;
	}
	const weather = state.weatherCardState?.currentWeatherData;
	const temperature = weather?.temperature;
	const condition = weather && !weather.unavailable
		? `${weather.condition || 'Weather'}${Number.isFinite(Number(temperature)) ? ` ${temperature}°C` : ''}`
		: 'Weather unavailable';
	const emergency = !!(state.safetyState?.emergencyBrakeApplied || state.safetyState?.emergencyMode);
	return {
		speed,
		limit,
		nextStop: stop.point?.placeName || 'End of line',
		nextStopIndex: stop.index,
		distanceKm: distance,
		distance: distanceLabel(distance),
		etaSeconds,
		eta: durationLabel(etaSeconds),
		schedule: control.isManualMode ? 'Manual control' : scheduleValue(state),
		weather: condition,
		doorsOpen: !!control.doorsOpen,
		doors: control.doorsOpen ? 'OPEN' : 'CLOSED',
		mode: control.autopilotActive ? 'AUTOPILOT' : control.isManualMode ? 'MANUAL' : 'DRIVE',
		power: clamp(finiteNumber(control.acceleration), 0, 100),
		brake: clamp(finiteNumber(control.brakeLevel), 0, 100),
		gForce: finiteNumber(state.currentGForce),
		gradePercent: finiteNumber(state.currentTrackGrade),
		tunnelDepth: Math.max(0, finiteNumber(state.currentTunnelDepth)),
		trackSection: state.currentTrackSection || 'Surface',
		emergency
	};
}

export function projectRouteNavigation(state = {}, width = 480, height = 360, padding = 28) {
	const source = state.smoothRoute?.length > 1 ? state.smoothRoute : state.route || [];
	const route = source.map(pointCoordinates).filter(Boolean);
	if (!route.length || width <= padding * 2 || height <= padding * 2) {
		return { points: [], marker: null, nextStation: null, nextStopIndex: -1 };
	}
	const meanLatitude = route.reduce((sum, point) => sum + point.lat, 0) / route.length;
	const longitudeScale = Math.max(0.01, Math.cos(meanLatitude * Math.PI / 180));
	const values = route.map(point => ({ x: point.lng * longitudeScale, y: point.lat }));
	const bounds = values.reduce((box, point) => ({
		minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
		minY: Math.min(box.minY, point.y), maxY: Math.max(box.maxY, point.y)
	}), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
	const scale = Math.min(
		(width - padding * 2) / Math.max(0.000001, bounds.maxX - bounds.minX),
		(height - padding * 2) / Math.max(0.000001, bounds.maxY - bounds.minY)
	);
	const project = point => ({
		x: padding + (point.lng * longitudeScale - bounds.minX) * scale,
		y: height - padding - (point.lat - bounds.minY) * scale
	});
	const points = route.map(project);
	const train = trainPosition(state);
	const stop = nextStop(state);
	const nextCoordinate = pointCoordinates(stop.point);
	return {
		points,
		marker: train ? project(train) : points[0] || null,
		nextStation: nextCoordinate ? { ...project(nextCoordinate), name: stop.point?.placeName || 'Next station' } : null,
		nextStopIndex: stop.index
	};
}

function safeAction(actions, name, argument) {
	const callback = actions?.[name];
	if (typeof callback !== 'function') return;
	return argument === undefined ? callback() : callback(argument);
}

export function createCabControls(THREE, camera, canvas, state, actions) {
	const touchLayout = !!state.isMobileDevice || globalThis.matchMedia?.('(max-width: 768px)').matches;
	const root = new THREE.Group();
	root.name = 'locomotive-cab-desk';
	camera.add(root);
	const materials = {
		desk: new THREE.MeshStandardMaterial({ color: 0x253039, roughness: 0.68, metalness: 0.32 }),
		edge: new THREE.MeshStandardMaterial({ color: 0x7e8c91, roughness: 0.34, metalness: 0.78 }),
		panel: new THREE.MeshStandardMaterial({ color: 0x11191f, roughness: 0.82, metalness: 0.2 }),
		rubber: new THREE.MeshStandardMaterial({ color: 0x090d10, roughness: 0.95 }),
		metal: new THREE.MeshStandardMaterial({ color: 0xa9b3b6, roughness: 0.28, metalness: 0.82 }),
		guard: new THREE.MeshStandardMaterial({ color: 0xf0b72d, roughness: 0.4, metalness: 0.45 }),
		white: new THREE.MeshStandardMaterial({ color: 0xdbe3df, emissive: 0x16211d, emissiveIntensity: 0.35, roughness: 0.44 }),
		red: new THREE.MeshStandardMaterial({ color: 0xc72f2a, emissive: 0x5b0604, emissiveIntensity: 0.55, roughness: 0.36 }),
		glass: new THREE.MeshBasicMaterial({ color: 0xaad8df, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }),
		light: new THREE.MeshBasicMaterial({ color: 0x76dcae }),
		doorLight: new THREE.MeshStandardMaterial({ color: 0x5a4731, emissive: 0x000000, emissiveIntensity: 0.2 }),
		hornLight: new THREE.MeshStandardMaterial({ color: 0x31516a, emissive: 0x000000, emissiveIntensity: 0.2 }),
		wiperLight: new THREE.MeshStandardMaterial({ color: 0x24475b, emissive: 0x000000, emissiveIntensity: 0.2 }),
		autoLight: new THREE.MeshStandardMaterial({ color: 0x315c49, emissive: 0x000000, emissiveIntensity: 0.2 })
	};
	const geometries = new Map();
	const interactive = [];
	const raycaster = new THREE.Raycaster();
	const textureResources = [];
	let drag = null;
	let wipers = false;
	let hornLitUntil = 0;

	function cachedGeometry(key, create) {
		if (!geometries.has(key)) geometries.set(key, create());
		return geometries.get(key);
	}

	function box(width, height, depth, material, position, parent = root) {
		return mesh(cachedGeometry(`box:${width}:${height}:${depth}`, () => new THREE.BoxGeometry(width, height, depth)), material, position, parent);
	}

	function cylinder(radiusTop, radiusBottom, height, segments, material, position, parent = root) {
		return mesh(cachedGeometry(`cylinder:${radiusTop}:${radiusBottom}:${height}:${segments}`, () => (
			new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments)
		)), material, position, parent);
	}

	function mesh(geometry, material, position, parent = root) {
		const result = new THREE.Mesh(geometry, material);
		result.position.set(...position);
		parent.add(result);
		return result;
	}

	function hit(part, action) {
		part.userData.cabAction = action;
		interactive.push(part);
		return part;
	}

	function controlLabel(text, x, y, width = 0.34) {
		const surface = document.createElement('canvas');
		surface.width = 256;
		surface.height = 64;
		const context = surface.getContext('2d');
		if (context) {
			context.fillStyle = '#c9d9dc';
			context.font = '600 27px sans-serif';
			context.textAlign = 'center';
			context.fillText(text, 128, 44);
		}
		const texture = new THREE.CanvasTexture(surface);
		texture.colorSpace = THREE.SRGBColorSpace;
		const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
		textureResources.push({ texture, material });
		mesh(cachedGeometry(`plane-label:${width}:0.085`, () => new THREE.PlaneGeometry(width, 0.085)), material, [x, y, -1.325]);
	}

	// Sloped console shell, glass and structural trim.
	box(3.34, 0.55, 0.34, materials.desk, [0, -0.63, -1.58]);
	box(3.22, 0.035, 0.36, materials.edge, [0, -0.345, -1.58]);
	box(3.12, 0.045, 0.035, materials.rubber, [0, -0.885, -1.39]);
	box(3.0, 0.025, 0.025, materials.edge, [0, -0.21, -1.59]);
	box(0.055, 0.68, 0.33, materials.edge, [-1.61, -0.56, -1.57]);
	box(0.055, 0.68, 0.33, materials.edge, [1.61, -0.56, -1.57]);
	mesh(new THREE.PlaneGeometry(3.45, 1.55), materials.glass, [0, 0.14, -2.02]);

	// Windscreen wiper stays camera-relative but is animated independently.
	const wiper = new THREE.Group();
	wiper.name = 'cab-wiper';
	wiper.userData.wiperArm = true;
	wiper.position.set(-1.25, -0.48, -1.99);
	root.add(wiper);
	box(0.035, 1.02, 0.028, materials.rubber, [0, 0.5, 0], wiper);
	box(0.045, 0.76, 0.032, materials.rubber, [0.08, 0.55, 0.01], wiper);

	// Separate master power and brake controller tracks.
	function lever(action, x) {
		box(0.37, 0.43, 0.028, materials.panel, [x, -0.49, -1.395]);
		box(0.035, 0.28, 0.018, materials.rubber, [x, -0.49, -1.365]);
		for (let index = 0; index < 6; index++) {
			box(0.027, 0.008, 0.012, materials.edge, [x + 0.105, -0.615 + index * 0.05, -1.35]);
		}
		const group = new THREE.Group();
		group.name = `${action}-controller`;
		group.position.set(x, -0.7, -1.31);
		group.scale.setScalar(0.58);
		root.add(group);
		hit(cylinder(0.026, 0.035, 0.39, 12, materials.metal, [0, 0.195, 0], group), action);
		const grip = hit(cylinder(0.055, 0.055, 0.22, 16, materials.rubber, [0, 0.41, 0], group), action);
		grip.rotation.z = Math.PI / 2;
		controlLabel(action.toUpperCase(), x, -0.69, 0.34);
		return group;
	}
	const power = lever('power', -1.23);
	const brake = lever('brake', -0.77);

	// Detented speed selector.
	const limitBezel = cylinder(0.105, 0.105, 0.035, 28, materials.rubber, [-0.39, -0.57, -1.35]);
	limitBezel.rotation.x = Math.PI / 2;
	const limitKnob = hit(cylinder(0.079, 0.088, 0.07, 24, materials.metal, [-0.39, -0.57, -1.31]), 'limit');
	limitKnob.rotation.x = Math.PI / 2;
	const limitMark = box(0.016, 0.055, 0.017, materials.rubber, [-0.39, -0.51, -1.267]);
	limitMark.userData.limitPointer = true;
	controlLabel('LIMIT', -0.39, -0.69, 0.32);

	// Integrated DMI and a self-contained navigation display.
	const displays = new THREE.Group();
	displays.name = 'cab-digital-displays';
	root.add(displays);
	let displaysVisible = true;
	const dmiCanvas = document.createElement('canvas');
	dmiCanvas.width = 960;
	dmiCanvas.height = 400;
	const dmiContext = dmiCanvas.getContext('2d');
	const dmiTexture = new THREE.CanvasTexture(dmiCanvas);
	dmiTexture.colorSpace = THREE.SRGBColorSpace;
	dmiTexture.generateMipmaps = false;
	dmiTexture.minFilter = THREE.LinearFilter;
	const dmiMaterial = new THREE.MeshBasicMaterial({ map: dmiTexture, toneMapped: false });
	textureResources.push({ texture: dmiTexture, material: dmiMaterial });
	box(1.12, 0.58, 0.065, materials.panel, [-0.05, -0.2, -1.48], displays);
	mesh(cachedGeometry('dmi-plane', () => new THREE.PlaneGeometry(1.04, 0.5)), dmiMaterial, [-0.05, -0.2, -1.438], displays);

	const navCanvas = document.createElement('canvas');
	navCanvas.width = 512;
	navCanvas.height = 400;
	const navContext = navCanvas.getContext('2d');
	const navTexture = new THREE.CanvasTexture(navCanvas);
	navTexture.colorSpace = THREE.SRGBColorSpace;
	navTexture.generateMipmaps = false;
	navTexture.minFilter = THREE.LinearFilter;
	const navMaterial = new THREE.MeshBasicMaterial({ map: navTexture, toneMapped: false });
	textureResources.push({ texture: navTexture, material: navMaterial });
	box(0.78, 0.58, 0.065, materials.panel, [0.99, -0.2, -1.48], displays);
	mesh(cachedGeometry('nav-plane', () => new THREE.PlaneGeometry(0.7, 0.5)), navMaterial, [0.99, -0.2, -1.438], displays);

	const switchLights = {};
	function pushSwitch(action, x, label, lightMaterial) {
		const bezel = cylinder(0.077, 0.077, 0.035, 24, materials.edge, [x, -0.56, -1.355]);
		bezel.rotation.x = Math.PI / 2;
		const button = hit(cylinder(0.057, 0.06, 0.055, 18, action === 'emergency' ? materials.red : materials.rubber, [x, -0.56, -1.315]), action);
		button.rotation.x = Math.PI / 2;
		const lamp = cylinder(0.014, 0.014, 0.01, 12, lightMaterial, [x, -0.49, -1.3]);
		lamp.rotation.x = Math.PI / 2;
		switchLights[action] = lamp.material;
		controlLabel(label, x, -0.69, action === 'emergency' ? 0.3 : 0.26);
		return button;
	}
	const wiperButton = pushSwitch('wiper', 0.18, 'WIPER', materials.wiperLight);
	const screenButton = pushSwitch('screens', -0.08, 'SCREENS', materials.white);
	const doorButton = pushSwitch('doors', 0.45, 'DOOR', materials.doorLight);
	const hornButton = pushSwitch('horn', 0.72, 'HORN', materials.hornLight);
	const autopilotButton = pushSwitch('autopilot', 0.99, 'AUTO', materials.autoLight);
	const emergencyButton = pushSwitch('emergency', 1.32, 'STOP', materials.red);

	// Two side bars and a translucent top bridge create a physical guard over STOP.
	box(0.025, 0.17, 0.025, materials.guard, [1.24, -0.54, -1.26]);
	box(0.025, 0.17, 0.025, materials.guard, [1.4, -0.54, -1.26]);
	box(0.185, 0.025, 0.025, materials.guard, [1.32, -0.455, -1.26]);

	let dmiKey = '';
	let navKey = '';
	let navRouteReference = null;
	let navSmoothReference = null;
	let navSatelliteReference = null;
	let lastTelemetryAt = -Infinity;
	let lastNavAt = -Infinity;
	let telemetry = buildCabTelemetry(state);

	function text(context, value, x, y, font, color, align = 'left', maxWidth) {
		if (!context?.fillText) return;
		context.font = font;
		context.fillStyle = color;
		context.textAlign = align;
		context.fillText(String(value), x, y, maxWidth);
	}

	function panel(context, x, y, width, height, color = '#13242b') {
		if (!context?.fillRect) return;
		context.fillStyle = color;
		context.fillRect(x, y, width, height);
	}

	function renderDmi(data) {
		const context = dmiContext;
		if (!context?.fillRect) return;
		panel(context, 0, 0, 960, 400, '#071217');
		panel(context, 0, 0, 960, 46, '#10252d');
		text(context, 'LOCOMOTIVE DRIVER MACHINE INTERFACE', 24, 31, '700 23px sans-serif', '#9bc7c9');
		text(context, data.emergency ? 'EMERGENCY' : 'SYSTEM NOMINAL', 936, 31, '700 20px sans-serif', data.emergency ? '#ff5c52' : '#6fe2a5', 'right');

		panel(context, 18, 62, 255, 210, '#0d2027');
		text(context, 'SPEED', 40, 93, '600 20px sans-serif', '#8eb4b8');
		text(context, Math.round(data.speed), 40, 174, '800 84px sans-serif', data.speed > data.limit && data.limit > 0 ? '#ffb64e' : '#e9fbf6');
		text(context, 'km/h', 44, 210, '600 24px sans-serif', '#a7c4c6');
		text(context, `LIMIT ${Math.round(data.limit)}`, 252, 210, '700 22px sans-serif', '#ffce67', 'right');
		panel(context, 40, 230, 211, 9, '#253c44');
		panel(context, 40, 230, Math.min(211, 211 * data.speed / Math.max(1, data.limit)), 9, data.speed > data.limit ? '#ef704d' : '#5dd5b0');

		const rows = [
			['NEXT', data.nextStop],
			['DISTANCE', data.distance],
			['ETA', data.eta],
			['SCHEDULE', data.schedule]
		];
		rows.forEach(([label, value], index) => {
			const y = 78 + index * 47;
			text(context, label, 304, y, '600 17px sans-serif', '#749aa0');
			text(context, value, 925, y + 5, '700 22px sans-serif', index === 3 && /late/i.test(value) ? '#ffb064' : '#dff3ef', 'right', 420);
		});
		panel(context, 18, 292, 924, 2, '#28424b');
		const lower = [
			['WEATHER', data.weather, '#dcefeb'],
			['DOORS', data.doors, data.doorsOpen ? '#ffbb61' : '#6fe2a5'],
			['MODE', data.mode, '#8bd8ed'],
			['POWER', `${Math.round(data.power)}%`, '#6fe2a5'],
			['BRAKE', `${Math.round(data.brake)}%`, data.brake > 0 ? '#ffb45e' : '#8fb1b6'],
			['G', `${data.gForce.toFixed(2)}`, Math.abs(data.gForce) > 0.2 ? '#ffb45e' : '#dcefeb'],
			['GRADE', `${data.gradePercent >= 0 ? '+' : ''}${data.gradePercent.toFixed(1)}%`, '#dcefeb']
		];
		const widths = [205, 100, 130, 105, 105, 78, 130];
		let x = 24;
		lower.forEach(([label, value, color], index) => {
			text(context, label, x, 326, '600 15px sans-serif', '#7699a0');
			text(context, value, x, 362, '700 23px sans-serif', color, 'left', widths[index] - 10);
			x += widths[index];
		});
	}

	function renderNav(routeData) {
		const context = navContext;
		if (!context?.fillRect || !context?.beginPath || !context?.lineTo) return;
		panel(context, 0, 0, navCanvas.width, navCanvas.height, '#07171b');
		const satellite = state.worldSatelliteMosaic?.canvas;
		if (satellite && context.drawImage) {
			context.globalAlpha = 0.42;
			context.drawImage(satellite, 0, 0, navCanvas.width, navCanvas.height);
			context.globalAlpha = 1;
		}
		panel(context, 0, 0, navCanvas.width, 42, '#102930');
		text(context, 'GPS ROUTE', 18, 29, '700 20px sans-serif', '#96d9dc');
		if (routeData.points.length > 1) {
			context.beginPath();
			context.moveTo(routeData.points[0].x, routeData.points[0].y + 25);
			for (let index = 1; index < routeData.points.length; index++) context.lineTo(routeData.points[index].x, routeData.points[index].y + 25);
			context.strokeStyle = '#66d3c0';
			context.lineWidth = 7;
			context.lineCap = 'round';
			context.lineJoin = 'round';
			context.stroke?.();
		}
		if (routeData.nextStation && context.arc) {
			const station = routeData.nextStation;
			context.beginPath();
			context.arc(station.x, station.y + 25, 11, 0, Math.PI * 2);
			context.fillStyle = '#f3c454';
			context.fill();
			text(context, station.name, clamp(station.x, 40, navCanvas.width - 40), Math.max(58, station.y + 5), '700 15px sans-serif', '#f8e5a8', 'center', 180);
		}
		if (routeData.marker && context.arc) {
			const marker = routeData.marker;
			context.beginPath();
			context.arc(marker.x, marker.y + 25, 9, 0, Math.PI * 2);
			context.fillStyle = '#e9ffff';
			context.fill();
			context.beginPath();
			context.arc(marker.x, marker.y + 25, 4, 0, Math.PI * 2);
			context.fillStyle = '#177c74';
			context.fill();
		}
		text(context, routeData.nextStation ? `NEXT  ${routeData.nextStation.name}` : 'END OF ROUTE', 18, 376, '700 18px sans-serif', '#d8eeea', 'left', 330);
		const terrain = telemetry.trackSection === 'Tunnel'
			? `TUNNEL  ${telemetry.tunnelDepth.toFixed(0)} m`
			: telemetry.trackSection === 'Ramp' ? `GRADE  ${telemetry.gradePercent.toFixed(1)}%` : 'SURFACE';
		text(context, terrain, 494, 376, '700 17px sans-serif', '#78bfc2', 'right', 150);
	}

	function telemetryKey(data) {
		return [
			Math.round(data.speed * 10), Math.round(data.limit), data.nextStop,
			Math.round(data.distanceKm * 100), Math.round(data.etaSeconds / 2),
			data.schedule, data.weather, data.doors, data.mode,
			Math.round(data.power), Math.round(data.brake), Math.round(data.gForce * 100),
			Math.round(data.gradePercent * 10), Math.round(data.tunnelDepth), data.trackSection,
			data.emergency
		].join('|');
	}

	function setSwitch(material, lit, color) {
		material.emissive?.setHex(lit ? color : 0x000000);
		material.emissiveIntensity = lit ? 2.4 : 0.15;
	}

	function actionAt(event) {
		const rect = canvas.getBoundingClientRect();
		const point = new THREE.Vector2(
			(event.clientX - rect.left) / rect.width * 2 - 1,
			-(event.clientY - rect.top) / rect.height * 2 + 1
		);
		camera.updateMatrixWorld(true);
		raycaster.setFromCamera(point, camera);
		return raycaster.intersectObjects(interactive, false)[0]?.object.userData.cabAction;
	}

	function value(action) {
		const control = state.manualControlState || {};
		if (action === 'limit') return finiteNumber(control.targetSpeed);
		if (action === 'power') return finiteNumber(control.acceleration);
		return finiteNumber(control.brakeLevel);
	}

	function setValue(action, next) {
		const maximum = action === 'limit' ? finiteNumber(state.manualControlState?.maxSpeed, 100) : 100;
		const amount = Math.round(clamp(next, 0, maximum));
		safeAction(actions, action, amount);
	}

	function toggleWipers() {
		wipers = !wipers;
		safeAction(actions, 'wipers', wipers);
	}

	function toggleDisplays(visible) {
		displaysVisible = visible === undefined ? !displaysVisible : !!visible;
		displays.visible = displaysVisible;
		return displaysVisible;
	}

	return {
		resize(aspect) {
			root.scale.x = Math.min(1, Math.max(0.3, finiteNumber(aspect, 1) * 0.52));
		},
		pointerDown(event) {
			if (touchLayout) return false;
			const action = actionAt(event);
			if (!CONTROL_ACTIONS.includes(action)) return false;
			if (action === 'limit' || action === 'power' || action === 'brake') {
				drag = { action, y: event.clientY, value: value(action) };
			} else if (action === 'wiper') {
				toggleWipers();
			} else if (action === 'screens') {
				toggleDisplays();
			} else {
				if (action === 'horn') hornLitUntil = performance.now() + 350;
				safeAction(actions, action);
			}
			return true;
		},
		pointerMove(event) {
			if (!drag) return;
			const maximum = drag.action === 'limit' ? finiteNumber(state.manualControlState?.maxSpeed, 100) : 100;
			setValue(drag.action, drag.value + (drag.y - event.clientY) * maximum / 160);
		},
		pointerUp() { drag = null; },
		toggleWipers,
		toggleDisplays,
		getDisplaysVisible() { return displaysVisible; },
		wheel(event) {
			if (actionAt(event) !== 'limit') return false;
			setValue('limit', value('limit') + (event.deltaY < 0 ? 5 : -5));
			return true;
		},
		update(timestamp, visible) {
			root.visible = visible && !touchLayout;
			if (!visible) return;
			const now = finiteNumber(timestamp);
			if (now - lastTelemetryAt >= TELEMETRY_INTERVAL) {
				lastTelemetryAt = now;
				telemetry = buildCabTelemetry(state);
				const key = telemetryKey(telemetry);
				if (key !== dmiKey) {
					dmiKey = key;
					renderDmi(telemetry);
					dmiTexture.needsUpdate = true;
				}
			}
			if (now - lastNavAt >= NAV_INTERVAL) {
				lastNavAt = now;
				const route = projectRouteNavigation(state, navCanvas.width, navCanvas.height - 30, 30);
				const key = [
					state.route?.length || 0, state.smoothRoute?.length || 0,
					state.index, Math.round(finiteNumber(state.progress) * 100), route.nextStopIndex
				].join('|');
				const referencesChanged = navRouteReference !== state.route || navSmoothReference !== state.smoothRoute ||
					navSatelliteReference !== state.worldSatelliteMosaic;
				if (referencesChanged || key !== navKey) {
					navKey = key;
					navRouteReference = state.route;
					navSmoothReference = state.smoothRoute;
					navSatelliteReference = state.worldSatelliteMosaic;
					renderNav(route);
					navTexture.needsUpdate = true;
				}
			}
			const limitMaximum = Math.max(1, finiteNumber(state.manualControlState?.maxSpeed, 120));
			limitKnob.rotation.y = -finiteNumber(state.manualControlState?.targetSpeed) / limitMaximum * Math.PI * 1.5;
			limitMark.rotation.z = limitKnob.rotation.y;
			limitMark.position.x = -0.39 + Math.sin(-limitKnob.rotation.y) * 0.047;
			limitMark.position.y = -0.57 + Math.cos(-limitKnob.rotation.y) * 0.047;
			power.rotation.z = -0.65 + finiteNumber(state.manualControlState?.acceleration) / 100 * 1.3;
			brake.rotation.z = -0.65 + finiteNumber(state.manualControlState?.brakeLevel) / 100 * 1.3;
			wiper.rotation.z = wipers ? -0.25 + 0.6 * Math.sin(now / 550) : -0.8;
			setSwitch(switchLights.doors, telemetry.doorsOpen, 0xffa72f);
			setSwitch(switchLights.horn, now < hornLitUntil, 0x3ca7ff);
			setSwitch(switchLights.wiper, wipers, 0x3ca7ff);
			setSwitch(switchLights.autopilot, !!state.manualControlState?.autopilotActive, 0x43e58e);
			setSwitch(switchLights.screens, displaysVisible, 0x43a8d8);
			setSwitch(switchLights.emergency, telemetry.emergency, 0xff3028);
		},
		getWipers() { return wipers; },
		getTelemetry() { return { ...telemetry }; },
		getResourceCounts() {
			return { geometries: geometries.size, materials: Object.keys(materials).length + textureResources.length, interactive: interactive.length };
		},
		dispose() {
			camera.remove(root);
			geometries.forEach(geometry => geometry.dispose());
			textureResources.forEach(resource => {
				resource.texture.dispose();
				resource.material.dispose();
			});
			Object.values(materials).forEach(material => material.dispose());
		}
	};
}
