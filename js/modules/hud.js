// ====================================
// HUD DISPLAY & STATISTICS
// ====================================
import state from './state.js';
import { updateSpeedometer } from './speedometer.js';
import { formatTime, formatTimeHHMMSS, calculateDistance, formatDuration, formatDistance, formatDistanceShort, convertSpeed } from './utils.js';
import { DRIVING_STYLES } from './constants.js';
import { calculateWaypointAndStopTimes, calculateRealisticTravelTime, preCalculateJourney, reCalculateFromIndex, warmJourneyProfileCache } from './gforce.js';
import { updateWeatherCardData } from './weatherAPI.js';
import { reverseGeocodeAddress } from './net/geo.js';

// Speed smoothing for ETA
let speedBuffer = [];
const BUFFER_SIZE = 60; // 1 second @ 60fps
const marqueeContent = new WeakMap();

function setTextIfChanged(element, value) {
	if (element && element.textContent !== String(value)) element.textContent = value;
}

function updateStats(currentSpeed, nextStopDistance, timeToNextStop, timeToFinalDestination, distanceCovered,
	location, timeToNextWaypoint = 0, gForce = 0) {

	// Add speed to buffer for smoothing ETA calculations
	speedBuffer.push(currentSpeed);
	if (speedBuffer.length > BUFFER_SIZE) speedBuffer.shift();

	// Calculate smoothed speed for ETA calculation
	state.smoothedSpeedForETA = speedBuffer.reduce((a, b) => a + b, 0) / speedBuffer.length;

	if (state.startTime === null) { // start timer
		state.startTime = Date.now();
	}

	const duration = Date.now() - state.startTime;
	let formattedDuration = formatDuration(duration);

	if (currentSpeed == 0) {
		// Keep the timer running even at 0 speed, but if we haven't started yet, show placeholder
		if (duration < 1000) formattedDuration = "00:00:00";
	}
	setTextIfChanged(document.getElementById("duration"), formattedDuration);

	// Apply marquee effect to long location names
	applyMarqueeToElement("nextstop", location, 20);

	// Don't update nextStopDistance here - let updateRouteInfo handle it
	// This prevents the segment distance from overriding the proper route distance
	// document.getElementById("nextStopDistance").innerText =
	// 	isNaN(nextStopDistance) ? '-' : `${nextStopDistance.toFixed(2)} km`;

	if (currentSpeed === 0 && timeToNextStop === 0) {
		updateTimeDisplays(null, null, timeToFinalDestination,
			location && location !== '-' ? `At ${location}` : '-');
	}

	const finalDestEl = document.getElementById("finalDestinationTime");
	if (finalDestEl) {
		setTextIfChanged(finalDestEl,
			timeToFinalDestination === null || timeToFinalDestination === 0
				? (currentSpeed === 0 ? 'En route' : '-')
				: formatTimeHHMMSS(timeToFinalDestination));
	}

	setTextIfChanged(document.getElementById("distanceCovered"),
		isNaN(distanceCovered) ? '-' : formatDistance(distanceCovered, state.useImperialUnits));

	// DON'T call updateRouteInfo() here - it overrides the values we just set
	// The animation loop calls updateRouteInfo() separately
	// updateRouteInfo();

	// Update HUD elements
	updateHUD(currentSpeed, nextStopDistance, timeToNextStop, timeToFinalDestination, distanceCovered,
		location, timeToNextWaypoint, gForce);
}

// Update HUD elements with futuristic styling and animations
function updateHUD(currentSpeed, nextStopDistance, timeToNextStop, timeToFinalDestination, distanceCovered,
	location, timeToNextWaypoint = 0, gForce = 0) {

	// Update speed display
	const speedElement = document.querySelector('.speed-value');
	if (speedElement) {
		updateSpeedometer(currentSpeed);

		// Add speed lines animation based on speed
		const speedPanel = document.querySelector('.speed-panel');
		if (speedPanel) {
			if (currentSpeed > 10 && speedPanel.getAttribute('data-speed') !== 'active') {
				speedPanel.setAttribute('data-speed', 'active');
			} else if (currentSpeed <= 10 && speedPanel.hasAttribute('data-speed')) {
				speedPanel.removeAttribute('data-speed');
			}
		}
	}

	// The G-meter (value, dot, phase, comfort bar) is owned by gforce.js:updateGForceDisplay().

	// Update destination distance in timer ring — shows FINAL DESTINATION info
	const waypointDistanceElement = document.querySelector('.waypoint-distance');
	const waypointLabelElement = document.querySelector('.waypoint-label');

	if (waypointDistanceElement && waypointLabelElement) {
		// Always show final destination (not next stop/waypoint)
		setTextIfChanged(waypointLabelElement, "DESTINATION");
		// The actual distance is populated by updateRouteInfo()
	}

	// Update location coordinates (simulate GPS coordinates)
	// (Moved to autoAnimation.js for tight animation loop throttling)

	// Update vehicle condition (simulate based on distance travelled)
	updateVehicleCondition(distanceCovered);
}

// Update location display with reverse geocoding
function updateLocationDisplay() {
	const currentLocationElement = document.getElementById('currentLocation');
	if (!currentLocationElement) {
		console.log("❌ currentLocation element not found!");
		return;
	}

	// Get current vehicle position
	let lat, lng;

	// Try to get coordinates from current vehicle position
	if (typeof state.fractionalLat !== 'undefined' && typeof state.fractionalLng !== 'undefined' &&
		!isNaN(state.fractionalLat) && !isNaN(state.fractionalLng)) {
		lat = state.fractionalLat;
		lng = state.fractionalLng;
	} else if (typeof state.newLat !== 'undefined' && typeof state.newLng !== 'undefined' &&
		!isNaN(state.newLat) && !isNaN(state.newLng)) {
		lat = state.newLat;
		lng = state.newLng;
	} else {
		// Fallback to showing placeholder
		currentLocationElement.textContent = "Detecting...";
		return;
	}

	const now = Date.now();
	const timeSinceLastGeocode = now - state.lastReverseGeocodeTime;
	const speedKmh = Math.max(0, Number(state.currentDisplaySpeed || state.manualControlState?.currentSpeed || 0));
	const adaptiveGeocodeThrottleMs = speedKmh >= 80 ? 10 * 60 * 1000 : (speedKmh >= 20 ? 7 * 60 * 1000 : 4 * 60 * 1000);
	const adaptiveGeocodeDistanceKm = speedKmh >= 80 ? 25 : (speedKmh >= 20 ? 15 : 10);

	// Calculate distance from last geocoded position
	let distanceFromLastGeocode = 0;
	if (state.lastGeocodedPosition) {
		distanceFromLastGeocode = calculateDistance(
			{ lat: state.lastGeocodedPosition.lat, lng: state.lastGeocodedPosition.lng },
			{ lat: lat, lng: lng }
		);
	}

	// Check if a request is already in progress to prevent API spam
	if (typeof state.isGeocoding === 'undefined') state.isGeocoding = false;

	// Check if we need to make a new geocoding request (either time OR distance threshold)
	const shouldMakeRequest = !state.isGeocoding && (
		timeSinceLastGeocode >= Math.max(state.reverseGeocodeThrottleMs || 0, adaptiveGeocodeThrottleMs) ||
		!state.lastGeocodedPosition ||
		distanceFromLastGeocode >= Math.max(state.reverseGeocodeDistanceKm || 0, adaptiveGeocodeDistanceKm) ||
		(speedKmh < 1.0 && timeSinceLastGeocode >= 2 * 60 * 1000)
	);

	if (shouldMakeRequest) {
		// Preemptively set the throttle immediately to prevent race conditions at 60fps
		state.lastReverseGeocodeTime = now;
		state.isGeocoding = true;
		// Make reverse geocoding request with strict throttling
		reverseGeocode(lat, lng)
			.then(locationName => {
				state.isGeocoding = false;
				if (locationName && locationName !== "Unknown location") {
					state.currentLocationCache = locationName;
					currentLocationElement.textContent = locationName;
					state.lastGeocodedPosition = { lat, lng };
				} else {
					// Show nearby coordinates if no place name found
					const coordText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
					currentLocationElement.textContent = coordText;
				}
			})
			.catch(error => {
				state.isGeocoding = false;
				const coordText = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
				currentLocationElement.textContent = coordText;
			});
	} else {
		// Use cached location name
		currentLocationElement.textContent = state.currentLocationCache;
	}

	// Cheap when nothing changed: the card only refetches on weather-grid-cell change or staleness.
	updateWeatherCardData();
}

// Reverse geocoding: returns "Place, Region", "Unknown location", or null when unavailable.
async function reverseGeocode(lat, lng) {
	const data = await reverseGeocodeAddress(lat, lng, 14);
	if (!data) return null;
	const a = data.address;
	const placeName = a.village || a.town || a.city || a.municipality || a.county ||
		a.suburb || a.neighbourhood || a.hamlet || data.display_name?.split(',')[0];
	if (!placeName) return "Unknown location";
	const region = a.state || a.region;
	return region ? `${placeName}, ${region}` : placeName;
}

// Apply marquee effect to long waypoint names
function applyMarqueeToElement(elementId, text, maxLength = 25) {
	const element = document.getElementById(elementId);
	if (!element) return;
	const previous = marqueeContent.get(element);
	if (previous && previous.text === text && previous.maxLength === maxLength && element.textContent === (text || '-')) return;
	marqueeContent.set(element, { text, maxLength });

	if (text && text.length > maxLength) {
		// Check if element already has marquee-container class
		if (element.classList.contains('marquee-container')) {
			element.innerHTML = `<div class="marquee-content long-text">${text}</div>`;
		} else {
			element.innerHTML = `<div class="marquee-container"><div class="marquee-content long-text">${text}</div></div>`;
		}
		// Add location-specific marquee class for location elements
		if (elementId === 'nextstop') {
			element.classList.add('long-text');
		}
	} else {
		// Remove any marquee classes and set simple text
		element.classList.remove('long-text');
		element.textContent = text || '-';
	}
}

// Update vehicle condition based on distance travelled
function updateVehicleCondition(distanceCovered) {
	const conditionElement = document.getElementById('vehicleCondition');
	const vehicleElements = document.querySelectorAll('.vehicle-svg path, .vehicle-svg rect, .vehicle-svg circle');

	if (conditionElement) {
		// Simulate condition degradation based on distance (starts at 100%, decreases slowly)
		const maxDistance = 1000; // km
		const condition = Math.max(85, 100 - (distanceCovered / maxDistance) * 15);
		setTextIfChanged(conditionElement, `${Math.round(condition)}%`);

		// Change wireframe color based on condition
		const color = condition > 95 ? '#00ff88' : condition > 80 ? '#ffff44' : '#ff4444';
		vehicleElements.forEach(element => {
			element.style.stroke = color;
		});
	}
}

// Helper function to get the next stop name (skipping waypoints)
function getNextStopName() {
	if (!state.route || state.route.length === 0) {
		return "No route";
	}

	const currentIndex = (typeof state.index !== 'undefined') ? state.index : 0;

	// Start searching from current index + 1
	for (let i = currentIndex + 1; i < state.route.length; i++) {
		const point = state.route[i];
		const pointType = point.type || 'stop'; // Default to stop for backward compatibility

		if (pointType === 'stop') {
			const stopName = point.placeName.replace(/^\[Waypoint\]\s*/, '');
			return stopName;
		}
	}

	return "End of route";
}

function setAllDistanceElements(val) {
	const elements = ['nextStopDistance', 'nextStopTime', 'duration', 'nextstop', 'finalDestinationTime', 'distanceCovered', 'distanceToNext', 'timeToNext', 'timeToEnd'];
	elements.forEach(id => {
		const el = document.getElementById(id);
		if (el) el.innerText = val;
	});
}

// Real-time distance update function - uses route point types properly
function updateRouteInfo() {
	// Check if we have a valid route and animation is running
	if (!state.route || state.route.length === 0 || typeof state.index === 'undefined') {
		setAllDistanceElements('-');
		return;
	}

	const currentIndex = state.index;
	const currentProgress = typeof state.progress !== 'undefined' ? state.progress : 0;

	function getSegmentDistanceForHUD(i) {
		if (state.segmentSmoothDistances && state.segmentSmoothDistances[i] != null && state.segmentSmoothDistances[i] > 0) {
			return state.segmentSmoothDistances[i];
		}
		if (state.segmentDistances && state.segmentDistances[i] != null && state.segmentDistances[i] > 0) {
			return state.segmentDistances[i];
		}
		if (i >= 0 && i < state.route.length - 1) {
			return calculateDistance(state.route[i].latlng, state.route[i + 1].latlng);
		}
		return 0;
	}

	// Helper: calculate cumulative distance from current position to a target index
	function distanceToIndex(targetIdx) {
		if (targetIdx <= currentIndex || targetIdx >= state.route.length) return null;
		if (currentIndex + 1 >= state.route.length) return null;
		const currentSegDist = getSegmentDistanceForHUD(currentIndex);
		let dist = Math.max(0, currentSegDist * (1 - currentProgress));
		for (let i = currentIndex + 1; i < targetIdx; i++) {
			dist += getSegmentDistanceForHUD(i);
		}
		return dist;
	}

	let nextStopDistance = null;
	let nextStopName = null;
	let nextWaypointDistance = null;
	let nextWaypointName = null;
	let finalDestDistance = null;

	// Always compute distance to final destination
	const finalIdx = state.route.length - 1;
	if (currentIndex < finalIdx) {
		finalDestDistance = distanceToIndex(finalIdx);
	}

	// Journey percentage — derived from cumulative distance vs. full route length
	const progressEl = document.getElementById('journeyProgress');
	if (progressEl && state.totalRouteDistance > 0) {
		const pct = Math.min(100, (state.totalDistanceCovered / state.totalRouteDistance) * 100);
		progressEl.textContent = `${pct.toFixed(1)}%`;
	}

	// Scan ahead to find actual next stop (by type) and actual next waypoint (by type)
	for (let i = currentIndex + 1; i < state.route.length; i++) {
		const point = state.route[i];
		const pointType = point.type || 'stop';

		if (pointType === 'stop' && nextStopDistance === null) {
			nextStopDistance = distanceToIndex(i);
			nextStopName = point.placeName || `Stop ${i + 1}`;
		} else if (pointType === 'waypoint' && point.placeName && nextWaypointDistance === null) {
			nextWaypointDistance = distanceToIndex(i);
			nextWaypointName = point.placeName || `Waypoint ${i + 1}`;
		}

		if (nextStopDistance !== null && nextWaypointDistance !== null) break;
	}

	// If no stop found ahead, use final destination
	if (nextStopDistance === null && finalDestDistance !== null) {
		nextStopDistance = finalDestDistance;
		nextStopName = state.route[finalIdx].placeName || 'Final Destination';
	}

	// Waypoint distance: show distance to next named waypoint, or fall back to next stop distance
	if (nextWaypointDistance === null) {
		nextWaypointDistance = nextStopDistance;
		nextWaypointName = nextStopName;
	}

	// Calculate and update time estimates (3 separate values)
	calculateAndUpdateTimeEstimates(nextStopDistance, nextWaypointDistance, finalDestDistance);

	// Update distance displays in the HUD
	if (nextStopDistance !== null) {
		const nextStopDistEl = document.getElementById('nextStopDistance');
		if (nextStopDistEl) nextStopDistEl.innerText = formatDistance(nextStopDistance, state.useImperialUnits);

		const hudNextStopDistEl = document.getElementById('hudNextStopDistance');
		if (hudNextStopDistEl) hudNextStopDistEl.textContent = formatDistance(nextStopDistance, state.useImperialUnits);
	}

	// Timer ring shows FINAL DESTINATION distance (not waypoint)
	if (finalDestDistance !== null) {
		const nextWaypointDistEl = document.getElementById('nextWaypointDistance');
		if (nextWaypointDistEl) nextWaypointDistEl.innerText = formatDistanceShort(finalDestDistance, state.useImperialUnits);
	}

	// Update SVG progress circle & progress text based on journey percentage
	const pctNum = state.totalRouteDistance > 0
		? Math.min(100, (state.totalDistanceCovered / state.totalRouteDistance) * 100)
		: 0;
	const progressCircle = document.getElementById('waypointProgressCircle');
	if (progressCircle) {
		const circumference = 251.2;
		progressCircle.setAttribute('stroke-dashoffset', circumference * (1 - pctNum / 100));
	}
	const progressText = document.getElementById('waypointProgress');
	if (progressText) progressText.textContent = `${pctNum.toFixed(1)}%`;
}

// Calculate time estimates based on current speed and distances
function calculateAndUpdateTimeEstimates(nextStopDistance, nextWaypointDistance, finalDestDistance) {
	// Get current speed (try multiple sources)
	let currentSpeed = 0;

	if (typeof state.manualControlState !== 'undefined' && state.manualControlState.currentSpeed) {
		currentSpeed = state.manualControlState.currentSpeed;
	} else if (state.smoothedSpeedForETA > 0) {
		currentSpeed = state.smoothedSpeedForETA;
	} else {
		const speedElement = document.getElementById('liveSpeed') || document.querySelector('.speed-value');
		if (speedElement) {
			currentSpeed = parseFloat(speedElement.textContent) || 0;
		}
	}

	const maxSpeed = state.manualControlState.userDefinedMaxSpeed || 500;
	const accelRate = (state.accelGForceLimit || 0.10) * 9.81 * 3.6;
	const decelRate = (state.decelGForceLimit || 0.05) * 9.81 * 3.6;
	const isRailLike = state.currentRouteType === 'rail' || state.currentRouteType === 'hyperloop';

	if (isRailLike) {
		const timingObj = calculateWaypointAndStopTimes(state.index, state.progress, currentSpeed);
		updateTimeDisplays(
			timingObj.timeToNextStop,
			timingObj.timeToNextWaypoint,
			timingObj.timeToFinalDestination
		);
		return;
	}

	// Calculate time to next stop
	let nextStopTime = null;
	if (nextStopDistance !== null && nextStopDistance > 0) {
		nextStopTime = calculateRealisticTravelTime(nextStopDistance, currentSpeed, maxSpeed, accelRate, decelRate, 0);
	}

	// Calculate time to next waypoint
	let nextWaypointTime = null;
	if (nextWaypointDistance !== null && nextWaypointDistance > 0) {
		nextWaypointTime = calculateRealisticTravelTime(nextWaypointDistance, currentSpeed, maxSpeed, accelRate, decelRate, 0);
	}

	// Calculate time to final destination
	let finalDestTime = null;
	if (finalDestDistance !== null && finalDestDistance > 0) {
		finalDestTime = calculateRealisticTravelTime(finalDestDistance, currentSpeed, maxSpeed, accelRate, decelRate, 0);
	}

	// Update time displays with three separate values
	updateTimeDisplays(nextStopTime, nextWaypointTime, finalDestTime);
}

// NEW FUNCTION: Format seconds into HH:MM:SS
function formatTimeEstimate(totalSeconds) {
	if (totalSeconds === null || isNaN(totalSeconds) || !isFinite(totalSeconds)) return '-';

	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);

	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	} else if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	} else {
		return `${seconds}s`;
	}
}

// Update the DOM with time estimates — three separate values
function updateTimeDisplays(nextStopTimeSeconds, nextWaypointTimeSeconds, finalDestTimeSeconds, nextStopStatus = null) {
	const nextStopTimeText = nextStopStatus ?? formatTimeEstimate(nextStopTimeSeconds);
	const finalDestTimeText = formatTimeEstimate(finalDestTimeSeconds != null ? finalDestTimeSeconds : nextWaypointTimeSeconds);

	// Next stop time (location-panel ETA)
	const nextStopEl = document.getElementById('nextStopTime');
	setTextIfChanged(nextStopEl, nextStopTimeText);

	const timeToNextEl = document.getElementById('timeToNext');
	setTextIfChanged(timeToNextEl, nextStopTimeText);

	// Final destination time → goes into the timer-ring ETA
	const waypointETAEl = document.getElementById('waypointETA');
	setTextIfChanged(waypointETAEl, finalDestTimeText);

	// Flight monitor arrival estimate
	const arrivalEl = document.getElementById('flightMonitorArrival');
	if (arrivalEl && finalDestTimeSeconds != null && isFinite(finalDestTimeSeconds) && finalDestTimeSeconds > 0) {
		const arrivalDate = new Date(Date.now() + finalDestTimeSeconds * 1000);
		setTextIfChanged(arrivalEl, arrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
	}

	const timeToEndEl = document.getElementById('timeToEnd');
	setTextIfChanged(timeToEndEl, finalDestTimeText);
}

// ====================================
// FLIGHT MONITOR - Rotating info display
// ====================================
let flightMonitorInterval = null;
let flightMonitorSlideIndex = 0;

function startFlightMonitor() {
	if (flightMonitorInterval) return;
	flightMonitorSlideIndex = 0;
	updateFlightMonitorSlide();
	flightMonitorInterval = setInterval(() => {
		flightMonitorSlideIndex = (flightMonitorSlideIndex + 1) % 4;
		updateFlightMonitorSlide();
	}, 4000); // Rotate every 4 seconds
}

function stopFlightMonitor() {
	if (flightMonitorInterval) {
		clearInterval(flightMonitorInterval);
		flightMonitorInterval = null;
	}
}

function updateFlightMonitorSlide() {
	const slides = document.querySelectorAll('.flight-monitor-slide');
	if (!slides.length) return;
	slides.forEach((s, i) => {
		s.classList.toggle('active', i === flightMonitorSlideIndex);
	});
	// Always update live values
	const now = new Date();
	const localTimeEl = document.getElementById('flightMonitorLocalTime');
	if (localTimeEl) localTimeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	const dateEl = document.getElementById('flightMonitorDate');
	if (dateEl) dateEl.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
	// Departure time is set once when simulation starts (see setDepartureTime)
}

function setDepartureTime() {
	const depEl = document.getElementById('flightMonitorDeparture');
	if (depEl) depEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ====================================
// TIME CHART - Route timetable with pre-calculated physics estimates
// ====================================
const timeChartData = []; // [{name, type, estimatedArrival, estimatedDeparture, actualArrival, actualDeparture, stopDuration, status, ...}]
let journeyPreCalc = null; // Cached preCalculateJourney() result
let lastLiveUpdateTime = 0;
const LIVE_UPDATE_INTERVAL = 5000; // Re-estimate every 5 seconds during sim

function initTimeChart() {
	timeChartData.length = 0;
	journeyPreCalc = null;
	if (!state.route || state.route.length === 0) return;

	const maxSpeed = state.manualControlState.userDefinedMaxSpeed || state.manualControlState.maxSpeed || 500;
	const accelG = state.accelGForceLimit || 0.10;
	const decelG = state.decelGForceLimit || 0.05;
	const stationDelay = state.stationDelayTime || 24;

	// Pre-warm the server journey cache (background, used on subsequent openings)
	warmJourneyProfileCache(maxSpeed, accelG, decelG, stationDelay);

	// Run the physics-based pre-calculation (uses server cache if already warm)
	try {
		journeyPreCalc = preCalculateJourney(maxSpeed, accelG, decelG, stationDelay);
	} catch (error) {
		console.warn('Time chart pre-calculation failed, using fallback rows:', error?.message || error);
		journeyPreCalc = null;
	}

	if (!journeyPreCalc || !journeyPreCalc.timetable || journeyPreCalc.timetable.length === 0) {
		// Fallback: just populate names without estimates
		let cumulativeDistance = 0;
		let cumulativeTimeSec = 0;
		for (let i = 0; i < state.route.length; i++) {
			const pt = state.route[i];
			let distanceInterval = 0;
			if (i > 0) {
				distanceInterval = (state.segmentSmoothDistances && state.segmentSmoothDistances[i - 1] != null)
					? state.segmentSmoothDistances[i - 1]
					: calculateDistance(state.route[i - 1].latlng, state.route[i].latlng);
				cumulativeDistance += distanceInterval;
			}
			timeChartData.push({
				name: pt.placeName || `Point ${i + 1}`,
				type: pt.type || 'stop',
				estimatedArrival: null,
				estimatedDeparture: null,
				actualArrival: null,
				actualDeparture: null,
				stopDuration: null,
				peakSpeed: null,
				segmentTime: null,
				distance: cumulativeDistance,
				distanceInterval,
				cumulativeTimeFromOriginSec: cumulativeTimeSec,
				status: i === 0 ? 'departed' : 'upcoming'
			});
		}
	} else {
		// Populate from pre-calculated timetable
		for (let i = 0; i < journeyPreCalc.timetable.length; i++) {
			const tt = journeyPreCalc.timetable[i];
			timeChartData.push({
				name: tt.name,
				type: tt.type,
				estimatedArrival: tt.estimatedArrival,
				estimatedDeparture: tt.estimatedDeparture,
				actualArrival: null,
				actualDeparture: null,
				stopDuration: tt.stopDuration,
				peakSpeed: tt.peakSpeed,
				segmentTime: tt.segmentTime,
				distance: tt.cumulativeDistance,
				distanceInterval: tt.distanceInterval,
				cumulativeTimeFromOriginSec: tt.cumulativeTimeFromOriginSec,
				status: i === 0 ? 'departed' : 'upcoming'
			});
		}
	}

	// Origin: departed now
	if (timeChartData.length > 0) {
		timeChartData[0].actualDeparture = Date.now();
		timeChartData[0].status = 'departed';
	}

	renderTimeChart();
	return journeyPreCalc;
}

function recordArrival(routeIndex) {
	if (routeIndex < 0 || routeIndex >= timeChartData.length) return;
	const entry = timeChartData[routeIndex];
	if (!entry.actualArrival) {
		entry.actualArrival = Date.now();
		entry.status = 'arrived';
		renderTimeChart();
	}
}

function recordDeparture(routeIndex) {
	if (routeIndex < 0 || routeIndex >= timeChartData.length) return;
	const entry = timeChartData[routeIndex];
	entry.actualDeparture = Date.now();
	if (entry.actualArrival) {
		entry.stopDuration = entry.actualDeparture - entry.actualArrival;
	}
	entry.status = 'departed';
	renderTimeChart();
}

// Live-update: re-estimate upcoming stops from current position
function liveUpdateTimeChart(currentIndex, currentProgress, currentSpeed) {
	const now = Date.now();
	if (now - lastLiveUpdateTime < LIVE_UPDATE_INTERVAL) return;
	lastLiveUpdateTime = now;

	if (!state.route || currentIndex >= state.route.length - 1) return;

	const maxSpeed = state.manualControlState.userDefinedMaxSpeed || state.manualControlState.maxSpeed || 500;
	const accelG = state.accelGForceLimit || 0.10;
	const decelG = state.decelGForceLimit || 0.05;
	const stationDelay = state.stationDelayTime || 24;

	const updated = reCalculateFromIndex(currentIndex, currentProgress, currentSpeed, accelG, decelG, maxSpeed, stationDelay);
	if (!updated) return;

	let changed = false;
	for (const upd of updated) {
		const idx = upd.routeIndex;
		if (idx < 0 || idx >= timeChartData.length) continue;
		const entry = timeChartData[idx];
		// Only update upcoming/future entries
		if (entry.status === 'departed' || entry.status === 'arrived') continue;
		// Mark as live-updated (different from original estimate)
		entry.liveEstimatedArrival = upd.estimatedArrival;
		entry.liveEstimatedDeparture = upd.estimatedDeparture;
		changed = true;
	}

	if (changed) renderTimeChart();
}

/**
 * Schedule adherence against the timetable planned at departure.
 * Uses the live re-estimate for the next stop, else the delay recorded at the last arrival.
 * Returns { deltaSec, label, level } or null when no timetable is available.
 */
function getScheduleStatus() {
	if (!journeyPreCalc || timeChartData.length < 2) return null;
	let deltaMs = null;
	const now = Date.now();
	// Dwelling at a station: late if we're past the planned departure.
	const dwelling = timeChartData.findLast((e, i) => i > 0 && e.actualArrival && !e.actualDeparture);
	if (dwelling && dwelling.estimatedArrival) {
		deltaMs = dwelling.actualArrival - dwelling.estimatedArrival;
		if (dwelling.estimatedDeparture) deltaMs = Math.max(deltaMs, now - dwelling.estimatedDeparture);
	}
	const next = timeChartData.find((e, i) => i > 0 && e.type !== 'waypoint' && e.status === 'upcoming' && e.estimatedArrival);
	if (deltaMs === null && next && next.liveEstimatedArrival) deltaMs = next.liveEstimatedArrival - next.estimatedArrival;
	if (deltaMs === null) {
		for (let i = timeChartData.length - 1; i > 0; i--) {
			const e = timeChartData[i];
			if (e.actualArrival && e.estimatedArrival) { deltaMs = e.actualArrival - e.estimatedArrival; break; }
		}
	}
	const deltaSec = Math.round((deltaMs || 0) / 1000);
	const fmt = s => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);
	if (Math.abs(deltaSec) < 30) return { deltaSec, label: 'On time', level: 'ok' };
	if (deltaSec > 0) return { deltaSec, label: `${fmt(deltaSec)} late`, level: deltaSec >= 300 ? 'bad' : 'warn' };
	return { deltaSec, label: `${fmt(-deltaSec)} early`, level: 'early' };
}

function renderTimeChart() {
	const tbody = document.getElementById('timeChartBody');
	if (!tbody) return;
	if (timeChartData.length === 0) {
		tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;opacity:0.5;">No route loaded</td></tr>';
		return;
	}

	const fmtTime = (ts) => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
	const fmtDur = (sec) => {
		if (!sec && sec !== 0) return '—';
		const s = Math.round(typeof sec === 'number' && sec > 1000 ? sec / 1000 : sec);
		if (s < 0) return '—';
		const m = Math.floor(s / 60);
		const rem = s % 60;
		if (m >= 60) {
			const h = Math.floor(m / 60);
			const rm = m % 60;
			return `${h}h ${rm}m`;
		}
		return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
	};

	const statusBadge = (st) => {
		const colors = { upcoming: '#64748b', arrived: '#f59e0b', departed: '#10b981', passed: '#3b82f6' };
		const labels = { upcoming: 'UPCOMING', arrived: 'AT STATION', departed: 'DEPARTED', passed: 'PASSED' };
		return `<span style="color:${colors[st] || '#94a3b8'};font-weight:600;font-size:10px;">${labels[st] || st.toUpperCase()}</span>`;
	};

	// Determine arrival/departure display with color coding
	const arrivalCell = (d) => {
		if (d.actualArrival) {
			// Show actual time in green
			const diff = d.estimatedArrival ? (d.actualArrival - d.estimatedArrival) / 1000 : 0;
			const diffStr = Math.abs(diff) >= 5
				? ` <span style="font-size:9px;color:${diff > 0 ? '#ef4444' : '#22c55e'};">(${diff > 0 ? '+' : ''}${fmtDur(Math.abs(diff))})</span>`
				: '';
			return `<span style="color:#10b981;font-weight:600;">${fmtTime(d.actualArrival)}</span>${diffStr}`;
		}
		if (d.liveEstimatedArrival && d.estimatedArrival) {
			// Show live re-estimated in amber, original crossed out
			const diff = Math.abs(d.liveEstimatedArrival - d.estimatedArrival);
			if (diff > 3000) { // Only show if >3s difference
				return `<span style="color:#f59e0b;">${fmtTime(d.liveEstimatedArrival)}</span> <span style="text-decoration:line-through;opacity:0.4;font-size:9px;">${fmtTime(d.estimatedArrival)}</span>`;
			}
		}
		if (d.estimatedArrival) {
			return `<span style="color:#94a3b8;">${fmtTime(d.estimatedArrival)}</span>`;
		}
		return '—';
	};

	const departureCell = (d) => {
		if (d.actualDeparture) {
			return `<span style="color:#10b981;font-weight:600;">${fmtTime(d.actualDeparture)}</span>`;
		}
		if (d.liveEstimatedDeparture && d.estimatedDeparture) {
			const diff = Math.abs(d.liveEstimatedDeparture - d.estimatedDeparture);
			if (diff > 3000) {
				return `<span style="color:#f59e0b;">${fmtTime(d.liveEstimatedDeparture)}</span>`;
			}
		}
		if (d.estimatedDeparture) {
			return `<span style="color:#94a3b8;">${fmtTime(d.estimatedDeparture)}</span>`;
		}
		return '—';
	};

	const speedCell = (d) => {
		if (d.peakSpeed != null && d.peakSpeed > 0) {
			return `${Math.round(convertSpeed(d.peakSpeed, state.useImperialUnits))}`;
		}
		return '—';
	};

	const travelCell = (d) => {
		if (d.segmentTime != null && d.segmentTime > 0) {
			return fmtDur(d.segmentTime);
		}
		return '—';
	};

	const distanceIntervalCell = (d) => {
		if (d.distanceInterval != null && isFinite(d.distanceInterval)) {
			return formatDistance(d.distanceInterval, state.useImperialUnits);
		}
		return '—';
	};

	const cumulativeFromOriginCell = (d) => {
		if (d.cumulativeDistance != null && isFinite(d.cumulativeDistance)) {
			return formatDistance(d.cumulativeDistance, state.useImperialUnits);
		}
		return '—';
	};

	// Detect loop route: last timetable entry returns to the origin name
	const isLastLoop = timeChartData.length > 1 &&
		timeChartData[0].name.trim().toLowerCase() === timeChartData[timeChartData.length - 1].name.trim().toLowerCase();

	tbody.innerHTML = timeChartData.map((d, i) => {
		const isLast = i === timeChartData.length - 1;
		const nameDisplay = (isLast && isLastLoop)
			? `${d.name} <span style="color:#f59e0b;font-size:10px;font-weight:600;">(Return)</span>`
			: d.name;
		const typeDisplay = d.type === 'dummy' ? 'pass-thru' : d.type;
		return `
		<tr class="${d.status === 'arrived' ? 'time-chart-active' : ''} ${d.status === 'departed' && i > 0 ? 'time-chart-departed' : ''}">
			<td>${i + 1}</td>
			<td>${nameDisplay}</td>
			<td style="text-transform:capitalize;">${typeDisplay}</td>
			<td>${arrivalCell(d)}</td>
			<td>${departureCell(d)}</td>
			<td>${travelCell(d)}</td>
			<td>${distanceIntervalCell(d)}</td>
			<td>${cumulativeFromOriginCell(d)}</td>
			<td>${speedCell(d)}</td>
			<td>${statusBadge(d.status)}</td>
		</tr>
		`;
	}).join('');
}

function showTimeChart() {
	const dlg = document.getElementById('timeChartDialog');
	if (dlg) {
		// If chart data is empty (e.g. route loaded before sim starts), initialize on demand.
		if (timeChartData.length === 0 && state.route && state.route.length > 0) {
			initTimeChart();
		}
		renderTimeChart();
		dlg.style.display = 'flex';
	}
}

function hideTimeChart() {
	const dlg = document.getElementById('timeChartDialog');
	if (dlg) dlg.style.display = 'none';
}

// ──────────────────────────────────────────────────────────────────────────────
// ROAD-SPECIFIC HUD UPDATES
// Called once per animation frame in road/car mode from autoAnimation.js.
// ──────────────────────────────────────────────────────────────────────────────
function updateRoadHUD() {
	// Driving style badge (created once, updated in place)
	let badge = document.getElementById('drivingStyleBadge');
	if (!badge) {
		badge = document.createElement('div');
		badge.id = 'drivingStyleBadge';
		badge.className = 'driving-style-badge';
		const mapEl = document.getElementById('map');
		if (mapEl) mapEl.appendChild(badge);
	}
	const styleInfo = DRIVING_STYLES[state.drivingStyle] || DRIVING_STYLES.normal;
	badge.textContent = styleInfo.label;
	badge.dataset.style = state.drivingStyle;
}

export { updateStats, updateHUD, updateRoadHUD };
export { updateLocationDisplay, reverseGeocode };
export { updateVehicleCondition };
export { getNextStopName };
export { applyMarqueeToElement };
export { updateRouteInfo, calculateAndUpdateTimeEstimates };
export { startFlightMonitor, stopFlightMonitor, setDepartureTime };
export { initTimeChart, recordArrival, recordDeparture, liveUpdateTimeChart, showTimeChart, hideTimeChart, getScheduleStatus };