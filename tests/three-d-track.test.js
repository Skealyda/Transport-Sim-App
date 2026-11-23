import { describe, expect, it } from 'vitest';
import { calculateDistance } from '../js/modules/utils.js';
import { buildRailLines } from '../js/modules/three-d/track.js';

describe('3D ground track', () => {
	it.each([
		[{ lat: 11, lng: 78 }, { lat: 11.01, lng: 78 }],
		[{ lat: 60, lng: 70 }, { lat: 60, lng: 70.01 }]
	])('offsets two rails by Indian broad gauge at each route point', (start, end) => {
		const rails = buildRailLines([start, end]);
		for (let i = 0; i < rails.left.length; i += 2) {
			const left = { lng: rails.left[i], lat: rails.left[i + 1] };
			const right = { lng: rails.right[i], lat: rails.right[i + 1] };
			expect(calculateDistance(left, right) * 1000).toBeCloseTo(1.676, 2);
		}
	});

	it('removes duplicate points and avoids a spurious track for an invalid route', () => {
		const a = { lat: 11, lng: 78 };
		const b = { lat: 11.01, lon: 78 };
		expect(buildRailLines([a, a, b]).left).toHaveLength(4);
		expect(buildRailLines([a, a])).toBeNull();
		expect(buildRailLines([{ lat: NaN, lng: 0 }, a])).toBeNull();
	});
});
