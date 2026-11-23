// ====================================
// INTELLIGENT CONTROL SYSTEM
// ====================================
import state from './state.js';
import { DRIVING_STYLES } from './constants.js';

// ============================================================
// G-FORCE MODEL
// ============================================================
// The user's G-force setting is a COMFORT TARGET, not a hard cap.
// Think of it like a car owner saying "drive smoothly at 0.2G".
// The driver (this system) respects that target throughout the
// journey, using it as:
//   - the desired acceleration rate when speeding up
//   - the desired deceleration rate when slowing down
//   - the threshold for "do I need to start braking yet?"
//
// An absolute SAFETY CAP (1.0G) is enforced in all cases.
// Passenger safety is always the top priority.
//
// At any moment:
//   maxSafeSpeed = sqrt(2 × targetDecel × remainingDistance)
//
// If currentSpeed > maxSafeSpeed → start braking NOW at targetDecel
// If currentSpeed < maxSafeSpeed → free to accelerate at targetAccel
// ============================================================

const SAFETY_HARD_CAP_G = 1.0;    // Absolute maximum G regardless of user setting
const MIN_COMFORT_G     = 0.05;   // Lowest meaningful G setting (softer than this is unrealistic)

// Toggle fuel efficiency mode
function toggleFuelEfficiency(enabled) {
	state.fuelEfficiencyMode = enabled;
	localStorage.setItem('fuelEfficiencyMode', enabled);
	localStorage.setItem('fuelEfficiencyEnabled', enabled);

	const dialogToggle = document.getElementById('fuelEfficiencyToggle');
	const hudToggle    = document.getElementById('hudFuelEfficiencyToggle');
	const hudModeIndicator = document.getElementById('fuelModeIndicator');

	if (dialogToggle) dialogToggle.checked = enabled;
	if (hudToggle)    hudToggle.checked    = enabled;

	if (hudModeIndicator) {
		hudModeIndicator.textContent = enabled ? 'EFFICIENT' : 'STANDARD';
		hudModeIndicator.style.color = enabled ? '#10b981' : '#ef4444';
	}
	efficiencyHudKey = '';
	updateEfficiencyHUD();
}

// ============================================================
// ECO DRIVING + ENERGY LEDGER
// ============================================================
// Efficient mode cuts traction ahead of each stop and lets the vehicle coast on rolling and
// aerodynamic resistance before the normal comfort-G braking point. The ledger integrates
// tractive energy actually used, and the energy a standard driver would have spent holding
// speed over the coasted distance, so "saved" is a measured figure, not a constant.

const VEHICLE_MASS_T = { train: null, hyperloop: 30, car: 1.6, flight: 70, helicopter: 5, ship: 2000, submarine: 1500, rocket: 500 };
const DRAG_AREA_M2 = { train: 9, hyperloop: 1.5, car: 0.7, flight: 3, helicopter: 2, ship: 60, submarine: 40, rocket: 3 };

const energyLedger = { massKg: 300000, dragArea: 9, usedJ: 0, savedJ: 0, coastedKm: 0, coasting: false };
let efficiencyHudKey = '';

function resetEnergyLedger(vehicleMode = 'train', coachCount = 3) {
	const tonnes = vehicleMode === 'train' ? 120 + 50 * Math.max(1, coachCount) : (VEHICLE_MASS_T[vehicleMode] || 80);
	energyLedger.massKg = tonnes * 1000;
	energyLedger.dragArea = DRAG_AREA_M2[vehicleMode] || 5;
	energyLedger.usedJ = 0;
	energyLedger.savedJ = 0;
	energyLedger.coastedKm = 0;
	energyLedger.coasting = false;
	efficiencyHudKey = '';
	updateEfficiencyHUD();
}

// Rolling + aerodynamic resistance (N) at speed (m/s).
function resistanceForce(speedMs) {
	return energyLedger.massKg * 9.81 * 0.0012 + 0.5 * 1.225 * energyLedger.dragArea * speedMs * speedMs;
}

/** Natural deceleration (km/h per second) while coasting at the given speed. */
function coastingDecelKmhPerS(speedKmh) {
	return resistanceForce(speedKmh / 3.6) / energyLedger.massKg * 3.6;
}

/**
 * Efficient mode only: coast (no traction) once the stop is within the braking distance
 * plus a speed-proportional coasting window (≈30 s of travel, 0.3–3 km).
 */
function shouldCoast(speedKmh, distanceToStopKm, brakingDistanceKm) {
	if (!state.fuelEfficiencyMode || speedKmh < 20) return false;
	const coastWindowKm = Math.min(3, Math.max(0.3, speedKmh * 0.008));
	return distanceToStopKm <= brakingDistanceKm + coastWindowKm;
}

/** Integrate one tick. Speeds in km/h, distance in km. */
function recordEnergyTick(speedBeforeKmh, speedAfterKmh, distanceKm, coasting) {
	if (!(distanceKm > 0)) return;
	const v0 = speedBeforeKmh / 3.6;
	const v1 = speedAfterKmh / 3.6;
	const meters = distanceKm * 1000;
	const resistanceJ = resistanceForce((v0 + v1) / 2) * meters;
	energyLedger.coasting = coasting;
	if (coasting) {
		energyLedger.savedJ += resistanceJ;
		energyLedger.coastedKm += distanceKm;
	} else if (v1 >= v0) {
		energyLedger.usedJ += 0.5 * energyLedger.massKg * (v1 * v1 - v0 * v0) + resistanceJ;
	}
}

function getEnergyStats() {
	const total = energyLedger.usedJ + energyLedger.savedJ;
	return {
		usedKWh: energyLedger.usedJ / 3.6e6,
		savedKWh: energyLedger.savedJ / 3.6e6,
		savedPercent: total > 0 ? (energyLedger.savedJ / total) * 100 : 0,
		coastedKm: energyLedger.coastedKm,
		coasting: energyLedger.coasting
	};
}

function formatKWh(kwh) {
	return kwh >= 100 ? `${Math.round(kwh)} kWh` : `${kwh.toFixed(1)} kWh`;
}

function updateEfficiencyHUD() {
	const savingsEl = document.getElementById('fuelSavings');
	if (!savingsEl) return;
	const stats = getEnergyStats();
	let text;
	if (state.fuelEfficiencyMode) {
		text = stats.coasting
			? `Coasting · ${stats.savedPercent.toFixed(1)}% saved`
			: `${stats.savedPercent.toFixed(1)}% saved · ${formatKWh(stats.usedKWh)}`;
	} else {
		text = `${formatKWh(stats.usedKWh)} used`;
	}
	const key = `${text}|${state.fuelEfficiencyMode}`;
	if (key === efficiencyHudKey) return;
	efficiencyHudKey = key;
	savingsEl.textContent = text;
	savingsEl.style.color = state.fuelEfficiencyMode ? '#10b981' : '#94a3b8';
	savingsEl.title = state.fuelEfficiencyMode
		? `Traction energy ${formatKWh(stats.usedKWh)}; coasting saved ${formatKWh(stats.savedKWh)} over ${stats.coastedKm.toFixed(1)} km`
		: 'Traction energy used this journey. Enable Efficient to coast into stops and save energy.';
}

// Coasting distance for fuel-efficient mode
function calculateCoastingDistance(currentSpeed) {
	const speedMs = currentSpeed / 3.6;
	const mass = 300000;
	const rollingResistanceCoeff = 0.0015;
	const airResistanceCoeff = 0.5;
	const frontalArea = 10;
	const airDensity = 1.225;
	const gravity = 9.81;

	const kineticEnergy = 0.5 * mass * speedMs * speedMs;
	const rollingResistance = mass * gravity * rollingResistanceCoeff;
	const avgAirResistance  = 0.5 * airDensity * airResistanceCoeff * frontalArea * speedMs * speedMs * 0.5;
	const totalResistance   = rollingResistance + avgAirResistance;
	return Math.max(0, kineticEnergy / totalResistance) / 1000;
}

// ============================================================
// CORE PHYSICS CONTROLLER
// Called every ~50ms.  Returns a state object that the animation
// loop uses directly — it does not modify speed itself.
// ============================================================
function calculateIntelligentAcceleration(currentSpeed, remainingDistance, userGForceLimit) {
	const now = Date.now();

	// Run every frame — pure arithmetic, negligible CPU cost.
	// At 257 km/h, a 50ms cache = 3.57m blind spot that causes late braking.
	state.intelligentControlState.lastCalculationTime = now;

	// === G-FORCE TARGETS ===
	// For road mode, scale comfort G by the driving style multiplier so "Rushed"
	// accelerates and brakes more aggressively than "Smooth".
	let styleGMult = 1.0;
	if (state.currentRouteType === 'road') {
		const style = DRIVING_STYLES[state.drivingStyle];
		if (style) styleGMult = style.gForceMult;
	}

	// Comfort target: clamp to [MIN_COMFORT_G, SAFETY_HARD_CAP_G]
	const comfortG     = Math.min(Math.max(userGForceLimit * styleGMult, MIN_COMFORT_G), SAFETY_HARD_CAP_G);
	const targetDecelA = comfortG * 9.81;           // m/s²  — braking decel rate
	const targetAccelA = comfortG * 9.81;           // m/s²  — acceleration rate (same feel)

	const currentSpeedMs    = currentSpeed / 3.6;
	const remainingDistanceM = remainingDistance * 1000;

	// === STOPPING DISTANCE at comfort rate ===
	// s = v² / (2a)
	const stoppingDistanceM  = (currentSpeedMs * currentSpeedMs) / (2 * targetDecelA);
	const stoppingDistanceKm = stoppingDistanceM / 1000;

	// === MAX SAFE SPEED for remaining distance ===
	// v = sqrt(2 * a * d)
	// Subtract 3 frames worth of travel as a lookahead buffer so the braking
	// decision fires slightly before the mathematical point of no return.
	// At 260 km/h (72 m/s) and ~30fps: 3 frames ≈ 7.2m of early trigger.
	const oneFrameM      = currentSpeedMs / 30;       // distance per frame at ~30fps
	const effectiveDistM = Math.max(0, remainingDistanceM - oneFrameM * 3);
	const maxSafeSpeedMs  = Math.sqrt(2 * targetDecelA * effectiveDistM);
	const maxSafeSpeedKmh = maxSafeSpeedMs * 3.6;

	let canAccelerate     = true;
	let shouldBrake       = false;
	let targetDeceleration = 0;
	let stopAccelerationDistance = 0;

	if (state.fuelEfficiencyMode) {
		// FUEL EFFICIENT: coast to a stop using 0.1G natural deceleration
		const naturalDecelA       = 0.1 * 9.81;
		const naturalStopDistM    = (currentSpeedMs * currentSpeedMs) / (2 * naturalDecelA);
		const naturalStopDistKm   = naturalStopDistM / 1000;

		state.intelligentControlState.coastingDistance = naturalStopDistKm;

		if (naturalStopDistKm >= remainingDistance) {
			canAccelerate     = false;
			shouldBrake       = false;   // coast naturally
			targetDeceleration = naturalDecelA;
			stopAccelerationDistance = remainingDistance;
		} else {
			canAccelerate     = true;
			shouldBrake       = false;
			targetDeceleration = 0;
			stopAccelerationDistance = remainingDistance - naturalStopDistKm;
		}
	} else {
		// STANDARD: pure-physics decision
		if (currentSpeed > maxSafeSpeedKmh) {
			// Need to brake — compute exact decel needed for remaining distance
			canAccelerate     = false;
			shouldBrake       = true;
			stopAccelerationDistance = remainingDistance;

			if (remainingDistanceM > 0.5) {
				// Required decel: a = v²/(2s)
				const requiredDecelA = (currentSpeedMs * currentSpeedMs) / (2 * remainingDistanceM);
				// Apply at the COMFORT rate unless physics demands more (up to safety cap)
				targetDeceleration = Math.min(
					Math.max(requiredDecelA, targetDecelA),
					SAFETY_HARD_CAP_G * 9.81
				);
			} else {
				// Very close — use full comfort decel
				targetDeceleration = Math.min(targetDecelA, SAFETY_HARD_CAP_G * 9.81);
			}
		} else {
			// Below max safe speed — can accelerate at the user's comfort G-force
			canAccelerate     = true;
			shouldBrake       = false;
			stopAccelerationDistance = remainingDistance - stoppingDistanceKm;
			targetDeceleration = 0;
		}

		state.intelligentControlState.brakingDistance = stoppingDistanceKm;
	}

	// ---- Update shared state ----
	state.intelligentControlState.canAccelerate          = canAccelerate;
	state.intelligentControlState.shouldBrake            = shouldBrake;
	state.intelligentControlState.stopAccelerationDistance = stopAccelerationDistance;
	state.intelligentControlState.targetDeceleration     = targetDeceleration;
	state.intelligentControlState.targetGForce           = targetDeceleration / 9.81;
	state.intelligentControlState.targetAccelG           = comfortG;    // so animation loop knows
	state.intelligentControlState.effectiveGForceLimit   = comfortG;
	state.intelligentControlState.isInTransitionZone     = shouldBrake;
	state.intelligentControlState.transitionDistance     = stoppingDistanceKm;
	state.intelligentControlState.previouslyBraking      = shouldBrake;
	state.intelligentControlState.mode                   = state.fuelEfficiencyMode ? 'EFFICIENT' : 'STANDARD';
	state.intelligentControlState.maxSafeSpeed           = maxSafeSpeedKmh;

	return state.intelligentControlState;
}

// Load fuel efficiency setting on page load
document.addEventListener('DOMContentLoaded', () => {
	const savedFuelMode = localStorage.getItem('fuelEfficiencyEnabled') || localStorage.getItem('fuelEfficiencyMode');
	if (savedFuelMode !== null) {
		toggleFuelEfficiency(savedFuelMode === 'true');
	}
});

export {
	toggleFuelEfficiency, calculateCoastingDistance, calculateIntelligentAcceleration,
	resetEnergyLedger, shouldCoast, coastingDecelKmhPerS, recordEnergyTick, getEnergyStats, updateEfficiencyHUD
};