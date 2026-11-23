// ====================================
// AUTOMATIC SIMULATION ENGINE
// ====================================
import state from './state.js';
import { sampleRoutePosition } from './routePosition.js';
import { createFramePacer } from './framePacing.js';
import { updateSpeedometer } from './speedometer.js';
import { setSegmentSpeedProfile, updateSegmentSpeedSign } from './segmentSpeedSign.js';
import { calculateDistance, calculateRotationAngle, playAudio } from './utils.js';
import { beginJourney, announceDeparture, announceApproach, announcePassing, announceArrival, announceCruise } from './announcer.js';
import { startTrainAudio, updateTrainAudio, trainArrived, prepareTrainDeparture, soundHorn, setStationAmbience } from './trainSound.js';
import { updateRouteInfo, updateStats, updateLocationDisplay, getNextStopName, startFlightMonitor, setDepartureTime, initTimeChart, recordArrival, recordDeparture, liveUpdateTimeChart, updateRoadHUD } from './hud.js';
import { placeVehicleAtStart, updateVehicleRotation, updateTrainCoaches, realignTrainCoachesInstant, appendCoachVisual, removeLastCoachVisual } from './vehicle.js';
import { updateExistingRouteColor } from './themePanel.js';
import { updateDynamicBraking, calculateStoppingDistance, calculateTargetSpeedForStop, calculateSafeSpeedEnhanced, calculateGForces, calculateWaypointAndStopTimes, updateGForceDisplay } from './gforce.js';
import { resetEnergyLedger, shouldCoast, coastingDecelKmhPerS, recordEnergyTick, updateEfficiencyHUD } from './intelligentControl.js';
import { calculateMaxAchievableSpeed } from './routeManager.js';
import { getUpcomingCurvature, getRoadCurvePhysics } from './curveEngine.js';
import { DRIVING_STYLES } from './constants.js';
import { isCareerActive, updateCareerFrame, handleStationArrival, handleStationDeparture, isGameOver, getCareerState, formatMoney, getTotalPassengerCount, getSmoothnessPercent, updateEconomyHUD, showGameOverOverlay, setAtStop, clearAtStop, getPassengersForCoach, flushBoardingQueue, getCareerAutomation, isBoardingInProgress, autoAddCoachesForDemand, autoTrimCoaches, CAREER } from './careerMode.js';
import { processPassengerArrival } from './passengerTraffic.js';

document.addEventListener('visibilitychange', () => {
	window.lastAutoFrameTime = Date.now();
});

// let comfortableAcceleration = 30; // Use state.comfortableAcceleration instead
// Function to animate the movement with rotation
function animateMovement(route, mode, topSpeed, coachCount = 3, resume = null) {
	if (!state.route || state.route.length < 2) {
		console.error("No valid route loaded.");
		alert("Error: No valid route found.");
		return;
	}


	console.log("🚀 Starting simulation with route:", state.route);

	// Initialize enhanced braking system
	state.brakingState = resume ? { ...state.brakingState, brakingLatch: false } : {
		isEmergencyBraking: false,
		targetSpeed: 0,
		emergencyBrakeDistance: 0.1, // Emergency brake within 100m
		lastGForceUpdate: 0,
		plannedStopDistance: 0,
		isAdvancedBraking: false
	};

	// Performance monitoring for automatic mode
	let autoFrameCount = 0;
	let autoLastFPSCheck = Date.now();
	let autoAverageFPS = 60;

	function monitorAutoPerformance() {
		autoFrameCount++;
		const now = Date.now();
		if (now - autoLastFPSCheck >= 1000) { // Check every second
			autoAverageFPS = autoFrameCount;
			autoFrameCount = 0;
			autoLastFPSCheck = now;

			/*if (autoAverageFPS < 50) {
				console.warn(`⚠️ Automatic mode low FPS: ${autoAverageFPS}fps`);
			} else {
				console.log(`✅ Automatic mode FPS: ${autoAverageFPS}fps`);
			}*/
		}
	}

	// Reset global animation state variables
	if (!resume) state.index = 0;
	let green_flag = true
	let currentSpeed = resume ? resume.speed : 0;
	let active = true;
	let removeTracking = null;
	let stationTimer = null;
	let handoverAcceleration = resume ? resume.acceleration : 0;
	const useSmoothRoute = !resume || resume.useSmoothRoute;
	let maxSpeed = topSpeed;
	state.manualControlState.userDefinedMaxSpeed = topSpeed;
	let comfortableDeceleration = 2.5 * (3600 ** 2 / 1000); // Adjusted
	let maxDeceleration = 60;
	let minSpeed = 1;
	// Use global progress and totalDistanceCovered variables
	if (!resume) {
		state.progress = 0;
		state.totalDistanceCovered = 0;
		state.totalRouteDistance = 0;
	}
	let distanceToNextStop;
	let totalDistanceRemaining;
	let isDecelerating = false;
	let tickInterval = 16; // ~60fps (1000ms/16ms ≈ 62.5fps) for smooth movement
	let animationPaused = false;
	let timeToNextStop = 0;
	let timeToFinalDestination = 0;
	let spoken = false;
	let count = 0;
	let autoZoomed = false;
	let lastUpdateTime = 0;
	let fractionalProgress = 0;
	let fractionalTotalDistanceCovered = 0;
	let isTrackingEnabled = false;

	if (currentSpeed < 80) {
		state.comfortableAcceleration = 30
	}

	if (!state.vectorLayer) {
		state.vectorLayer = new ol.layer.Vector({
			source: state.vectorSource
		});
		state.map.addLayer(state.vectorLayer);
	}

	let startPoint = state.route[0].latlng;
	if (!startPoint || isNaN(startPoint.lat) || isNaN(startPoint.lng)) {
		console.error("Invalid start point, stopping animation.");
		return;
	}

	let projectedStart = ol.proj.fromLonLat([startPoint.lng, startPoint.lat]);

	// Pre-compute segment distances for O(1) lookup during animation
	state.segmentDistances = [];
	for (let i = 0; i < state.route.length - 1; i++) {
		state.segmentDistances[i] = calculateDistance(state.route[i].latlng, state.route[i + 1].latlng);
	}
	// Store full route length so hud.js can derive journey percentage
	state.totalRouteDistance = state.segmentDistances.reduce((s, d) => s + d, 0);

	if (!resume) {
		placeVehicleAtStart(mode, coachCount);
		drawRoute();
	}

	// Career mode: board passengers at the first station
	if (!resume && isCareerActive()) {
		setAtStop(0);
		window.initialCareerArrivalInfo = handleStationArrival(0);
		updateEconomyHUD();
		if (window.updateCoachBtnState) window.updateCoachBtnState();
	} else if (!resume && mode === 'train') {
		processPassengerArrival(0);
	}

	// Initialize flight monitor and time chart
	if (!resume) {
		startFlightMonitor();
		setDepartureTime();
		const journeyProfile = initTimeChart();
		setSegmentSpeedProfile(journeyProfile?.segmentPeakSpeeds);
	}

	if (state.route[0].placeName === state.route[state.route.length - 1].placeName) {
		state.isLooping = true;
	}
	if (!resume) {
		beginJourney({ mode, topSpeed });
		resetEnergyLedger(mode, coachCount);
	}
	let lastEfficiencyHudAt = 0;
	let lastLocationDisplayAt = 0;
	if (!resume && mode === 'train') {
		startTrainAudio();
		setStationAmbience(true);
	} else if (!resume) {
		StopAmbience.play();
	}
	// Perform auto-zoom when the simulation starts
	const wasAlreadyZoomed = autoZoomed;
	if (!resume && !autoZoomed) {
		const view = state.map.getView();
		const currentZoom = view.getZoom();
		const startCoords = ol.proj.fromLonLat([startPoint.lng, startPoint
			.lat
		]); // Get the starting point coordinates

		// Jump close to the target, then a short settle zoom: animating across many zoom
		// levels makes OpenLayers fetch tiles for every intermediate level.
		const targetZoom = Math.max(currentZoom, 16);
		view.setCenter(startCoords);
		view.setZoom(Math.max(currentZoom, targetZoom - 1));
		view.animate({ zoom: targetZoom, duration: 800 });
		autoZoomed = true;
		setTimeout(() => {
			const departureReady = mode === 'train' ? prepareTrainDeparture() : (StopAmbience.pause(), Promise.resolve());
			realignTrainCoachesInstant(state.currentBearing || calculateRotationAngle(state.route[0].latlng, state.route[1].latlng));
			// Clear first-station stop state before departure
			if (isCareerActive()) {
				clearAtStop();
				if (window.updateCoachBtnState) window.updateCoachBtnState();
			}
			// Doors close and the horn sounds during the start sequence, then the train moves.
			const startDelay = new Promise(resolve => setTimeout(resolve, 4200));
			Promise.all([departureReady, startDelay]).then(() => moveToNextPoint());
		}, 6800); // First-station dwell before departure (11 s total, unchanged)

		// Listen to map view rotation to instantly update vehicle icons
		if (!view.hasListener('change:rotation')) {
			view.on('change:rotation', () => {
				if (state.movingFeature) state.movingFeature.changed();
				if (state.trainCoaches) state.trainCoaches.forEach(c => c.changed());
			});
		}
	}

	function moveToNextPoint(resuming = false) {
		//console.log(`🎯 moveToNextPoint() called - Index: ${index}, Route length: ${route.length}`);

		if (!active || animationPaused) return;
		//console.log("🚗 moveToNextPoint called: index: ", index, " route.length: ", route.length);
		if (state.index >= state.route.length - 1) {
			// Check if looping
			if (state.isLooping) {
				// Reset to start
				console.log("🔁 Looping back to the beginning.");
				state.index = 0;
				updateSegmentSpeedSign(0);
				currentSpeed = 0; // Reset speed
				state.progress = 0; // Reset state.progress
				state.smoothRouteIndex = 0; // Reset curve position for loop
				spoken = false;
				green_flag = true;

				totalDistanceRemaining = state.route.slice(state.index).reduce((sum, stop, i, arr) => {
					if (i < arr.length - 1) return sum + calculateDistance(stop.latlng, arr[i + 1]
						.latlng);
					return sum;
				}, 0);

				moveToNextPoint();
				return;
			} else {
				console.log("✅ Simulation complete.");
				updateStats(0, 0, 0, 0, state.totalDistanceCovered, "-"); // Update with final values
				return;
			}
		}

		let pointA = route[state.index].latlng;
		let pointB = state.route[state.index + 1].latlng;

		if (!pointA || !pointB || isNaN(pointA.lat) || isNaN(pointA.lng) || isNaN(pointB.lat) || isNaN(pointB
			.lng)) {
			console.error("❌ ERROR: Invalid lat/lng values detected. Stopping animation.", {
				pointA,
				pointB
			});
			return;
		}

		if (!resuming) updateVehicleRotation(mode, pointA, pointB);

		// Use smooth arc length if available — prevents physics/visual mismatch on curves.
		distanceToNextStop = (useSmoothRoute && state.segmentSmoothDistances && state.segmentSmoothDistances[state.index] > 0)
			? state.segmentSmoothDistances[state.index]
			: calculateDistance(pointA, pointB);
		// Only log distance once per state.index update
		if (!window.distanceLogged || window.distanceLogged !== state.index) {
			// console.log(`📏 Distance calculated for state.index ${state.index}: ${segmentDistance} km`);
			window.distanceLogged = state.index;
		}
		totalDistanceRemaining = state.route.slice(state.index).reduce((sum, stop, i, arr) => {
			if (i < arr.length - 1) return sum + calculateDistance(stop.latlng, arr[i + 1].latlng);
			return sum;
		}, 0);

		// Legacy time calculations removed - now using waypoint-aware calculations in animation loop

		if (!resuming) state.progress = 0;
		isDecelerating = false;
		spoken = false;

		// Only reset speed to 0 if we're starting from a stop, not a waypoint
		// Check if the previous point was a waypoint - if so, preserve speed
		let preserveSpeed = false;
		if (state.index > 0) {
			const previousPoint = state.route[state.index - 1]; // Check the point we just came FROM
			const previousPointType = previousPoint.type || 'stop';
			if (previousPointType === 'waypoint' || previousPointType === 'dummy') {
				preserveSpeed = true;
				console.log(`🚩 Preserving speed ${currentSpeed.toFixed(1)} km/h after waypoint/dummy: ${previousPoint.placeName}`);
			}
		}

		if (!resuming && !preserveSpeed) {
			currentSpeed = 0; // Reset speed only when starting from a stop
		}

		// Ensure the vehicle starts moving automatically
		// Only log setup once per route segment
		if (!window.segmentSetupLogged || window.segmentSetupLogged !== state.index) {
			//console.log("🚀 Setting up automatic movement - vehicle should start accelerating");
			//console.log(`📊 Initial state: speed=${currentSpeed}, distance=${distanceToNextStop}, deceleration=${isDecelerating}, index=${index}`);
			//console.log(`📍 Route segment ${index} → ${index + 1}: ${pointA.lng.toFixed(4)},${pointA.lat.toFixed(4)} → ${pointB.lng.toFixed(4)},${pointB.lat.toFixed(4)}`);
			window.segmentSetupLogged = state.index;
		}

		function toggleTracking(event) {
			let clickedFeature = state.map.forEachFeatureAtPixel(event.pixel, (feature) => feature);
			const isVehicleClicked = state.trainCoaches.includes(clickedFeature);

			if (isVehicleClicked) {
				state.isTracking = !state.isTracking;
				if (state.isTracking && state.movingFeature) {
					const coords = state.movingFeature.getGeometry().getCoordinates();
					state.map.getView().setCenter(coords);
				}
			} else {
				// Dismiss controls and release camera
				hideVehicleHoverControls(true);
				if (state.isTracking) {
					state.isTracking = false;
				}
			}
		}

		// Hover-based vehicle controls: appear when hovering vehicle while following
		let hoverControlsTimeout = null;
		let isHoveringVehicle = false;
		let lastPointerCheck = 0;
		const VEHICLE_CONTROL_SNOOZE_MS = 20000;
		if (typeof window.__vehicleControlPopupSnoozeUntil !== 'number') {
			window.__vehicleControlPopupSnoozeUntil = 0;
		}

		function isHoveringOccupiedPassengerDot(hoveredFeature, pixel) {
			if (!isCareerActive() || !hoveredFeature || !state.map || !state.trainCoaches) return false;
			const coachIdx = state.trainCoaches.indexOf(hoveredFeature);
			if (coachIdx < 0) return false;

			const passengers = getPassengersForCoach(coachIdx);
			if (!passengers || passengers.length === 0) return false;

			const coachGeom = hoveredFeature.getGeometry && hoveredFeature.getGeometry();
			if (!coachGeom) return false;

			const coachScreenPos = state.map.getPixelFromCoordinate(coachGeom.getCoordinates());
			if (!coachScreenPos) return false;

			const mouseX = pixel[0];
			const mouseY = pixel[1];
			const CANVAS_W = 100, CANVAS_H = 32, DOT_COLS = 10, DOT_ROWS = 3;
			const DOT_PAD_X = 7, DOT_PAD_Y = 5;
			const DOT_STEP_X = (CANVAS_W - DOT_PAD_X * 2) / DOT_COLS;
			const DOT_STEP_Y = (CANVAS_H - DOT_PAD_Y * 2) / DOT_ROWS;
			const capacity = CAREER.MAX_PAX_PER_COACH;

			const currentZoom = state.map.getView().getZoom();
			const nz = Math.max(0, Math.min(1, (currentZoom - 5) / 11));
			const ez = nz * nz * (3 - 2 * nz);
			const zs = (0.02 + 0.028 * ez) * (state.vehicleSizeMultiplier || 1.0);
			const iconScale = zs * 12;
			const halfW = (CANVAS_W / 2) * iconScale;
			const halfH = (CANVAS_H / 2) * iconScale;

			const theta = ((state.currentBearing || 0) - 90) * (Math.PI / 180)
				+ (state.map.getView().getRotation() || 0);
			const cosT = Math.cos(theta);
			const sinT = Math.sin(theta);

			const hitRadius = Math.max(10, (halfW * 2 / DOT_COLS) * 1.5);
			let hoveredDotIndex = -1;
			let nearestDist2 = hitRadius * hitRadius;

			for (let slot = 0; slot < capacity; slot++) {
				const col = slot % DOT_COLS;
				const row = Math.floor(slot / DOT_COLS);
				const dotCnX = DOT_PAD_X + col * DOT_STEP_X + DOT_STEP_X / 2;
				const dotCnY = DOT_PAD_Y + row * DOT_STEP_Y + DOT_STEP_Y / 2;
				const canRelX = (dotCnX / CANVAS_W - 0.5) * 2 * halfW;
				const canRelY = (dotCnY / CANVAS_H - 0.5) * 2 * halfH;
				const dotSX = coachScreenPos[0] + canRelX * cosT - canRelY * sinT;
				const dotSY = coachScreenPos[1] + canRelX * sinT + canRelY * cosT;
				const ddx = mouseX - dotSX;
				const ddy = mouseY - dotSY;
				const d2 = ddx * ddx + ddy * ddy;
				if (d2 < nearestDist2) {
					nearestDist2 = d2;
					hoveredDotIndex = slot;
				}
			}

			return hoveredDotIndex >= 0 && hoveredDotIndex < passengers.length;
		}

		function onPointerMove(event) {
			if (!state.isTracking) return;

			// Throttle: check at most every 150ms to reduce CPU and not block scroll
			const now = Date.now();
			if (now - lastPointerCheck < 150) return;
			lastPointerCheck = now;

			// Snooze popup re-appearance for a short window after explicit close.
			if (now < (window.__vehicleControlPopupSnoozeUntil || 0)) {
				isHoveringVehicle = false;
				hideVehicleHoverControls(true);
				return;
			}

			let hoveredFeature = state.map.forEachFeatureAtPixel(event.pixel, (feature) => feature);
			const isOverVehicle = state.trainCoaches.includes(hoveredFeature);
			const isOverOccupiedPaxDot = isOverVehicle && isHoveringOccupiedPassengerDot(hoveredFeature, event.pixel);

			// Passenger-info hovers take priority over vehicle controls.
			if (isOverOccupiedPaxDot) {
				isHoveringVehicle = false;
				if (hoverControlsTimeout) { clearTimeout(hoverControlsTimeout); hoverControlsTimeout = null; }
				hideVehicleHoverControls(true);
				return;
			}

			if (isOverVehicle && !isHoveringVehicle) {
				isHoveringVehicle = true;
				if (hoverControlsTimeout) { clearTimeout(hoverControlsTimeout); hoverControlsTimeout = null; }
				showVehicleHoverControls(event.pixel);
			} else if (!isOverVehicle && isHoveringVehicle) {
				isHoveringVehicle = false;
				// Delay hide by 1 second for smooth UX
				hoverControlsTimeout = setTimeout(() => {
					const popup = document.getElementById('vehicleControlPopup');
					if (popup && !popup.matches(':hover')) {
						hideVehicleHoverControls(false);
					}
				}, 1000);
			}
		}

		function showVehicleHoverControls(pixel) {
			let popup = document.getElementById('vehicleControlPopup');
			if (popup) return;

			// When cam-locked, vehicle is always at screen center — anchor popup there
			const cx = window.innerWidth / 2;
			const cy = window.innerHeight / 2;

			popup = document.createElement('div');
			popup.id = 'vehicleControlPopup';
			popup.style.cssText = `
				position: fixed;
				left: ${cx + 30}px;
				top: ${cy - 36}px;
				width: 180px;
				padding: 10px 12px;
				background: rgba(8, 8, 18, 0.92);
				backdrop-filter: blur(14px);
				border: 1px solid rgba(255,255,255,0.1);
				border-radius: 10px;
				color: #cbd5e1;
				font-family: 'Inter', 'Segoe UI', sans-serif;
				font-size: 11px;
				z-index: 99998;
				box-shadow: 0 6px 24px rgba(0,0,0,0.5);
				opacity: 0;
				transform: scale(0.95);
				transition: opacity 0.2s ease, transform 0.2s ease;
				pointer-events: auto;
				overflow: hidden;
			`;

			popup.innerHTML = `
				<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.08);">
					<div style="font-size:10px; letter-spacing:0.08em; color:#94a3b8; text-transform:uppercase;">Vehicle Control</div>
					<button id="vcCloseBtn" title="Close"
						style="width:20px; height:20px; border:none; border-radius:5px; background:rgba(255,255,255,0.06); color:#cbd5e1; cursor:pointer; font-size:12px; line-height:1;">✕</button>
				</div>
				<div>
				<div style="margin-bottom:8px;">
					<div style="display:flex; justify-content:space-between; margin-bottom:3px;">
						<span style="opacity:0.55; font-size:10px;">Speed</span>
						<span id="vcSpeedValue" style="color:#34d399; font-weight:700; font-size:10px;">${Math.round(maxSpeed)} km/h</span>
					</div>
					<input type="range" id="vcSpeedSlider" min="10" max="1500" step="10" value="${maxSpeed}"
						style="width:100%; accent-color:#34d399; cursor:pointer; height:3px;">
				</div>
				<div style="margin-bottom:8px;">
					<div style="display:flex; justify-content:space-between; margin-bottom:3px;">
						<span style="opacity:0.55; font-size:10px;">Accel G-Force</span>
						<span id="vcAccelGForceValue" style="color:#fbbf24; font-weight:700; font-size:10px;">${state.accelGForceLimit.toFixed(2)}g</span>
					</div>
					<input type="range" id="vcAccelGForceSlider" min="0.05" max="2.0" step="0.05" value="${state.accelGForceLimit}"
						style="width:100%; accent-color:#fbbf24; cursor:pointer; height:3px;">
				</div>
				<div style="margin-bottom:8px;">
					<div style="display:flex; justify-content:space-between; margin-bottom:3px;">
						<span style="opacity:0.55; font-size:10px;">Decel G-Force</span>
						<span id="vcDecelGForceValue" style="color:#f87171; font-weight:700; font-size:10px;">${state.decelGForceLimit.toFixed(2)}g</span>
					</div>
					<input type="range" id="vcDecelGForceSlider" min="0.05" max="2.0" step="0.05" value="${state.decelGForceLimit}"
						style="width:100%; accent-color:#f87171; cursor:pointer; height:3px;">
				</div>
				<div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:8px;">
					<button id="vcNorthUpBtn"
						style="width:100%; padding:6px 0; background:${state.lockNorth ? 'rgba(96,165,250,0.25)' : 'rgba(255,255,255,0.05)'}; border:1px solid ${state.lockNorth ? '#60a5fa' : 'rgba(255,255,255,0.12)'}; border-radius:6px; color:${state.lockNorth ? '#93c5fd' : '#94a3b8'}; font-size:10px; cursor:pointer; transition:all 0.2s; letter-spacing:0.05em;">
						🧭 NORTH-UP: <strong>${state.lockNorth ? 'ON' : 'OFF'}</strong>
					</button>
				</div>
				</div>
			`;

			document.body.appendChild(popup);

			// Keep popup alive when hovering over it
			popup.addEventListener('mouseenter', () => {
				if (hoverControlsTimeout) { clearTimeout(hoverControlsTimeout); hoverControlsTimeout = null; }
			});
			popup.addEventListener('mouseleave', () => {
				hoverControlsTimeout = setTimeout(() => hideVehicleHoverControls(false), 1000);
			});

			const closeBtn = document.getElementById('vcCloseBtn');
			if (closeBtn) {
				closeBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					window.__vehicleControlPopupSnoozeUntil = Date.now() + VEHICLE_CONTROL_SNOOZE_MS;
					isHoveringVehicle = false;
					hideVehicleHoverControls(true);
				});
			}

			// Wire sliders
			document.getElementById('vcSpeedSlider').addEventListener('input', (e) => {
				const v = parseFloat(e.target.value);
				maxSpeed = v;
				state.manualControlState.userDefinedMaxSpeed = v;
				document.getElementById('vcSpeedValue').textContent = `${Math.round(v)} km/h`;
			});
			document.getElementById('vcAccelGForceSlider').addEventListener('input', (e) => {
				const g = parseFloat(e.target.value);
				state.accelGForceLimit = g;
				state.maxGForceLimit   = g; // legacy alias
				document.getElementById('vcAccelGForceValue').textContent = `${g.toFixed(2)}g`;
			});
			document.getElementById('vcDecelGForceSlider').addEventListener('input', (e) => {
				const g = parseFloat(e.target.value);
				state.decelGForceLimit = g;
				document.getElementById('vcDecelGForceValue').textContent = `${g.toFixed(2)}g`;
			});
			document.getElementById('vcNorthUpBtn').addEventListener('click', () => {
				state.lockNorth = !state.lockNorth;
				// Snap map to north immediately when turning ON
				if (state.lockNorth) {
					state.map.getView().setRotation(0);
				}
				// Update button appearance
				const btn = document.getElementById('vcNorthUpBtn');
				if (btn) {
					btn.style.background = state.lockNorth ? 'rgba(96,165,250,0.25)' : 'rgba(255,255,255,0.05)';
					btn.style.borderColor = state.lockNorth ? '#60a5fa' : 'rgba(255,255,255,0.12)';
					btn.style.color = state.lockNorth ? '#93c5fd' : '#94a3b8';
					btn.innerHTML = `🧭 NORTH-UP: <strong>${state.lockNorth ? 'ON' : 'OFF'}</strong>`;
				}
			});

			// Animate in
			requestAnimationFrame(() => {
				popup.style.opacity = '1';
				popup.style.transform = 'scale(1)';
			});
		}

		function hideVehicleHoverControls(immediate) {
			const popup = document.getElementById('vehicleControlPopup');
			if (!popup) return;
			if (immediate) {
				popup.remove();
			} else {
				popup.style.opacity = '0';
				popup.style.transform = 'scale(0.95)';
				setTimeout(() => { if (popup.parentNode) popup.remove(); }, 250);
			}
		}

		// Add event listeners only once
		if (!isTrackingEnabled) {
			state.map.on('click', toggleTracking);
			state.map.on('pointermove', onPointerMove);
			removeTracking = () => {
				state.map.un('click', toggleTracking);
				state.map.un('pointermove', onPointerMove);
				if (hoverControlsTimeout) clearTimeout(hoverControlsTimeout);
				hideVehicleHoverControls(true);
			};
			isTrackingEnabled = true;
		}

		const frameReady = createFramePacer();
		function animateFrame(timestamp) {
			if (!active || animationPaused) {
				console.log("⏸️ Animation paused, skipping frame");
				return;
			}
			if (resume && state.manualControlState.isPaused) {
				frameReady.reset();
				window.lastAutoFrameTime = Date.now();
				state.animationInterval = requestAnimationFrame(animateFrame);
				return;
			}
			if (document.hidden) {
				frameReady.reset();
				window.lastAutoFrameTime = Date.now();
				state.animationInterval = requestAnimationFrame(animateFrame);
				return;
			}

			const fps = state.performanceModeEnabled ? Math.min(state.targetFPS, 30) : state.targetFPS;
			const renderTime = timestamp ?? performance.now();
			if (!frameReady(renderTime, fps)) {
				state.animationInterval = requestAnimationFrame(animateFrame);
				return;
			}

			// Performance optimization: Limit heavy calculations
			const now = Date.now();

			// Use time-based movement instead of fixed tick interval for smooth 60fps
			const deltaTime = now - (window.lastAutoFrameTime || now);
			window.lastAutoFrameTime = now;

			// Convert tickInterval from fixed to time-based calculation
			// Do not discard elapsed time at low FPS; reset the clock on visibility changes
			// instead so returning from a hidden tab does not fast-forward the journey.
			const effectiveTickInterval = Math.max(0, deltaTime);

			let deltaDistance = currentSpeed * (effectiveTickInterval / 3600000);
			state.totalDistanceCovered += deltaDistance;

			// Career updates are applied after physics so we can detect powered vs coasting movement.

			// Use smooth arc length for progress denominator — the vehicle follows the curved
			// smoothRoute, which is longer than the straight segment. Using arc distance
			// ensures progress reaches 1.0 exactly when the end of the path is reached,
			// eliminating the last-50m teleport / jump-stop bug.
			const segmentDistance = (useSmoothRoute && state.segmentSmoothDistances && state.segmentSmoothDistances[state.index] > 0)
				? state.segmentSmoothDistances[state.index]
				: calculateDistance(pointA, pointB);

			const deltaProgress = deltaDistance / segmentDistance;
			state.progress += deltaProgress;

			// Clamp progress to 1.0 — the stop/waypoint handler will fire on the next condition check
			if (state.progress > 1.0) {
				state.progress = 1.0;
			}


			// Speed-synchronised train audio (running loop, traction, rail joints, brakes)
			if (mode === 'train') updateTrainAudio(currentSpeed, effectiveTickInterval / 1000);

			// Raw (unclamped) remaining distance — used for the arrival snap.
			// We keep a clamped version to guard against division-by-zero elsewhere.
			const rawRemainingDistance = segmentDistance * (1 - state.progress);
			let remainingDistance = Math.max(rawRemainingDistance, 0.0001);

			// Update dynamic braking monitoring
			updateDynamicBraking(currentSpeed);

			// === ENHANCED DYNAMIC DECELERATION LOGIC ===
			// Check if next destination is a stop or waypoint
			let shouldDecelerateForStop = true;
			let nextStopDestination = null;
			if ((state.index + 1) < state.route.length) {
				nextStopDestination = state.route[state.index + 1];
				const destinationType = nextStopDestination.type || 'stop';
				const terminal = resume && state.index + 1 === state.route.length - 1 && !state.isLooping;
				if ((destinationType === 'waypoint' || destinationType === 'dummy') && !terminal) {
					shouldDecelerateForStop = false;
				}
			}

			// === LOOK-AHEAD: Distance to Next ACTUAL Stop (across consecutive waypoints) ===
			// This prevents the train from braking for waypoints. The braking controller
			// should only start braking for real stops, not for intermediate waypoints.
			let distanceToNextActualStop = remainingDistance; // default: use current segment
			if (!shouldDecelerateForStop) {
				// We're heading to a waypoint — sum distances to the next actual stop
				distanceToNextActualStop = remainingDistance; // Include remaining portion of current segment
				for (let lookahead = state.index + 1; lookahead < state.route.length - 1; lookahead++) {
					const nextType = (state.route[lookahead + 1].type || 'stop');
					const segDist = (useSmoothRoute && state.segmentSmoothDistances && state.segmentSmoothDistances[lookahead] > 0)
						? state.segmentSmoothDistances[lookahead]
						: calculateDistance(state.route[lookahead].latlng, state.route[lookahead + 1].latlng);
					distanceToNextActualStop += segDist;
					if (nextType !== 'waypoint' && nextType !== 'dummy') break; // Reached a stop, stop summing
				}
			}

			// ==========================================================
			// PHYSICS STATE MACHINE
			// States: ACCELERATE/CRUISE  →  BRAKE (irreversible latch)
			//
			// accelG = state.accelGForceLimit (slider, default 0.10G)
			// decelG = state.decelGForceLimit (slider, default 0.05G)
			//
			// BRAKE triggers when: v²/(2 × decelG × 9.81) >= distToNextStop
			// Braking uses max(decelG, requiredDecel) to self-correct timing.
			// ==========================================================

			if (resume) maxSpeed = state.manualControlState.targetSpeed;
			const accelG   = state.accelGForceLimit || 0.10;
			const decelG   = state.decelGForceLimit || 0.05;
			const decelA   = decelG * 9.81;   // m/s²
			const speedMs  = currentSpeed / 3.6;
			const isRoadMode = state.currentRouteType === 'road';
			const roadStyle = DRIVING_STYLES[state.drivingStyle] || DRIVING_STYLES.normal;
			const roadCurve = isRoadMode ? getRoadCurvePhysics(
				state.smoothRoute, state.smoothRouteDistances, state.index, state.progress,
				Math.max(0.10, accelG * roadStyle.gForceMult), decelA,
				Math.max(0.7, speedMs * speedMs / (2 * decelA * 1000) + 0.05)
			) : null;
			const speedBeforeControl = currentSpeed;
			let ecoCoasting = false;
			const stopDistM  = (speedMs * speedMs) / (2 * decelA);
			const stopDistKm = stopDistM / 1000;

			// Latch fires when theoretical stopping distance >= remaining distance.
			// No artificial margin: the self-correcting requiredDecel handles timing.
			const handoverMargin = resume ? speedMs * 2 / 1000 : 0;
			if (stopDistKm + handoverMargin >= distanceToNextActualStop) {
				state.brakingState.brakingLatch = true;
			}

			// Un-latch if decelG was increased and we now have room to spare.
			// This lets the user raise the G-force limit mid-trip without the train
			// crawling to a premature stop.
			if (state.brakingState.brakingLatch && stopDistKm + handoverMargin < distanceToNextActualStop * 0.85) {
				state.brakingState.brakingLatch = false;
				state.brakingState.isAdvancedBraking = false;
			}

			if (state.brakingState.brakingLatch) {
				// ── BRAKE ────────────────────────────────────────────────
				state.brakingState.isAdvancedBraking = true;

				// Pure self-correcting deceleration:
				// requiredDecelA = exactly the decel needed to reach v=0 at the stop.
				// Unlike max(decelA, required), this never over-decelerates when
				// the vehicle is 'ahead of schedule' (e.g. after crossing the final
				// waypoint before a stop where remainingDist was re-set smaller).
				// Clamped: floor=0.3×decelG (always feeling some braking),
				//          ceil =3×decelG  (emergency correction, no runaway).
				const remainingM     = Math.max(distanceToNextActualStop * 1000, 0.1);
				const requiredDecelA = (speedMs * speedMs) / (2 * remainingM);
				const floorDecel     = decelA * 0.3;
				const ceilDecel      = decelA * 3.0;
				let   actualDecelA   = Math.min(ceilDecel, Math.max(floorDecel, requiredDecelA));

				// Final-5% taper: ease decel toward 30% of required so the
				// vehicle creeps silently into the platform rather than thudding.
				const stopRatio = distanceToNextActualStop / stopDistKm; // 1.0 at latch, →0 at stop
				if (stopRatio < 0.05) {
					const taperFactor = 0.3 + 0.7 * (stopRatio / 0.05); // 0.3→1.0 over last 5%
					actualDecelA *= taperFactor;
				}

				const actualDecelKmhPerS = actualDecelA * 3.6;
				const decelThisTick      = actualDecelKmhPerS * (effectiveTickInterval / 1000);
				currentSpeed = Math.max(0, currentSpeed - decelThisTick);

				// Safety snap: only fires if physics somehow left an infinitesimal
				// gap (<0.5m). Pure requiredDecel should reach progress=1.0
				// naturally in nearly all cases.
				if (currentSpeed === 0 && rawRemainingDistance < 0.0005) {
					state.progress = 1.0;
				}

				const statusEl = document.getElementById('statusText');
				if (statusEl) {
					statusEl.textContent = `🛑 Braking (${decelG.toFixed(2)}G)`;
					statusEl.style.color = '#ef4444';
				}

			} else {
				// ── ACCELERATE / CRUISE ──────────────────────────────────
				state.brakingState.isAdvancedBraking = false;

				// Road curves use a braking-distance envelope; other modes retain
				// their existing curve ceiling.
				const curveCap = isRoadMode ? roadCurve.speedCap : getUpcomingCurvature(
					useSmoothRoute ? state.smoothRoute : null,
					state.smoothRouteDistances,
					state.smoothRouteIndex,
					0.5,
					decelG
				);

				// OSRM's speed annotation is a travel-time estimate, not a posted
				// speed limit. Use the driver's selected speed as the road target.
				let speedLimitCap = Infinity;
				if (isRoadMode) {
					speedLimitCap = Math.min(maxSpeed, maxSpeed * roadStyle.speedMult);
				}

				const accelCeiling = isRoadMode
					? Math.min(curveCap, speedLimitCap)
					: Math.min(maxSpeed, curveCap, speedLimitCap);

				// Efficient mode: cut traction and coast once cruising near the stop.
				ecoCoasting = !isGameOver() && currentSpeed >= accelCeiling * 0.6
					&& shouldCoast(currentSpeed, distanceToNextActualStop, stopDistKm);

				const accelKmhPerS  = accelG * 9.81 * 3.6;
				const accelThisTick = accelKmhPerS * (effectiveTickInterval / 1000);

				// Career game over: no acceleration, coast to halt
				if (isGameOver()) {
					// Apply gentle natural deceleration (rolling resistance)
					currentSpeed = Math.max(0, currentSpeed - 0.5 * (effectiveTickInterval / 1000));
				} else if (ecoCoasting) {
					currentSpeed = Math.max(0, currentSpeed - coastingDecelKmhPerS(currentSpeed) * (effectiveTickInterval / 1000));
				} else if (isRoadMode && currentSpeed > accelCeiling) {
					currentSpeed = Math.max(accelCeiling, currentSpeed - decelA * 3.6 * (effectiveTickInterval / 1000));
				} else if (resume && currentSpeed > accelCeiling) {
					currentSpeed = Math.max(accelCeiling, currentSpeed - decelA * 3.6 * (effectiveTickInterval / 1000));
				} else {
					currentSpeed = Math.min(currentSpeed + accelThisTick, accelCeiling);
				}

				// If already above curve ceiling (e.g. user set maxSpeed > curveCap),
				// treat it as a braking trigger to bring speed within safe range.
				if (!isRoadMode && currentSpeed > curveCap) {
					state.brakingState.brakingLatch = true;
				}

				const statusEl = document.getElementById('statusText');
				if (ecoCoasting) {
					if (statusEl) {
						statusEl.textContent = `🍃 Coasting ${currentSpeed.toFixed(0)}km/h`;
						statusEl.style.color = '#10b981';
					}
				} else if (currentSpeed < accelCeiling * 0.98) {
					if (statusEl) {
						statusEl.textContent = `⚡ Accelerating (${accelG.toFixed(2)}G) → ${accelCeiling.toFixed(0)}km/h`;
						statusEl.style.color = '#10b981';
					}
				} else {
					if (statusEl) {
						statusEl.textContent = `🚀 ${currentSpeed.toFixed(0)}km/h`;
						statusEl.style.color = '#3b82f6';
					}
				}
			}

			if (resume && effectiveTickInterval > 0) {
				const seconds = effectiveTickInterval / 1000;
				if (state.safetyState.emergencyBrakeApplied) {
					const emergency = Math.min(state.maxGForceLimit * 1.2, 1) * 9.81 * 3.6;
					currentSpeed = Math.max(0, speedBeforeControl - emergency * seconds);
					handoverAcceleration = -emergency;
				} else {
					let desired = (currentSpeed - speedBeforeControl) / seconds;
					if (speedBeforeControl > maxSpeed && handoverAcceleration > 0) handoverAcceleration = 0;
					const rampSpeedGain = Math.max(0, handoverAcceleration) ** 2 / 8;
					if (desired > 0 && maxSpeed - speedBeforeControl <= rampSpeedGain) desired = 0;
					const change = 4 * seconds;
					handoverAcceleration = Math.max(handoverAcceleration - change, Math.min(handoverAcceleration + change, desired));
					currentSpeed = Math.max(0, speedBeforeControl + handoverAcceleration * seconds);
					if (speedBeforeControl <= maxSpeed && currentSpeed > maxSpeed) {
						currentSpeed = maxSpeed;
						handoverAcceleration = (currentSpeed - speedBeforeControl) / seconds;
					}
				}
				resume.onSpeed(currentSpeed, handoverAcceleration);
			}
			const isPoweredMotion = currentSpeed > (speedBeforeControl + 0.001);
			recordEnergyTick(speedBeforeControl, currentSpeed, deltaDistance, ecoCoasting);
			if (timestamp - lastEfficiencyHudAt > 500) {
				lastEfficiencyHudAt = timestamp;
				updateEfficiencyHUD();
			}

			// Career mode: deduct operating costs only when traction is powering movement.
			if (isCareerActive() && deltaDistance > 0) {
				updateCareerFrame(deltaDistance, state.currentGForce, isPoweredMotion);
				updateEconomyHUD();
				if (isGameOver()) {
					// Game over — show overlay, stop acceleration
					showGameOverOverlay();
				}
			}

			// Short horn as the train runs into a station.
			if (mode === 'train' && remainingDistance < 0.6 && !window.audioFadeStarted
				&& (state.route[state.index + 1]?.type || 'stop') === 'stop') {
				window.audioFadeStarted = true;
				soundHorn('approach');
			}

			// === PROGRESS >= 1.0 : Handle waypoints and stops ===
			// Waypoints/dummies: fire immediately regardless of speed (cruise through).
			// Stops: force speed to 0 and trigger station logic.
			if (state.progress >= 1.0) {
				if ((state.index + 1) < state.route.length) {
					const currentDestination = state.route[state.index + 1];
					const destinationType = currentDestination.type || 'stop';
					const terminalWaypoint = resume && state.index + 1 === state.route.length - 1 && !state.isLooping
						&& (destinationType === 'waypoint' || destinationType === 'dummy');

					if ((destinationType === 'waypoint' || destinationType === 'dummy') && !terminalWaypoint) {
						// === WAYPOINT / DUMMY: pass through at speed ===
						// Only announce named waypoints; dummy points pass silently
						if (destinationType === 'waypoint' && currentDestination.placeName) {
							announcePassing(state.index + 1);
						}

						// Record waypoint pass in time chart
						recordArrival(state.index + 1);
						recordDeparture(state.index + 1);

						state.index++; // Move to the next segment
						state.progress = 0; // Reset state.progress for the new segment
						updateSegmentSpeedSign(state.index);
						spoken = false;

						// Update route info for next segment and continue in the same frame
						if (state.index < state.route.length - 1) {
							pointA = state.route[state.index].latlng;
							pointB = state.route[state.index + 1].latlng;
							distanceToNextStop = calculateDistance(pointA, pointB);
							console.log(`📍 Next segment: ${state.route[state.index].placeName} → ${state.route[state.index + 1].placeName} (${distanceToNextStop.toFixed(3)} km)`);
							// Continue processing in the same animation frame - don't return
						} else {
							console.log("✅ Journey complete after waypoint.");
							// Snap vehicle to final position
							const finalPt = state.route[state.index].latlng;
							const finalCoords = ol.proj.fromLonLat([finalPt.lng, finalPt.lat]);
							updateTrainCoaches(mode, finalCoords, state.currentBearing || 0);
							state.fractionalLng = finalPt.lng;
							state.fractionalLat = finalPt.lat;
							state.fractionalCoords = finalCoords;
							cancelAnimationFrame(state.animationInterval);
							state.animationInterval = null;
							return;
						}
					} else if ((state.index + 1) > 0 && state.index < state.route.length - 1) {
						// === STOP: force speed to 0 and trigger station logic ===
						currentSpeed = 0; // FORCE to zero — no more lingering at 4km/h
						if (resume) {
							handoverAcceleration = 0;
							resume.onSpeed(0, 0);
							if (!terminalWaypoint) {
								state.manualControlState.doorsOpen = true;
								resume.onDoors();
							}
						}

						// Snap vehicle to the exact station position BEFORE
						// cancelling the animation frame. The position interpolation
						// code lives below this block and would never run on the
						// final frame, leaving the vehicle ~0.05 km away.
						const stationLng = pointB.lng;
						const stationLat = pointB.lat;
						const stationCoords = ol.proj.fromLonLat([stationLng, stationLat]);
						// Use ARRIVAL bearing so the vehicle keeps facing the
						// direction it was travelling when it reached the station.
						const stationBearing = calculateRotationAngle(pointA, pointB);
						updateTrainCoaches(mode, stationCoords, stationBearing);
						state.fractionalLng = stationLng;
						state.fractionalLat = stationLat;
						state.fractionalCoords = stationCoords;
						state.newCoords = stationCoords;
						state.currentBearing = stationBearing;

						cancelAnimationFrame(state.animationInterval);
						state.animationInterval = null;

						// Train-specific audio: brake release, door chime + doors, platform ambience
						if (mode === "train" && !terminalWaypoint) {
							trainArrived();
						}

						const arrivedStationName = route[state.index + 1].placeName;
						const isCarMode = mode === 'car';
						// Detect loop-endpoint arrival: last stop is same station as start
						const isLoopReturn = state.isLooping && (state.index + 1 === state.route.length - 1);
						updateSegmentSpeedSign(isLoopReturn ? 0 : state.index + 1);
						announceArrival(state.index + 1, {
							dwellSec: state.stationDelayTime,
							semiAuto: state.semiAutoMode,
							loopReturn: isLoopReturn
						});
						updateStats(0, distanceToNextStop, 0, timeToFinalDestination,
							state.totalDistanceCovered, arrivedStationName);
						animationPaused = true;
						currentSpeed = 0;

						// Record arrival in time chart
						recordArrival(state.index + 1);

						// Career mode: handle passenger boarding/alighting
						// At loop endpoint, treat as stop 0 so passengers destined for the
						// start station alight correctly and new loop-iteration passengers board.
						let careerArrivalInfo = null;
						let autoCoachesAdded = 0;
						if (isCareerActive()) {
							const careerStopIndex = isLoopReturn ? 0 : state.index + 1;
							setAtStop(careerStopIndex);
							if (mode === 'train') {
								autoCoachesAdded = autoAddCoachesForDemand(careerStopIndex);
								for (let k = 0; k < autoCoachesAdded; k++) appendCoachVisual();
							}
							careerArrivalInfo = handleStationArrival(careerStopIndex);
							updateEconomyHUD();
							if (window.updateCoachBtnState) window.updateCoachBtnState();
						} else if (mode === 'train') {
							processPassengerArrival(isLoopReturn ? 0 : state.index + 1);
						}

						function departStation() {
							if (!active) return;
							if (resume && state.manualControlState.isPaused) {
								stationTimer = setTimeout(departStation, 100);
								return;
							}
							// Career mode: flush any pending boarding before departure
							if (isCareerActive()) {
								flushBoardingQueue();
								if (mode === 'train') {
									const trimmed = autoTrimCoaches();
									for (let k = 0; k < trimmed; k++) removeLastCoachVisual();
								}
								clearAtStop();
								handleStationDeparture(state.index + 1);
								updateEconomyHUD();
								if (window.updateCoachBtnState) window.updateCoachBtnState();
							}
							// Record departure in time chart before advancing index
							recordDeparture(state.index + 1);
							state.index++;
							state.progress = 0;
							updateSegmentSpeedSign(state.index < state.route.length - 1 ? state.index : (state.isLooping ? 0 : state.index));
							currentSpeed = 0;
							if (resume) {
								state.manualControlState.doorsOpen = false;
								resume.onDoors();
							}
							animationPaused = false;
							state.brakingState.isAdvancedBraking = false;
							state.brakingState.isEmergencyBraking = false;
							state.brakingState.brakingLatch = false;
							window.audioFadeStarted = false;
							announceDeparture(state.index);
							moveToNextPoint();
						}

						// Keep the next-stop distance HUD live during station dwell:
						state.index++;
						updateRouteInfo();
						state.index--;
						if (state.semiAutoMode) {
							// === SEMI-AUTO MODE ===
							if (!isCarMode && mode !== 'train') {
								playAudio("DoorAction");
							}
							if (!isCarMode) state.manualControlState.doorsOpen = true;

							// Find next stop name
							let nextStopName = 'End of Line';
							for (let si = state.index + 2; si < state.route.length; si++) {
								if ((state.route[si].type || 'stop') !== 'waypoint') {
									nextStopName = state.route[si].placeName;
									break;
								}
							}

							let overlay = document.getElementById('semiAutoStopOverlay');
							if (!overlay) {
								overlay = document.createElement('div');
								overlay.id = 'semiAutoStopOverlay';
								document.body.appendChild(overlay);
							}
							overlay.style.display = '';
							overlay.classList.remove('sa-visible');

							if (isCarMode) {
								// Car "Proceed" overlay
								overlay.innerHTML = `
									<div class="sa-header sa-header--car">
										<div class="sa-station-row">
											<span class="sa-mode-badge sa-mode-badge--car">🚗 ROAD</span>
											<div class="sa-pulse-dot"></div>
											<span class="sa-station-name" title="${arrivedStationName}">${arrivedStationName}</span>
										</div>
										<div class="sa-status-row">
											<span class="sa-doors-label">🛑 Stopped</span>
											<span id="semiAutoTimer" class="sa-timer">0:00</span>
										</div>
									</div>
									<div class="sa-meta">
										<span class="sa-next-wrap">
											<span class="sa-next-label">NEXT</span>
											<span class="sa-next-value">${nextStopName}</span>
										</span>
										<span class="sa-odometer">${(state.totalDistanceCovered || 0).toFixed(1)} km</span>
									</div>
									<div class="sa-footer">
										<button id="semiAutoCloseDoorsBtn" class="sa-depart-btn sa-depart-btn--car">
											🚗 Proceed
										</button>
									</div>
								`;
							} else {
								// Train "Close Doors & Depart" overlay
								// Build career info section if applicable
								let careerInfoHtml = '';
								let careerCoachControlsHtml = '';
								if (isCareerActive() && careerArrivalInfo) {
									const cs = getCareerState();
									careerInfoHtml = `
										<div class="sa-career-info">
											<span id="saCareerAlighted" class="sa-career-stat">⬇️ 0 alighted</span>
											<span id="saCareerBoarded" class="sa-career-stat">⬆️ 0 boarded</span>
											<span id="saCareerOnBoard" class="sa-career-stat">🧑‍🤝‍🧑 ${getTotalPassengerCount()} on board</span>
											<span id="saCareerBalance" class="sa-career-stat">💰 ${formatMoney(cs.balance)}</span>
											${autoCoachesAdded ? `<span class="sa-career-stat">🚃 +${autoCoachesAdded} coach${autoCoachesAdded > 1 ? 'es' : ''} (auto)</span>` : ''}
										</div>
									`;
									careerCoachControlsHtml = `
										<div class="sa-coach-controls">
											<button id="stationAddCoachBtn" class="sa-coach-btn">+ Add Coach</button>
											<button id="stationRemoveCoachBtn" class="sa-coach-btn sa-coach-btn--danger">− Remove Coach</button>
										</div>
									`;
								}
								overlay.innerHTML = `
									<div class="sa-header">
										<div class="sa-station-row">
											<span class="sa-mode-badge">${isCareerActive() ? '💰 CAREER' : 'SEMI-AUTO'}${isLoopReturn ? ' ↺' : ''}</span>
											<div class="sa-pulse-dot"></div>
											<span class="sa-station-name" title="${arrivedStationName}">${arrivedStationName}${isLoopReturn ? ' <span style="font-size:10px;color:#a78bfa;">(Return)</span>' : ''}</span>
										</div>
										<div class="sa-status-row">
											<span class="sa-doors-label">🚪 Doors Open</span>
											<span id="semiAutoTimer" class="sa-timer">0:00</span>
										</div>
									</div>
									<div class="sa-meta">
										<span class="sa-next-wrap">
											<span class="sa-next-label">NEXT</span>
											<span class="sa-next-value">${nextStopName}</span>
										</span>
										<span class="sa-odometer">${(state.totalDistanceCovered || 0).toFixed(1)} km</span>
									</div>
									${careerInfoHtml}
									${careerCoachControlsHtml}
									<div class="sa-footer">
										<button id="semiAutoCloseDoorsBtn" class="sa-depart-btn">
											🚪 Close Doors &amp; Depart
										</button>
									</div>
								`;
							}

							requestAnimationFrame(() => {
								overlay.classList.add('sa-visible');
							});

							// Live timer
							const timerStart = Date.now();
							const timerInterval = setInterval(() => {
								const el = document.getElementById('semiAutoTimer');
								if (!el) { clearInterval(timerInterval); return; }
								const elapsed = Math.floor((Date.now() - timerStart) / 1000);
								const mins = Math.floor(elapsed / 60);
								const secs = elapsed % 60;
								el.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
							}, 1000);

							// Career auto doors: close once boarding is complete and the dwell time has elapsed.
							let autoDoorInterval = null;
							if (isCareerActive() && !isCarMode && getCareerAutomation().doors) {
								const dwellMs = state.stationDelayTime * 1000;
								autoDoorInterval = setInterval(() => {
									const btn = document.getElementById('semiAutoCloseDoorsBtn');
									if (!btn || !isCareerActive()) { clearInterval(autoDoorInterval); return; }
									if (isGameOver() || state.manualControlState.isPaused) return;
									const left = Math.ceil((dwellMs - (Date.now() - timerStart)) / 1000);
									if (isBoardingInProgress()) {
										btn.textContent = '🚪 Boarding… (auto doors)';
									} else if (left > 0) {
										btn.textContent = `🚪 Doors closing in ${left}s`;
									} else {
										clearInterval(autoDoorInterval);
										btn.click();
									}
								}, 250);
							}

							document.getElementById('semiAutoCloseDoorsBtn').onclick = () => {
								clearInterval(timerInterval);
								clearInterval(autoDoorInterval);
								overlay.classList.remove('sa-visible');
								setTimeout(() => { overlay.style.display = 'none'; }, 400);
								if (mode === 'train') {
									state.manualControlState.doorsOpen = false;
									prepareTrainDeparture().then(departStation);
									return;
								}
								if (!isCarMode) {
									playAudio("DoorAction");
									state.manualControlState.doorsOpen = false;
								}
								departStation();
							};

							const stationAddCoachBtn = document.getElementById('stationAddCoachBtn');
							if (stationAddCoachBtn) {
								stationAddCoachBtn.onclick = () => {
									if (window.addCareerCoach) window.addCareerCoach();
								};
							}

							const stationRemoveCoachBtn = document.getElementById('stationRemoveCoachBtn');
							if (stationRemoveCoachBtn) {
								stationRemoveCoachBtn.onclick = () => {
									if (window.removeCareerCoach) window.removeCareerCoach();
								};
							}
						} else {
							// Full auto: timed departure (same delay for car and train). Trains close
							// doors and sound the horn inside the dwell so the timetable is unchanged.
							const isFinalStop = state.index + 1 >= state.route.length - 1 && !state.isLooping;
							const dwellMs = state.stationDelayTime * 1000;
							if (resume && isFinalStop) {
								active = false;
								removeTracking?.();
								resume.onComplete();
								return;
							}
							if (mode === 'train' && !isFinalStop) {
								const prepareDeparture = () => {
									if (!active) return;
									if (resume && state.manualControlState.isPaused) {
										stationTimer = setTimeout(prepareDeparture, 100);
										return;
									}
									const ready = prepareTrainDeparture();
									const rest = new Promise(resolve => setTimeout(resolve, Math.min(4200, dwellMs)));
									Promise.all([ready, rest]).then(departStation);
								};
								stationTimer = setTimeout(prepareDeparture, Math.max(0, dwellMs - 4200));
							} else {
								setTimeout(() => {
									if (!active) return;
									departStation();
								}, dwellMs);
							}
						}
						return;
					}
				}
			}

			// Continue with distance calculations and speed control
			if (state.index >= state.route.length - 1) {
				if (state.isLooping) {
					console.log("🔁 Looping back to the beginning.");
					state.index = 0;
					updateSegmentSpeedSign(0);
					currentSpeed = 0;
					state.progress = 0;
					state.smoothRouteIndex = 0; // Reset curve position for loop
					spoken = false;
					green_flag = true;
					totalDistanceRemaining = state.route.slice(0).reduce((sum, stop, i, arr) => {
						if (i < arr.length - 1) return sum + calculateDistance(stop.latlng, arr[i + 1].latlng);
						return sum;
					}, 0);
					cancelAnimationFrame(state.animationInterval);
					state.animationInterval = null;
					moveToNextPoint();
					return;
				}
				console.log("✅ Journey complete!");
				cancelAnimationFrame(state.animationInterval);
				state.animationInterval = null;
				return;
			}

			remainingDistance = Math.max(segmentDistance * (1 - state.progress), 0.001);

			// Check if the next destination is a waypoint/dummy for legacy car logic
			let shouldDecelerate = true;
			if ((state.index + 1) < state.route.length) {
				const nextDestination = state.route[state.index + 1];
				const destinationType = nextDestination.type || 'stop';
				if (destinationType === 'waypoint' || destinationType === 'dummy') {
					shouldDecelerate = false;
				}
			}

			// Legacy deceleration logic for cars (non-road only).
			// Road mode is governed by the G-force state machine and curve speed envelope.
			if (mode === "car" && state.currentRouteType !== 'road') {
				// Original car deceleration logic - preserve for cars
				let requiredStopDistance = (currentSpeed * currentSpeed) / (2 * comfortableDeceleration);

				if (shouldDecelerate && remainingDistance <= requiredStopDistance * 1.5) {
					isDecelerating = true;
					let requiredDeceleration = (currentSpeed * currentSpeed) / (2 * remainingDistance);
					let smoothFactor = 0.2;
					let adjustedDeceleration = (1 - smoothFactor) * comfortableDeceleration + smoothFactor * requiredDeceleration;
					let decelerationFactor = Math.min(Math.max(adjustedDeceleration, comfortableDeceleration), maxDeceleration);

					// Apply G-force limited deceleration
					let targetSpeed = Math.max(currentSpeed - (decelerationFactor * (effectiveTickInterval / 3600)), 0);
					currentSpeed = calculateSafeSpeedEnhanced(targetSpeed, currentSpeed, effectiveTickInterval / 1000, state.maxGForceLimit);
				}
			}

			// === POSITION CALCULATION ===
			// If a smooth curved route exists, follow it; otherwise fall back to linear.
			const sampled = sampleRoutePosition(state.route, useSmoothRoute ? state.smoothRoute : null, state.index, state.progress);
			state.newLng = sampled.lng;
			state.newLat = sampled.lat;
			if (sampled.smoothIndex !== null) state.smoothRouteIndex = sampled.smoothIndex;
			state.newCoords = ol.proj.fromLonLat([state.newLng, state.newLat]);

			// Update fractional coordinates for visual updates
			state.fractionalLng = state.newLng;
			state.fractionalLat = state.newLat;
			state.fractionalCoords = state.newCoords;
			state.currentDisplaySpeed = currentSpeed; // For 3D view sync
			updateSpeedometer(currentSpeed);

			// Reduced debug coordinates calculation
			if (!window.lastCoordDebug || Date.now() - window.lastCoordDebug > 60000) {
				// Only log once per minute
				window.lastCoordDebug = Date.now();
			}

			if (!isNaN(state.newLng) && !isNaN(state.newLat)) {
				// Calculate rotation angle for the vehicle
				const currentPosition = {
					lat: state.newLat,
					lng: state.newLng
				};
				let rotationAngle = 0;

				// Use local tangent heading in road mode to avoid premature turn-in,
				// and short lookahead for non-road modes.
				if (useSmoothRoute && state.smoothRoute && state.smoothRoute.length > 2 && state.smoothRouteIndex < state.smoothRoute.length - 1) {
					let targetRotation;

					if (state.currentRouteType === 'road' && state.smoothRouteDistances && state.smoothRouteDistances.length > 0) {
						const findOffsetIndex = (startIdx, targetKm, dir) => {
							let idx = startIdx;
							let dist = 0;
							if (dir > 0) {
								while (idx < state.smoothRoute.length - 1 && dist < targetKm) {
									dist += state.smoothRouteDistances[idx] || 0;
									idx++;
								}
							} else {
								while (idx > 0 && dist < targetKm) {
									dist += state.smoothRouteDistances[idx - 1] || 0;
									idx--;
								}
							}
							return idx;
						};

						const forwardKm = Math.min(0.018, Math.max(0.006, (currentSpeed / 3600) * 0.45));
						const backKm = Math.min(0.008, Math.max(0.003, forwardKm * 0.4));
						const prevIdx = findOffsetIndex(state.smoothRouteIndex, backKm, -1);
						const nextIdx = findOffsetIndex(state.smoothRouteIndex, forwardKm, 1);
						const pPrev = state.smoothRoute[prevIdx] || state.smoothRoute[state.smoothRouteIndex];
						const pNext = state.smoothRoute[nextIdx] || state.smoothRoute[state.smoothRouteIndex + 1];
						targetRotation = calculateRotationAngle(pPrev, pNext);
					} else {
						const nextSubPoint = state.smoothRoute[state.smoothRouteIndex + 1] || state.smoothRoute[state.smoothRouteIndex];
						targetRotation = calculateRotationAngle(currentPosition, nextSubPoint);
					}

					// Angle interpolation with wraparound-safe delta in [-180, 180].
					if (typeof state.currentBearing === 'number' && isFinite(state.currentBearing)) {
						let delta = targetRotation - state.currentBearing;
						while (delta > 180) delta -= 360;
						while (delta < -180) delta += 360;

						if (state.currentRouteType === 'road') {
							const maxTurnRateDegPerSec = 75;
							const maxDelta = maxTurnRateDegPerSec * (effectiveTickInterval / 1000);
							delta = Math.max(-maxDelta, Math.min(maxDelta, delta));
						}

						const headingLerp = state.currentRouteType === 'road' ? 0.22 : 0.45;
						rotationAngle = state.currentBearing + delta * headingLerp;
					} else {
						rotationAngle = targetRotation;
					}
				} else if (pointB) {
					rotationAngle = calculateRotationAngle(currentPosition, pointB);
				}

				const visualNow = now;
				const isNearStationaryVisual = currentSpeed < 2 && !state.isTracking && !state.lockNorth;
				if (!isNearStationaryVisual || !window.lastCoachVisualUpdateMs || (visualNow - window.lastCoachVisualUpdateMs) >= 33) {
					updateTrainCoaches(mode, state.newCoords, rotationAngle);
					window.lastCoachVisualUpdateMs = visualNow;
				}

				// Always store bearing for 3D view sync (previousAngle only updates inside gforce calc)
				state.currentBearing = rotationAngle;

				// Calculate G-forces based on movement (suppress when stationary to avoid flicker)
				if (currentSpeed > 0.5) {
					state.currentGForce = calculateGForces(currentSpeed, state.newCoords, rotationAngle, Date.now(), roadCurve?.curvature);
				} else {
					state.currentGForce = 0;
					// Force the G-force display to zero and reset EMA to prevent bar dancing
					updateGForceDisplay(0, 0, 0);
				}

				if (state.isTracking) {
					const view = state.map.getView();
					if (!view.getAnimating()) {
						view.setCenter(state.newCoords);
						// HEADING-UP MODE (like Google Maps navigation):
						// rotationAngle is a geographic BEARING in DEGREES (0=North, 90=East).
						// OL view.setRotation takes RADIANS where 0 = North-up.
						// To make the vehicle always point UP on screen, rotate the map
						// by the negative bearing converted to radians.
						if (state.lockNorth) {
							const bearingRad = rotationAngle * Math.PI / 180;
							const targetRotation = -bearingRad;
							const currentRotation = view.getRotation() || 0;
							
							// Normalise delta to [-PI, PI] to handle wraparound
							let delta = targetRotation - currentRotation;
							while (delta > Math.PI) delta -= 2 * Math.PI;
							while (delta < -Math.PI) delta += 2 * Math.PI;
							
							// Single-owner LERP rotation — only animateFrame touches heading
							const lerpFactor = 0.18;
							const smoothed = currentRotation + delta * lerpFactor;
							view.setRotation(smoothed);
						}
					}
				}

				// Expensive calculations - throttled to improve performance  
				// Calculate every 5 frames (~12 times per second at 60fps) for more responsive speed targeting
				if (!window.autoFrameCount) window.autoFrameCount = 0;
				window.autoFrameCount++;

				if (window.autoFrameCount % 5 === 0) {
					let maxAchievableSpeedForNextStop = calculateMaxAchievableSpeed(
						remainingDistance,
						currentSpeed,
						maxSpeed,
						state.maxGForceLimit
					);

					let maxAchievableSpeedForFinalDestination = calculateMaxAchievableSpeed(
						totalDistanceRemaining,
						currentSpeed,
						maxSpeed,
						state.maxGForceLimit
					);

					// Store for use in acceleration logic - use the higher of the two for better acceleration
					window.maxAchievableSpeedForJourney = Math.max(maxAchievableSpeedForFinalDestination, maxAchievableSpeedForNextStop);
					window.maxAchievableSpeedForNextStop = maxAchievableSpeedForNextStop;

					// Use waypoint-aware time calculations instead of legacy calculations
					// (Legacy calculations removed to prevent inconsistency)
				}

				// Always use waypoint-aware time calculations
				if (!window.lastTimeCalculation || now - window.lastTimeCalculation >= 1000) {
					window.timeCalculations = calculateWaypointAndStopTimes(state.index, state.progress, currentSpeed);
					window.lastTimeCalculation = now;
				}

				const timeCalcs = window.timeCalculations || {
					timeToNextStop: 0,
					timeToNextWaypoint: 0,
					timeToFinalDestination: 0
				};

				let timeToNextStopValue = timeCalcs.timeToNextStop || 0;
				let timeToNextWaypointValue = timeCalcs.timeToNextWaypoint || 0;
				let timeToFinalDestinationValue = timeCalcs.timeToFinalDestination || 0;
				if (remainingDistance < 2 && !spoken) {
					if (distanceToNextStop >= 3) announceApproach(state.index + 1);
					spoken = true;
				}
				announceCruise(currentSpeed, remainingDistance);

				// Update stats for real-time HUD updates
				if (window.autoFrameCount % 2 === 0) {
					// Pass actual distances and times to updateStats
					// NOTE: updateRouteInfo handles the more precise distance labels
					updateStats(
						currentSpeed,
						remainingDistance,
						timeToNextStopValue,
						timeToFinalDestinationValue,
						state.totalDistanceCovered,
						getNextStopName(),
						timeToNextWaypointValue,
						state.currentGForce
					);
				}

				// Update route info (distances to stops/waypoints) ~20fps
				if (window.autoFrameCount % 3 === 0) {
					updateRouteInfo();
				}

				// Live-update time chart estimates ~10fps
				if (window.autoFrameCount % 6 === 0) {
					liveUpdateTimeChart(state.index, state.progress, currentSpeed);
				}

				// Road-mode driving style badge
				if (state.currentRouteType === 'road') {
					updateRoadHUD();
				}

				// Update location display very infrequently to minimize API calls (first refresh right after departure)
				const locationIntervalMs = currentSpeed >= 80 ? 60000 : (currentSpeed >= 20 ? 40000 : 20000);
				if (!lastLocationDisplayAt || timestamp - lastLocationDisplayAt >= locationIntervalMs) {
					lastLocationDisplayAt = timestamp;
					updateLocationDisplay();
				}
			} else {
				console.error("❌ ERROR: Invalid car position, stopping animation.");
				return;
			}

			// Monitor automatic mode performance
			monitorAutoPerformance();

			// Continue the animation loop
			if (!animationPaused) {
				state.animationInterval = requestAnimationFrame(animateFrame);
			}
		}

		if (!state.animationInterval) {
			// Initialize with requestAnimationFrame for 60fps
			console.log("🎬 Starting/Restarting automatic mode animation loop");
			console.log(`🔧 Animation state: paused=${animationPaused}, speed=${currentSpeed}, distance=${distanceToNextStop}`);

			// Reset timing for smooth restart
			window.lastAutoFrameTime = Date.now();
			window.autoStartTime = Date.now(); // Reset debug timer

			// Start the animation loop
			state.animationInterval = requestAnimationFrame(animateFrame);
		} else {
			// Remove repetitive log - animation already running
			// console.log("🔄 Animation already running, interval ID:", animationInterval);
		}
	}
	// Only call moveToNextPoint immediately if auto-zoom was ALREADY done
	// (e.g. re-simulation without page refresh). During fresh starts,
	// the setTimeout chain inside the autoZoom block takes care of it.
	if (resume) {
		moveToNextPoint(true);
		return {
			stop() {
				active = false;
				if (stationTimer) clearTimeout(stationTimer);
				if (state.animationInterval) cancelAnimationFrame(state.animationInterval);
				state.animationInterval = null;
				removeTracking?.();
				return { speed: currentSpeed, acceleration: handoverAcceleration };
			}
		};
	} else if (wasAlreadyZoomed) {
		moveToNextPoint();
	}
}

// Initialize route color picker listener
document.addEventListener('DOMContentLoaded', function () {
	const routeColorPicker = document.getElementById('routeColorPicker');
	const colorPreview = document.getElementById('colorPreview');

	// Update color preview and route color when picker changes
	if (routeColorPicker) {
		routeColorPicker.addEventListener('input', function (e) {
			const newColor = e.target.value;
			state.routeColor = newColor;
			colorPreview.textContent = newColor.toUpperCase();
			colorPreview.style.borderLeft = `4px solid ${newColor}`;

			// Update existing route if it exists
			updateExistingRouteColor();
		});

		// Initialize color preview
		colorPreview.textContent = state.routeColor.toUpperCase();
		colorPreview.style.borderLeft = `4px solid ${state.routeColor}`;
	}
});


export { animateMovement };