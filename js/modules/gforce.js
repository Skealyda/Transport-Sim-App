// ====================================
// G-FORCE CALCULATION & BRAKING PHYSICS
// ====================================
import state from './state.js';
import { calculateDistance } from './utils.js';
import { GFORCE_UPDATE_INTERVAL } from './constants.js';

// EMA smoothing for G-force display
let smoothedDisplayGForce = 0;
let smoothedCurveGForce = 0;
let smoothedLongitudinalG = 0;
let smoothedLateralG = 0;
const GFORCE_EMA_ALPHA = 0.06; // Stronger smoothing: 6% new, 94% old


function solveSegmentTravelProfile(distanceM, entrySpeedMS, exitSpeedMS, maxSpeedMS, accelRateMS, decelRateMS) {
	if (distanceM <= 0) {
		return { timeSec: 0, peakSpeedMS: Math.max(entrySpeedMS, exitSpeedMS, 0) };
	}

	const safeAccel = Math.max(accelRateMS, 1e-6);
	const safeDecel = Math.max(decelRateMS, 1e-6);
	const safeMaxSpeed = Math.max(maxSpeedMS, entrySpeedMS, exitSpeedMS, 0);

	const peakSqNumerator = (2 * safeAccel * safeDecel * distanceM)
		+ (safeDecel * entrySpeedMS * entrySpeedMS)
		+ (safeAccel * exitSpeedMS * exitSpeedMS);
	const peakSqDenominator = safeAccel + safeDecel;
	const unconstrainedPeakSq = peakSqNumerator / peakSqDenominator;
	const triangularPeakMS = Math.sqrt(Math.max(unconstrainedPeakSq, entrySpeedMS * entrySpeedMS, exitSpeedMS * exitSpeedMS, 0));

	let peakSpeedMS = triangularPeakMS;
	let cruiseDistanceM = 0;

	if (triangularPeakMS > safeMaxSpeed) {
		peakSpeedMS = safeMaxSpeed;
		const accelDistanceM = peakSpeedMS > entrySpeedMS
			? (peakSpeedMS * peakSpeedMS - entrySpeedMS * entrySpeedMS) / (2 * safeAccel)
			: 0;
		const decelDistanceM = peakSpeedMS > exitSpeedMS
			? (peakSpeedMS * peakSpeedMS - exitSpeedMS * exitSpeedMS) / (2 * safeDecel)
			: 0;
		const usedDistanceM = accelDistanceM + decelDistanceM;

		if (usedDistanceM <= distanceM) {
			cruiseDistanceM = distanceM - usedDistanceM;
		} else {
			peakSpeedMS = triangularPeakMS;
		}
	}

	const accelTimeSec = peakSpeedMS > entrySpeedMS
		? (peakSpeedMS - entrySpeedMS) / safeAccel
		: 0;
	const decelTimeSec = peakSpeedMS > exitSpeedMS
		? (peakSpeedMS - exitSpeedMS) / safeDecel
		: 0;
	const cruiseTimeSec = cruiseDistanceM > 0 && peakSpeedMS > 0
		? cruiseDistanceM / peakSpeedMS
		: 0;

	const totalTimeSec = accelTimeSec + cruiseTimeSec + decelTimeSec;
	if (!Number.isFinite(totalTimeSec) || totalTimeSec < 0) {
		return {
			timeSec: distanceM / Math.max(peakSpeedMS, entrySpeedMS, exitSpeedMS, 0.1),
			peakSpeedMS
		};
	}

	return { timeSec: totalTimeSec, peakSpeedMS };
}

// Realistic travel time calculation with exact accel-cruise-decel phasing.
function calculateRealisticTravelTime(distance, startSpeed, maxSpeed, accelRate, decelRate, finalSpeed) {
	if (distance <= 0) return 0;

	const distanceM = distance * 1000;
	const startSpeedMS = (startSpeed * 1000) / 3600;
	const maxSpeedMS = (maxSpeed * 1000) / 3600;
	const finalSpeedMS = (finalSpeed * 1000) / 3600;
	const accelRateMS = (accelRate * 1000) / 3600;
	const decelRateMS = (decelRate * 1000) / 3600;

	return solveSegmentTravelProfile(distanceM, startSpeedMS, finalSpeedMS, maxSpeedMS, accelRateMS, decelRateMS).timeSec;
}

// Helper: get segment distance from cache or calculate
function getSegmentDistance(i) {
	if (state.segmentSmoothDistances && state.segmentSmoothDistances[i] !== undefined && state.segmentSmoothDistances[i] > 0) {
		return state.segmentSmoothDistances[i];
	}
	if (state.segmentDistances && state.segmentDistances[i] !== undefined) {
		return state.segmentDistances[i];
	}
	if (i < state.route.length - 1) {
		return calculateDistance(state.route[i].latlng, state.route[i + 1].latlng);
	}
	return 0;
}

function buildJourneySegments(startIndex = 0, startProgress = 0) {
	if (!state.route || startIndex >= state.route.length - 1) return [];

	const segments = [];
	for (let i = startIndex; i < state.route.length - 1; i++) {
		let distKm = getSegmentDistance(i);
		if (i === startIndex) {
			distKm *= Math.max(0, 1 - startProgress);
		}

		const exitPoint = state.route[i + 1];
		const exitType = exitPoint.type || 'stop';
		// 'dummy' points behave like 'waypoint' — vehicle passes through without stopping
		const isExitStop = (exitType !== 'waypoint' && exitType !== 'dummy') || i === state.route.length - 2;

		segments.push({
			routeIndexFrom: i,
			routeIndexTo: i + 1,
			distM: distKm * 1000,
			isExitStop,
			exitType
		});
	}

	return segments;
}

function solveJourneyPointSpeeds(segments, initialSpeedMS, maxSpeedMS, accelRateMS, decelRateMS, forceOriginStop = false) {
	if (!segments.length) {
		return new Float64Array([initialSpeedMS]);
	}

	const pointCount = segments.length + 1;
	const pointLimits = new Float64Array(pointCount).fill(maxSpeedMS);
	for (let i = 1; i < pointCount; i++) {
		if (segments[i - 1].isExitStop) {
			pointLimits[i] = 0;
		}
	}
	if (forceOriginStop) {
		pointLimits[0] = 0;
	}

	const forward = new Float64Array(pointCount);
	forward[0] = initialSpeedMS;
	for (let i = 0; i < segments.length; i++) {
		forward[i + 1] = Math.min(
			pointLimits[i + 1],
			maxSpeedMS,
			Math.sqrt(forward[i] * forward[i] + 2 * accelRateMS * segments[i].distM)
		);
	}

	const backward = new Float64Array(pointCount);
	backward[pointCount - 1] = pointLimits[pointCount - 1];
	for (let i = segments.length - 1; i >= 0; i--) {
		const currentPointLimit = (i === 0 && !forceOriginStop) ? maxSpeedMS : pointLimits[i];
		backward[i] = Math.min(
			currentPointLimit,
			maxSpeedMS,
			Math.sqrt(backward[i + 1] * backward[i + 1] + 2 * decelRateMS * segments[i].distM)
		);
	}

	const pointSpeeds = new Float64Array(pointCount);
	pointSpeeds[0] = initialSpeedMS;
	for (let i = 1; i < pointCount; i++) {
		pointSpeeds[i] = Math.min(forward[i], backward[i], pointLimits[i]);
	}

	return pointSpeeds;
}

function calculateManualSegmentPeakSpeeds(maxSpeedKmh, accelG, decelG, useSmoothRoute = false) {
	if (!state.route || state.route.length < 2) return [];
	const segments = buildJourneySegments();
	for (const segment of segments) {
		if (useSmoothRoute) continue;
		segment.distM = calculateDistance(
			state.route[segment.routeIndexFrom].latlng,
			state.route[segment.routeIndexTo].latlng
		) * 1000;
	}
	const maxSpeedMS = maxSpeedKmh / 3.6;
	const accel = accelG * 9.81;
	const decel = decelG * 9.81;
	const speeds = solveJourneyPointSpeeds(segments, 0, maxSpeedMS, accel, decel, true);
	return segments.map((segment, i) => segment.distM > 0
		? solveSegmentTravelProfile(segment.distM, speeds[i], speeds[i + 1], maxSpeedMS, accel, decel).peakSpeedMS * 3.6
		: 0);
}

// Calculate distance from current exact position to a target index (improved real-time version)
function calculateRealTimeDistanceFromCurrent(targetIndex, currentIndex, currentProgress) {
	if (!state.route || state.route.length === 0 || targetIndex < currentIndex) return 0;

	let totalDistance = 0;

	// If we're at the same segment, calculate remaining distance in current segment
	if (targetIndex === currentIndex) {
		if (currentIndex < state.route.length - 1) {
			return getSegmentDistance(currentIndex) * (1 - currentProgress);
		}
		return 0;
	}

	// Add remaining distance in current segment
	if (currentIndex < state.route.length - 1) {
		totalDistance += getSegmentDistance(currentIndex) * (1 - currentProgress);
	}

	// Add distances of all intermediate segments
	for (let i = currentIndex + 1; i < targetIndex; i++) {
		if (i < state.route.length - 1) {
			totalDistance += getSegmentDistance(i);
		}
	}

	return totalDistance;
}

// PHYSICS-BASED JOURNEY TIME CALCULATION
// Calculates travel times to next stop, next waypoint, and final destination
function calculateWaypointAndStopTimes(currentIndex, currentProgress = 0, currentSpeed = 0) {
	if (!state.route || state.route.length === 1 || currentIndex >= state.route.length - 1) {
		return { timeToNextStop: 0, timeToNextWaypoint: 0, timeToFinalDestination: 0 };
	}

	const maxSpeed = state.manualControlState.userDefinedMaxSpeed || 500;
	const accelG = state.accelGForceLimit || 0.10;
	const decelG = state.decelGForceLimit || 0.05;
	const accelRateMS = accelG * 9.81;
	const decelRateMS = decelG * 9.81;
	const maxSpeedMS = maxSpeed / 3.6;
	const initialSpeedMS = currentSpeed / 3.6;
	const stationDelay = state.stationDelayTime || 24;

	const segments = buildJourneySegments(currentIndex, currentProgress);
	const pointSpeeds = solveJourneyPointSpeeds(segments, initialSpeedMS, maxSpeedMS, accelRateMS, decelRateMS, false);

	let elapsedSec = 0;
	let timeToNextStop = 0;
	let timeToNextWaypoint = 0;
	let foundNextStop = false;
	let foundNextWaypoint = false;

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		const profile = solveSegmentTravelProfile(
			segment.distM,
			pointSpeeds[i],
			pointSpeeds[i + 1],
			maxSpeedMS,
			accelRateMS,
			decelRateMS
		);

		elapsedSec += profile.timeSec;

		if (!foundNextWaypoint && segment.exitType === 'waypoint') {
			timeToNextWaypoint = elapsedSec;
			foundNextWaypoint = true;
		}

		if (!foundNextStop && segment.isExitStop) {
			timeToNextStop = elapsedSec;
			foundNextStop = true;
		}

		if (segment.isExitStop && segment.routeIndexTo < state.route.length - 1) {
			elapsedSec += stationDelay;
		}
	}

	const timeToFinalDestination = elapsedSec;
	if (!foundNextWaypoint) {
		timeToNextWaypoint = timeToNextStop;
	}

	return {
		timeToNextStop,
		timeToNextWaypoint,
		timeToFinalDestination
	};
}

function calculateDistanceFromCurrent(targetIndex, currentIndex = 0, currentProgress = 0) {
	if (!state.route || targetIndex >= state.route.length || currentIndex >= state.route.length) return 0;

	let routeDistance = 0;

	// Add remaining distance to current segment
	if (currentIndex < state.route.length - 1) {
		const currentSegmentDistance = getSegmentDistance(currentIndex);
		// Use the passed progress parameter
		routeDistance += Math.max(0, currentSegmentDistance - currentProgress);
	}

	// Add distances for intermediate segments
	for (let i = currentIndex + 1; i < targetIndex; i++) {
		if (i < state.route.length - 1) {
			routeDistance += getSegmentDistance(i);
		}
	}

	return routeDistance;
}

// G-Force calculation and display functions
function calculateGForces(currentSpeed, currentPosition, currentAngle, timestamp, roadCurvature) {
	const currentTimestamp = timestamp || Date.now();

	// Initialize if first call
	if (state.previousTimestamp === 0) {
		state.previousSpeed = currentSpeed;
		state.previousTimestamp = currentTimestamp;
		state.previousPosition = currentPosition;
		state.previousAngle = currentAngle;
		updateGForceDisplay(0, 0, 0);
		return 0; // Return total G-force
	}

	const deltaTime = (currentTimestamp - state.previousTimestamp) / 1000; // Convert to seconds

	if (deltaTime <= 0 || deltaTime > 0.5) { // Skip if too large time gap (e.g., tab inactive)
		// Update tracking variables without calculating G-forces
		state.previousSpeed = currentSpeed;
		state.previousTimestamp = currentTimestamp;
		state.previousPosition = currentPosition;
		state.previousAngle = currentAngle;
		return 0;
	}

	// **ENHANCED LINEAR G-FORCE CALCULATION** - Much more sensitive to speed changes
	const speedMs = currentSpeed / 3.6; // Convert km/h to m/s
	const prevSpeedMs = state.previousSpeed / 3.6;
	const speedDifference = speedMs - prevSpeedMs;
	const linearAcceleration = speedDifference / deltaTime; // m/s² (positive = acceleration, negative = deceleration)

	// Calculate G-force magnitude (but preserve sign for analysis)
	const linearGForce = Math.abs(linearAcceleration / 9.81); // Convert to g-force magnitude

	// **ENHANCED SENSITIVITY** - Ensure we capture even small accelerations
	const minDetectableGForce = 0.002; // Detect even 0.002G changes
	const adjustedLinearGForce = linearGForce < minDetectableGForce ? 0 : linearGForce;

	// Calculate curve acceleration (centripetal force)
	let rawCurveGForce = 0;
	const turnDelta = ((currentAngle - state.previousAngle) % 360 + 540) % 360 - 180;
	if (Number.isFinite(roadCurvature)) {
		rawCurveGForce = speedMs * speedMs * Math.abs(roadCurvature) / 9.81;
	} else if (currentPosition && state.previousPosition && speedMs > 0.1) {
		const deltaAngle = Math.abs(turnDelta);

		if (deltaAngle > 0.5 && deltaAngle < 180) { // Raise threshold to 0.5° to filter sub-point noise
			const deltaAngleRad = (deltaAngle * Math.PI) / 180;
			const distance = speedMs * deltaTime;

			if (distance > 0) {
				const radius = distance / deltaAngleRad;
				const centripetal = (speedMs * speedMs) / radius;
				rawCurveGForce = Math.max(0, centripetal / 9.81);
			}
		}
	}
	// Smooth the curve G-force to prevent oscillation from dense sub-points
	smoothedCurveGForce = smoothedCurveGForce * 0.85 + rawCurveGForce * 0.15;
	const curveGForce = smoothedCurveGForce;

	// Signed components for the G-meter: +longitudinal = accelerating, +lateral = turning right.
	smoothedLongitudinalG = smoothedLongitudinalG * (1 - GFORCE_EMA_ALPHA) + (linearAcceleration / 9.81) * GFORCE_EMA_ALPHA;
	smoothedLateralG = smoothedLateralG * 0.85 + Math.sign(Number.isFinite(roadCurvature) ? roadCurvature : turnDelta) * rawCurveGForce * 0.15;

	// **ENHANCED TOTAL G-FORCE** - Better vector sum calculation
	const totalGForce = Math.sqrt(adjustedLinearGForce * adjustedLinearGForce + curveGForce * curveGForce);

	// Apply EMA smoothing to eliminate per-frame noise and flickering
	smoothedDisplayGForce = (totalGForce * GFORCE_EMA_ALPHA) + (smoothedDisplayGForce * (1 - GFORCE_EMA_ALPHA));

	// Update display with smoothed value
	updateGForceDisplay(smoothedLongitudinalG, smoothedLateralG, smoothedDisplayGForce, currentSpeed);

	// Update tracking variables
	state.previousSpeed = currentSpeed;
	state.previousTimestamp = currentTimestamp;
	state.previousPosition = currentPosition;
	state.previousAngle = currentAngle;

	return totalGForce; // Return total G-force for safety checks
}

// Enhanced Dynamic Braking System
let brakingState = {
	isEmergencyBraking: false,
	targetSpeed: 0,
	emergencyBrakeDistance: 0.1, // Emergency brake within 100m
	lastGForceUpdate: 0,
	plannedStopDistance: 0,
	isAdvancedBraking: false
};

// Calculate dynamic stopping distance based on current G-Force limit
function calculateStoppingDistance(currentSpeed, gForceLimit) {
	// Validate inputs to prevent NaN
	if (!currentSpeed || currentSpeed <= 0) return 0;
	if (!gForceLimit || gForceLimit <= 0 || isNaN(gForceLimit)) {
		console.warn(`⚠️ Invalid G-Force limit: ${gForceLimit}, using fallback of 0.5g`);
		gForceLimit = 0.5;
	}

	// Convert speed from km/h to m/s
	const speedMs = currentSpeed / 3.6;

	// Convert G-Force to deceleration (m/s²)
	const maxDeceleration = gForceLimit * 9.81;

	// Physics: v² = u² + 2as, where v=0 (final speed), u=initial speed, a=deceleration
	// Rearranging: s = u² / (2 * a)
	const stoppingDistanceM = (speedMs * speedMs) / (2 * maxDeceleration);

	// Convert back to kilometers - NO SAFETY MARGIN, pure physics
	const stoppingDistanceKm = stoppingDistanceM / 1000;

	// Validate result
	if (isNaN(stoppingDistanceKm) || stoppingDistanceKm <= 0) {
		console.error(`❌ Invalid stopping distance calculated: ${stoppingDistanceKm}km, speed: ${currentSpeed}km/h, gForce: ${gForceLimit}g`);
		return 0;
	}

	return stoppingDistanceKm;
}

// Enhanced smooth deceleration with emergency backup
function calculateTargetSpeedForStop(currentSpeed, remainingDistance, gForceLimit) {
	// Calculate ideal deceleration curve
	const maxDeceleration = gForceLimit * 9.81; // m/s² - STRICT adherence to G-force limit
	const remainingDistanceM = remainingDistance * 1000; // Convert to meters

	// Calculate the maximum safe speed for remaining distance
	// Using: v = √(2 * a * s)
	const maxSafeSpeedMs = Math.sqrt(2 * maxDeceleration * remainingDistanceM);
	const maxSafeSpeedKmh = maxSafeSpeedMs * 3.6;

	// SMOOTH DECELERATION ONLY: No emergency braking, respect user's G-force choice
	if (currentSpeed > maxSafeSpeedKmh) {
		state.brakingState.isAdvancedBraking = true;
		// Never activate emergency braking - let smooth deceleration handle it
		state.brakingState.isEmergencyBraking = false;

		// Log smooth deceleration (throttled to prevent spam) - DISABLED
		const now = Date.now();
		if (false && (!window.lastSmoothDecelLog || now - window.lastSmoothDecelLog > 3000)) {
			console.log(`� SMOOTH DECELERATION: ${currentSpeed.toFixed(1)} → ${maxSafeSpeedKmh.toFixed(1)} km/h, distance: ${remainingDistance.toFixed(3)}km`);
			window.lastSmoothDecelLog = now;
		}

		return Math.max(maxSafeSpeedKmh, 0);
	}

	return currentSpeed; // No deceleration needed yet
}

// Enhanced safe speed calculation - SPEED FIRST with user G-force compliance
function calculateSafeSpeedEnhanced(targetSpeed, currentSpeed, deltaTime, userGForce) {
	// Use the user's chosen G-force limit - they decide the safety level
	const maxAcceleration = userGForce * 9.81; // Convert G-force to m/s²
	const maxSpeedChangeMs = maxAcceleration * deltaTime; // Maximum speed change in m/s
	const maxSpeedChangeKmh = maxSpeedChangeMs * 3.6; // Convert to km/h

	const speedDifference = targetSpeed - currentSpeed;

	// Respect user's G-force choice - if they chose 2G, use 2G for max performance
	if (Math.abs(speedDifference) <= maxSpeedChangeKmh) {
		return targetSpeed; // Can reach target speed within user's G-force limits
	}

	if (speedDifference > 0) { // Accelerating - go as fast as user allows
		return currentSpeed + maxSpeedChangeKmh;
	} else { // Decelerating - brake as hard as user allows
		return Math.max(currentSpeed - maxSpeedChangeKmh, 0);
	}
}

// Monitor G-Force changes and recalculate braking if needed
function updateDynamicBraking(currentSpeedKmh) {
	const now = Date.now();
	if (now - state.brakingState.lastGForceUpdate > 100) { // Update every 100ms
		state.brakingState.lastGForceUpdate = now;

		// If user changed G-Force settings during braking, recalculate
		if (state.brakingState.isAdvancedBraking) {
			const newStoppingDistance = calculateStoppingDistance(currentSpeedKmh || 0, state.maxGForceLimit);

			// Only log significant changes and validate the result
			if (!isNaN(newStoppingDistance) && Math.abs(newStoppingDistance - state.brakingState.plannedStopDistance) > 0.1) {
				state.brakingState.plannedStopDistance = newStoppingDistance;
				// Reduce logging frequency - only log every 2 seconds during braking
				if (!window.lastBrakingUpdateLog || now - window.lastBrakingUpdateLog > 2000) {
					console.log(`⚙️ G-Force changed during braking - New stopping distance: ${newStoppingDistance.toFixed(3)}km`);
					window.lastBrakingUpdateLog = now;
				}
			}
		}
	}
}

// G-meter (friction circle) rendering. gforce.js is the only writer of the G-force HUD.
const GMETER_RADIUS = 27;
const GMETER_FULL_SCALE = 1.0;
let gmeterElements = null;
const gmeterRendered = { text: '', phase: '', level: '', dot: '', fill: '', limit: '' };

// Square-root scale keeps typical 0.05–0.2 g rail forces visible while still fitting 1 g.
function gmeterRadius(g) {
	return GMETER_RADIUS * Math.sqrt(Math.min(Math.abs(g), GMETER_FULL_SCALE) / GMETER_FULL_SCALE);
}

function getGmeterElements() {
	if (!gmeterElements || !gmeterElements.panel?.isConnected) {
		gmeterElements = {
			panel: document.querySelector('.gforce-panel'),
			value: document.getElementById('gForceDisplay'),
			phase: document.getElementById('gforcePhase'),
			dot: document.getElementById('gforceDot'),
			limitRing: document.getElementById('gforceLimitRing'),
			fill: document.getElementById('gforceBar')
		};
	}
	return gmeterElements;
}

function setIfChanged(key, value, apply) {
	if (gmeterRendered[key] === value) return;
	gmeterRendered[key] = value;
	apply(value);
}

function updateGForceDisplay(longitudinal, lateral, total, speedKmh = 0) {
	const now = Date.now();

	// If total is zero (stationary), reset the EMA accumulators to prevent stale values
	if (total === 0) {
		smoothedDisplayGForce = 0;
		smoothedCurveGForce = 0;
		smoothedLongitudinalG = 0;
		smoothedLateralG = 0;
		longitudinal = 0;
		lateral = 0;
	} else if (now - state.lastGForceUpdate < GFORCE_UPDATE_INTERVAL) {
		return;
	}
	state.lastGForceUpdate = now;
	state.lastGForceValue = Math.round(total * 100) / 100;

	const el = getGmeterElements();
	if (!el.panel) return;

	const braking = longitudinal < 0;
	const limit = Math.max(0.01, (braking ? state.decelGForceLimit : state.accelGForceLimit) || state.maxGForceLimit || 0.1);
	const ratio = total / limit;

	let phase = 'Idle';
	if (total >= 0.01) {
		if (Math.abs(longitudinal) >= Math.abs(lateral)) phase = braking ? 'Braking' : 'Accel';
		else phase = lateral > 0 ? 'Curve R' : 'Curve L';
	} else if (speedKmh > 0.5) {
		phase = 'Cruise';
	}

	const level = total >= 1.5 ? 'extreme' : total >= 1.0 ? 'warning' : total >= 0.5 || ratio > 1.05 ? 'caution' : 'safe';

	// Dot direction: accel up, braking down, right curve to the right.
	const magnitude = Math.hypot(longitudinal, lateral);
	const r = gmeterRadius(magnitude);
	const dx = magnitude > 0 ? (lateral / magnitude) * r : 0;
	const dy = magnitude > 0 ? (-longitudinal / magnitude) * r : 0;

	setIfChanged('text', state.lastGForceValue.toFixed(2), v => { if (el.value) el.value.textContent = v; });
	setIfChanged('phase', phase, v => {
		if (el.phase) el.phase.textContent = v;
		el.panel.dataset.gPhase = v.split(' ')[0].toLowerCase();
	});
	setIfChanged('level', level, v => { el.panel.dataset.gLevel = v; });
	setIfChanged('dot', `${dx.toFixed(1)}px, ${dy.toFixed(1)}px`, v => {
		if (el.dot) el.dot.style.transform = `translate(${v})`;
	});
	setIfChanged('fill', Math.min(100, ratio * 100).toFixed(0), v => {
		if (el.fill) el.fill.style.width = `${v}%`;
		el.panel.dataset.gOverLimit = ratio > 1.05 ? 'true' : 'false';
	});
	setIfChanged('limit', limit.toFixed(3), () => {
		if (el.limitRing) el.limitRing.setAttribute('r', gmeterRadius(limit).toFixed(2));
	});
}

// ====================================
// PRE-CALCULATED JOURNEY ENGINE
// ====================================
// Physics-accurate forward+backward pass speed profiling for train/hyperloop
// Computes exact per-segment entry/exit speeds, travel times, and cumulative timestamps

// Conservative grace time so pre-sim ETAs feel achievable in normal operation.
// Adds a sensible buffer between point durations, scaled by segment distance.
function calculateSegmentGraceBufferSec(segmentDistanceM, isExitStop) {
	const distanceKm = segmentDistanceM / 1000;
	const baseBuffer = Math.min(8, Math.max(2.5, distanceKm * 2.0));
	const stopApproachBuffer = isExitStop ? 2.5 : 1.0;
	return Math.min(11, baseBuffer + stopApproachBuffer);
}

// ========================================
// JOURNEY PROFILE WARM-UP HOOK
// ========================================
async function warmJourneyProfileCache(maxSpeedKmh, accelG, decelG, stationDelaySec) {
	// Existing callers use this hook; the standalone build calculates locally.
	void maxSpeedKmh;
	void accelG;
	void decelG;
	void stationDelaySec;
}

function preCalculateJourney(maxSpeedKmh, accelG, decelG, stationDelaySec) {
	if (!state.route || state.route.length < 2 || !state.segmentDistances || state.segmentDistances.length === 0) {
		return null;
	}

	const route = state.route;
	const accelRate = accelG * 9.81;   // m/s²
	const decelRate = decelG * 9.81;   // m/s²
	const maxSpeedMs = maxSpeedKmh / 3.6;
	const segments = buildJourneySegments(0, 0);
	const numSegments = segments.length;
	const pointSpeed = solveJourneyPointSpeeds(segments, 0, maxSpeedMs, accelRate, decelRate, true);

	// ---- COMPUTE PER-SEGMENT TRAVEL TIME ----
	// Each segment: entry speed = pointSpeed[i], exit speed = pointSpeed[i+1]
	// Peak speed within segment = min(maxSpeedMs, speed achievable from both ends)
	const segmentTimes = []; // seconds per segment
	const segmentGraceTimes = []; // seconds grace per segment
	const segmentPeakSpeeds = []; // km/h

	for (let i = 0; i < numSegments; i++) {
		if (segments[i].distM <= 0) {
			segmentTimes.push(0);
			segmentGraceTimes.push(0);
			segmentPeakSpeeds.push(0);
			continue;
		}

		const profile = solveSegmentTravelProfile(
			segments[i].distM,
			pointSpeed[i],
			pointSpeed[i + 1],
			maxSpeedMs,
			accelRate,
			decelRate
		);

		const graceSec = calculateSegmentGraceBufferSec(segments[i].distM, segments[i].isExitStop);
		segmentGraceTimes.push(graceSec);
		segmentTimes.push(profile.timeSec + graceSec);
		segmentPeakSpeeds.push(profile.peakSpeedMS * 3.6);
	}

	// ---- BUILD TIMETABLE ----
	// Accumulate arrival/departure timestamps starting from "now"
	const departureEpoch = Date.now();
	const timetable = [];

	// Origin: departs immediately
	timetable.push({
		index: 0,
		name: route[0].placeName || 'Origin',
		type: route[0].type || 'stop',
		estimatedArrival: departureEpoch, // Arrive at origin = now
		estimatedDeparture: departureEpoch, // Depart immediately
		segmentTime: 0,
		distanceInterval: 0,
		cumulativeTimeFromOriginSec: 0,
		stopDuration: 0,
		cumulativeDistance: 0,
		peakSpeed: 0,
		entrySpeed: 0
	});

	let cumulativeTime = 0; // seconds from departure
	let cumulativeDist = 0; // km

	for (let i = 0; i < numSegments; i++) {
		cumulativeTime += segmentTimes[i];
		cumulativeDist += (segments[i].distM / 1000);

		const pt = route[i + 1];
		const ptType = pt.type || 'stop';
		const isStop = ptType !== 'waypoint' || i === numSegments - 1;

		const arrivalMs = departureEpoch + cumulativeTime * 1000;
		const stopDurationSec = isStop ? stationDelaySec : 0;
		// Last stop has no departure (journey end)
		const isLast = (i === numSegments - 1);
		const departureMs = isLast ? null : arrivalMs + stopDurationSec * 1000;

		if (isStop && !isLast) {
			cumulativeTime += stopDurationSec;
		}

		timetable.push({
			index: i + 1,
			name: pt.placeName || `Point ${i + 2}`,
			type: ptType,
			estimatedArrival: arrivalMs,
			estimatedDeparture: departureMs,
			segmentTime: segmentTimes[i],
			distanceInterval: segments[i].distM / 1000,
			cumulativeTimeFromOriginSec: cumulativeTime,
			segmentGraceTime: segmentGraceTimes[i],
			stopDuration: stopDurationSec * 1000,
			cumulativeDistance: cumulativeDist,
			peakSpeed: segmentPeakSpeeds[i],
			entrySpeed: pointSpeed[i + 1] * 3.6
		});
	}

	return {
		timetable,
		totalTime: cumulativeTime,
		totalDistance: cumulativeDist,
		segmentTimes,
		segmentGraceTimes,
		segmentPeakSpeeds,
		pointSpeeds: Array.from(pointSpeed).map(v => v * 3.6), // km/h
		departureEpoch
	};
}

// Re-calculate from a given route index forward (for live updates)
function reCalculateFromIndex(fromIndex, currentProgress, currentSpeed, accelG, decelG, maxSpeedKmh, stationDelaySec) {
	if (!state.route || fromIndex >= state.route.length - 1 || !state.segmentDistances) return null;

	const route = state.route;
	const accelRate = accelG * 9.81;
	const decelRate = decelG * 9.81;
	const maxSpeedMs = maxSpeedKmh / 3.6;
	const segments = buildJourneySegments(fromIndex, currentProgress);
	const totalSegs = segments.length;
	if (totalSegs <= 0) return null;
	const pointSpd = solveJourneyPointSpeeds(segments, currentSpeed / 3.6, maxSpeedMs, accelRate, decelRate, false);

	// Compute times
	const segTimes = [];
	const now = Date.now();

	for (let j = 0; j < totalSegs; j++) {
		const profile = solveSegmentTravelProfile(
			segments[j].distM,
			pointSpd[j],
			pointSpd[j + 1],
			maxSpeedMs,
			accelRate,
			decelRate
		);
		const graceSec = calculateSegmentGraceBufferSec(segments[j].distM, segments[j].isExitStop);
		segTimes.push(profile.timeSec + graceSec);
	}

	// Build partial timetable
	const results = [];
	let cumTime = 0;
	for (let j = 0; j < totalSegs; j++) {
		cumTime += segTimes[j];
		const routeIdx = segments[j].routeIndexTo;
		const pt = route[routeIdx];
		const ptType = pt.type || 'stop';
		const isStop = ptType !== 'waypoint' || (routeIdx === route.length - 1);
		const arrMs = now + cumTime * 1000;
		const stopDur = isStop ? stationDelaySec : 0;
		const isLast = (routeIdx === route.length - 1);
		const depMs = isLast ? null : arrMs + stopDur * 1000;

		if (isStop && !isLast) cumTime += stopDur;

		results.push({
			routeIndex: routeIdx,
			estimatedArrival: arrMs,
			estimatedDeparture: depMs,
			segmentTime: segTimes[j]
		});
	}

	return results;
}

export { calculateGForces, updateGForceDisplay };
export { calculateStoppingDistance, calculateTargetSpeedForStop, calculateSafeSpeedEnhanced, updateDynamicBraking };
export { calculateWaypointAndStopTimes, calculateRealisticTravelTime };
export { calculateRealTimeDistanceFromCurrent, calculateDistanceFromCurrent };
export { preCalculateJourney, reCalculateFromIndex, warmJourneyProfileCache, calculateManualSegmentPeakSpeeds };
