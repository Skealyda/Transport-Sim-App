import state from './state.js';
import { createGeoScenery } from './three-d/geoScenery.js';
import { showWorldNotice, clearWorldNotices } from './three-d/worldNotices.js';
import { setTargetSpeedDirect, updateAccelerationFromSlider, updateBrakeFromSlider, toggleDoors, emergencyBrake, soundManualHorn, toggleManualAutopilot } from './manualControls.js';
import { deriveSatelliteScenery, fetchSatelliteMosaic, fetchWorldScenery } from './net/worldScenery.js';

let view = null;
let loading = false;
let mode = 'chase';
let geoScenery = null;
let mapTarget = null;
let sceneryRequest = 0;
let satelliteScenery = false;
let localScenery = false;
let automaticSceneryRoute = null;
let cabChromeTimer = 0;
let mobileDriveTimer = 0;
const CAMERA_MODES = ['chase', 'cab', 'front', 'side', 'roof', 'free'];

function isMobileCabLayout() {
	return !!state.isMobileDevice || matchMedia('(max-width: 768px)').matches;
}

function setMobileDriveMode(next) {
	const power = next === 'power' ? 55 : 0;
	const brake = next === 'brake' ? 100 : 0;
	updateAccelerationFromSlider(power);
	updateBrakeFromSlider(brake);
	document.querySelectorAll('[data-drive-mode]').forEach(button => {
		const active = button.dataset.driveMode === next;
		button.classList.toggle('is-active', active);
		button.setAttribute('aria-pressed', String(active));
	});
}

function updateMobileDriveUI() {
	if (!state.is3DMode || mode !== 'cab' || !isMobileCabLayout()) return;
	const control = state.manualControlState || {};
	const dock = document.getElementById('world3dMobileDrive');
	const speed = document.getElementById('world3dMobileSpeed');
	const limit = document.getElementById('world3dMobileLimit');
	const hint = document.getElementById('world3dMobileHint');
	if (speed) speed.textContent = String(Math.round(control.currentSpeed || state.currentDisplaySpeed || 0));
	if (limit) limit.textContent = String(Math.round(control.targetSpeed || 0));
	const hud = document.getElementById('world3dMobileHud');
	const hudVisible = state.world3dEnvironment?.hudVisible !== false;
	hud.hidden = !hudVisible;
	const hudSpeed = document.getElementById('world3dHudSpeed');
	const hudLimit = document.getElementById('world3dHudLimit');
	const hudNext = document.getElementById('world3dHudNext');
	if (hudSpeed) hudSpeed.textContent = String(Math.round(control.currentSpeed || state.currentDisplaySpeed || 0));
	if (hudLimit) hudLimit.textContent = String(Math.round(control.targetSpeed || 0));
	if (hudNext) {
		const route = state.route || [];
		const nextIndex = route.findIndex((point, index) => index > Math.floor(state.index || 0) && (point.type || 'stop') === 'stop');
		hudNext.textContent = nextIndex >= 0 ? route[nextIndex]?.placeName || 'Next stop' : route.at(-1)?.placeName || 'End of line';
	}
	const hudToggle = document.getElementById('world3dMobileHudToggle');
	hudToggle?.setAttribute('aria-pressed', String(hudVisible));
	const manual = !!control.isManualMode;
	dock?.querySelectorAll('button').forEach(button => {
		button.disabled = !manual;
	});
	if (hint) hint.textContent = manual ? (control.autopilotActive ? 'Autopilot engaged' : 'Tap a driving mode') : 'Start a manual simulation to use train controls';
	document.getElementById('world3dMobileDoors')?.setAttribute('aria-pressed', String(!!control.doorsOpen));
	document.getElementById('world3dMobileAutopilot')?.setAttribute('aria-pressed', String(!!control.autopilotActive));
}

function nudgeMobileLimit(delta) {
	const maximum = Math.max(1, Number(state.manualControlState?.maxSpeed) || 120);
	const current = Number(state.manualControlState?.targetSpeed) || 0;
	setTargetSpeedDirect(Math.max(0, Math.min(maximum, current + delta)));
	updateMobileDriveUI();
}

function revealCabChrome() {
	if (mode !== 'cab' || !view) return;
	document.body.classList.add('world3d-ui-active');
	clearTimeout(cabChromeTimer);
	cabChromeTimer = setTimeout(() => {
		document.body.classList.remove('world3d-ui-active');
	}, 5000);
}

function showSceneryStatus() {
	const status = document.getElementById('world3dStatus');
	showWorldNotice('world3dStatus', geoScenery || satelliteScenery
		? `${satelliteScenery ? 'Satellite ground' : ''}${geoScenery ? `${satelliteScenery ? ' · ' : ''}mapped features along route` : ' · mapped structures unavailable'}`
		: 'Loading route geography · illustrative scenery active');
	status.title = geoScenery || satelliteScenery
		? 'Route imagery and OpenStreetMap-derived features are used where available; uncovered areas are procedural.'
		: 'Route geography loads automatically when available. Use Scenery to replace it with a local OSM-derived GeoJSON extract.';
	document.getElementById('world3dAttribution').style.display = geoScenery || satelliteScenery ? 'block' : 'none';
	document.getElementById('world3dAttribution').textContent = satelliteScenery
		? 'Imagery © Esri · map data © OpenStreetMap'
		: '© OpenStreetMap contributors';
}

function setMode(next) {
	if (!view || !CAMERA_MODES.includes(next)) return;
	mode = next;
	view.setMode(next);
	revealCabChrome();
	if (mode !== 'cab') {
		clearTimeout(cabChromeTimer);
		document.body.classList.remove('world3d-ui-active');
	}
	for (const name of CAMERA_MODES) {
		document.getElementById(`world3d${name[0].toUpperCase()}${name.slice(1)}`)?.setAttribute('aria-pressed', String(name === next));
	}
	document.getElementById('world3dMobileCameraSelect').value = next;
	document.getElementById('world3dAssist').hidden = next !== 'cab' || !state.manualControlState.isManualMode;
	const screens = document.getElementById('world3dScreens');
	screens.hidden = next !== 'cab';
	if (next === 'cab' && view.getStats) screens.setAttribute('aria-pressed', String(view.getStats().cabDisplays));
	const mobileCab = next === 'cab' && isMobileCabLayout();
	document.body.classList.toggle('world3d-cab-mobile', mobileCab);
	document.getElementById('world3dMobileDrive').hidden = !mobileCab;
	if (mobileCab) {
		clearInterval(mobileDriveTimer);
		mobileDriveTimer = setInterval(updateMobileDriveUI, 150);
		updateMobileDriveUI();
	} else {
		clearInterval(mobileDriveTimer);
		mobileDriveTimer = 0;
		document.getElementById('world3dMobileHud').hidden = true;
	}
	document.body.classList.remove('world3d-cab-assist');
	document.getElementById('world3dAssist').setAttribute('aria-pressed', 'false');
}

function exit3D() {
	sceneryRequest++;
	clearTimeout(cabChromeTimer);
	clearInterval(mobileDriveTimer);
	mobileDriveTimer = 0;
	document.body.classList.remove('world3d-ui-active');
	view?.dispose();
	clearWorldNotices();
	view = null;
	state.world3D = null;
	state.is3DMode = false;
	document.body.classList.remove('world3d-cab-manual');
	document.body.classList.remove('world3d-cab-view');
	document.body.classList.remove('world3d-cab-assist');
	document.body.classList.remove('world3d-cab-mobile');
	document.getElementById('world3dMobileDrive').hidden = true;
	document.getElementById('world3dMobileHud').hidden = true;
	state.renderFPS = null;
	document.getElementById('renderFps').textContent = '—';
	document.getElementById('renderFps').parentElement.title = 'OpenLayers map render events per second; actual display FPS depends on hardware.';
	document.getElementById('world3dContainer').style.display = 'none';
	document.getElementById('world3dControls').style.display = 'none';
	document.getElementById('map').classList.remove('is-3d');
	document.getElementById('toggle3DBtn').textContent = '🌐 3D View';
	if (state.map && mapTarget !== null) {
		state.map.setTarget(mapTarget);
		mapTarget = null;
		setTimeout(() => state.map.updateSize(), 100);
	}
}

export async function toggle3DMode() {
	if (loading) return;
	if (state.is3DMode) {
		exit3D();
		return;
	}
	if (state.currentRouteType !== 'rail' || (state.activeVehicleMode && state.activeVehicleMode !== 'train')) {
		alert('The new 3D world currently supports train routes only. Other vehicles remain available in 2D.');
		return;
	}
	if (!state.route || state.route.length < 2) {
		alert('Create or load a train route before opening the 3D world.');
		return;
	}
	loading = true;
	if (!localScenery && automaticSceneryRoute !== state.route) {
		geoScenery = null;
		satelliteScenery = false;
	}
	automaticSceneryRoute = state.route;
	const button = document.getElementById('toggle3DBtn');
	const container = document.getElementById('world3dContainer');
	button.textContent = '⏳ Loading 3D…';
	try {
		const [THREE, { createWorldView }] = await Promise.all([
			import('three'),
			import('./three-d/worldView.js')
		]);
		container.style.display = 'block';
		view = createWorldView(THREE, container, state, error => {
			console.error('3D world failed:', error);
			exit3D();
			alert(`3D world stopped: ${error.message}`);
		}, { limit: setTargetSpeedDirect, power: updateAccelerationFromSlider, brake: updateBrakeFromSlider,
			doors: toggleDoors, emergency: emergencyBrake, horn: soundManualHorn, autopilot: toggleManualAutopilot,
			wipers: enabled => document.getElementById('compactWiper').setAttribute('aria-pressed', String(enabled)) });
		document.getElementById('compactWiper').setAttribute('aria-pressed', 'false');
		state.world3D = view;
		state.is3DMode = true;
		document.getElementById('renderFps').parentElement.title = '3D frames rendered per second; actual display FPS depends on hardware.';
		document.getElementById('map').classList.add('is-3d');
		if (state.map) {
			mapTarget = state.map.getTarget();
			state.map.setTarget(null);
		}
		document.getElementById('world3dControls').style.display = 'grid';
		view.setGeoScenery(geoScenery);
		const request = ++sceneryRequest;
		const routePoints = state.route.map(point => point.latlng || point);
		const center = routePoints[0];
		fetchWorldScenery(state.route).then(collection => {
			if (request !== sceneryRequest || view === null || state.is3DMode !== true) return;
			if (!localScenery && collection?.features?.length) {
				geoScenery = createGeoScenery(collection);
				view.setGeoScenery(geoScenery);
			}
			showSceneryStatus();
		}).catch(error => {
			console.warn('Automatic geographic scenery unavailable:', error.message);
		});
		fetchSatelliteMosaic(center.lat, center.lng).then(imagery => {
			if (request !== sceneryRequest || view === null || state.is3DMode !== true) return;
			if (imagery?.loaded) {
				satelliteScenery = true;
				view.setSatelliteScenery(imagery);
				if (!geoScenery && !localScenery) {
					const derived = deriveSatelliteScenery(imagery, state.route);
					if (derived.features.length) {
						geoScenery = createGeoScenery(derived);
						view.setGeoScenery(geoScenery);
					}
				}
			}
			showSceneryStatus();
		}).catch(error => {
			console.warn('Automatic satellite scenery unavailable:', error.message);
		});
		showSceneryStatus();
		button.textContent = '🗺️ 2D View';
		setMode('chase');
	} catch (error) {
		console.error('3D world could not start:', error);
		exit3D();
		alert('The 3D world could not be loaded. Run npm install and restart the server, then try again.');
	} finally {
		loading = false;
	}
}

export function initWorld3DControls() {
	for (const name of CAMERA_MODES) {
		const button = document.getElementById(`world3d${name[0].toUpperCase()}${name.slice(1)}`);
		if (button) button.onclick = () => setMode(name);
	}
	document.getElementById('world3dZoomIn').onclick = () => view?.zoom(true);
	document.getElementById('world3dZoomOut').onclick = () => view?.zoom(false);
	document.getElementById('world3dBack').onclick = toggle3DMode;
	document.getElementById('world3dMobileCameraSelect').onchange = event => setMode(event.target.value);
	document.getElementById('world3dMobileZoomIn').onclick = () => view?.zoom(true);
	document.getElementById('world3dMobileZoomOut').onclick = () => view?.zoom(false);
	document.getElementById('world3dMobileBack').onclick = toggle3DMode;
	document.getElementById('world3dMobileHudToggle').onclick = () => {
		window.set3DEnvironmentHud?.(state.world3dEnvironment?.hudVisible === false);
	};
	document.addEventListener('world3d-environment-changed', updateMobileDriveUI);
	document.getElementById('world3dAssist').onclick = event => {
		const enabled = document.body.classList.toggle('world3d-cab-assist');
		event.currentTarget.setAttribute('aria-pressed', String(enabled));
	};
	document.getElementById('world3dScreens').onclick = event => {
		const visible = view?.toggleCabDisplays();
		if (visible !== undefined) event.currentTarget.setAttribute('aria-pressed', String(visible));
	};
	document.getElementById('compactWiper').onclick = () => view?.toggleWipers();
	document.getElementById('compactAutopilot').onclick = toggleManualAutopilot;
	document.querySelectorAll('[data-drive-mode]').forEach(button => {
		button.addEventListener('click', () => setMobileDriveMode(button.dataset.driveMode));
	});
	document.getElementById('world3dMobileLimitDown').onclick = () => nudgeMobileLimit(-10);
	document.getElementById('world3dMobileLimitUp').onclick = () => nudgeMobileLimit(10);
	document.getElementById('world3dMobileDoors').onclick = toggleDoors;
	document.getElementById('world3dMobileHorn').onclick = soundManualHorn;
	document.getElementById('world3dMobileWiper').onclick = () => {
		const enabled = view?.toggleWipers();
		document.getElementById('world3dMobileWiper').setAttribute('aria-pressed', String(!!enabled));
	};
	document.getElementById('world3dMobileAutopilot').onclick = toggleManualAutopilot;
	document.getElementById('world3dMobileEmergency').onclick = emergencyBrake;
	const fileInput = document.getElementById('world3dDataFile');
	document.getElementById('world3dData').onclick = () => fileInput.click();
	fileInput.addEventListener('change', async () => {
		const file = fileInput.files?.[0];
		if (!file) return;
		try {
			if (file.size > 8 * 1024 * 1024) throw new Error('The extract must be 8 MB or smaller.');
			const collection = JSON.parse(await file.text());
			if (Array.isArray(collection.features) && collection.features.length > 2000) {
				throw new Error('The extract must contain at most 2,000 features.');
			}
			geoScenery = createGeoScenery(collection);
			localScenery = true;
			view?.setGeoScenery(geoScenery);
			showSceneryStatus();
		} catch (error) {
			console.error('Scenery data could not be loaded:', error);
			alert(`Scenery data could not be loaded: ${error.message}`);
		} finally {
			fileInput.value = '';
		}
	});
	document.getElementById('world3dContainer').addEventListener('wheel', event => {
		if (!view) return;
		if (mode === 'cab') {
			const handled = view.cabWheel(event);
			if (!handled) view.zoom(event.deltaY < 0);
			event.preventDefault();
			return;
		}
		event.preventDefault();
		view.zoom(event.deltaY < 0);
	}, { passive: false });
	document.getElementById('world3dContainer').addEventListener('pointermove', event => {
		if (mode === 'cab' && event.clientY < 190) revealCabChrome();
	});
	document.getElementById('world3dControls').addEventListener('pointerenter', revealCabChrome);
	document.getElementById('world3dControls').addEventListener('pointermove', revealCabChrome);
	document.addEventListener('keydown', event => {
		if (mode === 'cab' && (event.key === 'Tab' || event.key === 'Escape')) revealCabChrome();
	});
	document.addEventListener('focusin', () => {
		if (mode === 'cab') revealCabChrome();
	});
}
