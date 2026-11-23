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
	if (!view || !['chase', 'cab', 'free'].includes(next)) return;
	mode = next;
	view.setMode(next);
	revealCabChrome();
	if (mode !== 'cab') {
		clearTimeout(cabChromeTimer);
		document.body.classList.remove('world3d-ui-active');
	}
	for (const name of ['chase', 'cab', 'free']) {
		document.getElementById(`world3d${name[0].toUpperCase()}${name.slice(1)}`).setAttribute('aria-pressed', String(name === next));
	}
	document.getElementById('world3dZoomIn').disabled = next === 'cab';
	document.getElementById('world3dZoomOut').disabled = next === 'cab';
	document.getElementById('world3dAssist').hidden = next !== 'cab' || !state.manualControlState.isManualMode;
	const screens = document.getElementById('world3dScreens');
	screens.hidden = next !== 'cab';
	if (next === 'cab' && view.getStats) screens.setAttribute('aria-pressed', String(view.getStats().cabDisplays));
	document.body.classList.remove('world3d-cab-assist');
	document.getElementById('world3dAssist').setAttribute('aria-pressed', 'false');
}

function exit3D() {
	sceneryRequest++;
	clearTimeout(cabChromeTimer);
	document.body.classList.remove('world3d-ui-active');
	view?.dispose();
	clearWorldNotices();
	view = null;
	state.world3D = null;
	state.is3DMode = false;
	document.body.classList.remove('world3d-cab-manual');
	document.body.classList.remove('world3d-cab-view');
	document.body.classList.remove('world3d-cab-assist');
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
	for (const name of ['chase', 'cab', 'free']) {
		document.getElementById(`world3d${name[0].toUpperCase()}${name.slice(1)}`).onclick = () => setMode(name);
	}
	document.getElementById('world3dZoomIn').onclick = () => view?.zoom(true);
	document.getElementById('world3dZoomOut').onclick = () => view?.zoom(false);
	document.getElementById('world3dBack').onclick = toggle3DMode;
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
			if (view.cabWheel(event)) event.preventDefault();
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
