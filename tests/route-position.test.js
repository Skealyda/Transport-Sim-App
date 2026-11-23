import { describe, expect, it } from 'vitest';
import { sampleRoutePosition } from '../js/modules/routePosition.js';

describe('shared track position', () => {
	it('follows a curved path and joins the eased station rather than the original vertex', () => {
		const route = [{ latlng: { lat: 0, lng: 0 } }, { latlng: { lat: 0, lng: 1 } }, { latlng: { lat: 1, lng: 1 } }];
		const smooth = [
			{ lat: 0, lng: 0, originalIndex: 0, originalProgress: 0 },
			{ lat: 0.2, lng: 0.5, originalIndex: 0, originalProgress: 0.5 },
			{ lat: 0.25, lng: 0.75, originalIndex: 1, originalProgress: 0 },
			{ lat: 1, lng: 1, originalIndex: 2, originalProgress: 1 }
		];
		expect(sampleRoutePosition(route, smooth, 0, 0.5).lat).toBeCloseTo(0.2);
		expect(sampleRoutePosition(route, smooth, 0, 1).lng).toBeCloseTo(0.75);
		expect(sampleRoutePosition(route, smooth, 1, 0).lng).toBeCloseTo(0.75);
		expect(sampleRoutePosition(route, null, 0, 0.5).lng).toBeCloseTo(0.5);
	});
});
