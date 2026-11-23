// ====================================
// VEHICLE RENDERING & TRAIN COACHES
// ====================================
import state from './state.js';
import { calculateRotationAngle } from './utils.js';
import { isCareerActive, getPassengersForCoach, getDotColor, getDotColorIndex, removeStationPlatforms, CAREER } from './careerMode.js';
import { getOnboardPassengers, stopPassengerTraffic } from './passengerTraffic.js';

function addMarker(lng, lat, iconPath) {
	let iconStyle = new ol.style.Style({
		image: new ol.style.Icon({
			anchor: [0.5, 1],
			src: iconPath
		})
	});

	let feature = new ol.Feature({
		geometry: new ol.geom.Point(ol.proj.fromLonLat([lng, lat]))
	});
	feature.setStyle(iconStyle);

	if (state.vectorSource) {
		state.vectorSource.addFeature(feature);
	}
}

function resetMap() {
	removeStationPlatforms();
	stopPassengerTraffic();
	state.route = [];
	if (state.vectorLayer) {
		state.vectorLayer.getSource().clear();
	}
	state.totalDistance = 0;
	// Clear locomotive trail to prevent memory leak between routes
	window.locomotiveTrail = [];
	const distanceDisplay = document.getElementById('distanceDisplay');
	if (distanceDisplay) distanceDisplay.innerText = `Total Distance: 0 km`;
}

function showSimulateDialog() {
	document.getElementById("simulateDialog").style.display = "block";
	toggleCoachSelection(); // Check if train is selected and show coach options
}

function closeSimulateDialog() {
	document.getElementById("simulateDialog").style.display = "none";
}

// Toggle coach selection visibility based on vehicle type
function toggleCoachSelection() {
	const transportMode = document.getElementById("transportMode").value;
	const coachSection = document.getElementById("coachSelectionSection");

	if (transportMode === "train") {
		coachSection.style.display = "block";
		updateCoachCount(); // Update preview
		updateTrainColors(); // Initialize color codes
	} else {
		coachSection.style.display = "none";
	}
}

// Update coach count display and preview
function updateCoachCount() {
	const slider = document.getElementById("coachCountSlider");
	const display = document.getElementById("coachCountDisplay");
	const preview = document.getElementById("coachPreview");

	const count = parseInt(slider.value);
	display.textContent = count;

	// Generate visual preview
	let previewText = "🚂"; // Locomotive
	for (let i = 1; i < count; i++) {
		if (i === count - 1 && count > 1) {
			previewText += "🚃"; // Caboose
		} else {
			previewText += "🚋"; // Passenger car
		}
	}
	preview.textContent = previewText;
}

// Update train color selections and display color codes
function updateTrainColors() {
	const locomotiveColorPicker = document.getElementById("locomotiveColorPicker");
	const coachColorPicker = document.getElementById("coachColorPicker");
	const locomotiveColorCode = document.getElementById("locomotiveColorCode");
	const coachColorCode = document.getElementById("coachColorCode");

	if (locomotiveColorPicker && locomotiveColorCode) {
		locomotiveColorCode.textContent = locomotiveColorPicker.value.toUpperCase();
	}

	if (coachColorPicker && coachColorCode) {
		coachColorCode.textContent = coachColorPicker.value.toUpperCase();
	}

	// Store colors globally for use during simulation
	if (locomotiveColorPicker && coachColorPicker) {
		window.trainColors = {
			locomotive: locomotiveColorPicker.value,
			coach: coachColorPicker.value
		};

		// Clear style cache so new colors take effect
		clearStyleCache();

		// Update existing coach colors if train is currently active
		refreshTrainCoachColors();
	}
}

// Refresh the colors of existing train coaches
function refreshTrainCoachColors() {
	if (state.activeVehicleMode !== 'train') return;

	// Update main locomotive feature if it exists separately
	if (state.movingFeature) {
		const currentAngle = extractRotationDegrees(state.movingFeature.getStyle());
		state.movingFeature.setStyle(getTransportIcon('train', currentAngle, 'locomotive'));
	}

	if (!state.trainCoaches || state.trainCoaches.length === 0) {
		return; // No active train coaches to update
	}

	// Update each coach with new colors
	for (let i = 0; i < state.trainCoaches.length; i++) {
		let coachType;
		if (i === 0) {
			coachType = 'locomotive';
		} else if (i === state.trainCoaches.length - 1 && state.trainCoaches.length > 1) {
			coachType = 'caboose';
		} else {
			coachType = 'passenger';
		}

		// Get current style to preserve rotation
		const currentAngle = extractRotationDegrees(state.trainCoaches[i].getStyle());

		// Apply new style with updated colors
		state.trainCoaches[i].setStyle(getTransportIcon('train', currentAngle, coachType));
	}
}



// Drag and Drop Functionality
let isDragging = false;
let dragOffset = {
	x: 0,
	y: 0
};

// Render-threshold state (does not affect physics/geometric positions)
let _coachRenderFrame = 0;
const _coachStyleState = [];

function initializeDragDrop() {
	const panel = document.getElementById('manualControlPanel');
	const header = panel.querySelector('.dashboard-header');

	if (header.dataset.dragInitialized) return;
	header.dataset.dragInitialized = 'true';
	header.addEventListener('mousedown', startDrag);
	document.addEventListener('mousemove', drag);
	document.addEventListener('mouseup', stopDrag);

	// Prevent dragging when interacting with window controls
	const windowControls = panel.querySelector('.window-controls');
	windowControls.addEventListener('mousedown', function (e) {
		e.stopPropagation();
	});
}

function startDrag(e) {
	const panel = document.getElementById('manualControlPanel');
	if (panel.classList.contains('minimized')) return;

	// Don't drag if clicking on window controls
	if (e.target.classList.contains('window-btn')) {
		return;
	}

	state.isDragging = true;
	const rect = panel.getBoundingClientRect();
	state.dragOffset.x = e.clientX - rect.left;
	state.dragOffset.y = e.clientY - rect.top;

	panel.style.cursor = 'grabbing';
	document.body.style.userSelect = 'none';

	// Disable resize during drag
	panel.style.resize = 'none';
}

function drag(e) {
	if (!state.isDragging) return;

	const panel = document.getElementById('manualControlPanel');
	const x = e.clientX - state.dragOffset.x;
	const y = e.clientY - state.dragOffset.y;

	// Keep panel within viewport bounds
	const maxX = window.innerWidth - panel.offsetWidth;
	const maxY = window.innerHeight - panel.offsetHeight;

	const constrainedX = Math.max(0, Math.min(x, maxX));
	const constrainedY = Math.max(0, Math.min(y, maxY));

	panel.style.left = constrainedX + 'px';
	panel.style.top = constrainedY + 'px';
	panel.style.right = 'auto'; // Remove right positioning when dragging
	panel.style.bottom = 'auto'; // Remove bottom positioning when dragging
}

function stopDrag() {
	if (!state.isDragging) return;

	state.isDragging = false;
	const panel = document.getElementById('manualControlPanel');
	panel.style.cursor = '';
	document.body.style.userSelect = '';

	panel.style.resize = 'none';
}


// Style cache to avoid creating new Style/Icon objects every frame
const _styleCache = new Map();
const MAX_STYLE_CACHE = 500;
let _zoomScaleListenerBound = false;

function _getCachedStyle(key, factory) {
	if (_styleCache.has(key)) return _styleCache.get(key);
	const style = factory();
	if (_styleCache.size > MAX_STYLE_CACHE) {
		const firstKey = _styleCache.keys().next().value;
		_styleCache.delete(firstKey);
	}
	_styleCache.set(key, style);
	return style;
}

// Invalidate cache when train colors change
function clearStyleCache() {
	_styleCache.clear();
}

function getVehicleZoomScale(currentZoom) {
	// Use a bounded curve so close zooms stay readable without exploding after auto-zoom.
	const minZoom = 5;
	const maxZoom = 16;
	const minScale = 0.02;
	const maxScale = 0.048;
	const normalizedZoom = Math.max(0, Math.min(1, (currentZoom - minZoom) / (maxZoom - minZoom)));
	const easedZoom = normalizedZoom * normalizedZoom * (3 - 2 * normalizedZoom);
	return minScale + (maxScale - minScale) * easedZoom;
}

function extractRotationDegrees(style) {
	const styleList = Array.isArray(style) ? style : [style];
	for (const entry of styleList) {
		const image = entry && entry.getImage ? entry.getImage() : null;
		if (image) {
			// All vehicle icons are stored as (bearing - 90) * π/180 radians.
			// Add +90° when reading back so the returned value is the raw geographic
			// bearing — which getTransportIcon expects as its rotationAngle argument.
			return (image.getRotation() || 0) * (180 / Math.PI) + 90;
		}
	}
	return 0;
}

function refreshActiveVehicleStyles() {
	if (!state.trainCoaches || state.trainCoaches.length === 0) {
		return;
	}
	if (state.activeVehicleMode !== 'train') {
		const vehicle = state.trainCoaches[0];
		vehicle.setStyle(getTransportIcon(state.activeVehicleMode, extractRotationDegrees(vehicle.getStyle())));
		return;
	}
	for (let i = 0; i < _coachStyleState.length; i++) _coachStyleState[i] = null;

	for (let i = 0; i < state.trainCoaches.length; i++) {
		let coachType = 'passenger';
		if (i === 0) {
			coachType = 'locomotive';
		} else if (i === state.trainCoaches.length - 1 && state.trainCoaches.length > 1) {
			coachType = 'caboose';
		}

		state.trainCoaches[i].setStyle(getTransportIcon('train', extractRotationDegrees(state.trainCoaches[i].getStyle()), coachType, i));
	}
}

function ensureVehicleZoomSync() {
	if (_zoomScaleListenerBound || !state.map) {
		return;
	}

	const view = state.map.getView();
	if (!view) {
		return;
	}

	view.on('change:resolution', () => {
		if (!state.trainCoaches || state.trainCoaches.length === 0) {
			return;
		}

		refreshActiveVehicleStyles();
		if (state.activeVehicleMode === 'train') {
			const locomotive = state.trainCoaches[0];
			updateTrainCoaches('train', locomotive.getGeometry().getCoordinates(), extractRotationDegrees(locomotive.getStyle()));
		}
		state.map.render();
	});

	_zoomScaleListenerBound = true;
}

// ─── Mini-Metro Canvas Coach Renderer ───────────────────────────────────────
const CANVAS_W = 100;
const CANVAS_H = 32;
const DOT_RADIUS = 3.5;
const DOT_COLS = 10;
const DOT_ROWS = 3;
const DOT_PAD_X = 7;
const DOT_PAD_Y = 5;
const DOT_STEP_X = (CANVAS_W - DOT_PAD_X * 2) / DOT_COLS;
const DOT_STEP_Y = (CANVAS_H - DOT_PAD_Y * 2) / DOT_ROWS;
const BODY_COLORS = { locomotive: '#2a3a4a', passenger: '#1e2d3d', caboose: '#1e2d3d' };
const BODY_BORDER = { locomotive: '#5eead4', passenger: '#94a3b8', caboose: '#94a3b8' };

// Module-level canvas cache: key = coachType + 8-bucket colour-segment signature.
// Two coaches with identical type and per-bucket passenger counts produce the
// same pixels — no need to redraw.
const _coachCanvasCache = new Map();

function renderPassengerCoachCanvas(coachType, coachIndex, passengers = getPassengersForCoach(coachIndex), transparent = false) {
	const capacity = CAREER.MAX_PAX_PER_COACH;

	// Build 8-bucket colour signature (matches getTransportIcon careerKey)
	const cc = new Array(8).fill(0);
	for (const p of passengers) cc[getDotColorIndex(p.remainingKm)]++;
	const canvasKey = `${transparent ? 'glass' : 'career'}-${coachType}-${passengers.length}-${cc.join(',')}`;
	if (_coachCanvasCache.has(canvasKey)) return _coachCanvasCache.get(canvasKey);

	// Prevent unbounded growth (> 300 unique states is extremely unlikely in practice)
	if (_coachCanvasCache.size > 300) _coachCanvasCache.clear();

	const canvas = document.createElement('canvas');
	canvas.width = CANVAS_W;
	canvas.height = CANVAS_H;
	const ctx = canvas.getContext('2d');

	// Body
	const r = 6;
	ctx.beginPath();
	ctx.roundRect(1, 1, CANVAS_W - 2, CANVAS_H - 2, r);
	ctx.fillStyle = transparent ? 'rgba(25, 43, 55, 0.30)' : (BODY_COLORS[coachType] || BODY_COLORS.passenger);
	ctx.fill();
	ctx.strokeStyle = BODY_BORDER[coachType] || BODY_BORDER.passenger;
	ctx.lineWidth = coachType === 'locomotive' ? 2 : 1.2;
	ctx.stroke();

	// Locomotive accent stripe
	if (coachType === 'locomotive') {
		ctx.fillStyle = '#5eead4';
		ctx.fillRect(3, CANVAS_H - 5, CANVAS_W - 6, 2);
	}

	// Passenger dots
	for (let slot = 0; slot < capacity; slot++) {
		const col = slot % DOT_COLS;
		const row = Math.floor(slot / DOT_COLS);
		const cx = DOT_PAD_X + col * DOT_STEP_X + DOT_STEP_X / 2;
		const cy = DOT_PAD_Y + row * DOT_STEP_Y + DOT_STEP_Y / 2;

		ctx.beginPath();
		ctx.arc(cx, cy, DOT_RADIUS, 0, Math.PI * 2);

		if (slot < passengers.length) {
			ctx.fillStyle = getDotColor(passengers[slot].remainingKm);
			ctx.fill();
		} else {
			ctx.fillStyle = 'rgba(255,255,255,0.08)';
			ctx.fill();
		}
	}

	_coachCanvasCache.set(canvasKey, canvas);
	return canvas;
}

function applyTrainZIndex(styleOrStyles, coachIndex = 0) {
	if (styleOrStyles == null) return styleOrStyles;
	const zIndex = 300 - coachIndex;
	if (Array.isArray(styleOrStyles)) {
		for (const style of styleOrStyles) {
			if (style && typeof style.setZIndex === 'function') style.setZIndex(zIndex);
		}
		return styleOrStyles;
	}
	if (typeof styleOrStyles.setZIndex === 'function') {
		styleOrStyles.setZIndex(zIndex);
	}
	return styleOrStyles;
}

function getTransportIcon(mode, rotationAngle = 0, coachType = 'locomotive', coachIndex = 0) {
	let icons = {
		car: 'assets/images/car.png',
		train: 'assets/images/train.png',
		flight: 'assets/images/airplane.png',
		ship: 'assets/images/ship.png'
	};

	if (!icons[mode]) {
		console.warn(`⚠️ No icon found for mode: ${mode}, using car.png as fallback`);
		icons[mode] = 'assets/images/car.png';
	}

	const currentZoom = state.map ? state.map.getView().getZoom() : 10;
	const baseSizeMultiplier = state.vehicleSizeMultiplier || 1.0;
	const baseZoomScale = getVehicleZoomScale(currentZoom);
	const zoomScale = baseZoomScale * baseSizeMultiplier;

	const roundedAngle = Math.round(rotationAngle);
	const roundedZoom = Math.round(currentZoom * 10);
	const roundedSizeMultiplier = Math.round(baseSizeMultiplier * 100);
	const trainColors = window.trainColors || { locomotive: '#A0FF61', coach: '#FFDB57' };
	const cacheKey = `${mode}-${roundedAngle}-${coachType}-${trainColors.locomotive}-${trainColors.coach}-z${roundedZoom}-s${roundedSizeMultiplier}`;

	if (mode === 'train' && isCareerActive()) {
		const passengers = getPassengersForCoach(coachIndex);
		const kc = new Array(8).fill(0);
		for (const p of passengers) kc[getDotColorIndex(p.remainingKm)]++;
		const careerKey = `career-${coachType}-${coachIndex}-${kc.join(',')}-${roundedAngle}-z${roundedZoom}-s${roundedSizeMultiplier}`;

		return _getCachedStyle(careerKey, () => applyTrainZIndex(new ol.style.Style({
			image: new ol.style.Icon({
				img: renderPassengerCoachCanvas(coachType, coachIndex),
				imgSize: [CANVAS_W, CANVAS_H],
				scale: zoomScale * 12,
				rotation: (rotationAngle - 90) * (Math.PI / 180),
				rotateWithView: true
			})
		}), coachIndex));
	}

	if (mode === 'train' && state.coachType === 'transparent' && coachIndex > 0) {
		const allPassengers = getOnboardPassengers();
		const capacity = CAREER.MAX_PAX_PER_COACH;
		const passengers = allPassengers.slice((coachIndex - 1) * capacity, coachIndex * capacity);
		const buckets = new Array(8).fill(0);
		for (const passenger of passengers) buckets[getDotColorIndex(passenger.remainingKm)]++;
		const glassKey = `glass-${coachType}-${coachIndex}-${buckets.join(',')}-${roundedAngle}-z${roundedZoom}-s${roundedSizeMultiplier}`;
		return _getCachedStyle(glassKey, () => applyTrainZIndex(new ol.style.Style({
			image: new ol.style.Icon({
				img: renderPassengerCoachCanvas(coachType, coachIndex, passengers, true),
				imgSize: [CANVAS_W, CANVAS_H],
				scale: zoomScale * 12,
				rotation: (rotationAngle - 90) * (Math.PI / 180),
				rotateWithView: true
			})
		}), coachIndex));
	}

	return _getCachedStyle(cacheKey, () => {
		if (mode === 'train') {
			const coachStyle = {
				scale: zoomScale,
				rotation: (rotationAngle - 90) * (Math.PI / 180)
			};

			if (coachType === 'locomotive') {
				return applyTrainZIndex(new ol.style.Style({
					image: new ol.style.Icon({
						src: icons[mode],
						scale: coachStyle.scale,
						rotation: coachStyle.rotation,
						color: trainColors.locomotive,
						rotateWithView: true
					})
				}), coachIndex);
			}

			if (coachType === 'passenger') {
				return applyTrainZIndex([
					new ol.style.Style({
						image: new ol.style.Icon({
							src: icons[mode],
							scale: coachStyle.scale * 1.05,
							rotation: coachStyle.rotation,
							opacity: 0.3,
							color: '#000000',
							rotateWithView: true
						})
					}),
					new ol.style.Style({
						image: new ol.style.Icon({
							src: icons[mode],
							scale: coachStyle.scale,
							rotation: coachStyle.rotation,
							color: trainColors.coach,
							rotateWithView: true
						})
					})
				], coachIndex);
			}

			const cabooseColor = trainColors.coach;
			return applyTrainZIndex([
				new ol.style.Style({
					image: new ol.style.Icon({
						src: icons[mode],
						scale: coachStyle.scale * 1.05,
						rotation: coachStyle.rotation,
						opacity: 0.3,
						color: '#000000',
						rotateWithView: true
					})
				}),
				new ol.style.Style({
					image: new ol.style.Icon({
						src: icons[mode],
						scale: coachStyle.scale * 0.9,
						rotation: coachStyle.rotation,
						color: cabooseColor,
						rotateWithView: true
					})
				})
			], coachIndex);
		}

		return new ol.style.Style({
			image: new ol.style.Icon({
				src: icons[mode],
				scale: mode === 'flight' ? 0.06 : 0.05,
				rotation: (rotationAngle - 90) * (Math.PI / 180),
				rotateWithView: true
			})
		});
	});
}

function seedInitialLocoTrail(startCoords, initialAngle, coachSeparationMeters, coachCount) {
	const angleRad = initialAngle * (Math.PI / 180);
	const { lengths, offsets } = getCoachLayout(Math.max(1, coachCount));
	const step = Math.max(0.05, lengths[0] / 16);
	const totalDistance = Math.max(offsets[offsets.length - 1] + lengths[lengths.length - 1], coachSeparationMeters, step);

	window.locomotiveTrail = [];
	window.locomotiveCumulativeDistance = 0;

	for (let d = totalDistance; d >= 0; d -= step) {
		const x = startCoords[0] - Math.sin(angleRad) * d;
		const y = startCoords[1] - Math.cos(angleRad) * d;
		window.locomotiveTrail.push({
			coords: [x, y],
			angle: initialAngle,
			cumDist: window.locomotiveCumulativeDistance
		});
		window.locomotiveCumulativeDistance += step;
	}

	if (!window.locomotiveTrail.length) {
		window.locomotiveTrail.push({
			coords: [...startCoords],
			angle: initialAngle,
			cumDist: 0
		});
		window.locomotiveCumulativeDistance = 0;
	}
}

function initializeTrainCoaches(mode, startCoords, initialAngle, coachCount = 3, useVectorSource = true) {
	state.activeVehicleMode = mode;
	ensureVehicleZoomSync();

	// Clamp coach count to safe bounds
	coachCount = Math.max(1, Math.min(coachCount, 30));
	console.log("🚂 initializeTrainCoaches called with coachCount:", coachCount);

	// Clear existing coaches and couplings
	state.trainCoaches.forEach(coach => {
		if (coach && useVectorSource && state.vectorSource) {
			state.vectorSource.removeFeature(coach);
		}
	});
	state.trainCouplings.forEach(coupling => {
		if (coupling && useVectorSource && state.vectorSource) {
			state.vectorSource.removeFeature(coupling);
		}
	});
	state.trainCoaches = [];
	state.trainCouplings = [];
	state.coachPositionHistory = [];
	window.coachSmoothedPositions = []; // Reset so new coach count starts fresh
	window._forceCoachSnapFrames = 240;
	for (let i = 0; i < _coachStyleState.length; i++) _coachStyleState[i] = null;
	state.totalCoachCount = coachCount;
	state.visibleCoachCount = coachCount;  // All coaches visible from the start

	// No movement history needed for fixed distance system

	if (mode === 'train') {
		// Use the same separation model as runtime updates to prevent startup side-join.
		const FIXED_COACH_DISTANCE = getCoachSeparationMeters();
		const { offsets: coachOffsets } = getCoachLayout(coachCount);

		// Generate coach types based on count
		const coachTypes = [];
		for (let i = 0; i < coachCount; i++) {
			if (i === 0) {
				coachTypes.push('locomotive');
			} else if (i === coachCount - 1 && coachCount > 1) {
				coachTypes.push('caboose');
			} else {
				coachTypes.push('passenger');
			}
		}

		for (let i = 0; i < coachCount; i++) {
			// Calculate position for each coach (behind the previous one)
			let coachCoords = [...startCoords];

			const angleRad = initialAngle * (Math.PI / 180);
			const fixedDistance = coachOffsets[i];
			// Correct Cartesian math for bearings: X = sin(B)*d, Y = cos(B)*d
			// We subtract to position coaches BEHIND the locomotive
			coachCoords[0] -= Math.sin(angleRad) * fixedDistance;
			coachCoords[1] -= Math.cos(angleRad) * fixedDistance;

			const coachFeature = new ol.Feature({
				geometry: new ol.geom.Point(coachCoords)
			});

			// Use different coach types for visual variety
			const coachType = coachTypes[i];
			const coachStyle = getTransportIcon('train', initialAngle, coachType, i);

			console.log(`🚂 Creating coach ${i} of type ${coachType} at coords:`, coachCoords);

			coachFeature.setStyle(coachStyle);

			// Add to trainCoaches array
			state.trainCoaches.push(coachFeature);

			// Add all coaches to vectorSource immediately
			if (useVectorSource && state.vectorSource) {
				state.vectorSource.addFeature(coachFeature);
			}
		}

		// Create initial coupling lines for visual train connection (don't add to vectorSource in manual mode)
		updateTrainCouplings(useVectorSource);

		// Seed a stable initial trail so first animation frames preserve spacing.
		seedInitialLocoTrail(startCoords, initialAngle, FIXED_COACH_DISTANCE, coachCount);
		window.coachSmoothedPositions = state.trainCoaches.map((coach) => {
			const c = coach.getGeometry().getCoordinates();
			return { x: c[0], y: c[1], angle: initialAngle };
		});

		// One immediate sync avoids occasional startup overlap before trail growth.
		updateTrainCoaches('train', startCoords, initialAngle);

		console.log(`✅ Created ${state.trainCoaches.length} train coaches (requested: ${coachCount})`);

		// Set the first coach as the main movingFeature for compatibility
		state.movingFeature = state.trainCoaches[0];
	} else {
		// For non-train modes, create single vehicle
		const singleFeature = new ol.Feature({
			geometry: new ol.geom.Point(startCoords)
		});

		singleFeature.setStyle(getTransportIcon(mode, initialAngle));

		// Add to trainCoaches array
		state.trainCoaches = [singleFeature];
		state.movingFeature = singleFeature;

		// Add to vectorSource if requested (for automatic mode)
		if (useVectorSource && state.vectorSource) {
			state.vectorSource.addFeature(singleFeature);
		}

		console.log(`✅ Created single vehicle for mode: ${mode}`);
	}
}

function updateTrainCoaches(mode, newCoords, newAngle) {
	if (mode !== 'train' || state.trainCoaches.length === 0) {
		if (state.movingFeature) {
			state.movingFeature.setGeometry(new ol.geom.Point(newCoords));
			state.movingFeature.setStyle(getTransportIcon(mode, newAngle));
		}
		return;
	}

	const resolution = state.map.getView().getResolution();
	const COACH_SEPARATION_METERS = getCoachSeparationMeters();
	const currentZoom = state.map.getView().getZoom();
	const zoomBucket = Math.round((currentZoom || 0) * 10);
	const speedKmh = Math.max(0, Number(state.currentDisplaySpeed || state.manualControlState?.currentSpeed || 0));
	const forceSnap = (window._forceCoachSnapFrames || 0) > 0;
	if (forceSnap) window._forceCoachSnapFrames = Math.max(0, (window._forceCoachSnapFrames || 0) - 1);
	_coachRenderFrame++;

	if (!window.locomotiveTrail) {
		window.locomotiveTrail = [];
		window.locomotiveCumulativeDistance = 0;
	}
	if (!window.coachSmoothedPositions) {
		window.coachSmoothedPositions = [];
	}

	const lastTrailPos = window.locomotiveTrail.length > 0
		? window.locomotiveTrail[window.locomotiveTrail.length - 1]
		: null;

	let distFromLast = 0;
	if (lastTrailPos) {
		const dx = newCoords[0] - lastTrailPos.coords[0];
		const dy = newCoords[1] - lastTrailPos.coords[1];
		distFromLast = Math.sqrt(dx * dx + dy * dy);
	}

	// Cap trail spacing to at most 30% of coach separation so interpolation
	// has enough points to find the correct geographic position at any zoom level.
	const MIN_TRAIL_SPACING = Math.min(resolution * 0.5, COACH_SEPARATION_METERS * 0.3);
	if (!lastTrailPos || distFromLast > MIN_TRAIL_SPACING) {
		window.locomotiveCumulativeDistance += distFromLast;
		window.locomotiveTrail.push({
			coords: [...newCoords],
			angle: newAngle,
			cumDist: window.locomotiveCumulativeDistance
		});
		if (window.locomotiveTrail.length > 3000) {
			window.locomotiveTrail.splice(0, window.locomotiveTrail.length - 3000);
		}
	}

	const coachTypes = [];
	for (let i = 0; i < state.trainCoaches.length; i++) {
		if (i === 0) coachTypes.push('locomotive');
		else if (i === state.trainCoaches.length - 1 && state.trainCoaches.length > 1) coachTypes.push('caboose');
		else coachTypes.push('passenger');
	}

	const { lengths: coachLengths, offsets: coachOffsets } = getCoachLayout(state.trainCoaches.length);
	const lastIndex = state.trainCoaches.length - 1;
	const requiredTrailDistance = coachOffsets[lastIndex] + coachLengths[lastIndex] * BOGIE_OFFSET_RATIO;
	const hasSufficientTrail = window.locomotiveTrail.length > 2 && window.locomotiveCumulativeDistance >= requiredTrailDistance;
	const trailHead = window.locomotiveCumulativeDistance;
	const trailAt = (distanceBehind) => findPositionInTrailByCumulativeDist(window.locomotiveTrail, trailHead, distanceBehind);
	for (let i = 0; i < state.trainCoaches.length; i++) {
		let rawCoords;
		let rawAngle;
		const bogieOffset = coachLengths[i] * BOGIE_OFFSET_RATIO;

		if (i === 0) {
			rawCoords = [...newCoords];
			rawAngle = newAngle;
			// The locomotive body points from its rear bogie (on the track behind it) to its nose,
			// so it swings into curves gradually instead of snapping to each segment's heading.
			const rearBogie = !forceSnap && hasSufficientTrail ? trailAt(bogieOffset) : null;
			if (rearBogie && Math.hypot(newCoords[0] - rearBogie.coords[0], newCoords[1] - rearBogie.coords[1]) > bogieOffset * 0.5) {
				rawAngle = bearingBetween(rearBogie.coords, newCoords);
			}
		} else if (!forceSnap && hasSufficientTrail) {
			// Each coach rides on two bogies on the track; its body is the chord between them.
			const front = trailAt(coachOffsets[i] - bogieOffset);
			const rear = trailAt(coachOffsets[i] + bogieOffset);
			if (front && rear) {
				rawCoords = [(front.coords[0] + rear.coords[0]) / 2, (front.coords[1] + rear.coords[1]) / 2];
				rawAngle = Math.hypot(front.coords[0] - rear.coords[0], front.coords[1] - rear.coords[1]) > 1e-6
					? bearingBetween(rear.coords, front.coords) : front.angle;
			} else {
				const angleRad = newAngle * (Math.PI / 180);
				rawCoords = [
					newCoords[0] - Math.sin(angleRad) * coachOffsets[i],
					newCoords[1] - Math.cos(angleRad) * coachOffsets[i]
				];
				rawAngle = newAngle;
			}
		} else {
			const angleRad = newAngle * (Math.PI / 180);
			rawCoords = [
				newCoords[0] - Math.sin(angleRad) * coachOffsets[i],
				newCoords[1] - Math.cos(angleRad) * coachOffsets[i]
			];
			rawAngle = newAngle;
		}

		if (!window.coachSmoothedPositions[i]) {
			window.coachSmoothedPositions[i] = { x: rawCoords[0], y: rawCoords[1], angle: rawAngle };
		}

		const prev = window.coachSmoothedPositions[i];
		const smoothX = rawCoords[0];
		const smoothY = rawCoords[1];
		const smoothAngle = ((rawAngle % 360) + 360) % 360;

		prev.x = smoothX;
		prev.y = smoothY;
		prev.angle = smoothAngle;

		const coachCoords = [smoothX, smoothY];
		const coachType = coachTypes[i] || 'locomotive';

		const currentGeometry = state.trainCoaches[i].getGeometry();
		if (currentGeometry) currentGeometry.setCoordinates(coachCoords);
		else state.trainCoaches[i].setGeometry(new ol.geom.Point(coachCoords));

		// Style updates are expensive; only refresh when visual state changed enough.
		const roundedAngle = Math.round(smoothAngle * 2) / 2; // 0.5-degree bucket
		let passengerSignature = '';
		if (isCareerActive()) {
			const passengers = getPassengersForCoach(i);
			if (passengers && passengers.length) {
				const buckets = new Array(8).fill(0);
				for (const p of passengers) buckets[getDotColorIndex(p.remainingKm)]++;
				passengerSignature = `${passengers.length}:${buckets.join(',')}`;
			} else {
				passengerSignature = '0:';
			}
		} else if (state.coachType === 'transparent' && i > 0) {
			const capacity = CAREER.MAX_PAX_PER_COACH;
			const passengers = getOnboardPassengers().slice((i - 1) * capacity, i * capacity);
			const buckets = new Array(8).fill(0);
			for (const passenger of passengers) buckets[getDotColorIndex(passenger.remainingKm)]++;
			passengerSignature = `${passengers.length}:${buckets.join(',')}`;
		}

		const prevStyleState = _coachStyleState[i];
		const shouldRefreshStyle = !prevStyleState ||
			prevStyleState.zoomBucket !== zoomBucket ||
			Math.abs(prevStyleState.angle - roundedAngle) >= 1.0 ||
			prevStyleState.coachType !== coachType ||
			prevStyleState.passengerSignature !== passengerSignature;

		if (shouldRefreshStyle) {
			state.trainCoaches[i].setStyle(getTransportIcon('train', roundedAngle, coachType, i));
			_coachStyleState[i] = {
				zoomBucket,
				angle: roundedAngle,
				coachType,
				passengerSignature
			};
		}
	}

	// Couplings are visually negligible at far zoom. Rebuild adaptively.
	const couplingInterval = currentZoom < 9 ? 6 : (speedKmh < 5 ? 3 : 1);
	if (_coachRenderFrame % couplingInterval === 0) {
		updateTrainCouplings();
	}
}

function realignTrainCoachesInstant(bearingOverride = null) {
	if (state.activeVehicleMode !== 'train' || !state.trainCoaches || state.trainCoaches.length === 0) return;

	const locoGeom = state.trainCoaches[0].getGeometry();
	if (!locoGeom) return;

	const locomotiveCoords = locoGeom.getCoordinates();
	const bearing = Number.isFinite(bearingOverride)
		? bearingOverride
		: Number.isFinite(state.currentBearing)
			? state.currentBearing
			: extractRotationDegrees(state.trainCoaches[0].getStyle());
	window._forceCoachSnapFrames = 240;
	const separation = getCoachSeparationMeters();
	const { offsets: coachOffsets } = getCoachLayout(state.trainCoaches.length);
	const angleRad = bearing * (Math.PI / 180);

	for (let i = 0; i < _coachStyleState.length; i++) _coachStyleState[i] = null;
	_coachRenderFrame = 0;

	for (let i = 0; i < state.trainCoaches.length; i++) {
		const coachType = i === 0
			? 'locomotive'
			: (i === state.trainCoaches.length - 1 && state.trainCoaches.length > 1 ? 'caboose' : 'passenger');

		const coords = [
			locomotiveCoords[0] - Math.sin(angleRad) * coachOffsets[i],
			locomotiveCoords[1] - Math.cos(angleRad) * coachOffsets[i]
		];

		const geom = state.trainCoaches[i].getGeometry();
		if (geom) geom.setCoordinates(coords);
		else state.trainCoaches[i].setGeometry(new ol.geom.Point(coords));

		state.trainCoaches[i].setStyle(getTransportIcon('train', bearing, coachType, i));
	}

	window.coachSmoothedPositions = state.trainCoaches.map((coach) => {
		const c = coach.getGeometry().getCoordinates();
		return { x: c[0], y: c[1], angle: bearing };
	});

	seedInitialLocoTrail(locomotiveCoords, bearing, separation, state.trainCoaches.length);
	updateTrainCouplings();
}

// train.png is 1543 px wide but its visible body spans 1481 px; career canvases draw a 98 px body at 12x.
const TRAIN_BODY_PX = 1481;
const CAREER_BODY_PX = (CANVAS_W - 2) * 12;
const CABOOSE_SCALE = 0.9;
// Real coaches are ~24 m long with ~1 m between bodies.
const COUPLER_GAP_RATIO = 0.045;
// Bogie centres sit ~14% in from each end of the body.
const BOGIE_OFFSET_RATIO = 0.36;

function getCoachLayout(count = state.trainCoaches.length || 2) {
	let metersPerPx = 1 / 30;
	if (state.map && state.map.getView) {
		const view = state.map.getView();
		metersPerPx = view.getResolution() * getVehicleZoomScale(view.getZoom()) * (state.vehicleSizeMultiplier || 1.0);
	}
	const career = isCareerActive();
	const lengths = [];
	const offsets = [];
	for (let i = 0; i < count; i++) {
		const caboose = !career && count > 1 && i === count - 1;
		lengths.push((career ? CAREER_BODY_PX : TRAIN_BODY_PX * (caboose ? CABOOSE_SCALE : 1)) * metersPerPx);
	}
	const gap = lengths[0] * COUPLER_GAP_RATIO;
	for (let i = 0; i < count; i++) {
		offsets.push(i === 0 ? 0 : offsets[i - 1] + lengths[i - 1] / 2 + gap + lengths[i] / 2);
	}
	return { lengths, offsets, gap };
}

function getCoachSeparationMeters() {
	return getCoachLayout(2).offsets[1];
}

function bearingBetween(from, to) {
	return Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI;
}

/**
 * Find trail position at a specific cumulative distance behind the locomotive.
 * Uses cumulative distance for rigid geographic spacing.
 */
function findPositionInTrailByCumulativeDist(trail, currentCumDist, targetSeparation) {
	if (!trail || trail.length < 2) return null;

	const targetCumDist = currentCumDist - targetSeparation;
	let lo = 0;
	let hi = trail.length - 1;

	while (lo < hi) {
		const mid = (lo + hi + 1) >>> 1;
		if (trail[mid].cumDist <= targetCumDist) lo = mid;
		else hi = mid - 1;
	}

	if (lo >= trail.length - 1) return trail[trail.length - 1];

	const p0 = trail[lo];
	const p1 = trail[Math.min(lo + 1, trail.length - 1)];
	const segDist = p1.cumDist - p0.cumDist;
	if (segDist < 1e-10) return p0;

	const ratio = Math.max(0, Math.min(1, (targetCumDist - p0.cumDist) / segDist));
	return {
		coords: [
			p0.coords[0] + (p1.coords[0] - p0.coords[0]) * ratio,
			p0.coords[1] + (p1.coords[1] - p0.coords[1]) * ratio
		],
		angle: p0.angle + (p1.angle - p0.angle) * ratio
	};
}

// Keep the old function for backward compatibility
function findPositionInTrail(trail, targetDistance) {
	if (!trail || trail.length < 2) return null;

	let accumulatedDistance = 0;
	for (let i = trail.length - 1; i > 0; i--) {
		const currentPos = trail[i];
		const prevPos = trail[i - 1];
		const dx = currentPos.coords[0] - prevPos.coords[0];
		const dy = currentPos.coords[1] - prevPos.coords[1];
		const segmentDistance = Math.sqrt(dx * dx + dy * dy);

		if (accumulatedDistance + segmentDistance >= targetDistance) {
			const remainingDistance = targetDistance - accumulatedDistance;
			const ratio = remainingDistance / segmentDistance;
			return {
				coords: [
					currentPos.coords[0] - dx * ratio,
					currentPos.coords[1] - dy * ratio
				],
				angle: prevPos.angle
			};
		}

		accumulatedDistance += segmentDistance;
	}

	return trail[0];
}

function updateTrainCouplings(useVectorSource = true) {
	const source = state.manualControlState.isManualMode
		? window.vehicleLayer?.getSource()
		: state.vectorSource;
	const count = Math.max(0, state.trainCoaches.length - 1);
	while (state.trainCouplings.length > count) {
		const coupling = state.trainCouplings.pop();
		if (useVectorSource && source) source.removeFeature(coupling);
	}

	const { lengths } = getCoachLayout(state.trainCoaches.length);
	const endPoint = (index, sign) => {
		const c = state.trainCoaches[index].getGeometry().getCoordinates();
		const angle = window.coachSmoothedPositions?.[index]?.angle ?? state.currentBearing ?? 0;
		const rad = angle * Math.PI / 180;
		const half = lengths[index] / 2 * sign;
		return [c[0] + Math.sin(rad) * half, c[1] + Math.cos(rad) * half];
	};
	for (let i = 0; i < count; i++) {
		const coach1Coords = endPoint(i, -1);
		const coach2Coords = endPoint(i + 1, 1);
		const existing = state.trainCouplings[i];
		if (existing) {
			existing.getGeometry().setCoordinates([coach1Coords, coach2Coords]);
			if (useVectorSource && source && !source.hasFeature(existing)) source.addFeature(existing);
			continue;
		}
		const couplingLine = new ol.Feature({
			geometry: new ol.geom.LineString([coach1Coords, coach2Coords])
		});

		const couplingStyle = new ol.style.Style({
			stroke: new ol.style.Stroke({
				color: '#1b232d',
				width: 4,
				lineCap: 'butt'
			})
		});
		couplingStyle.setZIndex(285);
		couplingLine.setStyle(couplingStyle);

		if (useVectorSource && source) {
			source.addFeature(couplingLine);
		}
		state.trainCouplings.push(couplingLine);
	}
}

function placeVehicleAtStart(mode, coachCount = 3) {
	if (!state.route || state.route.length < 2) {
		console.error("❌ ERROR: No valid state.route available.");
		return;
	}

	let pointA = state.route[0].latlng;
	let pointB = state.route[1].latlng;
	if (!pointA || !pointB) {
		console.error("❌ ERROR: pointA or pointB not defined.");
		return;
	}

	// ✅ Compute direction angle
	let correctedAngle = calculateRotationAngle(pointA, pointB);

	let startCoords = ol.proj.fromLonLat([pointA.lng, pointA.lat]);

	console.log("🚗 Placing vehicle at the start...");
	console.log(`   📍 Start Position: [${pointA.lat}, ${pointA.lng}]`);
	console.log(`   🔄 Corrected Rotation: ${correctedAngle.toFixed(2)}°`);

	// Initialize coaches (variable count for train, 1 for other modes)
	initializeTrainCoaches(mode, startCoords, correctedAngle, coachCount);
}

function updateVehicleRotation(mode, pointA, pointB) {
	let rotationAngle = calculateRotationAngle(pointA, pointB);

	if (state.movingFeature) {
		state.movingFeature.setStyle(getTransportIcon(mode, rotationAngle));
	}
}

// -------------------------------------------------
// Direct add/remove one coach without full reinit
// -------------------------------------------------
export function removeLastCoachVisual() {
	if (!state.trainCoaches || state.trainCoaches.length <= 1) return false;

	// Remove last coach from vectorSource
	const lastCoach = state.trainCoaches[state.trainCoaches.length - 1];
	if (lastCoach && state.vectorSource) state.vectorSource.removeFeature(lastCoach);
	state.trainCoaches.pop();

	// Rebuild couplings (removes the now-dangling last coupling)
	updateTrainCouplings(true);

	// Trim smoothed position history
	if (window.coachSmoothedPositions) window.coachSmoothedPositions.splice(state.trainCoaches.length);

	state.totalCoachCount = state.trainCoaches.length;
	state.visibleCoachCount = state.trainCoaches.length;

	// Re-style new last coach as caboose
	const lastIdx = state.trainCoaches.length - 1;
	if (lastIdx >= 1) {
		const bearing = state.currentBearing || 0;
		state.trainCoaches[lastIdx].setStyle(getTransportIcon('train', bearing, 'caboose', lastIdx));
	}
	return true;
}

export function appendCoachVisual() {
	if (!state.trainCoaches || state.trainCoaches.length === 0 || !state.movingFeature) return false;

	const newIndex = state.trainCoaches.length;
	const bearing = state.currentBearing || 0;
	const locoCoords = state.trainCoaches[0].getGeometry().getCoordinates();

	// Find position from trail at correct separation, fall back to direct offset
	let newCoords = [...locoCoords];
	if (window.locomotiveTrail && window.locomotiveTrail.length > 1) {
		const sep = getCoachLayout(newIndex + 1).offsets[newIndex];
		const found = findPositionInTrailByCumulativeDist(
			window.locomotiveTrail,
			window.locomotiveCumulativeDistance,
			sep
		);
		if (found) newCoords = found.coords;
	} else {
		const angleRad = bearing * (Math.PI / 180);
		const sep = getCoachLayout(newIndex + 1).offsets[newIndex];
		newCoords = [
			locoCoords[0] - Math.sin(angleRad) * sep,
			locoCoords[1] - Math.cos(angleRad) * sep
		];
	}

	const newCoach = new ol.Feature({ geometry: new ol.geom.Point(newCoords) });
	newCoach.setStyle(getTransportIcon('train', bearing, 'caboose', newIndex));

	// Previous last coach changes from caboose → passenger
	if (newIndex >= 2) {
		state.trainCoaches[newIndex - 1].setStyle(getTransportIcon('train', bearing, 'passenger', newIndex - 1));
	}

	state.trainCoaches.push(newCoach);
	if (state.vectorSource) state.vectorSource.addFeature(newCoach);

	if (window.coachSmoothedPositions) {
		window.coachSmoothedPositions[newIndex] = { x: newCoords[0], y: newCoords[1], angle: bearing };
	}

	state.totalCoachCount = state.trainCoaches.length;
	state.visibleCoachCount = state.trainCoaches.length;
	updateTrainCouplings(true);
	return true;
}

export { addMarker, resetMap, showSimulateDialog, closeSimulateDialog };
export { getTransportIcon, initializeTrainCoaches, updateTrainCoaches, findPositionInTrail, updateTrainCouplings, realignTrainCoachesInstant };
export { toggleCoachSelection, updateCoachCount, updateTrainColors, refreshTrainCoachColors };
export { placeVehicleAtStart, updateVehicleRotation, initializeDragDrop, refreshActiveVehicleStyles };