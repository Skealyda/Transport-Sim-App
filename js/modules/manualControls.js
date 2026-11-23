// ====================================
// MANUAL VEHICLE CONTROLS & PHYSICS
// ====================================
import state from './state.js';
import { createFramePacer } from './framePacing.js';
import { sampleRoutePosition } from './routePosition.js';
import { updateSpeedometer } from './speedometer.js';
import { clearSegmentSpeedProfile, setSegmentSpeedProfile, updateSegmentSpeedSign } from './segmentSpeedSign.js';
import { playAudio, calculateRotationAngle, calculateDistance } from './utils.js';
import { beginJourney, announceDeparture, announceApproach, announcePassing, announceArrival, cancelAnnouncements } from './announcer.js';
import { startTrainAudio, stopTrainAudio, updateTrainAudio, isTrainAudioActive, playDoorSequence, soundHorn, setStationAmbience } from './trainSound.js';
import { animateMovement } from './autoAnimation.js';
import { closeSimulateDialog, updateTrainColors, initializeTrainCoaches, updateTrainCoaches, initializeDragDrop } from './vehicle.js';
import { calculateGForces, updateDynamicBraking, calculateManualSegmentPeakSpeeds } from './gforce.js';
import { updateStats, updateRouteInfo, stopFlightMonitor, getScheduleStatus } from './hud.js';
import { monitorSafetyStatus, clearEmergencyState, activateEmergencyBraking } from './safety.js';
import { calculateTotalRemainingDistance } from './routeManager.js';
import { initCareerMode, resetCareerMode, classifyRouteIfNeeded, getCareerAutomation, recommendStartingCoaches, setStartingCoachCount, createStationPlatforms, CAREER } from './careerMode.js';
import { startPassengerTraffic, stopPassengerTraffic, processPassengerArrival } from './passengerTraffic.js';

document.addEventListener('visibilitychange', () => {
	state.lastUpdateTime = Date.now();
});

// Toolbar telemetry interval (cleared on stop)
let telemetryInterval = null;
let manualRunId = 0;
let manualTrackingHandler = null;
let manualTrackingEnabled = false;
let autopilotRun = null;
let manualHandoverAcceleration = null;
let manualPassengerStopIndex = -1;

async function startSimulation() {
	let mode = document.getElementById("transportMode").value;
	// Use a high default speed - let physics calculations determine actual max achievable speed
	let topSpeed = parseFloat(document.getElementById("maxSpeedInput").value) || 500;
	let simulationMode = document.querySelector('input[name="simMode"]:checked').value;

	// Read driving style for road/car mode
	const drivingStyleInput = document.querySelector('input[name="drivingStyle"]:checked');
	state.drivingStyle = (mode === 'car' || state.currentRouteType === 'road')
		? (drivingStyleInput ? drivingStyleInput.value : 'normal')
		: 'normal';
	// Get coach count for trains
	let coachCount = 1;
	if (mode === 'train') {
		coachCount = parseInt(document.getElementById("coachCountSlider").value);
		// Ensure train colors are captured
		updateTrainColors();
	}

	if (!state.route || state.route.length < 2) {
		alert("No valid state.route loaded. Please select a state.route with at least two points.");
		return;
	}
	if (state.manualControlState.isManualMode) stopSimulation();
	stopPassengerTraffic();

	console.log("Starting simulation with route:", state.route);
	console.log("Simulation mode:", simulationMode);
	console.log("Coach count:", coachCount);
	if (mode === 'train' && window.trainColors) {
		console.log("Train colors:", window.trainColors);
	}

	closeSimulateDialog();

	// Activate toolbar simulation phase
	const toolbarBar = document.querySelector('.toolbar-bar');
	if (toolbarBar) toolbarBar.classList.add('toolbar--sim-active');
	const simBtn = document.getElementById('simulateBtn');
	if (simBtn) simBtn.classList.add('sim-running');
	// Start telemetry strip updater
	if (telemetryInterval) clearInterval(telemetryInterval);
	telemetryInterval = setInterval(() => {
		const scheduleEl = document.getElementById('telemetrySchedule');
		const progressEl = document.getElementById('telemetryProgress');
		if (scheduleEl) {
			const status = simulationMode === 'manual' ? null : getScheduleStatus();
			const label = state.manualControlState.autopilotActive ? 'Autopilot'
				: status ? status.label : (simulationMode === 'manual' ? 'Manual' : '—');
			const level = status ? status.level : 'none';
			if (scheduleEl.textContent !== label) scheduleEl.textContent = label;
			if (scheduleEl.dataset.level !== level) scheduleEl.dataset.level = level;
		}
		if (progressEl) {
			const pct = state.totalRouteDistance > 0
				? Math.round((state.totalDistanceCovered / state.totalRouteDistance) * 100)
				: 0;
			progressEl.textContent = pct + '%';
		}
	}, 500);

	if (simulationMode === 'manual') {
		state.careerMode = false;
		resetCareerMode();
		if (mode === 'train') startPassengerTraffic(state.route, coachCount * CAREER.MAX_PAX_PER_COACH);
		createStationPlatforms();
		showManualControlPanel();
		if (mode === 'train') {
			showDoorControls();
		} else {
			hideDoorControls();
		}
		startManualSimulation(state.route, mode, topSpeed, coachCount);
	} else if (simulationMode === 'semiAuto') {
		// Semi-auto: automated physics, but user controls doors at each stop.
		// Signal the animation loop to pause at stops and wait for door events.
		state.semiAutoMode = true;
		state.careerMode = false;
		resetCareerMode();
		if (mode === 'train') startPassengerTraffic(state.route, coachCount * CAREER.MAX_PAX_PER_COACH);
		createStationPlatforms();
		if (mode === 'train') showDoorControls();
		animateMovement(state.route, mode, topSpeed, coachCount);
	} else if (simulationMode === 'career') {
		// Career / Survival mode: semi-auto + economy system
		state.semiAutoMode = true;
		if (mode === 'train') showDoorControls();
		// Classify route stops for passenger density (async, non-blocking)
		const routeDropdown = document.getElementById('routeDropdown') || document.getElementById('mainRouteDropdown');
		const routeName = routeDropdown ? routeDropdown.value : '';
		if (routeName) classifyRouteIfNeeded(routeName);
		initCareerMode(coachCount);
		if (mode === 'train' && getCareerAutomation().startCoaches) {
			coachCount = recommendStartingCoaches();
			setStartingCoachCount(coachCount);
			console.log(`🚃 Career auto starting rake: ${coachCount} coach(es)`);
		}
		// Show economy panel
		const ep = document.getElementById('economyPanel');
		if (ep) ep.style.display = '';
		if (typeof window.updateEconomyHUD === 'function') window.updateEconomyHUD();
		animateMovement(state.route, mode, topSpeed, coachCount);
	} else {
		// Full auto
		state.semiAutoMode = false;
		state.careerMode = false;
		resetCareerMode();
		if (mode === 'train') startPassengerTraffic(state.route, coachCount * CAREER.MAX_PAX_PER_COACH);
		createStationPlatforms();
		animateMovement(state.route, mode, topSpeed, coachCount);
	}
}

function showManualControlPanel() {
	const panel = document.getElementById("manualControlPanel");
	if (panel.classList.contains('minimized')) minimizeControlPanel();
	panel.style.display = "block";

	// Initialize drag and drop functionality
	setTimeout(() => {
		initializeDragDrop();
	}, 100);
}

function hideManualControlPanel() {
	document.getElementById("manualControlPanel").style.display = "none";
}

function showDoorControls() {
	const doorsBtn = document.getElementById("doorsBtn");
	if (doorsBtn) {
		doorsBtn.style.display = "block";
	}
	document.querySelectorAll('.manual-horn').forEach(button => { button.style.display = ''; });
}

function hideDoorControls() {
	const doorsBtn = document.getElementById("doorsBtn");
	if (doorsBtn) {
		doorsBtn.style.display = "none";
	}
	document.querySelectorAll('.manual-horn').forEach(button => { button.style.display = 'none'; });
}

const manualControlState = state.manualControlState;

function soundManualHorn() {
	if (manualControlState.isManualMode && state.activeVehicleMode === 'train') soundHorn('depart');
}

function adjustSpeed(delta) {
	const input = document.getElementById("targetSpeedInput");
	const currentValue = parseInt(input.value) || 0;
	const newValue = Math.max(0, Math.min(manualControlState.maxSpeed, currentValue + delta));
	input.value = newValue;
	setTargetSpeed();
}

function setTargetSpeedDirect(speed) {
	const input = document.getElementById("targetSpeedInput");
	if (speed !== undefined) {
		input.value = Math.max(0, Math.min(manualControlState.maxSpeed, speed));
	}

	setTargetSpeed();
}

// Set acceleration to minimum value (20%)
function setAccelerationMin() {
	const accelerationSlider = document.getElementById('accelerationSlider');
	if (accelerationSlider) {
		accelerationSlider.value = 20;
		state.manualControlState.acceleration = 20;
		updateAccelerationFromSlider(20);
	}
}

// Update acceleration from slider
function updateAccelerationFromSlider(value) {
	if (autopilotRun) toggleManualAutopilot();
	state.manualControlState.acceleration = parseInt(value);
	document.getElementById('accelerationSlider').value = value;
	document.getElementById('compactPower').value = value;
	document.getElementById('compactPowerValue').textContent = `${value}%`;

	// Update both displays
	const accelerationDisplay = document.getElementById('accelerationDisplay');
	const accelerationValueDisplay = document.getElementById('accelerationValueDisplay');

	if (accelerationDisplay) {
		accelerationDisplay.textContent = value + '%';
	}
	if (accelerationValueDisplay) {
		accelerationValueDisplay.textContent = value + '%';
	}
}

// Update brake from slider
function updateBrakeFromSlider(value) {
	if (autopilotRun) toggleManualAutopilot();
	state.manualControlState.brakeLevel = parseInt(value);
	document.getElementById('brakeSlider').value = value;
	document.getElementById('compactBrake').value = value;
	document.getElementById('compactBrakeValue').textContent = `${value}%`;

	// Update both displays
	const brakeDisplay = document.getElementById('brakeDisplay');
	const brakeValueDisplay = document.getElementById('brakeValueDisplay');

	if (brakeDisplay) {
		brakeDisplay.textContent = value + '%';
	}
	if (brakeValueDisplay) {
		brakeValueDisplay.textContent = value + '%';
	}

	// Set braking state
	state.manualControlState.isBraking = value > 0;
}

// Emergency brake function
function emergencyBrake() {
	const brakeSlider = document.getElementById('brakeSlider');
	if (brakeSlider) {
		brakeSlider.value = 100;
		updateBrakeFromSlider(100);
	}

	// Set acceleration to zero
	const accelerationSlider = document.getElementById('accelerationSlider');
	if (accelerationSlider) {
		accelerationSlider.value = 0;
		updateAccelerationFromSlider(0);
	}

	// Apply emergency brake
	applyBrakes();
}

// G-Force limit control function
function updateGForceLimit(value) {
	const oldLimit = state.maxGForceLimit;
	const newLimit = parseFloat(value);

	// Validate the new G-Force limit
	if (isNaN(newLimit) || newLimit <= 0 || newLimit > 3.0) {
		console.warn(`⚠️ Invalid G-Force limit: ${value}, keeping current value: ${state.maxGForceLimit}g`);
		return;
	}

	state.maxGForceLimit = newLimit;
	const limitDisplay = document.getElementById('gforceLimitValue');
	if (limitDisplay) limitDisplay.textContent = newLimit + 'g';

	// Save to localStorage
	localStorage.setItem('gforceLimit', newLimit);

	// If the limit changed significantly and we're currently braking, recalculate
	if (Math.abs(oldLimit - state.maxGForceLimit) > 0.1 && state.brakingState && state.brakingState.isAdvancedBraking) {
		// Reset emergency braking flag if the new limit allows for better braking
		if (state.maxGForceLimit > oldLimit && state.brakingState.isEmergencyBraking) {
			state.brakingState.isEmergencyBraking = false;
		}
	}

	// Update smooth deceleration parameters based on G-Force limit
	updateDeceleration();
}

// Update deceleration parameters based on current G-Force limit
function updateDeceleration() {
	// Calculate new deceleration rate based on G-Force limit
	const maxDeceleration = calculateMaxAcceleration(); // Same calculation for decel

	// Update any active braking calculations
	if (typeof state.brakingState !== 'undefined' && state.brakingState.isActive) {
		// Parameters updated
	}
}

// Calculate maximum safe acceleration/deceleration based on G-Force limit
function calculateMaxAcceleration() {
	// Convert G-Force limit to m/s² (1g = 9.81 m/s²)
	const maxAccelMS2 = state.maxGForceLimit * 9.81;
	// Convert to km/h² for our speed calculations
	const maxAccelKMH2 = maxAccelMS2 * 12.96; // 3.6² conversion factor
	return maxAccelKMH2;
}

// Smooth speed transition with G-Force limiting
function applySmoothSpeedTransition(targetSpeed, deltaTime) {
	const maxAccel = calculateMaxAcceleration();
	const speedDifference = targetSpeed - state.currentSmoothedSpeed;

	// Calculate maximum speed change allowed per frame
	const maxSpeedChange = maxAccel * deltaTime;

	// Apply gradual speed change within G-Force limits
	if (Math.abs(speedDifference) <= maxSpeedChange) {
		state.currentSmoothedSpeed = targetSpeed;
	} else {
		state.currentSmoothedSpeed += Math.sign(speedDifference) * maxSpeedChange;
	}

	// Calculate current G-Force based on speed change
	if (deltaTime > 0) {
		const accelerationKMH2 = Math.abs(speedDifference) / deltaTime;
		const accelerationMS2 = accelerationKMH2 / 12.96;
		state.currentGForce = accelerationMS2 / 9.81;
	}

	return state.currentSmoothedSpeed;
}

function applyBrakes() {
	// Activate comprehensive emergency braking system
	activateEmergencyBraking("Emergency brake button activated");

	state.smoothTargetSpeed = 0;
	state.manualControlState.targetSpeed = 0;
	state.manualControlState.currentAcceleration = 0;

	// Reset UI immediately
	document.getElementById("accelerationSlider").value = 0;
	document.getElementById("accelerationDisplay").textContent = '0%';
	document.getElementById("targetSpeedInput").value = 0;
	document.getElementById("targetSpeedDisplay").textContent = '0';
	syncCompactSpeed();

}

function applySmoothBraking() {
	// Smooth braking - gradually reduce speed without emergency stop
	const currentSpeed = state.manualControlState.currentSpeed;
	const smoothBrakeTarget = Math.max(0, currentSpeed * 0.3); // Reduce to 30% of current speed

	state.manualControlState.targetSpeed = smoothBrakeTarget;
	state.manualControlState.currentAcceleration = 0;

	// Update UI
	document.getElementById("accelerationSlider").value = 0;
	document.getElementById("accelerationDisplay").textContent = '0';
	document.getElementById("targetSpeedInput").value = Math.round(smoothBrakeTarget);
	document.getElementById("targetSpeedDisplay").textContent = Math.round(smoothBrakeTarget);

	// Update status
	document.getElementById("statusText").textContent = "Smooth Braking";
	document.getElementById("statusIndicator").style.color = "#f59e0b";

	console.log(`Smooth braking applied! Target speed: ${Math.round(smoothBrakeTarget)} km/h`);

	setTimeout(() => {
		if (manualControlState.currentSpeed < 5) {
			document.getElementById("statusText").textContent = "Ready";
			document.getElementById("statusIndicator").style.color = "#10b981";
		}
	}, 1500);
}

function openDoors() {
	if (manualControlState.currentSpeed >= 0.1) {
		alert("Safety alert: Stop the vehicle before opening the doors.");
		return;
	}

	manualControlState.doorsOpen = true;
	manualControlState.targetSpeed = 0;
	if (state.activeVehicleMode === 'train') {
		const stopIndex = manualStationIndexHere();
		if (stopIndex >= 0 && manualPassengerStopIndex !== stopIndex) {
			manualPassengerStopIndex = stopIndex;
			processPassengerArrival(stopIndex);
		}
	}
	updateAccelerationFromSlider(0);
	document.getElementById('accelerationSlider').value = 0;
	document.getElementById('targetSpeedInput').value = 0;
	syncCompactSpeed();
	updateDoorButton();

	// Door chime/warning + door mechanism
	if (isTrainAudioActive()) playDoorSequence(true);
	else playAudio("DoorAction");
}

function closeDoors() {
	manualControlState.doorsOpen = false;
	updateDoorButton();

	// Door warning + door mechanism
	if (isTrainAudioActive()) playDoorSequence(false);
	else playAudio("DoorAction");
}

function updateDoorButton() {
	for (const button of [document.getElementById('doorsBtn'), document.getElementById('compactDoors')]) {
		if (!button) continue;
		button.textContent = manualControlState.doorsOpen ? 'Close doors' : 'Open doors';
		button.setAttribute('aria-pressed', String(manualControlState.doorsOpen));
	}
}

function toggleDoors() {
	if (autopilotRun && manualControlState.currentSpeed < 0.1) toggleManualAutopilot();
	if (manualControlState.doorsOpen) {
		closeDoors();
	} else {
		openDoors();
	}
}

function setTargetSpeed() {
	const input = document.getElementById("targetSpeedInput");
	const speed = Number(input.value);

	if (input.value.trim() === '' || !Number.isFinite(speed) || speed < 0 || speed > manualControlState.maxSpeed) {
		alert(`⚠️ Speed must be between 0 and ${state.manualControlState.maxSpeed} km/h`);
		input.value = state.manualControlState.targetSpeed;
		syncCompactSpeed();
		return;
	}

	if (state.manualControlState.doorsOpen && speed > 0) {
		alert("🚨 Safety Alert: Close doors before moving!");
		input.value = state.manualControlState.targetSpeed;
		syncCompactSpeed();
		return;
	}
	if (state.safetyState.emergencyBrakeApplied && speed > 0) {
		alert("Wait until the emergency stop is complete.");
		input.value = state.manualControlState.targetSpeed;
		syncCompactSpeed();
		return;
	}

	state.manualControlState.targetSpeed = speed;
	syncCompactSpeed();
	document.getElementById("targetSpeedDisplay").textContent = Math.round(speed);

	return true;
}

function syncCompactSpeed() {
	document.getElementById('compactSpeed').value = state.manualControlState.targetSpeed;
	document.getElementById('compactSpeedValue').textContent = `${Math.round(state.manualControlState.targetSpeed)} km/h`;
}

function updateAutopilotButton() {
	const button = document.getElementById('compactAutopilot');
	button.setAttribute('aria-pressed', String(manualControlState.autopilotActive));
	button.textContent = manualControlState.autopilotActive ? 'Autopilot on' : 'Autopilot off';
}

function toggleManualAutopilot() {
	if (!manualControlState.isManualMode || state.activeVehicleMode !== 'train') return;
	if (autopilotRun) {
		const snapshot = autopilotRun.stop();
		autopilotRun = null;
		manualControlState.autopilotActive = false;
		manualControlState.currentSpeed = snapshot.speed;
		manualControlState.currentAcceleration = snapshot.acceleration;
		manualHandoverAcceleration = snapshot.acceleration;
		manualTrackingEnabled = state.isTracking;
		state.totalDistanceCovered = state.route.slice(0, state.index)
			.reduce((distance, _, index) => distance + manualSegmentDistance(index), 0);
		manualRunId++;
		animateManualMovement(state.route, 'train', manualControlState.maxSpeed, state.trainCoaches.length, true);
		updateAutopilotButton();
		return;
	}
	if (manualControlState.doorsOpen || state.safetyState.emergencyBrakeApplied) {
		alert('Close the doors and release the emergency brake before enabling autopilot.');
		return;
	}
	if (state.index >= state.route.length - 1) return;
	let distanceToStop = manualSegmentDistance(state.index) * (1 - state.progress);
	for (let index = state.index + 1; index < state.route.length - 1; index++) {
		if (isStopPoint(state.route[index])) break;
		distanceToStop += manualSegmentDistance(index);
	}
	const deceleration = Math.max(0.001, state.decelGForceLimit || 0.05) * 9.81;
	const speed = manualControlState.currentSpeed / 3.6;
	const rampSeconds = Math.max(0, (manualControlState.currentAcceleration + deceleration * 3.6) / 4);
	const positiveAcceleration = Math.max(0, manualControlState.currentAcceleration / 3.6);
	const speedAfterRamp = speed + positiveAcceleration * rampSeconds;
	const stoppingMetres = speed * rampSeconds + 0.5 * positiveAcceleration * rampSeconds ** 2 +
		speedAfterRamp ** 2 / (2 * deceleration);
	if (stoppingMetres > distanceToStop * 1000) {
		alert('There is not enough distance to stop safely. Brake before enabling autopilot.');
		return;
	}
	const distance = state.route.slice(0, state.index)
		.reduce((total, _, index) => total + manualSegmentDistance(index), 0);
	state.totalDistanceCovered = distance + manualSegmentDistance(state.index) * state.progress;
	manualRunId++;
	if (manualTrackingHandler && state.map) state.map.un('click', manualTrackingHandler);
	manualTrackingHandler = null;
	state.isTracking = manualTrackingEnabled;
	state.semiAutoMode = false;
	manualControlState.autopilotActive = true;
	autopilotRun = animateMovement(state.route, 'train', manualControlState.maxSpeed, state.trainCoaches.length, {
		speed: manualControlState.currentSpeed,
		acceleration: manualControlState.currentAcceleration,
		useSmoothRoute: state.manualUsesSmoothRoute,
		onSpeed(speed, acceleration) {
			manualControlState.currentSpeed = speed;
			manualControlState.currentAcceleration = acceleration;
			state.currentDisplaySpeed = speed;
			const limit = Math.max(0.001, state.maxGForceLimit * 9.81 * 3.6);
			manualControlState.acceleration = Math.round(Math.min(100, Math.max(0, acceleration / Math.min(30, limit) * 100)));
			manualControlState.brakeLevel = Math.round(Math.min(100, Math.max(0, -acceleration / Math.min(50, limit) * 100)));
			manualControlState.isBraking = manualControlState.brakeLevel > 0;
			updateManualDisplays();
		},
		onDoors: updateDoorButton,
		onComplete() {
			autopilotRun = null;
			manualControlState.autopilotActive = false;
			manualControlState.isManualMode = false;
			updateAutopilotButton();
			document.querySelectorAll('#manualControlPanel .manual-driving-control').forEach(element => { element.disabled = true; });
			document.getElementById('statusText').textContent = 'Completed';
			stopTrainAudio();
		}
	});
	updateAutopilotButton();
}

function pauseSimulation() {
	state.manualControlState.isPaused = true;

	// Update UI
	document.getElementById("pauseBtn").style.display = "none";
	document.getElementById("resumeBtn").style.display = "block";
	document.getElementById("statusText").textContent = "Paused";
	document.getElementById("statusIndicator").style.color = "#f59e0b";
}

function resumeSimulation() {
	state.manualControlState.isPaused = false;
	state.lastUpdateTime = Date.now();

	// Update UI
	document.getElementById("resumeBtn").style.display = "none";
	document.getElementById("pauseBtn").style.display = "block";
	document.getElementById("statusText").textContent = "Running";
	document.getElementById("statusIndicator").style.color = "#10b981";
}

function stopSimulation() {
	if (autopilotRun) autopilotRun.stop();
	autopilotRun = null;
	state.manualControlState.autopilotActive = false;
	updateAutopilotButton();
	manualHandoverAcceleration = null;
	manualPassengerStopIndex = -1;
	stopPassengerTraffic();
	manualRunId++;
	if (manualTrackingHandler && state.map) state.map.un('click', manualTrackingHandler);
	manualTrackingHandler = null;
	manualTrackingEnabled = false;
	clearSegmentSpeedProfile();
	manualControlState.currentSpeed = 0;
	state.currentDisplaySpeed = 0;
	state.manualControlState.targetSpeed = 0;
	state.manualControlState.currentAcceleration = 0;
	state.manualControlState.acceleration = 0;
	state.manualControlState.brakeLevel = 0;
	state.manualControlState.isBraking = false;
	state.manualControlState.isPaused = false;
	state.manualControlState.isManualMode = false;
	state.manualUsesSmoothRoute = false;
	state.manualControlState.doorsOpen = false;
	clearEmergencyState();
	updateDoorButton();

	// Deactivate toolbar simulation phase
	const toolbarBar = document.querySelector('.toolbar-bar');
	if (toolbarBar) toolbarBar.classList.remove('toolbar--sim-active');
	const simBtn = document.getElementById('simulateBtn');
	if (simBtn) simBtn.classList.remove('sim-running');
	if (telemetryInterval) { clearInterval(telemetryInterval); telemetryInterval = null; }
	stopFlightMonitor();

	// Reset career mode if active
	resetCareerMode();
	createStationPlatforms();
	const economyPanel = document.getElementById('economyPanel');
	if (economyPanel) economyPanel.style.display = 'none';
	const goOverlay = document.getElementById('careerGameOverOverlay');
	if (goOverlay) goOverlay.style.display = 'none';

	// Stop all train sounds and announcements
	stopTrainAudio();
	cancelAnnouncements();
	const trainRunningSound = document.getElementById("TrainRunningSound");
	const stationAmbience = document.getElementById("StopAmbience");

	if (trainRunningSound && !trainRunningSound.paused) {
		trainRunningSound.pause();
	}
	if (stationAmbience && !stationAmbience.paused) {
		stationAmbience.pause();
	}

	// Reset UI
	document.getElementById("accelerationSlider").value = 0;
	document.getElementById("accelerationDisplay").textContent = '0';
	document.getElementById("targetSpeedInput").value = 0;
	document.getElementById("targetSpeedDisplay").textContent = '0';
	syncCompactSpeed();
	document.getElementById("currentSpeedDisplay").textContent = '0';
	document.getElementById("brakeSlider").value = 0;
	updateAccelerationFromSlider(0);
	updateBrakeFromSlider(0);
	updateSpeedometer(0);

	// Reset status
	document.getElementById("statusText").textContent = "Ready";
	document.getElementById("statusIndicator").style.color = "#10b981";

	// Hide control panel
	hideManualControlPanel();

	// Remove vehicle from map and clean up listeners
	if (window.vehicleLayer) {
		state.map.removeLayer(window.vehicleLayer);
		window.vehicleLayer = null;
	}

	console.log("⏹️ Manual simulation stopped and cleaned up");
}

function startManualSimulation(route, mode, maxSpeed, coachCount = 3) {
	if (autopilotRun) autopilotRun.stop();
	autopilotRun = null;
	state.manualControlState.autopilotActive = false;
	updateAutopilotButton();
	manualHandoverAcceleration = null;
	manualPassengerStopIndex = -1;
	manualRunId++;
	if (manualTrackingHandler && state.map) state.map.un('click', manualTrackingHandler);
	manualTrackingHandler = null;
	manualControlState.maxSpeed = maxSpeed;
	state.manualControlState.currentSpeed = 0;
	state.currentDisplaySpeed = 0;
	state.manualControlState.targetSpeed = 0;
	state.manualControlState.acceleration = 0;
	state.manualControlState.brakeLevel = 0;
	state.manualControlState.isBraking = false;
	state.manualControlState.isPaused = false;
	state.manualControlState.doorsOpen = false;
	clearEmergencyState();
	updateDoorButton();
	document.getElementById('targetSpeedInput').max = maxSpeed;
	document.getElementById('compactSpeed').max = maxSpeed;
	document.getElementById('targetSpeedInput').value = 0;
	document.getElementById('accelerationSlider').value = 0;
	document.getElementById('brakeSlider').value = 0;
	updateAccelerationFromSlider(0);
	updateBrakeFromSlider(0);
	document.getElementById('currentSpeedDisplay').textContent = '0';
	document.getElementById('targetSpeedDisplay').textContent = '0';
	syncCompactSpeed();
	document.getElementById('pauseBtn').style.display = '';
	document.getElementById('resumeBtn').style.display = 'none';
	document.getElementById('statusText').textContent = 'Ready';
	document.querySelectorAll('#manualControlPanel .manual-driving-control').forEach(element => { element.disabled = false; });

	console.log("🎮 Manual simulation started with max speed:", maxSpeed);
	console.log("🚂 Coach count:", coachCount);
	console.log("🗺️ Map object:", state.map);
	console.log("📍 Route:", route);

	// Ensure map is ready before starting animation
	if (!state.map) {
		console.error("❌ Map not initialized yet!");
		alert("Map is still loading. Please wait a moment and try again.");
		hideManualControlPanel();
		return;
	}
	state.manualControlState.isManualMode = true;

	// Check if map container is visible
	const mapElement = document.getElementById('map');

	// Start the manual animation with the route
	animateManualMovement(route, mode, maxSpeed, coachCount);
}

// Manual Animation Function - Enhanced with rotation and camera following
function animateManualMovement(route, mode, maxSpeed, coachCount = 3, resume = false) {
	const runId = manualRunId;
	console.log(`🚄 User max speed: ${maxSpeed} km/h`);

	// Update manual control state with user's max speed choice
	state.manualControlState.maxSpeed = maxSpeed;
	state.manualControlState.userDefinedMaxSpeed = maxSpeed;
	console.log(`🎯 Speed target: Achieve ${maxSpeed} km/h with ${state.maxGForceLimit}g G-force limit`);

	// Reset departure sound flag for new simulation
	if (!resume) window.manualDeparturePlayed = false;

	// Double-check map availability
	if (!state.map) {
		console.error("❌ Map not available for manual simulation!");
		alert("Map is not ready. Please wait for the map to load completely.");
		hideManualControlPanel();
		return;
	}

	// Ensure map container is visible and properly styled
	const mapElement = document.getElementById('map');
	if (mapElement) {
		mapElement.style.display = 'block';
		mapElement.style.visibility = 'visible';
		mapElement.style.opacity = '1';
		console.log("✅ Map container visibility ensured");
	}

	// Reset global animation state variables
	if (!resume) {
		state.index = 0;
		state.progress = 0;
		state.totalDistanceCovered = 0;
		const smooth = state.smoothRoute;
		state.manualUsesSmoothRoute = mode === 'train' && state.currentRouteType === 'rail' &&
			smooth?.length > 2 && state.segmentSmoothDistances?.length === route.length - 1 &&
			calculateDistance(smooth[0], route[0].latlng) < 0.001 &&
			calculateDistance(smooth[smooth.length - 1], route[route.length - 1].latlng) < 0.001;
		setSegmentSpeedProfile(calculateManualSegmentPeakSpeeds(maxSpeed, state.accelGForceLimit, state.decelGForceLimit, state.manualUsesSmoothRoute));
	}
	let animationPaused = false;
	state.lastUpdateTime = Date.now();
	let fractionalProgress = 0;
	let fractionalTotalDistanceCovered = 0;
	if (!resume) manualTrackingEnabled = false;
	let isManualTracking = manualTrackingEnabled;

	// Clean up any existing vehicle layer
	if (!resume && window.vehicleLayer) {
		try {
			state.map.removeLayer(window.vehicleLayer);
			console.log("🧹 Removed existing vehicle layer");
		} catch (e) {
			console.log("⚠️ Could not remove existing vehicle layer:", e);
		}
		window.vehicleLayer = null;
	}

	if (!resume) {
		const initialCoords = ol.proj.fromLonLat([state.route[0].latlng.lng, state.route[0].latlng.lat]);
		const initialRotation = state.route.length > 1
			? calculateRotationAngle(state.route[0].latlng, state.route[1].latlng) : 0;
		state.currentBearing = initialRotation;
		initializeTrainCoaches(mode, initialCoords, initialRotation, coachCount, false);
		const vehicleSource = new ol.source.Vector({ features: state.trainCoaches });
		window.vehicleLayer = new ol.layer.Vector({ source: vehicleSource });
		state.map.addLayer(window.vehicleLayer);
		console.log("🚗 Vehicle layer added to state.map");
		manualCueIndex = -1;
		beginJourney({ mode, topSpeed: maxSpeed });
		if (mode === 'train') {
			startTrainAudio();
			setStationAmbience(true);
		}
	}

	// Set up vehicle click tracking for manual mode - Optimized
	function toggleManualTracking(event) {
		let clickedFeature = state.map.forEachFeatureAtPixel(event.pixel, (feature) => feature);

		// Check if clicked feature is any of the train coaches
		const isVehicleClicked = state.trainCoaches.includes(clickedFeature);

		if (isVehicleClicked) {
			isManualTracking = !isManualTracking;
			manualTrackingEnabled = isManualTracking;

			// Ensure vehicle continues to move - the click shouldn't interfere with movement
			if (isManualTracking) {
				// Immediate center on vehicle position without animation
				if (state.movingFeature) {
					const currentCoords = state.movingFeature.getGeometry().getCoordinates();
					state.map.getView().setCenter(currentCoords);
				}
			}
		} else {
			// Clicked elsewhere - disable tracking
			if (isManualTracking) {
				isManualTracking = false;
				manualTrackingEnabled = false;
			}
		}
	}

	// Add click listener for manual tracking
	state.map.on('click', toggleManualTracking);
	manualTrackingHandler = toggleManualTracking;

	// Force map refresh and ensure it's visible
	if (state.map.getTarget()) {
		state.map.updateSize();
		state.map.renderSync();
	}

	// Center map on starting point with smooth animation
	if (!resume) {
		state.map.getView().animate({
			center: ol.proj.fromLonLat([state.route[0].latlng.lng, state.route[0].latlng.lat]),
			zoom: Math.max(state.map.getView().getZoom(), 16),
			duration: 1000
		});
	}

	const frameReady = createFramePacer();
	// OPTIMIZED: Manual control animation loop with adaptive frame rate
	function manualAnimationLoop(timestamp) {
		try {
			if (runId !== manualRunId) return;
			if (state.manualControlState.isPaused || !state.manualControlState.isManualMode) {
				frameReady.reset();
				state.lastUpdateTime = Date.now();
				if (state.manualControlState.isManualMode) {
					requestAnimationFrame(manualAnimationLoop);
				}
				return;
			}
			const fps = state.performanceModeEnabled ? Math.min(state.targetFPS, 30) : state.targetFPS;
			const renderTime = timestamp ?? performance.now();
			if (!frameReady(renderTime, fps)) {
				requestAnimationFrame(manualAnimationLoop);
				return;
			}

			const currentTime = Date.now();
			const elapsedSeconds = Math.max(0, (currentTime - state.lastUpdateTime) / 1000);
			state.lastUpdateTime = currentTime;
			if (document.hidden || elapsedSeconds === 0) {
				requestAnimationFrame(manualAnimationLoop);
				return;
			}

			// Always update speed first — must happen even when stationary so vehicle can start moving
			window.currentRoute = state.route;
			window.currentRouteIndex = state.index;
			window.currentProgress = state.progress;
			updateManualSpeedRealistic(elapsedSeconds, mode);
			updateSpeedometer(state.manualControlState.currentSpeed);

			// OPTIMIZED: Adaptive frame rate for stationary vehicles (skip render/move, not physics)
			const isStationary = state.manualControlState.currentSpeed < 0.1;
			if (isStationary) {
				// Throttle rendering to 10fps when truly stopped
				if (!window.lastStationaryUpdate || currentTime - window.lastStationaryUpdate < 100) {
					window.lastStationaryUpdate = currentTime;
					setTimeout(() => requestAnimationFrame(manualAnimationLoop), 100);
					return;
				}
				window.lastStationaryUpdate = currentTime;
			}

			// Move vehicle if speed > 0
			if (state.manualControlState.currentSpeed > 0 && state.index < state.route.length - 1) {
				let currentPoint = state.route[state.index];
				let nextPoint = state.route[state.index + 1];

				// Validate route data structure
				if (!currentPoint.latlng || !nextPoint.latlng) {
					console.error("❌ Invalid state.route data structure:", currentPoint, nextPoint);
					return;
				}

				// Calculate distance to next point
				const segmentDistance = manualSegmentDistance(state.index);

				// Update progress based on current speed
				const speedInMs = manualControlState.currentSpeed * 1000 / 3600; // Convert km/h to m/s
				const distanceThisFrame = speedInMs * elapsedSeconds;
				state.progress += distanceThisFrame / (segmentDistance * 1000); // Convert km to m

				const remainingKm = segmentDistance * Math.max(0, 1 - state.progress);
				if (manualCueIndex !== state.index) {
					manualCueIndex = state.index;
					manualApproachSpoken = false;
					manualApproachHorn = false;
				}
				if (!manualApproachSpoken && remainingKm < 2 && segmentDistance >= 3) {
					manualApproachSpoken = true;
					announceApproach(state.index + 1);
				}
				if (mode === 'train' && !manualApproachHorn && remainingKm < 0.6 && isStopPoint(nextPoint)) {
					manualApproachHorn = true;
					soundHorn('approach');
				}

				if (state.progress >= 1) {
					// Move to next segment
					state.index++;
					state.progress = 0;
					updateSegmentSpeedSign(state.index);
					state.totalDistanceCovered += segmentDistance;

					console.log(`✅ Reached waypoint ${state.index}, distance covered: ${state.totalDistanceCovered.toFixed(2)}km`);

					if (state.index >= state.route.length - 1) {
						announceArrival(state.index);
					} else if (!isStopPoint(nextPoint) || manualControlState.currentSpeed > 30) {
						announcePassing(state.index);
					} else {
						announceArrival(state.index, { semiAuto: true });
					}

					if (state.index >= state.route.length - 1) {
						console.log("🏁 Manual simulation completed!");
						manualControlState.currentSpeed = 0;
						state.currentDisplaySpeed = 0;
						state.manualControlState.targetSpeed = 0;
						state.manualControlState.isManualMode = false;
						const finalCoords = ol.proj.fromLonLat([nextPoint.latlng.lng, nextPoint.latlng.lat]);
						updateTrainCoaches(mode, finalCoords, state.currentBearing || 0);
						state.fractionalLat = nextPoint.latlng.lat;
						state.fractionalLng = nextPoint.latlng.lng;
						state.fractionalCoords = finalCoords;
						updateSpeedometer(0);
						updateManualDisplays();
						stopTrainAudio();
						document.querySelectorAll('#manualControlPanel .manual-driving-control').forEach(element => { element.disabled = true; });
						document.getElementById("statusText").textContent = "Completed";
						document.getElementById("statusIndicator").style.color = "#10b981";
						// Remove click listener
						state.map.un('click', toggleManualTracking);
						manualTrackingHandler = null;
						return;
					}
					currentPoint = state.route[state.index];
					nextPoint = state.route[state.index + 1];
				}

				// Interpolate position
				const sampled = sampleRoutePosition(state.route, state.manualUsesSmoothRoute ? state.smoothRoute : null, state.index, state.progress);
				const { lat, lng } = sampled;
				if (sampled.smoothIndex !== null) state.smoothRouteIndex = sampled.smoothIndex;

				// Calculate vehicle rotation based on movement direction
				const newPosition = {
					lat,
					lng
				};
				let rotationAngle = 0;
				if (state.index < state.route.length - 1) {
					// Use interpolated position and next point for smoother rotation
					const targetPoint = sampled.smoothIndex !== null
						? state.smoothRoute[Math.min(sampled.smoothIndex + 1, state.smoothRoute.length - 1)]
						: nextPoint.latlng;
					rotationAngle = calculateRotationAngle(newPosition, targetPoint);
				}

				// Update vehicle position and rotation
				const newCoords = ol.proj.fromLonLat([lng, lat]);
				state.currentBearing = rotationAngle;
				state.fractionalLat = lat;
				state.fractionalLng = lng;
				state.fractionalCoords = newCoords;
				updateTrainCoaches(mode, newCoords, rotationAngle);

				// Calculate G-forces for manual control
				calculateGForces(state.manualControlState.currentSpeed, newCoords, rotationAngle, Date.now());

				// High-performance camera following if tracking is enabled
				if (isManualTracking && !state.map.getView().getAnimating() && !state.map.getView().getInteracting()) {
					// Direct camera positioning for 60fps - no animations
					state.map.getView().setCenter(newCoords);
				}

				// OPTIMIZED: Update stats display less frequently (200ms instead of 100ms)
				if (!window.lastStatsUpdate || currentTime - window.lastStatsUpdate > 200) {
					const distanceToNextStop = manualSegmentDistance(state.index) * (1 - state.progress);
					updateStats(state.manualControlState.currentSpeed, distanceToNextStop, maxSpeed, 0, state.totalDistanceCovered, nextPoint.placeName);
					updateRouteInfo();
					window.lastStatsUpdate = currentTime;
				}
			} else if (state.manualControlState.currentSpeed === 0) {
				// Vehicle is stationary - still update camera if tracking
				if (isManualTracking && state.movingFeature && !state.map.getView().getAnimating() && !state.map.getView().getInteracting()) {
					const currentCoords = state.movingFeature.getGeometry().getCoordinates();
					state.map.getView().setCenter(currentCoords);
				}
			}

			requestAnimationFrame(manualAnimationLoop);
		} catch (error) {
			console.error("❌ Error in manual animation loop:", error);

			// Try to recover or stop animation
			manualControlState.isManualMode = false;
			const statusText = document.getElementById("statusText");
			const statusIndicator = document.getElementById("statusIndicator");
			if (statusText) statusText.textContent = "Error";
			if (statusIndicator) statusIndicator.style.color = "#ef4444";
			// Remove click listener on error
			state.map.un('click', toggleManualTracking);
			manualTrackingHandler = null;
		}
	}

	// Start the animation loop
	if (resume) requestAnimationFrame(manualAnimationLoop);
	else manualAnimationLoop();
}

// Update manual control displays with current values
// OPTIMIZED: Update manual displays with batched DOM updates
function updateManualDisplays() {
	// Use requestAnimationFrame for optimal rendering performance
	if (!window.updateManualDisplaysScheduled) {
		window.updateManualDisplaysScheduled = true;

		requestAnimationFrame(() => {
			// Get or cache elements
			const currentSpeedDisplay = document.getElementById('currentSpeedDisplay');
			const targetSpeedDisplay = document.getElementById('targetSpeedDisplay');
			const accelerationDisplay = document.getElementById('accelerationDisplay');
			const accelerationSlider = document.getElementById('accelerationSlider');
			const targetSpeedInput = document.getElementById('targetSpeedInput');
			const brakeSlider = document.getElementById('brakeSlider');
			const brakeDisplay = document.getElementById('brakeDisplay');

			// Batch all DOM updates together to minimize reflow/repaint
			if (currentSpeedDisplay) {
				currentSpeedDisplay.textContent = Math.round(state.manualControlState.currentSpeed);
			}
			if (targetSpeedDisplay) {
				targetSpeedDisplay.textContent = Math.round(state.manualControlState.targetSpeed);
			}
			if (accelerationDisplay) {
				accelerationDisplay.textContent = Math.round(state.manualControlState.acceleration) + '%';
			}
			if (accelerationSlider) {
				accelerationSlider.value = state.manualControlState.acceleration;
			}
			if (targetSpeedInput && document.activeElement !== targetSpeedInput) {
				targetSpeedInput.value = Math.round(state.manualControlState.targetSpeed);
			}
			if (brakeSlider) {
				brakeSlider.value = state.manualControlState.brakeLevel;
			}
			if (brakeDisplay) {
				brakeDisplay.textContent = Math.round(state.manualControlState.brakeLevel || 0) + '%';
			}
			document.getElementById('compactPower').value = state.manualControlState.acceleration;
			document.getElementById('compactPowerValue').textContent = Math.round(state.manualControlState.acceleration) + '%';
			document.getElementById('compactBrake').value = state.manualControlState.brakeLevel;
			document.getElementById('compactBrakeValue').textContent = Math.round(state.manualControlState.brakeLevel) + '%';
			syncCompactSpeed();

			window.updateManualDisplaysScheduled = false;
		});
	}
}

// Update manual speed based on controls with realistic physics
const MANUAL_STATION_RADIUS_KM = 0.15;
let manualCueIndex = -1;
let manualApproachSpoken = false;
let manualApproachHorn = false;
const isStopPoint = point => point && (point.type || 'stop') === 'stop';

function manualSegmentDistance(index) {
	return state.manualUsesSmoothRoute && state.segmentSmoothDistances[index] > 0
		? state.segmentSmoothDistances[index]
		: calculateDistance(state.route[index].latlng, state.route[index + 1].latlng);
}

// Route index of the stop the train is standing at (within 150 m), or -1 between stations.
function manualStationIndexHere() {
	const from = state.route?.[state.index];
	const to = state.route?.[state.index + 1];
	if (!from) return -1;
	if (!to) return isStopPoint(from) ? state.index : -1;
	const segmentKm = manualSegmentDistance(state.index);
	if (isStopPoint(from) && segmentKm * state.progress < MANUAL_STATION_RADIUS_KM) return state.index;
	if (isStopPoint(to) && segmentKm * (1 - state.progress) < MANUAL_STATION_RADIUS_KM) return state.index + 1;
	return -1;
}

function updateManualSpeedRealistic(deltaTime, mode) {
	// Always monitor safety first
	monitorSafetyStatus();

	const currentSpeed = state.manualControlState.currentSpeed;
	const targetSpeed = state.manualControlState.targetSpeed; // FIXED: Don't override user target speed
	const acceleration = state.manualControlState.acceleration; // Acceleration percentage (0-100)
	const brakeLevel = state.manualControlState.brakeLevel; // Brake percentage (0-100)
	const maxChange = Math.max(0, state.maxGForceLimit) * 9.81 * 3.6;

	// Calculate new speed based on user controls
	let newSpeed = currentSpeed;

	// BRAKING LOGIC - takes priority over acceleration
	if (brakeLevel > 0) {
		// Apply braking force - more brake percentage means stronger braking
		const maxBrakeDeceleration = Math.min(50, maxChange);
		const brakeDeceleration = (brakeLevel / 100) * maxBrakeDeceleration * deltaTime;
		newSpeed = Math.max(0, currentSpeed - brakeDeceleration);
		// console.log(`🛑 Braking: ${brakeLevel}% brake applied, speed: ${currentSpeed.toFixed(1)} → ${newSpeed.toFixed(1)} km/h`);
	}
	// ACCELERATION LOGIC - only if not braking
	else if (!manualControlState.doorsOpen && acceleration > 0 && currentSpeed < targetSpeed) {
		// Accelerate towards target speed
		const maxAcceleration = Math.min(30, maxChange);
		const accelerationForce = (acceleration / 100) * maxAcceleration * deltaTime;
		newSpeed = Math.min(targetSpeed, currentSpeed + accelerationForce);
		// console.log(`⚡ Accelerating: ${acceleration}% power, speed: ${currentSpeed.toFixed(1)} → ${newSpeed.toFixed(1)} km/h (target: ${targetSpeed} km/h)`);
	}
	// COASTING/NATURAL DECELERATION - when no acceleration and no braking
	else if (currentSpeed > targetSpeed) {
		newSpeed = Math.max(targetSpeed, currentSpeed - Math.min(3, maxChange) * deltaTime);
	} else if (acceleration === 0 && brakeLevel === 0) {
		// Natural deceleration (friction, air resistance)
		const naturalDeceleration = Math.min(2, maxChange); // km/h per second
		newSpeed = Math.max(0, currentSpeed - naturalDeceleration * deltaTime);
		if (currentSpeed > 0.1) {
			// console.log(`🌪️ Coasting: speed: ${currentSpeed.toFixed(1)} → ${newSpeed.toFixed(1)} km/h`);
		}
	}
	// SAFETY OVERRIDE: If emergency braking is active, force stop
	if (state.safetyState && state.safetyState.emergencyBrakeApplied) {
		const emergencyDeceleration = Math.min(80, Math.min(state.maxGForceLimit * 1.2, 1) * 9.81 * 3.6);
		newSpeed = Math.max(0, currentSpeed - emergencyDeceleration * deltaTime);
		console.log("🚨 Emergency braking active");
	}

	// Apply the new speed to the shared simulation and display state.
	const previousSpeed = state.manualControlState.currentSpeed;
	if (manualHandoverAcceleration !== null && deltaTime > 0 && !state.safetyState.emergencyBrakeApplied && !manualControlState.doorsOpen) {
		const desired = (newSpeed - previousSpeed) / deltaTime;
		const change = 4 * deltaTime;
		manualHandoverAcceleration = Math.max(manualHandoverAcceleration - change, Math.min(manualHandoverAcceleration + change, desired));
		newSpeed = Math.max(0, previousSpeed + manualHandoverAcceleration * deltaTime);
		if (Math.abs(manualHandoverAcceleration - desired) < 0.001) manualHandoverAcceleration = null;
	}
	state.manualControlState.currentAcceleration = deltaTime > 0 ? (newSpeed - previousSpeed) / deltaTime : 0;
	state.manualControlState.currentSpeed = newSpeed;
	state.currentDisplaySpeed = newSpeed;

	// Calculate actual G-force for monitoring
	const actualAcceleration = Math.abs(newSpeed - previousSpeed) / deltaTime;
	const actualGForceMs2 = actualAcceleration / 3.6; // Convert km/h/s to m/s²
	const actualGForce = actualGForceMs2 / 9.81;
	const userGForce = state.maxGForceLimit || 2.0; // Get user's G-force limit or default to 2G

	// Update global G-force tracking
	state.currentGForce = actualGForce;

	// Train audio: horn + departure announcement when pulling away, speed-synced sound while moving,
	// platform ambience only while standing at a station.
	if (mode === 'train') {
		const speedNow = state.manualControlState.currentSpeed;
		const stationHere = manualStationIndexHere();
		if (previousSpeed === 0 && speedNow > 0) {
			setStationAmbience(false);
			soundHorn('depart');
			if (stationHere >= 0) announceDeparture(stationHere);
			manualPassengerStopIndex = -1;
		} else if (previousSpeed > 0 && speedNow === 0 && stationHere >= 0) {
			setStationAmbience(true);
		}
		updateTrainAudio(speedNow, deltaTime);
	}

	// Update all displays with current values
	updateManualDisplays();

	// Update dynamic braking calculations
	updateDynamicBraking(manualControlState.currentSpeed);

	// Clear emergency state when safely stopped
	if (state.safetyState.emergencyBrakeApplied && state.manualControlState.currentSpeed < 0.1) {
		clearEmergencyState();
	}

	// Log performance status periodically
	const now = Date.now();
	if (!window.lastPerformanceLog || now - window.lastPerformanceLog > 3000) {
		const totalDistance = window.currentRoute ? calculateTotalRemainingDistance(window.currentRoute, window.currentRouteIndex || 0, window.currentProgress || 0) : 0;
		console.log(`📊 PERFORMANCE: Speed=${state.manualControlState.currentSpeed.toFixed(1)}km/h (target: ${targetSpeed.toFixed(1)}), G-Force=${actualGForce.toFixed(2)}g (limit: ${userGForce}g), Distance=${(state.totalDistanceCovered || 0).toFixed(3)}km`);
		window.lastPerformanceLog = now;
	}
}

// Update G-force indicator for realistic feedback - optimized
function updateGForceIndicator(gForce) {
	// Cache DOM elements to avoid repeated queries
	if (!window.cachedStatusElements) {
		window.cachedStatusElements = {
			statusIndicator: document.getElementById("statusIndicator"),
			statusText: document.getElementById("statusText")
		};
	}

	const {
		statusIndicator,
		statusText
	} = window.cachedStatusElements;

	// Only update if the status actually changes
	let newColor, newText;

	if (gForce > 0.25) {
		newColor = "#f59e0b"; // Yellow for high G-force
		newText = "High G-Force";
	} else if (gForce > 0.15) {
		newColor = "#60a5fa"; // Blue for moderate G-force
		newText = "Accelerating";
	} else if (manualControlState.currentSpeed > 1) {
		newColor = "#10b981"; // Green for cruising
		newText = "Cruising";
	} else {
		newColor = "#6b7280"; // Gray for stationary
		newText = "Stationary";
	}

	// Only update DOM if values changed
	if (statusIndicator.style.color !== newColor) {
		statusIndicator.style.color = newColor;
	}
	if (statusText.textContent !== newText) {
		statusText.textContent = newText;
	}
}

function updateSpeedDisplay() {
	// Cache DOM element to avoid repeated queries
	if (!window.cachedSpeedDisplay) {
		window.cachedSpeedDisplay = document.getElementById('currentSpeedDisplay');
	}

	const speedDisplay = window.cachedSpeedDisplay;
	if (speedDisplay) {
		const newSpeedText = Math.round(manualControlState.currentSpeed) + ' km/h';
		// Only update if the text actually changed
		if (speedDisplay.textContent !== newSpeedText) {
			speedDisplay.textContent = newSpeedText;
		}
	}
}

// Control Panel Management Functions
function minimizeControlPanel() {
	const panel = document.getElementById('manualControlPanel');
	const minimizeBtn = panel.querySelector('.minimize-btn');

	if (panel.classList.contains('minimized')) {
		// Restore panel
		panel.classList.remove('minimized');
		minimizeBtn.textContent = '−';
		minimizeBtn.title = 'Minimize';
		minimizeBtn.setAttribute('aria-label', 'Minimize manual controls');
	} else {
		// Minimize panel
		panel.classList.add('minimized');
		minimizeBtn.textContent = '□';
		minimizeBtn.title = 'Restore';
		minimizeBtn.setAttribute('aria-label', 'Restore manual controls');
	}
}

function closeControlPanel() {
	// Ask for user confirmation
	const confirmed = confirm("End the manual simulation?");

	if (confirmed) {
		const panel = document.getElementById('manualControlPanel');
		panel.style.display = 'none';

		// Stop simulation while preserving the route.
		stopSimulation();
	}
}

export { startSimulation, startManualSimulation };
export { adjustSpeed, setTargetSpeed, setTargetSpeedDirect, setAccelerationMin, updateAccelerationFromSlider, updateBrakeFromSlider };
export { updateManualSpeedRealistic, emergencyBrake, applyBrakes, soundManualHorn, toggleManualAutopilot };
export { openDoors, closeDoors, toggleDoors, showDoorControls, hideDoorControls };
export { pauseSimulation, resumeSimulation, stopSimulation };
export { showManualControlPanel, hideManualControlPanel, minimizeControlPanel, closeControlPanel };
export { animateManualMovement, updateManualDisplays, updateSpeedDisplay, updateDeceleration, updateGForceIndicator, updateGForceLimit };