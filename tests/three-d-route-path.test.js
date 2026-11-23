import { describe, expect, it } from 'vitest';
import { calculateDistance } from '../js/modules/utils.js';
import { createRoutePath } from '../js/modules/three-d/routePath.js';

describe('3D route path', () => {
	it('projects a vehicle onto the route and places coaches by physical distance through a bend', () => {
		const path = createRoutePath([
			{ lng: 78, lat: 11 },
			{ lng: 78.001, lat: 11 },
			{ lng: 78.001, lat: 11.001 }
		]);
		const projected = path.project({ lng: 78.001, lat: 11.0005 });
		const coach = path.poseAt(projected.distance - 80);
		expect(projected.index).toBe(1);
		expect(coach.lng).toBeCloseTo(78.0008, 3);
		expect(coach.lat).toBeCloseTo(11, 5);
		expect(coach.bearing).toBeCloseTo(90, 0);
		expect(path.poseAt(projected.distance).bearing).toBeCloseTo(0, 0);
	});

	it('extrapolates behind the start, handles duplicates and wraps the date line', () => {
		expect(createRoutePath([{ lng: 1, lat: 1 }, { lng: 1, lat: 1 }])).toBeNull();
		const path = createRoutePath([{ lng: 179.999, lat: 0 }, { lng: -179.999, lat: 0 }]);
		expect(path.pointAt(path.length / 2).lng).toBeCloseTo(-180, 3);
		const behind = path.pointAt(-50);
		expect(calculateDistance(behind, path.vertices[0]) * 1000).toBeCloseTo(50, 0);
		expect(path.project({ lng: -179.9995, lat: 0 }).distance).toBeCloseTo(path.length * 0.75, 0);
	});

	it('recovers from a stale projection hint after a large position jump', () => {
		const path = createRoutePath(Array.from({ length: 250 }, (_, i) => ({ lng: 78 + i * 0.001, lat: 11 })));
		const result = path.project({ lng: 78.22, lat: 11 }, 0);
		expect(result.index).toBeGreaterThanOrEqual(219);
		expect(result.error).toBeLessThan(1);
	});
});
