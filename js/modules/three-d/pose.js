// Read the rendered vehicle rather than animation-specific position fields, so
// automatic and manual simulations share the same 3D pose.
export function getVehiclePose(state, toLonLat) {
	const coords = state.movingFeature?.getGeometry()?.getCoordinates();
	let lng;
	let lat;
	if (coords) {
		[lng, lat] = toLonLat(coords);
	} else {
		const start = state.route?.[0]?.latlng || state.route?.[0];
		lng = start?.lng;
		lat = start?.lat;
	}
	if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

	const manual = state.manualControlState?.isManualMode;
	const bearing = state.currentBearing ?? state.previousAngle;
	const speed = manual ? state.manualControlState.currentSpeed : state.currentDisplaySpeed;
	return {
		lng, lat,
		bearing: Number.isFinite(bearing) ? bearing : 0,
		speed: Number.isFinite(speed) ? speed : 0
	};
}

// Destination on the sphere, used for a consistent chase offset at any latitude.
export function offsetPosition(lng, lat, bearing, distance) {
	const radians = Math.PI / 180;
	const angularDistance = distance / 6371008.8;
	const latitude = lat * radians;
	const longitude = lng * radians;
	const direction = bearing * radians;
	const resultLat = Math.asin(Math.sin(latitude) * Math.cos(angularDistance) +
		Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(direction));
	const resultLng = longitude + Math.atan2(
		Math.sin(direction) * Math.sin(angularDistance) * Math.cos(latitude),
		Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(resultLat)
	);
	return { lng: ((resultLng / radians + 540) % 360) - 180, lat: resultLat / radians };
}

// Coarse, still-loading globe tiles can report heights far below the Earth's surface.
export function safeTerrainHeight(height) {
	return Number.isFinite(height) && height >= -500 && height <= 9000 ? Math.max(0, height) : 0;
}
