import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
	buildCabTelemetry,
	createCabControls,
	projectRouteNavigation
} from '../js/modules/three-d/cabControls.js';

afterEach(() => vi.unstubAllGlobals());

function canvasDocument() {
	const surfaces = [];
	const createElement = vi.fn(() => {
		const context = {
			fillRect: vi.fn(),
			fillText: vi.fn(),
			beginPath: vi.fn(),
			moveTo: vi.fn(),
			lineTo: vi.fn(),
			arc: vi.fn(),
			stroke: vi.fn(),
			fill: vi.fn()
		};
		const surface = { width: 0, height: 0, context, getContext: () => context };
		surfaces.push(surface);
		return surface;
	});
	vi.stubGlobal('document', { createElement, getElementById: () => null });
	return surfaces;
}

function testState() {
	return {
		route: [
			{ latlng: { lat: 11, lng: 78 }, placeName: 'Origin' },
			{ latlng: { lat: 11.1, lng: 78.1 }, placeName: 'Unnamed waypoint', type: 'waypoint' },
			{ latlng: { lat: 11.2, lng: 78.2 }, placeName: 'Central' }
		],
		segmentDistances: [10, 15],
		index: 0,
		progress: 0.25,
		currentGForce: 0.08,
		currentTrackGrade: -2.4,
		currentTunnelDepth: 18,
		currentTrackSection: 'Ramp',
		scheduleStatus: { label: '1m 20s late' },
		weatherCardState: {
			currentWeatherData: { condition: 'Light rain', temperature: 26 }
		},
		manualControlState: {
			isManualMode: true,
			autopilotActive: true,
			maxSpeed: 120,
			currentSpeed: 72,
			targetSpeed: 100,
			acceleration: 64,
			brakeLevel: 12,
			doorsOpen: true
		}
	};
}

describe('3D locomotive cab controls', () => {
	it('derives the complete live DMI state from the simulator state', () => {
		const telemetry = buildCabTelemetry(testState());
		expect(telemetry).toMatchObject({
			speed: 72,
			limit: 100,
			nextStop: 'Central',
			nextStopIndex: 2,
			distanceKm: 22.5,
			eta: '18m 45s',
			schedule: 'Manual control',
			weather: 'Light rain 26°C',
			doors: 'OPEN',
			mode: 'AUTOPILOT',
			power: 64,
			brake: 12,
			gForce: 0.08,
			gradePercent: -2.4,
			tunnelDepth: 18,
			trackSection: 'Ramp'
		});
	});

	it('projects route geometry, the train and the next station into the GPS canvas', () => {
		const state = testState();
		state.smoothRoute = [
			{ lat: 11, lng: 78, originalIndex: 0, originalProgress: 0 },
			{ lat: 11.05, lng: 78.07, originalIndex: 0, originalProgress: 0.5 },
			{ lat: 11.1, lng: 78.1, originalIndex: 1, originalProgress: 0 },
			{ lat: 11.2, lng: 78.2, originalIndex: 1, originalProgress: 1 }
		];
		const navigation = projectRouteNavigation(state, 512, 400, 30);
		expect(navigation.points).toHaveLength(4);
		expect(navigation.marker.x).toBeCloseTo((navigation.points[0].x + navigation.points[1].x) / 2);
		expect(navigation.marker.y).toBeCloseTo((navigation.points[0].y + navigation.points[1].y) / 2);
		expect(navigation.nextStation).toMatchObject({
			x: expect.any(Number),
			y: expect.any(Number),
			name: 'Central'
		});
		for (const point of [...navigation.points, navigation.marker, navigation.nextStation]) {
			expect(point.x).toBeGreaterThanOrEqual(29);
			expect(point.x).toBeLessThanOrEqual(483);
			expect(point.y).toBeGreaterThanOrEqual(29);
			expect(point.y).toBeLessThanOrEqual(371);
		}
	});

	it('keeps raycast actions and drag/wheel contracts while animating bounded cab resources', () => {
		const surfaces = canvasDocument();
		const camera = new THREE.PerspectiveCamera(57, 1.6, 0.1, 100);
		const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }) };
		const state = testState();
		const actions = Object.fromEntries(['limit', 'power', 'brake', 'doors', 'horn', 'emergency', 'autopilot', 'wipers']
			.map(name => [name, vi.fn()]));
		const cab = createCabControls(THREE, camera, canvas, state, actions);
		cab.resize(camera.aspect);
		cab.update(0, true);

		const dmi = surfaces.find(surface => surface.width === 960).context;
		expect(dmi.fillText).toHaveBeenCalledWith('LOCOMOTIVE DRIVER MACHINE INTERFACE', 24, 31, undefined);
		expect(dmi.fillText).toHaveBeenCalledWith('Light rain 26°C', 24, 362, 195);
		expect(dmi.fillText).toHaveBeenCalledWith('-2.4%', expect.any(Number), 362, 130 - 10);
		const initialDmiDraws = dmi.fillRect.mock.calls.length;
		cab.update(50, true);
		expect(dmi.fillRect).toHaveBeenCalledTimes(initialDmiDraws);

		state.manualControlState.currentSpeed = 80;
		state.manualControlState.doorsOpen = false;
		cab.update(100, true);
		expect(dmi.fillText).toHaveBeenCalledWith('80', 40, 174, undefined);
		expect(dmi.fillText).toHaveBeenCalledWith('CLOSED', 229, 362, 90);

		const navigation = surfaces.find(surface => surface.width === 512).context;
		expect(navigation.moveTo).toHaveBeenCalled();
		expect(navigation.arc).toHaveBeenCalled();

		camera.updateMatrixWorld(true);
		function point(action) {
			let part;
			camera.traverse(object => {
				if (!part && object.userData.cabAction === action) part = object;
			});
			const projected = part.getWorldPosition(new THREE.Vector3()).project(camera);
			return { clientX: (projected.x + 1) * 400, clientY: (1 - projected.y) * 250 };
		}

		for (const action of ['doors', 'horn', 'emergency', 'autopilot']) {
			expect(cab.pointerDown(point(action))).toBe(true);
			expect(actions[action]).toHaveBeenCalledOnce();
		}
		expect(cab.pointerDown(point('wiper'))).toBe(true);
		expect(cab.getWipers()).toBe(true);
		expect(actions.wipers).toHaveBeenCalledWith(true);
		expect(cab.getDisplaysVisible()).toBe(true);
		expect(cab.pointerDown(point('screens'))).toBe(true);
		expect(cab.getDisplaysVisible()).toBe(false);
		expect(cab.toggleDisplays(true)).toBe(true);

		const wiper = camera.getObjectByName('locomotive-cab-desk').getObjectByName('cab-wiper');
		const powerController = camera.getObjectByName('locomotive-cab-desk').getObjectByName('power-controller');
		expect(powerController.scale.x).toBeCloseTo(0.58);
		cab.update(1000, true);
		const initialAngle = wiper.rotation.z;
		cab.update(1500, true);
		expect(wiper.rotation.z).not.toBe(initialAngle);
		cab.toggleWipers();
		expect(actions.wipers).toHaveBeenLastCalledWith(false);

		const limit = point('limit');
		expect(cab.wheel({ ...limit, deltaY: -1 })).toBe(true);
		expect(actions.limit).toHaveBeenCalledWith(105);
		expect(cab.pointerDown(limit)).toBe(true);
		cab.pointerMove({ ...limit, clientY: limit.clientY - 80 });
		expect(actions.limit).toHaveBeenLastCalledWith(120);
		cab.pointerUp();
		for (const action of ['power', 'brake']) {
			const start = point(action);
			state.manualControlState[action === 'power' ? 'acceleration' : 'brakeLevel'] = 0;
			expect(cab.pointerDown(start)).toBe(true);
			cab.pointerMove({ ...start, clientY: start.clientY - 80 });
			expect(actions[action]).toHaveBeenLastCalledWith(50);
			cab.pointerUp();
		}

		const resources = cab.getResourceCounts();
		for (let index = 0; index < 20; index++) {
			state.manualControlState.currentSpeed = index;
			cab.update(2000 + index * 100, true);
		}
		expect(cab.getResourceCounts()).toEqual(resources);
		expect(resources.geometries).toBeLessThan(30);
		expect(resources.materials).toBeLessThan(30);
		expect(resources.interactive).toBe(11);

		cab.dispose();
		expect(camera.children).toHaveLength(0);
	});
});
