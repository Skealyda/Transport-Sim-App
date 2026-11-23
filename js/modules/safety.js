// ====================================
// SAFETY SYSTEM & EMERGENCY PROTOCOLS
// ====================================
import state from './state.js';
import { playAudio, formatTimeHHMMSS } from './utils.js';
import { announceSafety } from './announcer.js';


// ===============================================
// 🚨 COMPREHENSIVE SAFETY SYSTEM WITH EMERGENCY PROTOCOLS
// ===============================================

// Enhanced safety state management
const safetyState = state.safetyState;

// Emergency braking system with multiple failsafe layers
function activateEmergencyBraking(reason = "Emergency situation detected") {
	// Emergency braking — respects user's G-force limit with 1.2x overage allowance
	if (!safetyState.emergencyBrakeApplied) {
		safetyState.emergencyBrakeApplied = true;
		safetyState.emergencyMode = true;
		safetyState.emergencyProtocolsActive = true;

		console.error(`🚨 EMERGENCY BRAKING ACTIVATED: ${reason}`);

		// Immediate passenger announcement
		announceEmergency(reason);

		// Force maximum safe deceleration
		if (state.manualControlState) {
			state.manualControlState.targetSpeed = 0;
			state.manualControlState.isBraking = true;
			// Allow slight overage (1.2x user limit, capped at 1.0G) for safety
			safetyState.maxAllowedGForce = Math.min((state.maxGForceLimit || 0.5) * 1.2, 1.0);
		}

		// Update HUD status
		const statusElement = document.getElementById("statusText");
		if (statusElement) {
			statusElement.textContent = "🚨 EMERGENCY BRAKING";
			statusElement.style.color = "#ef4444";
		}
	}
}

// Passenger safety announcement system
function announceEmergency(reason) {
	const now = Date.now();

	// Prevent announcement spam (minimum 3 seconds between announcements)
	if (now - state.safetyState.lastEmergencyAnnouncement < 3000) return;

	state.safetyState.lastEmergencyAnnouncement = now;

	let announcementText;

	if (state.safetyState.brakeFailureDetected) {
		announcementText = "ATTENTION PASSENGERS: Emergency braking in progress. Please hold on securely and remain seated. We are applying all available braking systems to ensure your safety.";
	} else {
		announcementText = `ATTENTION PASSENGERS: Emergency braking has been activated due to ${reason}. Please hold on securely, remain seated, and prepare for deceleration. Your safety is our priority.`;
	}

	// Emergency announcement pre-empts everything else in the announcer queue.
	announceSafety(announcementText);

	console.log(`📢 Emergency announcement: ${announcementText}`);
}

// Visual emergency indicators
function activateEmergencyVisuals() {
	// Add emergency styling to speed display
	const speedDisplay = document.getElementById('liveSpeed');
	if (speedDisplay) {
		speedDisplay.style.color = '#ef4444';
		speedDisplay.style.animation = 'pulse 1s infinite';
	}

	// Emergency border on HUD
	const hudElements = document.querySelectorAll('.hud-element');
	hudElements.forEach(element => {
		element.style.borderColor = '#ef4444';
		element.style.borderWidth = '2px';
	});

	// Update status indicator
	const statusIndicator = document.getElementById('statusIndicator');
	if (statusIndicator) {
		statusIndicator.style.color = '#ef4444';
		statusIndicator.textContent = '🚨 EMERGENCY BRAKING';
	}
}

// Emergency audio system
function playEmergencyAudio() {
	// Stop normal train sounds
	const trainRunning = document.getElementById("TrainRunningSound");
	if (trainRunning) {
		trainRunning.pause();
	}

	// Play emergency brake sound
	const emergencyBrakeSound = document.getElementById("TrainStop");
	if (emergencyBrakeSound) {
		emergencyBrakeSound.currentTime = 0;
		emergencyBrakeSound.volume = 0.8;
		emergencyBrakeSound.play().catch(e => console.log("Emergency brake sound failed:", e));
	}
}

// Update emergency stopping distance
function updateEmergencyStopDistance() {
	if (window.manualControlState && manualControlState.currentSpeed > 0) {
		state.safetyState.stopDistance = calculateStoppingDistance(
			state.manualControlState.currentSpeed,
			state.safetyState.maxAllowedGForce
		);

		console.log(`🛑 Emergency stop distance: ${state.safetyState.stopDistance.toFixed(3)}km at ${state.manualControlState.currentSpeed.toFixed(1)}km/h`);
	}
}

// Comprehensive safety monitoring system
function monitorSafetyStatus() {
	const now = Date.now();

	// Safety check every 100ms
	if (now - state.safetyState.lastSafetyCheck < 100) return;
	state.safetyState.lastSafetyCheck = now;

	if (!window.manualControlState || !state.manualControlState.isManualMode) return;

	const currentSpeed = state.manualControlState.currentSpeed;
	const targetSpeed = state.manualControlState.targetSpeed;
	const userGForceLimit = state.maxGForceLimit; // User's chosen G-force limit

	// Check for dangerous acceleration/deceleration only if exceeding user's choice significantly
	const speedDifference = Math.abs(targetSpeed - currentSpeed);
	if (speedDifference > 50) { // More than 50 km/h difference (increased from 30)
		updatePassengerAlertLevel(1, "Rapid speed change detected");
	}

	// Check G-force compliance - only alert if significantly exceeding user's choice (disabled emergency braking for smooth stops)
	if (state.currentGForce > userGForceLimit * 2.0) { // Much higher threshold: 100% overage allowed
		updatePassengerAlertLevel(3, "G-force significantly exceeding user limit");
		// DISABLED: Emergency braking for smooth stops
		// if (!safetyState.emergencyBrakeApplied) {
		//     activateEmergencyBraking(`G-force ${state.currentGForce.toFixed(1)}g exceeds user limit of ${userGForceLimit}g by 100%`);
		// }
	} else if (state.currentGForce > userGForceLimit * 1.5) { // 50% overage warning
		updatePassengerAlertLevel(2, "G-force approaching user-defined limit");
	}

	// Check for brake failure (speed not decreasing when it should) - much less aggressive
	if (targetSpeed < currentSpeed - 20 && currentSpeed > 50) { // Only check significant speed differences and high speeds
		const expectedDeceleration = calculateExpectedDeceleration(currentSpeed, targetSpeed);
		if (expectedDeceleration > 0 && !isDecelerating()) {
			safetyState.brakeFailureDetected = true;
			// DISABLED: Emergency braking for smoother operation
			// activateEmergencyBraking("Brake system failure detected - speed not reducing as expected");
			console.warn("⚠️ Brake system may not be responding optimally");
		}
	}

	// Reset brake failure flag when appropriate
	if (safetyState.brakeFailureDetected && isDecelerating()) {
		state.safetyState.brakeFailureDetected = false;
		console.log("✅ Brake system responding normally");
	}
}

// Update passenger alert level with announcements
function updatePassengerAlertLevel(level, reason) {
	const now = Date.now();

	// Don't downgrade alert level during emergency
	if (safetyState.emergencyMode && level < 3) return;

	if (level > state.safetyState.passengerAlertLevel) {
		state.safetyState.passengerAlertLevel = level;

		// Passenger update every 5 seconds minimum
		if (now - state.safetyState.lastPassengerUpdate > 5000) {
			state.safetyState.lastPassengerUpdate = now;

			let announcement = "";
			switch (level) {
				case 1:
					announcement = "ATTENTION PASSENGERS: Please be seated and hold on securely. We are adjusting our speed for your comfort.";
					break;
				case 2:
					announcement = "ATTENTION PASSENGERS: Please remain seated and ensure all personal items are secure. We are experiencing some speed adjustments.";
					break;
				case 3:
					// Emergency level handled by activateEmergencyBraking
					return;
			}

			if (announcement) {
				announceSafety(announcement, { interrupt: false });

				console.log(`👥 Passenger alert level ${level}: ${reason}`);
			}
		}
	}

	// Gradually reduce alert level when conditions improve
	if (level < state.safetyState.passengerAlertLevel && now - state.safetyState.lastPassengerUpdate > 10000) {
		state.safetyState.passengerAlertLevel = Math.max(0, state.safetyState.passengerAlertLevel - 1);
	}
}

// Check if vehicle is actually decelerating
function isDecelerating() {
	if (!window.manualControlState) return false;

	// Store speed history for deceleration detection
	if (!window.speedHistory) window.speedHistory = [];

	const now = Date.now();
	window.speedHistory.push({ speed: state.manualControlState.currentSpeed, time: now });

	// Keep only last 3 seconds of history
	window.speedHistory = window.speedHistory.filter(entry => now - entry.time < 3000);

	if (window.speedHistory.length < 2) return false;

	// Check if speed is generally decreasing
	const oldestSpeed = window.speedHistory[0].speed;
	const currentSpeed = window.speedHistory[window.speedHistory.length - 1].speed;

	return currentSpeed < oldestSpeed - 0.5; // At least 0.5 km/h decrease
}

// Calculate expected deceleration for brake failure detection
function calculateExpectedDeceleration(currentSpeed, targetSpeed) {
	if (targetSpeed >= currentSpeed) return 0;

	const maxDeceleration = state.maxGForceLimit * 9.81 * 3.6; // Convert to km/h/s
	const speedDifference = currentSpeed - targetSpeed;

	return Math.min(speedDifference, maxDeceleration);
}

// Clear emergency state when vehicle has safely stopped
function clearEmergencyState() {
	if (!state.safetyState.emergencyMode) return;

	state.safetyState.emergencyMode = false;
	state.safetyState.emergencyBrakeApplied = false;
	state.safetyState.emergencyProtocolsActive = false;
	state.safetyState.passengerAlertLevel = 0;
	state.safetyState.maxAllowedGForce = state.maxGForceLimit; // Reset to normal limit

	// Clear visual emergency indicators
	const speedDisplay = document.getElementById('liveSpeed');
	if (speedDisplay) {
		speedDisplay.style.color = '';
		speedDisplay.style.animation = '';
	}

	const hudElements = document.querySelectorAll('.hud-element');
	hudElements.forEach(element => {
		element.style.borderColor = '';
		element.style.borderWidth = '';
	});

	const statusIndicator = document.getElementById('statusIndicator');
	if (statusIndicator) {
		statusIndicator.style.color = '#10b981';
	}
	const statusText = document.getElementById('statusText');
	if (statusText) {
		statusText.textContent = 'Safely stopped';
		statusText.style.color = '';
	}

	// Final passenger announcement
	const safetyAnnouncement = "ATTENTION PASSENGERS: We have come to a complete stop safely. Thank you for your patience and cooperation. Please remain seated until further instructions.";
	announceSafety(safetyAnnouncement, { interrupt: false });

	console.log("✅ Emergency state cleared - Vehicle safely stopped");
}

// ===============================================
// 🔧 SAFETY SYSTEM TESTING AND VALIDATION
// ===============================================

// Test emergency braking system manually (for development/testing)
function testEmergencyBraking() {
	console.log("🧪 Testing emergency braking system...");
	activateEmergencyBraking("System test initiated");
}

// Validate all safety systems on startup
function initializeSafetySystem() {
	console.log("🛡️ Initializing comprehensive safety system...");

	// Reset all safety states
	safetyState.emergencyMode = false;
	state.safetyState.emergencyBrakeApplied = false;
	state.safetyState.passengerAlertLevel = 0;
	state.safetyState.maxAllowedGForce = state.maxGForceLimit;

	// Validate required elements exist
	const requiredElements = [
		'liveSpeed', 'statusIndicator', 'TrainRunningSound',
		'TrainStop', 'StopAmbience', 'gForceDisplay'
	];

	let missingElements = [];
	requiredElements.forEach(id => {
		if (!document.getElementById(id)) {
			missingElements.push(id);
		}
	});

	if (missingElements.length > 0) {
		console.warn(`⚠️ Missing safety system elements: ${missingElements.join(', ')}`);
	} else {
		console.log("✅ All safety system elements validated");
	}

	// Set up safety monitoring interval
	if (!window.safetyMonitorInterval) {
		window.safetyMonitorInterval = setInterval(monitorSafetyStatus, 100);
		console.log("✅ Safety monitoring system active");
	}

	console.log("🛡️ Safety system initialization complete");
	console.log("🚨 Emergency protocols ready - passenger safety is top priority");
}

export { activateEmergencyBraking, announceEmergency, activateEmergencyVisuals };
export { playEmergencyAudio, updateEmergencyStopDistance };
export { monitorSafetyStatus, updatePassengerAlertLevel };
export { isDecelerating, calculateExpectedDeceleration, clearEmergencyState };
export { testEmergencyBraking, initializeSafetySystem };