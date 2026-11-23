// ====================================
// SETTINGS & PREFERENCES MODULE
// ====================================
// Manages user settings for display, vehicle sizing, and other preferences
// Settings are persisted to localStorage

import state from './state.js';
import { setSpeedometerMode, updateSpeedometer } from './speedometer.js';
import { updateSegmentSpeedSign } from './segmentSpeedSign.js';
import { refreshActiveVehicleStyles } from './vehicle.js';
import { defaultGraphicsQuality, normalizeGraphicsQuality, resolveGraphicsQuality } from './graphicsQuality.js';
import { getLocalClientConfig, saveLocalClientConfig, clearLocalClientConfig } from './net/config.js';
import { resetGoogleSatelliteConfiguration } from './net/googleTiles.js';

const DEFAULT_MAX_SPEED_KMH = 120;
const DEFAULT_ACCEL_G = 0.10;
const DEFAULT_DECEL_G = 0.05;
const DEFAULT_MAP_WIDTH_PERCENT = 100;
const DEFAULT_MAP_HEIGHT_PX = 620;
// The UI exposes a user-facing "display" multiplier where 1.0 is considered
// the user's "100%" baseline. Internally, the visuals historically used
// a 1.5 multiplier (150%) as the true standard. To preserve that visual
// while giving users a 1.0 baseline, we store/display the user-facing value
// but multiply by `STATION_BASE_MULTIPLIER` for rendering.
const DEFAULT_STATION_SIZE_MULTIPLIER = 1.0; // user-facing default (display)
const STATION_BASE_MULTIPLIER = 1.5; // internal base multiplier (actual 150%)
const CAREER_TRAFFIC_BASELINE_FACTOR = 1.8;

function clampNumber(value, min, max, fallback) {
	const n = parseFloat(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, n));
}

function updateDynamicsDefaultsUI() {
	const maxSpeedInput = document.getElementById('defaultMaxSpeed');
	const accelGInput = document.getElementById('defaultAccelGForce');
	const decelGInput = document.getElementById('defaultDecelGForce');

	if (maxSpeedInput) maxSpeedInput.value = String(Math.round(state.defaultMaxSpeed || DEFAULT_MAX_SPEED_KMH));
	if (accelGInput) accelGInput.value = (state.defaultAccelGForce || DEFAULT_ACCEL_G).toFixed(2);
	if (decelGInput) decelGInput.value = (state.defaultDecelGForce || DEFAULT_DECEL_G).toFixed(2);
}

function applyDynamicsDefaultsToRuntime() {
	const maxSpeed = clampNumber(state.defaultMaxSpeed, 1, 1500, DEFAULT_MAX_SPEED_KMH);
	const accelG = clampNumber(state.defaultAccelGForce, 0.05, 2.0, DEFAULT_ACCEL_G);
	const decelG = clampNumber(state.defaultDecelGForce, 0.05, 2.0, DEFAULT_DECEL_G);

	state.defaultMaxSpeed = maxSpeed;
	state.defaultAccelGForce = accelG;
	state.defaultDecelGForce = decelG;

	state.accelGForceLimit = accelG;
	state.decelGForceLimit = decelG;
	state.maxGForceLimit = accelG; // legacy alias used in some modules

	if (state.manualControlState) {
		state.manualControlState.maxSpeed = maxSpeed;
		if (state.manualControlState.userDefinedMaxSpeed == null) {
			state.manualControlState.userDefinedMaxSpeed = maxSpeed;
		}
	}

	const simMaxSpeedInput = document.getElementById('maxSpeedInput');
	if (simMaxSpeedInput) {
		simMaxSpeedInput.value = String(Math.round(maxSpeed));
	}

	updateDynamicsDefaultsUI();
}

function loadDynamicsDefaultsFromStorage() {
	const savedMaxSpeed = localStorage.getItem('defaultMaxSpeedKmh');
	const savedAccelG = localStorage.getItem('defaultAccelGForce');
	const savedDecelG = localStorage.getItem('defaultDecelGForce');

	state.defaultMaxSpeed = clampNumber(savedMaxSpeed, 1, 1500, DEFAULT_MAX_SPEED_KMH);
	state.defaultAccelGForce = clampNumber(savedAccelG, 0.05, 2.0, DEFAULT_ACCEL_G);
	state.defaultDecelGForce = clampNumber(savedDecelG, 0.05, 2.0, DEFAULT_DECEL_G);

	localStorage.setItem('defaultMaxSpeedKmh', String(Math.round(state.defaultMaxSpeed)));
	localStorage.setItem('defaultAccelGForce', state.defaultAccelGForce.toFixed(2));
	localStorage.setItem('defaultDecelGForce', state.defaultDecelGForce.toFixed(2));

	applyDynamicsDefaultsToRuntime();
}

function setDefaultMaxSpeed(value) {
	state.defaultMaxSpeed = clampNumber(value, 1, 1500, DEFAULT_MAX_SPEED_KMH);
	localStorage.setItem('defaultMaxSpeedKmh', String(Math.round(state.defaultMaxSpeed)));
	applyDynamicsDefaultsToRuntime();
}

function setDefaultAccelGForce(value) {
	state.defaultAccelGForce = clampNumber(value, 0.05, 2.0, DEFAULT_ACCEL_G);
	localStorage.setItem('defaultAccelGForce', state.defaultAccelGForce.toFixed(2));
	applyDynamicsDefaultsToRuntime();
}

function setDefaultDecelGForce(value) {
	state.defaultDecelGForce = clampNumber(value, 0.05, 2.0, DEFAULT_DECEL_G);
	localStorage.setItem('defaultDecelGForce', state.defaultDecelGForce.toFixed(2));
	applyDynamicsDefaultsToRuntime();
}

function applyMapContainerSizeToDOM() {
	const widthPercent = clampNumber(state.mapContainerWidthPercent, 60, 100, DEFAULT_MAP_WIDTH_PERCENT);
	const heightPx = clampNumber(state.mapContainerHeightPx, 400, 1200, DEFAULT_MAP_HEIGHT_PX);

	state.mapContainerWidthPercent = widthPercent;
	state.mapContainerHeightPx = heightPx;

	const mapEl = document.getElementById('map');
	if (mapEl) {
		mapEl.style.width = `${widthPercent}%`;
		mapEl.style.height = `${Math.round(heightPx)}px`;
		mapEl.style.minHeight = '400px';
		setTimeout(() => {
			if (state.map && typeof state.map.updateSize === 'function') state.map.updateSize();
		}, 0);
	}

	const widthSlider = document.getElementById('mapContainerWidth');
	const heightSlider = document.getElementById('mapContainerHeight');
	const widthValue = document.getElementById('mapContainerWidthValue');
	const heightValue = document.getElementById('mapContainerHeightValue');
	if (widthSlider) widthSlider.value = String(Math.round(widthPercent));
	if (heightSlider) heightSlider.value = String(Math.round(heightPx));
	if (widthValue) widthValue.textContent = `${Math.round(widthPercent)}%`;
	if (heightValue) heightValue.textContent = `${Math.round(heightPx)}px`;
}

function loadMapContainerSizeFromStorage() {
	const savedWidth = localStorage.getItem('mapContainerWidthPercent');
	const savedHeight = localStorage.getItem('mapContainerHeightPx');

	state.mapContainerWidthPercent = clampNumber(savedWidth, 60, 100, DEFAULT_MAP_WIDTH_PERCENT);
	state.mapContainerHeightPx = clampNumber(savedHeight, 400, 1200, DEFAULT_MAP_HEIGHT_PX);

	localStorage.setItem('mapContainerWidthPercent', String(Math.round(state.mapContainerWidthPercent)));
	localStorage.setItem('mapContainerHeightPx', String(Math.round(state.mapContainerHeightPx)));

	applyMapContainerSizeToDOM();
}

function updateGraphicsQualityUI() {
	const select = document.getElementById('graphicsQualitySelect');
	if (select) select.value = state.graphicsQuality;
}

function setCoachType(value) {
	const coachType = value === 'transparent' ? 'transparent' : 'opaque';
	state.coachType = coachType;
	localStorage.setItem('coachType', coachType);
	const select = document.getElementById('coachTypeSelect');
	if (select) select.value = coachType;
	refreshActiveVehicleStyles();
}

function resolveCurrentGraphicsQuality(quality = state.graphicsQuality) {
	return resolveGraphicsQuality(quality, {
		devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
		mobile: !!state.isMobileDevice,
		performanceMode: state.performanceModeEnabled,
		viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1280
	});
}

function set3DGraphicsQuality(value) {
	const quality = normalizeGraphicsQuality(value) || defaultGraphicsQuality({
		mobile: !!state.isMobileDevice,
		hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4
	});
	state.graphicsQuality = quality;
	try { localStorage.setItem('graphicsQuality', quality); } catch {}
	state.graphicsQualityConfig = resolveCurrentGraphicsQuality(quality);
	updateGraphicsQualityUI();
	state.world3D?.setGraphicsQuality?.(quality);
}

function loadGraphicsQualityFromStorage() {
	let saved = null;
	try { saved = localStorage.getItem('graphicsQuality'); } catch {}
	const quality = normalizeGraphicsQuality(saved) || defaultGraphicsQuality({
		mobile: !!state.isMobileDevice,
		hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4
	});
	set3DGraphicsQuality(quality);
}

function setMapContainerWidth(value) {
	state.mapContainerWidthPercent = clampNumber(value, 60, 100, DEFAULT_MAP_WIDTH_PERCENT);
	localStorage.setItem('mapContainerWidthPercent', String(Math.round(state.mapContainerWidthPercent)));
	applyMapContainerSizeToDOM();
}

function setMapContainerHeight(value) {
	state.mapContainerHeightPx = clampNumber(value, 400, 1200, DEFAULT_MAP_HEIGHT_PX);
	localStorage.setItem('mapContainerHeightPx', String(Math.round(state.mapContainerHeightPx)));
	applyMapContainerSizeToDOM();
}

function updateStationSize(value) {
	let display = parseFloat(value);
	if (!Number.isFinite(display)) display = DEFAULT_STATION_SIZE_MULTIPLIER;
	display = Math.max(0.6, Math.min(2.5, display));

	// Store the user-facing display multiplier and set internal multiplier
	localStorage.setItem('stationSizeMultiplier', String(display));
	state.stationSizeMultiplier = display * STATION_BASE_MULTIPLIER;
	updateStationSizeUI();

	if (state.map && typeof state.map.render === 'function') {
		state.map.render();
	}
}

function updateStationSizeUI() {
	const internal = Number.isFinite(state.stationSizeMultiplier)
		? state.stationSizeMultiplier
		: DEFAULT_STATION_SIZE_MULTIPLIER * STATION_BASE_MULTIPLIER;
	// Compute the user-facing display value (relative to the base)
	const display = internal / STATION_BASE_MULTIPLIER;
	const percentage = Math.round(display * 100);

	const slider = document.getElementById('stationSizeSlider');
	const valueSpan = document.getElementById('stationSizeValue');
	const percentSpan = document.getElementById('stationSizePercent');

	if (slider) slider.value = String(display);
	if (valueSpan) valueSpan.textContent = `${percentage}%`;
	if (percentSpan) percentSpan.textContent = String(percentage);
}

function loadStationSizeFromStorage() {
	const saved = localStorage.getItem('stationSizeMultiplier');
	if (saved !== null) {
		state.stationSizeMultiplier = clampNumber(saved, 0.6, 2.5, DEFAULT_STATION_SIZE_MULTIPLIER);
	} else {
		state.stationSizeMultiplier = DEFAULT_STATION_SIZE_MULTIPLIER;
		localStorage.setItem('stationSizeMultiplier', String(state.stationSizeMultiplier));
	}
	updateStationSizeUI();
}

/**
 * Initialize settings from localStorage or use defaults
 */
function loadSettingsFromStorage() {
	// One-time migration: rebase old traffic multiplier values so legacy 1.8x
	// feel maps to new baseline 1.0x.
	const trafficMigrated = localStorage.getItem('careerTrafficBaselineMigratedV2') === 'true';
	if (!trafficMigrated) {
		const saved = localStorage.getItem('careerPassengerTrafficMultiplier');
		const rawTraffic = parseFloat(saved);
		if (saved !== null && Number.isFinite(rawTraffic)) {
			const rebased = Math.max(0.1, Math.min(5, rawTraffic / CAREER_TRAFFIC_BASELINE_FACTOR));
			localStorage.setItem('careerPassengerTrafficMultiplier', String(rebased));
		}
		localStorage.setItem('careerTrafficBaselineMigratedV2', 'true');
	}
	// Earlier builds rebased the unsaved default (1 → 0.56x) on first run; restore the 1.0x default.
	if (localStorage.getItem('careerPassengerTrafficMultiplier') === String(1 / CAREER_TRAFFIC_BASELINE_FACTOR)) {
		localStorage.setItem('careerPassengerTrafficMultiplier', '1');
	}

	const savedVehicleSize = localStorage.getItem('vehicleSizeMultiplier');
	if (savedVehicleSize !== null) {
		state.vehicleSizeMultiplier = parseFloat(savedVehicleSize);
		updateVehicleSizeUI();
	}

	// Load unit preference — default to metric (km)
	const savedUnits = localStorage.getItem('useImperialUnits');
	if (savedUnits !== null) {
		state.useImperialUnits = savedUnits === 'true';
	} else {
		state.useImperialUnits = false;
		localStorage.setItem('useImperialUnits', 'false');
	}
	updateUnitUI();
	loadDynamicsDefaultsFromStorage();
	setSpeedometerMode(localStorage.getItem('speedometerMode') || 'combined');
	setCoachType(localStorage.getItem('coachType') || 'opaque');
	loadMapContainerSizeFromStorage();
	loadStationSizeFromStorage();
	loadGraphicsQualityFromStorage();
	loadApiConnectionSettingsUI();
}

/**
 * Show settings dialog
 */
function showSettingsDialog() {
	const dialog = document.getElementById('settingsDialog');
	if (dialog) {
		updateDynamicsDefaultsUI();
		applyMapContainerSizeToDOM();
		updateStationSizeUI();
		loadApiConnectionSettingsUI();
		dialog.style.display = 'block';
		// Fade in animation
		requestAnimationFrame(() => {
			dialog.style.opacity = '0';
			dialog.style.transform = 'translate(-50%, -50%) scale(0.9)';
			requestAnimationFrame(() => {
				dialog.style.transition = 'all 0.3s ease';
				dialog.style.opacity = '1';
				dialog.style.transform = 'translate(-50%, -50%) scale(1)';
			});
		});
		refreshCareerSettingsVisibility();
	}
}

function loadApiConnectionSettingsUI() {
	const saved = getLocalClientConfig();
	const fields = {
		googleMapsApiKey: 'googleMapsApiKeySetting',
		cesiumIonToken: 'cesiumIonTokenSetting',
		weatherProxyUrl: 'weatherProxyUrlSetting',
		openWeatherApiKey: 'openWeatherApiKeySetting'
	};
	for (const [key, id] of Object.entries(fields)) {
		const input = document.getElementById(id);
		if (input) input.value = saved[key] || '';
	}
}

function saveApiConnectionSettings() {
	const values = {
		googleMapsApiKey: document.getElementById('googleMapsApiKeySetting')?.value || '',
		cesiumIonToken: document.getElementById('cesiumIonTokenSetting')?.value || '',
		weatherProxyUrl: document.getElementById('weatherProxyUrlSetting')?.value || '',
		openWeatherApiKey: document.getElementById('openWeatherApiKeySetting')?.value || ''
	};
	const status = document.getElementById('apiSettingsStatus');
	try {
		saveLocalClientConfig(values);
		resetGoogleSatelliteConfiguration();
		if (status) {
			status.textContent = 'Saved on this device. Reload or switch map themes to apply provider changes.';
			status.style.color = '#10b981';
		}
	} catch (error) {
		if (status) {
			status.textContent = error.message;
			status.style.color = '#f87171';
		}
	}
}

function clearApiConnectionSettings() {
	const status = document.getElementById('apiSettingsStatus');
	try {
		clearLocalClientConfig();
		resetGoogleSatelliteConfiguration();
		loadApiConnectionSettingsUI();
		if (status) {
			status.textContent = 'Local API settings cleared.';
			status.style.color = '#fbbf24';
		}
	} catch (error) {
		if (status) {
			status.textContent = error.message;
			status.style.color = '#f87171';
		}
	}
}

/**
 * Close settings dialog
 */
function closeSettingsDialog() {
	const dialog = document.getElementById('settingsDialog');
	if (dialog) {
		dialog.style.opacity = '0';
		dialog.style.transform = 'translate(-50%, -50%) scale(0.9)';
		setTimeout(() => {
			dialog.style.display = 'none';
			dialog.style.transition = 'none';
		}, 300);
	}
}

/**
 * Update vehicle size multiplier
 * @param {number} value - Scale multiplier (0.5 to 2.0)
 */
function updateVehicleSize(value) {
	value = parseFloat(value);
	
	// Clamp value to valid range
	if (value < 0.5) value = 0.5;
	if (value > 2.0) value = 2.0;
	
	state.vehicleSizeMultiplier = value;
	
	// Save to localStorage
	localStorage.setItem('vehicleSizeMultiplier', value);
	
	// Update UI display
	updateVehicleSizeUI();
	
	// Trigger vehicle icon refresh using the shared zoom-aware refresh path
	if (state.map) {
		refreshActiveVehicleStyles();
		state.map.render();
	}
}

/**
 * Update UI elements to reflect current vehicle size
 */
function updateVehicleSizeUI() {
	const multiplier = state.vehicleSizeMultiplier || 1.0;
	const percentage = Math.round(multiplier * 100);
	
	const slider = document.getElementById('vehicleSizeSlider');
	const valueSpan = document.getElementById('vehicleSizeValue');
	const percentSpan = document.getElementById('vehicleSizePercent');
	
	if (slider) slider.value = multiplier;
	if (valueSpan) valueSpan.textContent = `${percentage}%`;
	if (percentSpan) percentSpan.textContent = percentage;
}

/**
 * Reset vehicle size to default (1.0)
 */
function resetVehicleSize() {
	updateVehicleSize(1.0);
	console.log('🔄 Vehicle size reset to default (100%)');
}

/**
 * Set the unit system (metric or imperial) and persist the choice
 * @param {boolean} useImperial - true = mph/miles, false = km/h/km
 */
function setUnitSystem(useImperial) {
	state.useImperialUnits = !!useImperial;
	localStorage.setItem('useImperialUnits', state.useImperialUnits);
	updateUnitUI();
}

/**
 * Update all UI elements that reflect the current unit preference
 */
function updateUnitUI() {
	const imperial = state.useImperialUnits;
	const kmBtn = document.getElementById('unitKmBtn');
	const mphBtn = document.getElementById('unitMphBtn');
	if (kmBtn) {
		kmBtn.style.background = !imperial ? 'rgba(16, 185, 129, 0.2)' : 'rgba(51, 65, 85, 0.5)';
		kmBtn.style.borderColor = !imperial ? 'rgba(16, 185, 129, 0.5)' : 'rgba(71, 85, 105, 0.5)';
		kmBtn.style.color = !imperial ? '#10b981' : '#94a3b8';
	}
	if (mphBtn) {
		mphBtn.style.background = imperial ? 'rgba(16, 185, 129, 0.2)' : 'rgba(51, 65, 85, 0.5)';
		mphBtn.style.borderColor = imperial ? 'rgba(16, 185, 129, 0.5)' : 'rgba(71, 85, 105, 0.5)';
		mphBtn.style.color = imperial ? '#10b981' : '#94a3b8';
	}
	// Refresh all speed-unit labels in the HUD
	const speedUnit = imperial ? 'mph' : 'km/h';
	document.querySelectorAll('.speed-unit').forEach(el => { el.textContent = speedUnit; });
	// Update timetable peak-speed column header if present
	const peakHeader = document.getElementById('peakSpeedHeader');
	if (peakHeader) peakHeader.textContent = `Peak ${speedUnit}`;
	updateSpeedometer();
	updateSegmentSpeedSign();
}

// ─── Career Settings ───

function setCareerCurrency(curr) {
	localStorage.setItem('careerCurrency', curr);
	// Highlight active button
	const inrBtn = document.getElementById('careerCurrINR');
	const usdBtn = document.getElementById('careerCurrUSD');
	if (inrBtn) {
		inrBtn.style.background = curr === 'INR' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(51, 65, 85, 0.5)';
		inrBtn.style.borderColor = curr === 'INR' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(71, 85, 105, 0.5)';
		inrBtn.style.color = curr === 'INR' ? '#10b981' : '#94a3b8';
	}
	if (usdBtn) {
		usdBtn.style.background = curr === 'USD' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(51, 65, 85, 0.5)';
		usdBtn.style.borderColor = curr === 'USD' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(71, 85, 105, 0.5)';
		usdBtn.style.color = curr === 'USD' ? '#10b981' : '#94a3b8';
	}
}

function refreshCareerSettingsUI() {
	const sectionBody = document.getElementById('careerSettingsBody');
	const toggleBtn = document.getElementById('careerSettingsToggleBtn');
	const expanded = localStorage.getItem('careerSettingsExpanded') === 'true';
	if (sectionBody) sectionBody.style.display = expanded ? 'block' : 'none';
	if (toggleBtn) toggleBtn.textContent = expanded ? 'Hide Section ▴' : 'Show Section ▾';

	const curr = localStorage.getItem('careerCurrency') || 'INR';
	setCareerCurrency(curr);

	const fareRate = localStorage.getItem('careerFareRatePerKm') || '1';
	const baseCost = localStorage.getItem('careerOperatingCostPerKm') || '100';
	const coachCost = localStorage.getItem('careerExtraCoachCostPerKm') || '50';
	const trafficMultiplier = localStorage.getItem('careerPassengerTrafficMultiplier') || '1';

	const fareInput = document.getElementById('careerFareRate');
	const baseInput = document.getElementById('careerBaseCost');
	const coachInput = document.getElementById('careerCoachCost');
	const trafficInput = document.getElementById('careerPassengerTraffic');
	const trafficValue = document.getElementById('careerPassengerTrafficValue');
	if (fareInput) fareInput.value = fareRate;
	if (baseInput) baseInput.value = baseCost;
	if (coachInput) coachInput.value = coachCost;
	if (trafficInput) trafficInput.value = trafficMultiplier;
	if (trafficValue) trafficValue.textContent = `${parseFloat(trafficMultiplier).toFixed(1)}x`;
	for (const [id, key, fallback] of CAREER_AUTOMATION_TOGGLES) {
		const el = document.getElementById(id);
		const saved = localStorage.getItem(key);
		if (el) el.checked = saved === null ? fallback : saved === 'true';
	}

	const list = document.getElementById('careerHighScoresList');
	if (!list) return;
	const scores = JSON.parse(localStorage.getItem('careerHighScores') || '[]');
	if (scores.length === 0) {
		list.textContent = 'No high scores yet.';
		return;
	}
	list.innerHTML = scores.map((s, i) =>
		`<div style="display:flex;justify-content:space-between;padding:2px 0;${i % 2 ? '' : 'opacity:0.8'}"><span>#${i + 1} ${s.distance} km</span><span>${s.passengers} pax</span><span>${s.balance >= 0 ? '+' : ''}${s.balance}</span></div>`
	).join('');
}

function setCareerFareRate(value) {
	const parsed = parseFloat(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return;
	localStorage.setItem('careerFareRatePerKm', String(parsed));
}

function setCareerBaseCost(value) {
	const parsed = parseFloat(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return;
	localStorage.setItem('careerOperatingCostPerKm', String(parsed));
}

function setCareerCoachCost(value) {
	const parsed = parseFloat(value);
	if (!Number.isFinite(parsed) || parsed < 0) return;
	localStorage.setItem('careerExtraCoachCostPerKm', String(parsed));
}

function setCareerPassengerTraffic(value) {
	const parsed = parseFloat(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return;
	const clamped = Math.max(0.1, Math.min(5, parsed));
	localStorage.setItem('careerPassengerTrafficMultiplier', String(clamped));
	const trafficValue = document.getElementById('careerPassengerTrafficValue');
	if (trafficValue) trafficValue.textContent = `${clamped.toFixed(1)}x`;
}

const CAREER_AUTOMATION_TOGGLES = [
	['careerAutoDoorsToggle', 'careerAutoDoors', false],
	['careerAutoCoachesToggle', 'careerAutoCoaches', false],
	['careerAutoStartCoachesToggle', 'careerAutoStartCoaches', true]
];

function setCareerAutoDoors(enabled) {
	localStorage.setItem('careerAutoDoors', enabled ? 'true' : 'false');
}

function setCareerAutoCoaches(enabled) {
	localStorage.setItem('careerAutoCoaches', enabled ? 'true' : 'false');
}

function setCareerAutoStartCoaches(enabled) {
	localStorage.setItem('careerAutoStartCoaches', enabled ? 'true' : 'false');
}

function isCareerContextVisible() {
	// Career settings are now always visible in the Settings dialog
	return true;
}

function setPerformanceMode(enabled) {
	state.performanceModeEnabled = (enabled === true || enabled === 'true');
	document.documentElement.classList.toggle('performance-mode', state.performanceModeEnabled);
	localStorage.setItem('performanceMode', state.performanceModeEnabled ? 'true' : 'false');
	const toggle = document.getElementById('performanceModeToggle');
	if (toggle) toggle.checked = state.performanceModeEnabled;
	state.graphicsQualityConfig = resolveCurrentGraphicsQuality();
	state.world3D?.setGraphicsQuality?.(state.graphicsQuality);
}

function refreshCareerSettingsVisibility() {
	const section = document.getElementById('careerSettingsSection');
	if (!section) return;
	// Career settings section is now always shown
	section.style.display = 'block';
	refreshCareerSettingsUI();
}

function toggleCareerSettingsSection() {
	if (!isCareerContextVisible()) return;
	const expanded = localStorage.getItem('careerSettingsExpanded') === 'true';
	localStorage.setItem('careerSettingsExpanded', expanded ? 'false' : 'true');
	refreshCareerSettingsUI();
}

function clearCareerHighScores() {
	localStorage.removeItem('careerHighScores');
	refreshCareerSettingsUI();
}

// Close settings dialog on outer click
document.addEventListener('DOMContentLoaded', () => {
	const dialog = document.getElementById('settingsDialog');
	if (dialog) {
		dialog.addEventListener('click', (e) => {
			// Close only if clicking on the backdrop (outside the dialog content)
			if (e.target === dialog) {
				closeSettingsDialog();
			}
		});
	}

	document.querySelectorAll('input[name="simMode"]').forEach((radio) => {
		radio.addEventListener('change', refreshCareerSettingsVisibility);
	});

	refreshCareerSettingsVisibility();
	updateDynamicsDefaultsUI();
	applyMapContainerSizeToDOM();
	updateStationSizeUI();
});

export { loadSettingsFromStorage, showSettingsDialog, closeSettingsDialog, saveApiConnectionSettings, clearApiConnectionSettings, updateVehicleSize, resetVehicleSize, updateStationSize, setUnitSystem, updateUnitUI, setDefaultMaxSpeed, setDefaultAccelGForce, setDefaultDecelGForce, setMapContainerWidth, setMapContainerHeight, setCareerCurrency, clearCareerHighScores, setCareerFareRate, setCareerBaseCost, setCareerCoachCost, setCareerPassengerTraffic, setCareerAutoDoors, setCareerAutoCoaches, setCareerAutoStartCoaches, toggleCareerSettingsSection, refreshCareerSettingsVisibility, setPerformanceMode, set3DGraphicsQuality, setCoachType };
