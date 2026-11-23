import { describe, expect, it } from 'vitest';
import { createWorldRoute } from '../js/modules/three-d/worldRoute.js';
import { sampleRoutePosition } from '../js/modules/routePosition.js';

const route = [
	{ latlng: { lng: 78, lat: 11 }, placeName: 'A' },
	{ latlng: { lng: 78.02, lat: 11 }, type: 'waypoint' },
	{ latlng: { lng: 78.04, lat: 11 }, placeName: 'B', type: 'stop' }
];

describe('3D world route', () => {
	it('places only stops underground and maps manual progress to distance', () => {
		const world = createWorldRoute(route, null, true);
		expect(world.stations.map(s => s.name)).toEqual(['A', 'B']);
		expect(world.heightAt(0)).toBe(-28);
		expect(world.heightAt(world.path.length)).toBe(-28);
		expect(world.heightAt(-500)).toBe(-28);
		expect(world.heightAt(world.path.length + 500)).toBe(-28);
		expect(world.heightAt(world.boundaries[1])).toBe(0);
		expect(world.distanceAt(1, 0.5)).toBeCloseTo((world.boundaries[1] + world.path.length) / 2);
	});

	it('keeps adjacent stations connected underground without a surface gap', () => {
		const close = [
			{ latlng: { lng: 78, lat: 11 } },
			{ latlng: { lng: 78.018, lat: 11 } }
		];
		const world = createWorldRoute(close, null, true);
		expect(world.path.length).toBeLessThan(2000);
		for (let d = 0; d <= world.path.length; d += 100) {
			expect(world.heightAt(d)).toBe(-28);
			expect(world.isTunnelAt(d)).toBe(true);
		}
		expect(world.portals).toEqual([]);
	});

	it('places portals at actual tunnel transitions, not at waypoints or buried endpoints', () => {
		const world = createWorldRoute(route, null, true);
		expect(world.portals).toHaveLength(2);
		expect(world.portals.map(portal => portal.direction)).toEqual([-1, 1]);
		for (const portal of world.portals) {
			expect(world.heightAt(portal.distance)).toBe(0);
			expect(world.heightAt(portal.coverDistance)).toBeCloseTo(-8.5, 5);
			expect(portal.direction * (portal.coverDistance - portal.distance)).toBeGreaterThan(0);
			expect(world.isTunnelAt(portal.coverDistance + portal.direction)).toBe(true);
			expect(world.isTunnelAt(portal.distance)).toBe(false);
			expect(world.isRampAt(portal.distance + portal.direction * 100)).toBe(true);
		}
		expect(world.portals[0].distance).toBeLessThan(world.boundaries[1]);
		expect(world.portals[1].distance).toBeGreaterThan(world.boundaries[1]);
	});

	it('ramps smoothly between the surface and both tunnel portals', () => {
		const world = createWorldRoute(route, null, true);
		for (const portal of world.portals) {
			const start = portal.distance;
			const end = portal.distance + portal.direction * 900;
			let previous = world.heightAt(start);
			for (let i = 1; i <= 100; i++) {
				const height = world.heightAt(start + (end - start) * i / 100);
				expect(height).toBeLessThanOrEqual(previous + 1e-8);
				expect(Math.abs(height - previous)).toBeLessThan(0.5);
				previous = height;
			}
			expect(previous).toBeCloseTo(-28);
		}
	});

	it('reports meaningful route grade through a portal approach', () => {
		const world = createWorldRoute(route, null, true);
		const entering = world.portals.find(portal => portal.direction === 1);
		const exiting = world.portals.find(portal => portal.direction === -1);
		expect(world.gradeAt(entering.distance + 250)).toBeLessThan(-0.02);
		expect(world.gradeAt(exiting.distance - 250)).toBeGreaterThan(0.02);
	});

	it('does not make dummy route points underground stations', () => {
		const withDummy = route.map((point, index) => index === 1 ? { ...point, type: 'dummy' } : point);
		expect(createWorldRoute(withDummy, null, true).stations.map(station => station.index)).toEqual([0, 2]);
	});

	it('uses segment metadata rather than proximity at a crossing', () => {
		const crossing = [
			{ lng: 78, lat: 11, originalIndex: 0, originalProgress: 0 },
			{ lng: 78.01, lat: 11.01, originalIndex: 0, originalProgress: 0.5 },
			{ lng: 78.02, lat: 11, originalIndex: 1, originalProgress: 0 },
			{ lng: 78.01, lat: 11.01, originalIndex: 1, originalProgress: 0.5 },
			{ lng: 78, lat: 11, originalIndex: 2, originalProgress: 1 }
		];
		const world = createWorldRoute(route, crossing, false);
		expect(world.distanceAt(1, 0.5)).toBeCloseTo(world.path.cumulative[3]);
		expect(world.distanceAt(0, 0.5)).toBeCloseTo(world.path.cumulative[1]);
	});

	it('matches the shared 2D track position across eased segment boundaries', () => {
		const smooth = [
			{ lng: 78, lat: 11, originalIndex: 0, originalProgress: 0 },
			{ lng: 78.006, lat: 11.001, originalIndex: 0, originalProgress: 0.6 },
			{ lng: 78.009, lat: 11.002, originalIndex: 1, originalProgress: 0 },
			{ lng: 78.015, lat: 11.001, originalIndex: 1, originalProgress: 0.5 },
			{ lng: 78.02, lat: 11, originalIndex: 2, originalProgress: 1 }
		];
		const world = createWorldRoute(route, smooth, false);
		for (const [index, progress] of [[0, 0.3], [0, 0.9], [1, 0], [1, 0.7]]) {
			const expected = sampleRoutePosition(route, smooth, index, progress);
			const actual = world.path.pointAt(world.distanceAt(index, progress));
			expect(actual.lat).toBeCloseTo(expected.lat, 6);
			expect(actual.lng).toBeCloseTo(expected.lng, 6);
		}
	});

	it('rejects invalid and degenerate routes', () => {
		expect(() => createWorldRoute([], null, true)).toThrow();
		expect(() => createWorldRoute([{ latlng: { lng: 1, lat: 1 } }, { latlng: { lng: 1, lat: 1 } }], null, true)).toThrow();
	});
});
