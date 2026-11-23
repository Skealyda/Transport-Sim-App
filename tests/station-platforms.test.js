import { afterEach, describe, expect, it, vi } from 'vitest';
import state from '../js/modules/state.js';
import { createStationPlatforms, removeStationPlatforms } from '../js/modules/careerMode.js';
import { startPassengerTraffic, stopPassengerTraffic, processPassengerArrival } from '../js/modules/passengerTraffic.js';

class LineString {
	constructor(coordinates) { this.coordinates = coordinates; }
	setCoordinates(coordinates) { this.coordinates = coordinates; }
}

class Feature {
	constructor({ geometry }) { this.geometry = geometry; this.values = {}; }
	get(key) { return this.values[key]; }
	set(key, value) { this.values[key] = value; }
	getGeometry() { return this.geometry; }
	setStyle(style) { this.style = style; }
}

describe('2D rail station platforms', () => {
	const original = {};
	let features;

	afterEach(() => {
		stopPassengerTraffic();
		removeStationPlatforms();
		Object.assign(state, original);
		vi.unstubAllGlobals();
	});

	it('creates platform features for stops outside career mode but skips waypoints', () => {
		for (const key of ['route', 'smoothRoute', 'vectorSource', 'currentRouteType', 'world3D']) original[key] = state[key];
		features = [];
		state.route = [
			{ latlng: { lat: 0, lng: 0 }, placeName: 'Start', type: 'stop' },
			{ latlng: { lat: 0, lng: 1 }, placeName: 'Pass', type: 'waypoint' },
			{ latlng: { lat: 0, lng: 2 }, placeName: 'Finish', type: 'stop' }
		];
		state.smoothRoute = [];
		state.currentRouteType = 'rail';
		state.vectorSource = {
			addFeature: feature => features.push(feature),
			hasFeature: feature => features.includes(feature),
			removeFeature: feature => { features = features.filter(candidate => candidate !== feature); }
		};
		vi.stubGlobal('ol', {
			Feature,
			geom: { LineString },
			proj: { fromLonLat: ([lng, lat]) => [lng, lat] }
		});

		createStationPlatforms();

		expect(features).toHaveLength(2);
		expect(features.map(feature => feature.get('careerPlatformIdx'))).toEqual([0, 2]);
	});

	it('refreshes the 2D crowd and forwards the actual stop flow to 3D', () => {
		for (const key of ['route', 'smoothRoute', 'vectorSource', 'currentRouteType', 'world3D']) original[key] = state[key];
		features = [];
		state.route = [
			{ latlng: { lat: 0, lng: 0 }, placeName: 'Start', type: 'stop' },
			{ latlng: { lat: 0, lng: 1 }, placeName: 'Finish', type: 'stop' }
		];
		state.smoothRoute = [];
		state.currentRouteType = 'rail';
		state.vectorSource = {
			addFeature: feature => features.push(feature),
			hasFeature: feature => features.includes(feature),
			removeFeature: feature => { features = features.filter(candidate => candidate !== feature); }
		};
		const animatePassengerFlow = vi.fn();
		state.world3D = { animatePassengerFlow };
		vi.stubGlobal('ol', {
			Feature,
			geom: { LineString },
			proj: { fromLonLat: ([lng, lat]) => [lng, lat] }
		});
		startPassengerTraffic(state.route);
		createStationPlatforms();
		const waitingBeforeArrival = features[0].get('crowdDots').length;

		const flow = processPassengerArrival(0);

		expect(flow.boarded).toBe(waitingBeforeArrival);
		expect(features[0].get('crowdDots')).toHaveLength(0);
		expect(animatePassengerFlow).toHaveBeenCalledWith({ stopIndex: 0, ...flow });
	});
});
