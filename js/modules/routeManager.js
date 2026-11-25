// ====================================
// ROUTE MANAGEMENT
// ====================================
import state from './state.js';
import { calculateDistance } from './utils.js';
import { monitoredFetch } from './cache.js';
import { saveRoute, deleteRoute, loadRoute, getRouteMetadata } from './routeStore.js';
import { updateRouteInfo } from './hud.js';
import { generateSmoothRoute, warmSmoothRouteCache, easeStationCurves } from './curveEngine.js';
import { createStationPlatforms, removeStationPlatforms } from './careerMode.js';

// Detect if the route is a loop (first and last stops are the same location/name)
function isRouteLoop(route) {
	if (!route || route.length < 3) return false;
	const first = route[0];
	const last = route[route.length - 1];
	const distM = calculateDistance(first.latlng, last.latlng) * 1000;
	if (distM < 100) return true; // within 100 metres
	const firstName = (first.placeName || '').trim().toLowerCase();
	const lastName = (last.placeName || '').trim().toLowerCase();
	return firstName.length > 0 && firstName === lastName;
}

function drawRoute() {
	removeStationPlatforms();
	// Store existing vehicles and couplings before clearing
	let preservedFeatures = [];
	state.vectorLayer.getSource().getFeatures().forEach(feature => {
		// Preserve train coaches and coupling lines
		if (
			state.trainCoaches.includes(feature) ||
			state.trainCouplings.includes(feature)
		) {
			preservedFeatures.push(feature);
		}
	});

	state.vectorLayer.getSource().clear(); // Clear all features

	// Re-add preserved vehicles and couplings
	if (preservedFeatures.length > 0) {
		state.vectorLayer.getSource().addFeatures(preservedFeatures);
	}

	// Get the current route type selection (default to 'rail' if not set)
	const routeTypeElement = document.getElementById("routeTypeSelector");
	const routeType = window.currentRouteType || (routeTypeElement ? routeTypeElement.value : 'rail');
	state.currentRouteType = routeType;

	// Detect loop route: last point visually merges into first
	const loopRoute = isRouteLoop(state.route);

	// Create features for each point in the route
	const markerByPoint = new Map();
	let features = state.route.filter((point, idx) => {
		// For road routes, skip intermediate road waypoints (empty placeName) from map markers
		if (routeType === 'road' && point.type === 'waypoint' && !point.placeName) return false;
		// Loop route: suppress the last point marker (it overlaps the first)
		if (loopRoute && idx === state.route.length - 1) return false;
		// Never render dummy points with a label marker
		if (point.type === 'dummy') return false;
		return true;
	}).map((point, idx) => {
		let feature = new ol.Feature({
			geometry: new ol.geom.Point(ol.proj.fromLonLat([point.latlng.lng, point.latlng
				.lat
			])),
		});
		markerByPoint.set(point, feature);

		// Default to 'stop' for backward compatibility with existing routes
		let pointType = point.type || 'stop';

		// First point gets a loop badge in its label when the route is a loop
		const isLoopOrigin = loopRoute && idx === 0;
		const displayName = isLoopOrigin
			? (point.placeName || '') + ' ↺'
			: (point.placeName || '');

		if (routeType === 'hyperloop') {
			// Create hyperloop station style - two parallel platforms
			feature.setStyle(createHyperloopStationStyle(displayName, !state.careerMode, point.latlng));
		} else {
			// Standard point styles for road, rail, air
			let fillColor = pointType === 'waypoint' ? '#00aaff' : '#ffea00'; // Blue for waypoints, yellow for stops
			let strokeColor = pointType === 'waypoint' ? '#0066cc' : '#000000'; // Darker blue for waypoint outline, black for stops
			let radius = pointType === 'waypoint' ? 4 : 5; // Slightly smaller for waypoints
			// Loop-origin stop: slightly larger dot to indicate dual role
			if (isLoopOrigin) radius = 7;
			const showPointLabel = !state.careerMode || pointType === 'waypoint';

			feature.setStyle(new ol.style.Style({
				image: new ol.style.Circle({
					radius: radius,
					fill: new ol.style.Fill({
						color: fillColor
					}),
					stroke: new ol.style.Stroke({
						color: strokeColor,
						width: 2 // Thickness of the outline
					})
				}),
				text: showPointLabel ? new ol.style.Text({
					text: displayName, // Show place name (with loop badge if applicable)
					offsetY: -15, // Adjust text position
					fill: new ol.style.Fill({
						color: '#000' // Black text
					}),
					stroke: new ol.style.Stroke({
						color: '#fff', // White outline for text
						width: 2
					})
				}) : undefined
			}));
		}

		return feature;
	});

	// For road routes with OSRM geometry, draw the full road-snapped line
	let lineFeature;
	if (routeType === 'road' && state.roadRouteGeometry && state.roadRouteGeometry.length > 0) {
		// Visual line: full OSRM polyline
		lineFeature = new ol.Feature({
			geometry: new ol.geom.LineString(
				state.roadRouteGeometry.map(c => ol.proj.fromLonLat([c[0], c[1]]))
			)
		});

		// Vehicle path: use OSRM-geometry smoothRoute built in fetchRoadRoute
		if (state.roadSmoothRoute && state.roadSmoothRoute.length > 2) {
			state.smoothRoute = state.roadSmoothRoute;
			state.smoothRouteDistances = state.roadSmoothDistances;
			state.smoothRouteIndex = 0;

			// Recompute segmentSmoothDistances from the OSRM-geometry-based smoothRoute
			const segSmoothDist = new Array(state.route.length - 1).fill(0);
			for (let si = 0; si < state.roadSmoothRoute.length - 1; si++) {
				const oi = state.roadSmoothRoute[si].originalIndex;
				if (oi >= 0 && oi < segSmoothDist.length) {
					segSmoothDist[oi] += state.roadSmoothDistances[si];
				}
			}
			state.segmentSmoothDistances = segSmoothDist;
		}
	} else {
		// Generate smooth curved route for the line display
		const routeType = window.currentRouteType || (routeTypeElement ? routeTypeElement.value : 'rail');
		let { smoothRoute, smoothRouteDistances } = generateSmoothRoute(state.route, routeType);
		if (routeType === 'rail') {
			// Sweep the track through stations instead of kinking at the stop vertex;
			// the eased window is a bit longer than the platform so trains ease in.
			const stationKm = 0.22 * (Number.isFinite(state.stationSizeMultiplier) ? state.stationSizeMultiplier : 1.2);
			const eased = easeStationCurves(smoothRoute, state.route, stationKm * 0.8);
			if (eased) {
				({ smoothRoute, smoothRouteDistances } = eased);
				// Eased stations shift onto the curve; move their markers with them.
				for (let si = 1; si < smoothRoute.length; si++) {
					const k = smoothRoute[si].originalIndex;
					if (k === smoothRoute[si - 1].originalIndex) continue;
					const marker = markerByPoint.get(state.route[k]);
					if (marker) marker.getGeometry().setCoordinates(ol.proj.fromLonLat([smoothRoute[si].lng, smoothRoute[si].lat]));
				}
			}
		}
		state.smoothRoute = smoothRoute;
		state.smoothRouteDistances = smoothRouteDistances;
		state.smoothRouteIndex = 0;

		// Pre-compute per-segment arc lengths so the physics engine brakes/progresses
		// using true curved distance instead of straight-line segment distance.
		const segSmoothDist = new Array(state.route.length - 1).fill(0);
		for (let si = 0; si < smoothRoute.length - 1; si++) {
			const oi = smoothRoute[si].originalIndex;
			if (oi >= 0 && oi < segSmoothDist.length) {
				segSmoothDist[oi] += smoothRouteDistances[si];
			}
		}
		state.segmentSmoothDistances = segSmoothDist;

		// Re-map originalProgress from spline parameter t to arc-distance fraction.
		const segCumDist = new Array(state.route.length - 1).fill(0);
		for (let si = 0; si < smoothRoute.length; si++) {
			const oi = smoothRoute[si].originalIndex;
			if (oi >= 0 && oi < segSmoothDist.length && segSmoothDist[oi] > 0) {
				smoothRoute[si].originalProgress = segCumDist[oi] / segSmoothDist[oi];
				if (si < smoothRoute.length - 1 && smoothRouteDistances[si] !== undefined) {
					segCumDist[oi] += smoothRouteDistances[si];
				}
			}
		}

		if (smoothRoute.length > 2) {
			lineFeature = new ol.Feature({
				geometry: new ol.geom.LineString(
					smoothRoute.map(p => ol.proj.fromLonLat([p.lng, p.lat]))
				)
			});
		} else {
			lineFeature = new ol.Feature({
				geometry: new ol.geom.LineString(state.route.map(p => ol.proj.fromLonLat([p.latlng.lng, p.latlng
					.lat
				])))
			});
		}
	}

	// Calculate zoom-responsive line width
	// At zoom 5: 2px, at zoom 15+: 8px
	const currentZoom = state.map ? state.map.getView().getZoom() : 10;
	const lineWidth = Math.max(2, Math.min(8, 2 + (currentZoom - 5) * 0.6));

	// Set the style for the route line
	lineFeature.setStyle(new ol.style.Style({
		stroke: new ol.style.Stroke({
			color: state.routeColor, // Use dynamic state.route color
			width: lineWidth, // Responsive to zoom level
			lineCap: 'round', // Rounded line ends
			lineJoin: 'round', // Rounded line joins
		})
	}));

	// Add the features to the vector layer
	state.vectorLayer.getSource().addFeatures([...features, lineFeature]);

	// Render dummy points as tiny semi-transparent gray dots (no label)
	const dummyStyle = new ol.style.Style({
		image: new ol.style.Circle({
			radius: 3,
			fill: new ol.style.Fill({ color: 'rgba(180,180,180,0.85)' }),
			stroke: new ol.style.Stroke({ color: '#555', width: 1 })
		})
	});
	state.route.forEach(point => {
		if (point.type === 'dummy') {
			const df = new ol.Feature({
				geometry: new ol.geom.Point(ol.proj.fromLonLat([point.latlng.lng, point.latlng.lat]))
			});
			df.setStyle(dummyStyle);
			state.vectorLayer.getSource().addFeature(df);
		}
	});

	if (routeType === 'rail') createStationPlatforms();

	// Update the total distance
	updateDistance();
}

// Screen-independent track heading (radians, clockwise from east in map space) at a station,
// taken from the smoothed path so the platforms line up with the drawn tube.
function trackHeadingAt(latlng) {
	const path = state.smoothRoute && state.smoothRoute.length > 1 ? state.smoothRoute : null;
	if (!path || !latlng) return 0;
	let best = 0, bestD = Infinity;
	for (let i = 0; i < path.length; i++) {
		const d = (path[i].lat - latlng.lat) ** 2 + (path[i].lng - latlng.lng) ** 2;
		if (d < bestD) { bestD = d; best = i; }
	}
	const a = path[Math.max(0, best - 1)], b = path[Math.min(path.length - 1, best + 1)];
	const pa = ol.proj.fromLonLat([a.lng, a.lat]), pb = ol.proj.fromLonLat([b.lng, b.lat]);
	return Math.atan2(-(pb[1] - pa[1]), pb[0] - pa[0]);
}

function createHyperloopStationStyle(placeName, showLabel = true, latlng = null) {
	let headingCache = { path: null, heading: 0 };
	const heading = () => {
		if (headingCache.path !== state.smoothRoute) headingCache = { path: state.smoothRoute, heading: trackHeadingAt(latlng) };
		return headingCache.heading;
	};
	// Create hyperloop station with two parallel platform lines
	return new ol.style.Style({
		image: new ol.style.RegularShape({
			points: 4, // Rectangle shape
			radius: 12, // Size of the station area
			fill: new ol.style.Fill({
				color: 'rgba(0, 0, 0, 0.1)' // Transparent background
			}),
			stroke: new ol.style.Stroke({
				color: 'transparent',
				width: 0
			})
		}),
		// Add custom hyperloop platform rendering
		renderer: function (coordinates, renderState) {
			const context = renderState.context;
			const platformLength = 20 * (renderState.pixelRatio || 1);
			const platformSpacing = 8 * (renderState.pixelRatio || 1);

			context.save();
			context.translate(coordinates[0], coordinates[1]);
			// Map rotation turns the screen counter-clockwise; canvas rotation is clockwise.
			context.rotate(heading() - (renderState.rotation || 0));
			context.strokeStyle = '#000000';
			context.lineWidth = 3 * (renderState.pixelRatio || 1);
			context.lineCap = 'round';
			context.beginPath();
			context.moveTo(-platformLength / 2, -platformSpacing / 2);
			context.lineTo(platformLength / 2, -platformSpacing / 2);
			context.moveTo(-platformLength / 2, platformSpacing / 2);
			context.lineTo(platformLength / 2, platformSpacing / 2);
			context.stroke();
			context.restore();
		},
		text: showLabel ? new ol.style.Text({
			text: placeName, // Show place name next to the station
			offsetY: -25, // Adjust text position higher for hyperloop stations
			fill: new ol.style.Fill({
				color: '#000' // Black text
			}),
			stroke: new ol.style.Stroke({
				color: '#fff', // White outline for text
				width: 2
			}),
			font: 'bold 12px Arial' // Slightly different font for hyperloop
		}) : undefined
	});
}

function updateDistance() {
	state.totalDistance = 0;
	for (let i = 1; i < state.route.length; i++) {
		let prev = state.route[i - 1].latlng;
		let curr = state.route[i].latlng;
		state.totalDistance += calculateDistance(prev, curr);
	}

	// Update total distance element (for route planning)
	let totalDistanceElement = document.getElementById("totalDistance");
	if (totalDistanceElement) {
		totalDistanceElement.innerText = `${state.totalDistance.toFixed(2)} km`;
	}

	// Also update the HUD distance covered element with total route distance as reference
	let distanceCoveredElement = document.getElementById("distanceCovered");
	if (distanceCoveredElement && state.totalDistance > 0) {
		// During route creation, show total distance; during simulation it will be updated separately
		distanceCoveredElement.innerText = `${state.totalDistance.toFixed(2)} km`;
	}

	// Update route info dashboard when route changes
	updateRouteInfo();

	// Keep toolbar route stats strip in sync
	updateRouteStatsStrip();
}

function saveRouteToJson() {
	if (state.route.length < 2) {
		alert("You need at least two points to save a route.");
		return;
	}

	// Native window.prompt is being blocked by the browser. 
	// Create a custom HTML dialog to ensure the user can type a name reliably.
	const overlay = document.createElement('div');
	overlay.style.position = 'fixed';
	overlay.style.top = '0'; overlay.style.left = '0'; overlay.style.width = '100%'; overlay.style.height = '100%';
	overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
	overlay.style.zIndex = '99999';
	overlay.style.display = 'flex'; overlay.style.justifyContent = 'center'; overlay.style.alignItems = 'center';

	const modal = document.createElement('div');
	modal.style.background = '#1e293b';
	modal.style.padding = '20px';
	modal.style.borderRadius = '8px';
	modal.style.border = '1px solid #334155';
	modal.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
	modal.style.textAlign = 'center';

	const title = document.createElement('h3');
	title.innerText = 'Save Route';
	title.style.color = 'white';
	title.style.marginTop = '0';

	const input = document.createElement('input');
	input.type = 'text';
	input.placeholder = 'Enter a name for this route...';
	input.style.width = '100%'; input.style.padding = '10px'; input.style.marginBottom = '15px';
	input.style.boxSizing = 'border-box'; input.style.borderRadius = '4px'; input.style.border = '1px solid #475569';
	input.style.background = '#0f172a'; input.style.color = 'white';

	const btnContainer = document.createElement('div');
	btnContainer.style.display = 'flex'; btnContainer.style.justifyContent = 'space-between';

	const cancelBtn = document.createElement('button');
	cancelBtn.innerText = 'Cancel';
	cancelBtn.style.padding = '8px 16px'; cancelBtn.style.background = '#334155'; cancelBtn.style.color = 'white';
	cancelBtn.style.border = 'none'; cancelBtn.style.borderRadius = '4px'; cancelBtn.style.cursor = 'pointer';

	const saveBtn = document.createElement('button');
	saveBtn.innerText = 'Save';
	saveBtn.style.padding = '8px 16px'; saveBtn.style.background = '#10b981'; saveBtn.style.color = 'white';
	saveBtn.style.border = 'none'; saveBtn.style.borderRadius = '4px'; saveBtn.style.cursor = 'pointer';

	btnContainer.appendChild(cancelBtn);
	btnContainer.appendChild(saveBtn);
	modal.appendChild(title);
	modal.appendChild(input);
	modal.appendChild(btnContainer);
	overlay.appendChild(modal);
	document.body.appendChild(overlay);

	input.focus();

	const removeModal = () => document.body.removeChild(overlay);

	cancelBtn.onclick = removeModal;

	saveBtn.onclick = () => {
		const routeName = input.value;
		if (!routeName || routeName.trim() === '') {
			alert("Route name cannot be empty.");
			return;
		}

		removeModal();

		let formattedPoints = state.route.map(p => ({
			latlng: [p.latlng.lat, p.latlng.lng],
			placeName: p.placeName || "Unknown",
			type: p.type || "stop"
		}));

		let routeData = {
			route_name: routeName.trim(),
			points: formattedPoints,
			total_distance: state.totalDistance.toFixed(2)
		};

		console.log("🚀 Sending formatted route data:", routeData);

		saveRoute(routeData)
			.then(result => {
				if (result.ok) {
					alert(`✅ Route "${routeName}" saved on this device.`);
				} else {
					alert(`❌ Failed to save route: ${result.message}`);
				}
			})
			.catch(error => {
				console.error("❌ Error saving route:", error);
				alert("❌ Error saving route. Please try again.");
			});
	};
}

function undoLastPoint() {
	if (state.route.length > 0) {
		state.route.pop(); // Remove the last point from the array
		drawRoute(); // Redraw the state.route without the last point
		updateDistance(); // Update the displayed distance
	}

	// Keep the undo button visible as long as route mode is active
	// Only hide it when route mode is turned off
	const undoBtn = document.getElementById('undoBtn');
	if (state.routeMode) {
		undoBtn.style.display = 'inline-block';
	} else {
		undoBtn.style.display = 'none';
	}
}

function toggleRouteMode() {
	state.routeMode = !state.routeMode; // Toggle the state.route mode state
	const createRouteBtn = document.getElementById('createRouteBtn');

	// Toggle toolbar phase class
	const toolbarBar = document.querySelector('.toolbar-bar');
	if (toolbarBar) toolbarBar.classList.toggle('toolbar--routing-mode', state.routeMode);

	// Update button label via .btn-label span (preserves Lucide icon)
	const label = createRouteBtn ? createRouteBtn.querySelector('.btn-label') : null;

	// Toggle the "active" class on the button
	if (state.routeMode) {
		if (createRouteBtn) createRouteBtn.classList.add('active');
		if (label) label.textContent = 'Route Mode: ON'; else if (createRouteBtn) createRouteBtn.textContent = 'Route Mode: ON';

		// Show help bulb icon instead of automatic instructions
		showHelpBulb();
	} else {
		if (createRouteBtn) createRouteBtn.classList.remove('active');
		if (label) label.textContent = 'Create Route'; else if (createRouteBtn) createRouteBtn.textContent = 'Create Route';

		// Hide help bulb and instructions
		hideHelpBulb();
		hideWaypointInstructions();
	}

	// Show or hide the undo button based on routeMode
	const undoBtn = document.getElementById('undoBtn');
	if (state.routeMode) {
		if (undoBtn) undoBtn.style.display = 'inline-flex';
	} else {
		if (undoBtn) undoBtn.style.display = 'none';
	}

	// Update route stats strip
	updateRouteStatsStrip();
}

function updateRouteStatsStrip() {
	const kEl = document.getElementById('routeStatsKm');
	const pEl = document.getElementById('routeStatsPts');
	if (kEl) kEl.textContent = (state.totalDistance || 0).toFixed(1) + ' km';
	if (pEl) pEl.textContent = (state.route ? state.route.length : 0) + ' pts';
}

function showHelpBulb() {
	// Create help bulb icon if it doesn't exist
	let helpBulb = document.getElementById('helpBulb');
	if (!helpBulb) {
		helpBulb = document.createElement('div');
		helpBulb.id = 'helpBulb';
		helpBulb.style.cssText = `
			position: fixed;
			top: 15px;
			right: 15px;
			width: 40px;
			height: 40px;
			background: rgba(255, 193, 7, 0.9);
			border-radius: 50%;
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			font-size: 20px;
			z-state.index: 1001;
			box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
			transition: all 0.3s ease;
		`;
		helpBulb.innerHTML = '💡';
		helpBulb.title = 'Click for state.route creation help';

		// Add click event to toggle instructions
		helpBulb.onclick = toggleWaypointInstructions;

		// Add hover effects
		helpBulb.onmouseover = function () {
			this.style.background = 'rgba(255, 193, 7, 1)';
			this.style.transform = 'scale(1.1)';
		};
		helpBulb.onmouseout = function () {
			this.style.background = 'rgba(255, 193, 7, 0.9)';
			this.style.transform = 'scale(1)';
		};

		document.body.appendChild(helpBulb);
	}
	helpBulb.style.display = 'flex';
}

function hideHelpBulb() {
	const helpBulb = document.getElementById('helpBulb');
	if (helpBulb) {
		helpBulb.style.display = 'none';
	}
}

function toggleWaypointInstructions() {
	const instructionsDiv = document.getElementById('waypointInstructions');
	if (instructionsDiv && instructionsDiv.style.display === 'block') {
		hideWaypointInstructions();
	} else {
		showWaypointInstructions();
	}
}

function showWaypointInstructions() {
	// Create instruction tooltip if it doesn't exist
	let instructionsDiv = document.getElementById('waypointInstructions');
	if (!instructionsDiv) {
		instructionsDiv = document.createElement('div');
		instructionsDiv.id = 'waypointInstructions';
		instructionsDiv.style.cssText = `
			position: fixed;
			top: 60px;
			right: 15px;
			background: rgba(0, 0, 0, 0.9);
			color: white;
			padding: 15px;
			border-radius: 8px;
			font-size: 13px;
			z-state.index: 1000;
			max-width: 320px;
			box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4);
			border: 1px solid rgba(255, 255, 255, 0.1);
		`;
		instructionsDiv.innerHTML = `
			<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
				<strong style="color: #ffc107;">Route Creation Help</strong>
				<button onclick="hideWaypointInstructions()" style="background: none; border: none; color: #fff; font-size: 18px; cursor: pointer; padding: 0;">×</button>
			</div>
			• <span style="color: #ffea00;">●</span> Single click: Add stop point (vehicle stops)<br>
			• <span style="color: #00aaff;">●</span> Double click: Add waypoint (vehicle passes through)<br>
			• <span style="color: #aaa;">●</span> Triple click: Add dummy point (pass-through, no name)<br>
			• Click existing point: Cycle stop → waypoint → dummy → remove
		`;
		document.body.appendChild(instructionsDiv);
	}
	instructionsDiv.style.display = 'block';
}

function hideWaypointInstructions() {
	const instructionsDiv = document.getElementById('waypointInstructions');
	if (instructionsDiv) {
		instructionsDiv.style.display = 'none';
	}
}

// Speed-optimized calculation for maximum achievable speed
function calculateMaxAchievableSpeed(totalDistanceToDestination, currentSpeed, userMaxSpeed, userGForceLimit) {
	// Validate inputs
	if (totalDistanceToDestination <= 0) return 0;
	if (!userMaxSpeed || userMaxSpeed <= 0) {
		console.warn("Invalid user max speed, using default 100 km/h");
		userMaxSpeed = 100;
	}
	if (!userGForceLimit || userGForceLimit <= 0) {
		console.warn("Invalid G-force limit, using default 0.5g");
		userGForceLimit = 0.5;
	}

	// Convert G-force to acceleration (m/s²)
	const maxAcceleration = userGForceLimit * 9.81;
	const maxDeceleration = userGForceLimit * 9.81;

	// Convert speeds to m/s for physics calculations
	const currentSpeedMs = currentSpeed / 3.6;
	const userMaxSpeedMs = userMaxSpeed / 3.6;

	// Calculate stopping distance from user's max speed
	const stoppingDistanceFromMaxSpeed = (userMaxSpeedMs * userMaxSpeedMs) / (2 * maxDeceleration);
	const stoppingDistanceKm = stoppingDistanceFromMaxSpeed / 1000;

	// Speed-first approach: Can we reach user's max speed?
	if (totalDistanceToDestination >= stoppingDistanceKm) {
		// We have enough distance to reach max speed and stop safely
		return userMaxSpeed;
	} else {
		// Calculate the maximum speed we can safely achieve with remaining distance
		// Using: v = √(2 * a * s) where s is total available distance
		const maxAchievableSpeedMs = Math.sqrt(2 * maxDeceleration * totalDistanceToDestination * 1000);
		const maxAchievableSpeedKmh = maxAchievableSpeedMs * 3.6;

		// Return the lower of achievable speed vs user max speed
		const finalSpeed = Math.min(maxAchievableSpeedKmh, userMaxSpeed);

		// Throttle logging to prevent spam (only log every 10 seconds)
		if (!window.lastSpeedOptimizationLog || Date.now() - window.lastSpeedOptimizationLog > 10000) {
			console.log(`⚡ Speed Target: ${finalSpeed.toFixed(0)}km/h for ${totalDistanceToDestination.toFixed(2)}km`);
			window.lastSpeedOptimizationLog = Date.now();
		}

		return finalSpeed;
	}
}

// Calculate total remaining distance to final destination (not just next waypoint)
function calculateTotalRemainingDistance(route, currentIndex, currentProgress) {
	if (!route || currentIndex >= state.route.length - 1) return 0;

	let totalDistance = 0;

	// Add remaining distance in current segment
	if (currentIndex < state.route.length - 1) {
		const currentSegmentDistance = calculateDistance(state.route[currentIndex].latlng, state.route[currentIndex + 1].latlng);
		const remainingInCurrentSegment = currentSegmentDistance * (1 - currentProgress);
		state.totalDistance += remainingInCurrentSegment;
	}

	// Add all subsequent segments to final destination
	for (let i = currentIndex + 1; i < state.route.length - 1; i++) {
		const segmentDistance = calculateDistance(state.route[i].latlng, state.route[i + 1].latlng);
		state.totalDistance += segmentDistance;
	}

	return state.totalDistance;
}

// Route list from the unified store (server + device copy, works offline).
async function fetchRouteMetadata() {
	return getRouteMetadata();
}
async function showRouteDialog() {
	try {
		const allRouteData = await fetchRouteMetadata();
		// Store route data for sorting
		window.mainDialogRouteData = allRouteData;

		// Add event listener for sort dropdown
		const sortDropdown = document.getElementById("mainRouteSortDropdown");
		sortDropdown.onchange = () => populateMainRouteDropdown(allRouteData);

		// Initial population
		populateMainRouteDropdown(allRouteData);

		document.getElementById("routeDialog").style.display = "block";

	} catch (error) {
		console.error("Error loading routes:", error);
		alert("Error loading routes. Please try again.");
	}
}

function populateMainRouteDropdown(routeData) {
	const sortType = document.getElementById("mainRouteSortDropdown").value;
	const dropdown = document.getElementById("routeDropdown");

	// Sort routes based on selected option
	let sortedRoutes = [...routeData];
	switch (sortType) {
		case 'name':
			sortedRoutes.sort((a, b) => a.name.localeCompare(b.name));
			break;
		case 'name-desc':
			sortedRoutes.sort((a, b) => b.name.localeCompare(a.name));
			break;
		case 'distance':
			sortedRoutes.sort((a, b) => a.distance - b.distance);
			break;
		case 'distance-desc':
			sortedRoutes.sort((a, b) => b.distance - a.distance);
			break;
	}

	// Clear and populate dropdown
	dropdown.innerHTML = '';
	sortedRoutes.forEach(route => {
		const option = document.createElement("option");
		option.value = route.name;
		option.innerText = `${route.name} (${route.distance.toFixed(1)}km, ${route.pointCount} points)`;
		dropdown.appendChild(option);
	});
}

function closeRouteDialog() {
	document.getElementById("routeDialog").style.display = "none";
}

async function loadSelectedRoute() {
	try {
		let routeName = document.getElementById("routeDropdown").value;
		let shouldReverse = document.getElementById("reverseRoute").checked;
		let routeType = document.getElementById("routeTypeSelector").value;

		if (!routeName) {
			alert("Please select a route to load.");
			return;
		}

		// Store the selected route type globally for use in drawing functions
		window.currentRouteType = routeType;
		state.currentRouteType = routeType;

		let data = await loadRoute(routeName);
		if (!data) {
			alert(`Route '${routeName}' not found.`);
			return;
		}
		console.log("Loaded route data:", data);

		if (!data.points || data.points.length === 0) {
			alert("This route has no saved points.");
			return;
		}

		let filteredPoints = data.points.filter(point =>
			point.latlng && typeof point.latlng.lat === 'number' && typeof point.latlng.lng === 'number'
		).map(point => ({
			...point,
			type: point.type || "stop", // 🔄 Default to 'stop' for backward compatibility
			placeName: point.placeName ? point.placeName.replace(/^\[Waypoint\]\s*/, '') : "Unknown" // 🔄 Clean legacy [Waypoint] prefixes
		}));

		if (filteredPoints.length === 0) {
			alert("No valid points found in this route.");
			return;
		}

		// 🔄 Reverse the route if checkbox is checked
		if (shouldReverse) {
			filteredPoints = filteredPoints.reverse();
			console.log("🔄 Route reversed!");
		}

		// 🛣️ For road routes, fetch OSRM road-snapped routing
		if (routeType === 'road' && filteredPoints.length >= 2) {
			try {
				console.log('🛣️ Fetching road routing from OSRM...');
				filteredPoints = await fetchRoadRoute(filteredPoints);
			} catch (error) {
				console.warn('Road routing failed, using straight lines:', error.message);
			}
		} else {
			state.roadRouteGeometry = null;
		}

		state.route = filteredPoints;
		state.totalDistance = parseFloat(data.total_distance) || 0;

		// Pre-warm server smooth route cache in the background (used on next drawRoute call)
		warmSmoothRouteCache(state.route, routeType);

		// ✅ Ensure the map UI updates correctly
		if (state.vectorLayer) state.vectorLayer.getSource().clear();
		drawRoute();

		// ✅ Ensure distance is updated correctly
		let distanceElement = document.getElementById("totalDistance");
		if (distanceElement) {
			distanceElement.innerText = `${totalDistance.toFixed(2)} km`;
		}

		closeRouteDialog();

	} catch (error) {
		console.error("Error loading selected state.route:", error);
		alert("Error loading route. Please try again.");
	}
}

// ===== EDIT ROUTE DIALOG FUNCTIONS =====

function getCoordinateDisplay(latlng) {
	if (!latlng) return 'Unknown';

	// Handle array format [lat, lng]
	if (Array.isArray(latlng) && latlng.length >= 2) {
		return `${latlng[0].toFixed(6)}, ${latlng[1].toFixed(6)}`;
	}

	// Handle object format {lat: x, lng: y}
	if (typeof latlng === 'object' && latlng.lat !== undefined && latlng.lng !== undefined) {
		return `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
	}

	return 'Invalid coordinates';
}

function convertToArrayFormat(latlng) {
	if (!latlng) return [0, 0]; // Default fallback

	// Already in array format [lat, lng]
	if (Array.isArray(latlng) && latlng.length >= 2) {
		return [latlng[0], latlng[1]];
	}

	// Convert from object format {lat: x, lng: y} to array [lat, lng]
	if (typeof latlng === 'object' && latlng.lat !== undefined && latlng.lng !== undefined) {
		return [latlng.lat, latlng.lng];
	}

	console.warn("Invalid latlng format:", latlng);
	return [0, 0]; // Fallback
}

const mapEditState = {
	active: false,
	mode: 'move',
	source: null,
	layer: null,
	lineFeature: null,
	pointFeatures: [],
	modifyInteraction: null,
	clickKey: null
};

function getEditPointStyle(pointType = 'stop') {
	const fillColor = pointType === 'waypoint' ? '#22d3ee' : pointType === 'dummy' ? '#94a3b8' : '#facc15';
	const strokeColor = pointType === 'waypoint' ? '#0e7490' : pointType === 'dummy' ? '#64748b' : '#000000';
	const radius = pointType === 'waypoint' ? 5 : pointType === 'dummy' ? 4 : 6;

	return new ol.style.Style({
		image: new ol.style.Circle({
			radius,
			fill: new ol.style.Fill({ color: fillColor }),
			stroke: new ol.style.Stroke({ color: strokeColor, width: 2 })
		})
	});
}

function getEditLineStyle() {
	return new ol.style.Style({
		stroke: new ol.style.Stroke({
			color: 'rgba(56, 189, 248, 0.95)',
			width: 4,
			lineDash: [8, 6],
			lineCap: 'round',
			lineJoin: 'round'
		})
	});
}

function updateMapEditStatusLabel() {
	const status = document.getElementById('modifyMapStatus');
	const fabStatus = document.getElementById('fabMapStatus');
	let msg = '';
	if (mapEditState.active) {
		if (mapEditState.mode === 'move') {
			msg = 'Mode: Move points by dragging';
		} else if (mapEditState.mode === 'add') {
			msg = 'Mode: Click map to add point between nearest segment';
		} else {
			msg = 'Mode: Click a point to remove it';
		}
	}
	if (status) status.textContent = msg;
	if (fabStatus) fabStatus.textContent = msg;
}

function updateMapModeButtonStates() {
	const moveBtn = document.getElementById('modifyMapMoveBtn');
	const addBtn = document.getElementById('modifyMapAddBtn');
	const removeBtn = document.getElementById('modifyMapRemoveBtn');
	const fabMoveBtn = document.getElementById('fabMoveBtn');
	const fabAddBtn = document.getElementById('fabAddBtn');
	const fabRemoveBtn = document.getElementById('fabRemoveBtn');
	const active = mapEditState.active;

	if (moveBtn) {
		moveBtn.style.display = active ? '' : 'none';
		moveBtn.style.opacity = mapEditState.mode === 'move' ? '1' : '0.7';
	}
	if (addBtn) {
		addBtn.style.display = active ? '' : 'none';
		addBtn.style.opacity = mapEditState.mode === 'add' ? '1' : '0.7';
	}
	if (removeBtn) {
		removeBtn.style.display = active ? '' : 'none';
		removeBtn.style.opacity = mapEditState.mode === 'remove' ? '1' : '0.7';
	}
	// Sync FAB mode button highlights
	if (fabMoveBtn) fabMoveBtn.style.opacity = mapEditState.mode === 'move' ? '1' : '0.55';
	if (fabAddBtn) fabAddBtn.style.opacity = mapEditState.mode === 'add' ? '1' : '0.55';
	if (fabRemoveBtn) fabRemoveBtn.style.opacity = mapEditState.mode === 'remove' ? '1' : '0.55';
}

function renderEditablePointsList() {
	const pointsContainer = document.getElementById('editRoutePoints');
	if (!pointsContainer || !window.editingRouteData || !window.editingRouteData.points) return;

	const points = window.editingRouteData.points;
	pointsContainer.innerHTML = `
		<h4 style="margin-bottom: 15px; color: #f1f5f9;">Route Points:</h4>
		<div id="pointsList"></div>
	`;

	const pointsList = document.getElementById('pointsList');
	points.forEach((point, index) => {
		const pointType = point.type || 'stop';
		const cleanPlaceName = point.placeName ? point.placeName.replace(/^\[Waypoint\]\s*/, '') : `Point ${index + 1}`;
		const pointDiv = document.createElement('div');
		pointDiv.style.cssText = `
			margin-bottom: 12px;
			padding: 12px;
			background: rgba(51, 65, 85, 0.5);
			border-radius: 8px;
			border: 1px solid rgba(148, 163, 184, 0.2);
		`;

		pointDiv.innerHTML = `
			<div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
				<span style="color: ${pointType === 'waypoint' ? '#00aaff' : pointType === 'dummy' ? '#aaa' : '#ffea00'}; font-size: 16px;">●</span>
				<span style="font-weight: bold; color: #f1f5f9;">Point ${index + 1}:</span>
				<select id="pointType_${index}" onchange="updateEditingPointField(${index}, 'type', this.value)"
					style="padding: 4px; border-radius: 4px; background: rgba(51, 65, 85, 0.8); color: #f1f5f9; border: 1px solid #475569;">
					<option value="stop" ${pointType === 'stop' ? 'selected' : ''}>Stop</option>
					<option value="waypoint" ${pointType === 'waypoint' ? 'selected' : ''}>Waypoint</option>
					<option value="dummy" ${pointType === 'dummy' ? 'selected' : ''}>Dummy</option>
				</select>
			</div>
			<input type="text" id="placeName_${index}" value="${cleanPlaceName}"
				onchange="updateEditingPointField(${index}, 'placeName', this.value)"
				style="width: 100%; padding: 8px; border-radius: 5px; border: 1px solid #475569; background: rgba(51, 65, 85, 0.8); color: #f1f5f9;"
				placeholder="Enter place name">
			<div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">
				Coordinates: ${getCoordinateDisplay(point.latlng)}
			</div>
		`;

		pointsList.appendChild(pointDiv);
	});
}

function syncEditedRouteFromMapFeatures() {
	if (!window.editingRouteData || !window.editingRouteData.points) return;
	const sorted = [...mapEditState.pointFeatures].sort((a, b) => a.get('editIndex') - b.get('editIndex'));
	for (let i = 0; i < sorted.length; i++) {
		const feature = sorted[i];
		const coords = feature.getGeometry().getCoordinates();
		const lonLat = ol.proj.toLonLat(coords);
		if (!window.editingRouteData.points[i]) continue;
		window.editingRouteData.points[i].latlng = [lonLat[1], lonLat[0]];
	}
}

function refreshEditLineGeometry() {
	if (!mapEditState.lineFeature) return;
	const lineCoords = [...mapEditState.pointFeatures]
		.sort((a, b) => a.get('editIndex') - b.get('editIndex'))
		.map(f => f.getGeometry().getCoordinates());
	mapEditState.lineFeature.setGeometry(new ol.geom.LineString(lineCoords));
}

function refreshMapEditFeatures() {
	if (!mapEditState.active || !window.editingRouteData || !window.editingRouteData.points) return;

	if (!mapEditState.source) {
		mapEditState.source = new ol.source.Vector();
	}

	mapEditState.source.clear();
	mapEditState.pointFeatures = [];

	window.editingRouteData.points.forEach((point, index) => {
		const latlng = convertToArrayFormat(point.latlng);
		const pointType = point.type || 'stop';
		const feature = new ol.Feature({
			geometry: new ol.geom.Point(ol.proj.fromLonLat([latlng[1], latlng[0]]))
		});
		feature.set('editKind', 'point');
		feature.set('editIndex', index);
		feature.set('pointType', pointType);
		feature.setStyle(getEditPointStyle(pointType));
		mapEditState.pointFeatures.push(feature);
		mapEditState.source.addFeature(feature);
	});

	mapEditState.lineFeature = new ol.Feature({
		geometry: new ol.geom.LineString(mapEditState.pointFeatures.map(f => f.getGeometry().getCoordinates()))
	});
	mapEditState.lineFeature.set('editKind', 'line');
	mapEditState.lineFeature.setStyle(getEditLineStyle());
	mapEditState.source.addFeature(mapEditState.lineFeature);

	if (mapEditState.modifyInteraction && state.map) {
		state.map.removeInteraction(mapEditState.modifyInteraction);
		mapEditState.modifyInteraction = null;
	}

	if (state.map) {
		const featureCollection = new ol.Collection(mapEditState.pointFeatures);
		mapEditState.modifyInteraction = new ol.interaction.Modify({
			features: featureCollection,
			pixelTolerance: 12
		});
		mapEditState.modifyInteraction.on('modifyend', () => {
			syncEditedRouteFromMapFeatures();
			refreshEditLineGeometry();
			renderEditablePointsList();
		});
		state.map.addInteraction(mapEditState.modifyInteraction);
	}

	if (state.map && mapEditState.pointFeatures.length > 1) {
		const extent = mapEditState.source.getExtent();
		state.map.getView().fit(extent, { padding: [80, 80, 80, 80], maxZoom: 16, duration: 250 });
	}
}

function findClosestSegmentInsertIndex(targetCoord) {
	if (!mapEditState.pointFeatures || mapEditState.pointFeatures.length < 2) return 0;

	let bestIndex = 0;
	let bestDistanceSq = Number.POSITIVE_INFINITY;

	for (let i = 0; i < mapEditState.pointFeatures.length - 1; i++) {
		const a = mapEditState.pointFeatures[i].getGeometry().getCoordinates();
		const b = mapEditState.pointFeatures[i + 1].getGeometry().getCoordinates();
		const abx = b[0] - a[0];
		const aby = b[1] - a[1];
		const apx = targetCoord[0] - a[0];
		const apy = targetCoord[1] - a[1];
		const abLenSq = abx * abx + aby * aby;
		const t = abLenSq > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq)) : 0;
		const projX = a[0] + t * abx;
		const projY = a[1] + t * aby;
		const dx = targetCoord[0] - projX;
		const dy = targetCoord[1] - projY;
		const distSq = dx * dx + dy * dy;
		if (distSq < bestDistanceSq) {
			bestDistanceSq = distSq;
			bestIndex = i;
		}
	}

	return bestIndex + 1;
}

function handleMapEditClick(event) {
	if (!mapEditState.active || !window.editingRouteData || !window.editingRouteData.points) return;

	if (mapEditState.mode === 'add') {
		const insertIndex = findClosestSegmentInsertIndex(event.coordinate);
		const lonLat = ol.proj.toLonLat(event.coordinate);
		window.editingRouteData.points.splice(insertIndex, 0, {
			latlng: [lonLat[1], lonLat[0]],
			placeName: `Point ${insertIndex + 1}`,
			type: 'stop'
		});
		refreshMapEditFeatures();
		renderEditablePointsList();
		return;
	}

	if (mapEditState.mode === 'remove') {
		if (window.editingRouteData.points.length <= 2) {
			alert('A route must keep at least two points.');
			return;
		}

		let clickedPointFeature = null;
		state.map.forEachFeatureAtPixel(event.pixel, (feature, layer) => {
			if (layer === mapEditState.layer && feature.get('editKind') === 'point') {
				clickedPointFeature = feature;
				return true;
			}
			return false;
		}, { hitTolerance: 10 });

		if (!clickedPointFeature) return;
		const index = clickedPointFeature.get('editIndex');
		if (index < 0 || index >= window.editingRouteData.points.length) return;
		window.editingRouteData.points.splice(index, 1);
		refreshMapEditFeatures();
		renderEditablePointsList();
	}
}

function clearMapModifyMode() {
	if (mapEditState.clickKey) {
		ol.Observable.unByKey(mapEditState.clickKey);
		mapEditState.clickKey = null;
	}
	if (state.map && mapEditState.modifyInteraction) {
		state.map.removeInteraction(mapEditState.modifyInteraction);
	}
	if (state.map && mapEditState.layer) {
		state.map.removeLayer(mapEditState.layer);
	}

	mapEditState.active = false;
	mapEditState.mode = 'move';
	mapEditState.source = null;
	mapEditState.layer = null;
	mapEditState.lineFeature = null;
	mapEditState.pointFeatures = [];
	mapEditState.modifyInteraction = null;

	// Restore edit dialog, hide FAB
	const editDialog = document.getElementById('editRouteDialog');
	if (editDialog) editDialog.style.display = '';
	const fab = document.getElementById('mapEditFAB');
	if (fab) fab.style.display = 'none';

	const btn = document.getElementById('modifyOnMapBtn');
	if (btn) btn.textContent = '🗺️ Modify on Map';
	updateMapEditStatusLabel();
	updateMapModeButtonStates();
}

function setModifyOnMapMode(mode) {
	if (!mapEditState.active) return;
	if (!['move', 'add', 'remove'].includes(mode)) return;
	mapEditState.mode = mode;
	updateMapEditStatusLabel();
	updateMapModeButtonStates();
}

function toggleModifyOnMap() {
	if (!state.map) {
		alert('Map is not ready yet.');
		return;
	}
	if (!window.editingRouteData || !window.editingRouteData.points || window.editingRouteData.points.length < 2) {
		alert('Load a route in Edit Route before using Modify on Map.');
		return;
	}

	if (mapEditState.active) {
		clearMapModifyMode();
		return;
	}

	mapEditState.active = true;
	mapEditState.mode = 'move';
	mapEditState.source = new ol.source.Vector();
	mapEditState.layer = new ol.layer.Vector({
		source: mapEditState.source,
		zIndex: 2500
	});
	state.map.addLayer(mapEditState.layer);

	mapEditState.clickKey = state.map.on('singleclick', handleMapEditClick);
	refreshMapEditFeatures();

	// Minimize edit dialog, show FAB
	const editDialog = document.getElementById('editRouteDialog');
	if (editDialog) editDialog.style.display = 'none';
	const fab = document.getElementById('mapEditFAB');
	if (fab) fab.style.display = '';

	const btn = document.getElementById('modifyOnMapBtn');
	if (btn) btn.textContent = '🛑 Exit Map Modify';
	updateMapEditStatusLabel();
	updateMapModeButtonStates();
}

function updateEditingPointField(index, field, value) {
	if (!window.editingRouteData || !window.editingRouteData.points || !window.editingRouteData.points[index]) return;
	if (field === 'placeName') {
		window.editingRouteData.points[index].placeName = (value || '').trim() || `Point ${index + 1}`;
		return;
	}
	if (field === 'type') {
		window.editingRouteData.points[index].type = value || 'stop';
		if (mapEditState.active) {
			const feature = mapEditState.pointFeatures.find(f => f.get('editIndex') === index);
			if (feature) feature.setStyle(getEditPointStyle(window.editingRouteData.points[index].type));
		}
	}
}

async function showEditRouteDialog() {
	try {
		const allRouteData = await fetchRouteMetadata();

		// Store route data for sorting
		window.editDialogRouteData = allRouteData;

		// Add event listener for sort dropdown
		const sortDropdown = document.getElementById("routeSortDropdown");
		sortDropdown.onchange = () => populateRouteDropdown(allRouteData);

		// Initial population
		populateRouteDropdown(allRouteData);

		// Add event listener for route selection
		const dropdown = document.getElementById("editRouteDropdown");
		dropdown.onchange = loadRouteForEditing;

		document.getElementById("editRouteDialog").style.display = "block";
		updateMapEditStatusLabel();
		updateMapModeButtonStates();

	} catch (error) {
		console.error("Error loading routes:", error);
		alert("Error loading routes. Please try again.");
	}
}

function populateRouteDropdown(routeData) {
	const sortType = document.getElementById("routeSortDropdown").value;
	const dropdown = document.getElementById("editRouteDropdown");

	// Sort routes based on selected option
	let sortedRoutes = [...routeData];
	switch (sortType) {
		case 'name':
			sortedRoutes.sort((a, b) => a.name.localeCompare(b.name));
			break;
		case 'name-desc':
			sortedRoutes.sort((a, b) => b.name.localeCompare(a.name));
			break;
		case 'distance':
			sortedRoutes.sort((a, b) => a.distance - b.distance);
			break;
		case 'distance-desc':
			sortedRoutes.sort((a, b) => b.distance - a.distance);
			break;
	}

	// Clear and populate dropdown
	dropdown.innerHTML = '<option value="">-- Select a route --</option>';
	sortedRoutes.forEach(route => {
		const option = document.createElement("option");
		option.value = route.name;
		option.innerText = `${route.name} (${route.distance.toFixed(1)}km, ${route.pointCount} points)`;
		dropdown.appendChild(option);
	});
}

function closeEditRouteDialog() {
	clearMapModifyMode();
	document.getElementById("editRouteDialog").style.display = "none";
	document.getElementById("editRoutePoints").innerHTML = "";
}

async function loadRouteForEditing() {
	const routeName = document.getElementById("editRouteDropdown").value;
	const pointsContainer = document.getElementById("editRoutePoints");

	if (!routeName) {
		pointsContainer.innerHTML = "";
		// Hide delete button when no route is selected
		const deleteBtn = document.getElementById("deleteRouteBtn");
		if (deleteBtn) {
			deleteBtn.style.display = "none";
		}
		return;
	}

	try {
		let data = await loadRoute(routeName);
		if (!data) {
			alert(`Route '${routeName}' not found.`);
			return;
		}

		if (!data.points || data.points.length === 0) {
			pointsContainer.innerHTML = "<p>This route has no saved points.</p>";
			return;
		}

		// Store the current route data for saving
		window.editingRouteData = data;
		window.editingRouteName = routeName;
		renderEditablePointsList();
		if (mapEditState.active) {
			refreshMapEditFeatures();
			updateMapEditStatusLabel();
			updateMapModeButtonStates();
		}

		// Show delete button when route is loaded
		const deleteBtn = document.getElementById("deleteRouteBtn");
		if (deleteBtn) {
			deleteBtn.style.display = "block";
		}

	} catch (error) {
		console.error("Error loading route for editing:", error);
		alert("Error loading route. Please try again.");
	}
}

async function saveEditedRoute() {
	if (!window.editingRouteData || !window.editingRouteName) {
		alert("No route selected for editing.");
		return;
	}

	const updatedPoints = [];
	const pointsContainer = document.getElementById("pointsList");

	if (!pointsContainer) {
		alert("No points to save.");
		return;
	}

	// Collect updated point data
	window.editingRouteData.points.forEach((originalPoint, index) => {
		const placeNameInput = document.getElementById(`placeName_${index}`);
		const pointTypeSelect = document.getElementById(`pointType_${index}`);

		if (placeNameInput && pointTypeSelect) {
			const updatedPoint = {
				latlng: originalPoint.latlng, // Keep original coordinates
				placeName: placeNameInput.value.trim() || `Point ${index + 1}`,
				type: pointTypeSelect.value
			};
			updatedPoints.push(updatedPoint);
		}
	});

	if (updatedPoints.length === 0) {
		alert("No valid points to save.");
		return;
	}

	// Prepare route data for saving
	const routeData = {
		route_name: window.editingRouteName,
		points: updatedPoints.map(point => ({
			latlng: convertToArrayFormat(point.latlng), // Convert to array format [lat, lng]
			placeName: point.placeName,
			type: point.type
		})),
		total_distance: window.editingRouteData.total_distance
	};

	console.log("🚀 Sending edited route data:", routeData); // Debug log

	try {
		const result = await saveRoute(routeData);

		if (result.ok) {
			alert(`✅ Route "${window.editingRouteName}" updated on this device.`);
			closeEditRouteDialog();
		} else {
			alert(`❌ Failed to update route: ${result.message}`);
		}

	} catch (error) {
		console.error("Error saving edited state.route:", error);
		alert("Error saving route. Please try again.");
	}
}

async function deleteSelectedRoute() {
	if (!window.editingRouteName) {
		alert("No route selected for deletion.");
		return;
	}

	// Confirmation dialog with route details
	const routeName = window.editingRouteName;
	const pointCount = window.editingRouteData?.points?.length || 0;
	const distance = window.editingRouteData?.total_distance || 0;

	const confirmMessage = `Are you sure you want to delete the state.route "${routeName}"?\n\nRoute details:\n• ${pointCount} points\n• ${distance} km total distance\n\n⚠️ This action cannot be undone.`;

	if (!confirm(confirmMessage)) {
		return;
	}

	try {
		const result = await deleteRoute(routeName);

		if (result.ok) {
			alert(`✅ Route "${routeName}" deleted from this device.`);

			// Clear the editing state
			window.editingRouteData = null;
			window.editingRouteName = null;

			// Refresh the dropdown and close dialog
			showEditRouteDialog();
		} else {
			alert(`❌ Failed to delete route: ${result.message || 'Unknown error'}`);
		}

	} catch (error) {
		console.error("Error deleting state.route:", error);
		alert("❌ Error deleting route. Please check your connection and try again.");
	}
}


// ===== ROAD ROUTING (OSRM) =====

// Fetch road-following route between stops using OSRM public API
// Returns an expanded route with intermediate road waypoints inserted between original stops
async function fetchRoadRoute(points) {
	if (!points || points.length < 2) return points;

	// Build OSRM coordinate string: lng,lat;lng,lat;...
	const coords = points.map(p => {
		const lat = p.latlng.lat;
		const lng = p.latlng.lng;
		return `${lng},${lat}`;
	}).join(';');

	const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&annotations=speed&alternatives=true`;

	try {
		const response = await fetch(url);
		if (!response.ok) {
			console.warn('OSRM routing failed, falling back to straight lines');
			return points;
		}

		const data = await response.json();
		if (!data.routes || data.routes.length === 0) {
			console.warn('No OSRM route found, falling back to straight lines');
			return points;
		}

		// Store all alternatives for the selection UI
		state.roadAlternatives = data.routes.map((r, i) => ({
			index: i,
			distance: r.distance,   // metres
			duration: r.duration,   // seconds
			coords: r.geometry.coordinates
		}));

		// If more than one route found, let the user pick
		let selectedRouteIdx = 0;
		if (data.routes.length > 1) {
			selectedRouteIdx = await showRouteAlternativesUI(data.routes, points);
		}
		state.roadSelectedAlternative = selectedRouteIdx;

		const route = data.routes[selectedRouteIdx];

		// Aggregate step-level geometry for maximum road precision.
		// OSRM step geometry is denser and follows road curves more exactly than
		// the overview polyline (which is slightly simplified even with overview=full).
		const stepCoords = [];
		let prevStepCoord = null;
		if (route.legs) {
			for (const leg of route.legs) {
				if (leg.steps) {
					for (const step of leg.steps) {
						if (step.geometry && step.geometry.coordinates) {
							for (const c of step.geometry.coordinates) {
								if (!prevStepCoord || c[0] !== prevStepCoord[0] || c[1] !== prevStepCoord[1]) {
									stepCoords.push(c);
									prevStepCoord = c;
								}
							}
						}
					}
				}
			}
		}
		// Prefer step-level geometry (denser) over the overview geometry
		const routeCoords = stepCoords.length > 2 ? stepCoords : route.geometry.coordinates; // Array of [lng, lat]

		// Extract modelled travel speed per coord (m/s → km/h) from OSRM speed annotation
		const coordSpeedLimits = new Array(routeCoords.length).fill(null);
		let globalAnnotationIdx = 0;
		if (route.legs) {
			for (const leg of route.legs) {
				const speeds = leg.annotation && leg.annotation.speed ? leg.annotation.speed : [];
				for (let ni = 0; ni < speeds.length; ni++) {
					const idx = globalAnnotationIdx + ni;
					if (idx < coordSpeedLimits.length && speeds[ni] != null) {
						coordSpeedLimits[idx] = speeds[ni] * 3.6; // m/s → km/h
					}
				}
				if (speeds.length > 0) globalAnnotationIdx += speeds.length;
				else if (leg.steps) {
					// Fallback to step-level speed
					for (const step of leg.steps) {
						if (step.geometry && step.geometry.coordinates) {
							const stepSpeed = step.distance > 0 && step.duration > 0
								? (step.distance / step.duration) * 3.6
								: 50;
							for (let i = 0; i < step.geometry.coordinates.length; i++) {
								if (globalAnnotationIdx < coordSpeedLimits.length) {
									coordSpeedLimits[globalAnnotationIdx++] = stepSpeed;
								}
							}
						}
					}
				}
			}
		}
		// Fill remaining nulls with 50 km/h urban default
		for (let i = 0; i < coordSpeedLimits.length; i++) {
			if (coordSpeedLimits[i] == null) coordSpeedLimits[i] = 50;
		}

		// Map each original point to its nearest OSRM coord index
		const originalIndices = [];
		for (const origPoint of points) {
			let bestIdx = 0;
			let bestDist = Infinity;
			for (let i = 0; i < routeCoords.length; i++) {
				const dist = calculateDistance(
					{ lat: origPoint.latlng.lat, lng: origPoint.latlng.lng },
					{ lat: routeCoords[i][1], lng: routeCoords[i][0] }
				);
				if (dist < bestDist) {
					bestDist = dist;
					bestIdx = i;
				}
			}
			originalIndices.push(bestIdx);
		}

		// Keep only real route points for simulation logic, but snap each one to road.
		// This prevents OSRM micro-points from being treated as actual stop/waypoint nodes.
		const snappedPoints = points.map((pt, i) => {
			const snappedIdx = originalIndices[i];
			const snappedCoord = routeCoords[snappedIdx];
			const snapped = {
				...pt,
				latlng: {
					lat: snappedCoord[1],
					lng: snappedCoord[0]
				}
			};

			// Surface nearest-road speed value for debug/introspection if needed.
			if (coordSpeedLimits[snappedIdx] != null) {
				snapped.speedLimit = coordSpeedLimits[snappedIdx];
			}

			return snapped;
		});

		// Store raw OSRM geometry for map drawing
		state.roadRouteGeometry = routeCoords;

		// ── Build roadSmoothRoute directly from OSRM coords ──────────────────
		// Each OSRM coord becomes a smoothRoute sub-point mapped to the correct
		// segment in state.route (= snappedPoints after this function returns).
		// We use originalIndices to figure out segment boundaries.
		const roadSmoothRoute = [];
		const roadSmoothDistances = [];
		const roadSegmentSpeedLimits = [];

		for (let p = 0; p < points.length - 1; p++) {
			const startIdx = originalIndices[p];
			const endIdx   = originalIndices[p + 1];
			const step     = startIdx <= endIdx ? 1 : -1;

			// Collect segment coords (exclusive of endIdx — added as start of next segment)
			const segCoords = [];
			const segSpeeds = [];
			for (let i = startIdx; step > 0 ? i < endIdx : i > endIdx; i += step) {
				segCoords.push({ lat: routeCoords[i][1], lng: routeCoords[i][0] });
				segSpeeds.push(coordSpeedLimits[i]);
			}

			if (segCoords.length === 0) continue;

			// Include the endpoint when calculating arc progress, even though it
			// belongs to the next segment in the combined path.
			const subDists = [];
			const endCoord = { lat: routeCoords[endIdx][1], lng: routeCoords[endIdx][0] };
			for (let i = 0; i < segCoords.length; i++) {
				subDists.push(calculateDistance(segCoords[i], segCoords[i + 1] || endCoord));
			}
			const totalSegDist = subDists.reduce((a, b) => a + b, 0) || 0.0001;

			let cumDist = 0;
			for (let i = 0; i < segCoords.length; i++) {
				roadSmoothRoute.push({
					lat: segCoords[i].lat,
					lng: segCoords[i].lng,
					originalIndex: p,
					originalProgress: cumDist / totalSegDist
				});
				roadSegmentSpeedLimits.push(segSpeeds[i] || 50);
				roadSmoothDistances.push(subDists[i]);
				cumDist += subDists[i];
			}
		}

		// Add the very final coord
		const lastCoordIdx = originalIndices[points.length - 1];
		roadSmoothRoute.push({
			lat: routeCoords[lastCoordIdx][1],
			lng: routeCoords[lastCoordIdx][0],
			originalIndex: points.length - 2,
			originalProgress: 1.0
		});
		roadSegmentSpeedLimits.push(coordSpeedLimits[lastCoordIdx] || 50);

		state.roadSmoothRoute = roadSmoothRoute;
		state.roadSmoothDistances = roadSmoothDistances;
		state.roadSegmentSpeedLimits = roadSegmentSpeedLimits;

		console.log(`🛣️ Road route: ${snappedPoints.length} snapped stops | ${roadSmoothRoute.length} OSRM smooth sub-points`);
		return snappedPoints;

	} catch (error) {
		console.warn('OSRM routing error, falling back to straight lines:', error.message);
		return points;
	}
}

// ── OSRM Route Alternatives picker ───────────────────────────────────────────
// Draws all alternatives as coloured lines and shows a selection card.
// Returns a Promise<number> resolving to the chosen route index.
function showRouteAlternativesUI(routes, userPoints) {
	return new Promise((resolve) => {
		const COLORS = ['#3b82f6', '#f59e0b', '#a855f7']; // Blue, Amber, Purple

		// Draw all alternatives on the map
		const altFeatures = routes.map((r, i) => {
			const f = new ol.Feature({
				geometry: new ol.geom.LineString(
					r.geometry.coordinates.map(c => ol.proj.fromLonLat([c[0], c[1]]))
				)
			});
			f.setStyle(new ol.style.Style({
				stroke: new ol.style.Stroke({
					color: COLORS[i] || '#ffffff',
					width: i === 0 ? 5 : 3,
					lineDash: i === 0 ? null : [8, 6]
				})
			}));
			return f;
		});
		if (state.vectorLayer) {
			altFeatures.forEach(f => state.vectorLayer.getSource().addFeature(f));
		}

		function cleanup(chosenIdx) {
			altFeatures.forEach(f => {
				if (state.vectorLayer) state.vectorLayer.getSource().removeFeature(f);
			});
			const overlay = document.getElementById('roadAltOverlay');
			if (overlay) overlay.remove();
			resolve(chosenIdx);
		}

		// Build selection card
		const overlay = document.createElement('div');
		overlay.id = 'roadAltOverlay';
		overlay.className = 'road-alt-overlay';

		const header = `<div class="road-alt-header"><span class="road-alt-title">🛣️ Choose Route</span><span class="road-alt-sub">${routes.length} options found</span></div>`;
		const cards = routes.map((r, i) => {
			const distKm = (r.distance / 1000).toFixed(1);
			const durMin = Math.round(r.duration / 60);
			const label  = i === 0 ? 'Fastest' : i === 1 ? 'Alternative' : 'Scenic';
			const dot    = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLORS[i]};margin-right:6px;"></span>`;
			return `
				<button class="road-alt-card" data-idx="${i}">
					<span class="road-alt-badge">${dot}${label}</span>
					<span class="road-alt-stat">🕐 ${durMin} min</span>
					<span class="road-alt-stat">📏 ${distKm} km</span>
				</button>`;
		}).join('');

		overlay.innerHTML = header + `<div class="road-alt-cards">${cards}</div>`;
		document.body.appendChild(overlay);

		overlay.querySelectorAll('.road-alt-card').forEach(btn => {
			btn.addEventListener('click', () => cleanup(parseInt(btn.dataset.idx, 10)));
		});

		// Zoom map to show all alternatives
		if (state.map && userPoints.length >= 2) {
			const allCoords = routes.flatMap(r => r.geometry.coordinates.map(c => ol.proj.fromLonLat([c[0], c[1]])));
			const extent = ol.extent.boundingExtent(allCoords);
			state.map.getView().fit(extent, { padding: [80, 80, 80, 80], duration: 600, maxZoom: 14 });
		}
	});
}

export { drawRoute, updateDistance, saveRouteToJson, undoLastPoint, toggleRouteMode };
export { showRouteDialog, closeRouteDialog, loadSelectedRoute, populateMainRouteDropdown };
export { showEditRouteDialog, closeEditRouteDialog, loadRouteForEditing, saveEditedRoute, deleteSelectedRoute };
export { toggleModifyOnMap, setModifyOnMapMode, updateEditingPointField };
export { populateRouteDropdown, getCoordinateDisplay, convertToArrayFormat, createHyperloopStationStyle };
export { showHelpBulb, hideHelpBulb, toggleWaypointInstructions, showWaypointInstructions, hideWaypointInstructions };
export { calculateMaxAchievableSpeed, calculateTotalRemainingDistance };
export { fetchRoadRoute };

if (typeof window !== 'undefined') {
	window.addEventListener('routes:changed', async () => {
		const loadDialog = document.getElementById('routeDialog');
		const editDialog = document.getElementById('editRouteDialog');
		if (loadDialog?.style.display !== 'block' && editDialog?.style.display !== 'block') return;
		try {
			const routes = await fetchRouteMetadata();
			const selectedEditRoute = document.getElementById('editRouteDropdown')?.value;
			if (loadDialog?.style.display === 'block') {
				window.mainDialogRouteData = routes;
				populateMainRouteDropdown(routes);
			}
			if (editDialog?.style.display === 'block') {
				window.editDialogRouteData = routes;
				populateRouteDropdown(routes);
				if (selectedEditRoute && [...document.getElementById('editRouteDropdown').options].some(option => option.value === selectedEditRoute)) {
					document.getElementById('editRouteDropdown').value = selectedEditRoute;
					await loadRouteForEditing();
				}
			}
		} catch (error) {
			console.warn('Could not refresh route dialogs:', error);
		}
	});
}
export { isRouteLoop };