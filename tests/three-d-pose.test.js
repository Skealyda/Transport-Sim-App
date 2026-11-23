import { describe, expect, it, vi } from 'vitest';
import { getVehiclePose, offsetPosition, safeTerrainHeight } from '../js/modules/three-d/pose.js';

describe('3D vehicle pose', () => {
	it('uses the rendered vehicle and the automatic simulation bearing and speed', () => {
		const toLonLat = vi.fn(() => [78.7, 11.1]);
		const state = {
			movingFeature: { getGeometry: () => ({ getCoordinates: () => [100, 200] }) },
			route: [{ latlng: { lng: 77, lat: 10 } }],
			currentBearing: 45, previousAngle: 10, currentDisplaySpeed: 123,
			manualControlState: { isManualMode: false }
		};
		expect(getVehiclePose(state, toLonLat)).toEqual({ lng: 78.7, lat: 11.1, bearing: 45, speed: 123 });
		expect(toLonLat).toHaveBeenCalledWith([100, 200]);
	});

	it('uses the live heading and manual speed', () => {
		const state = {
			movingFeature: { getGeometry: () => ({ getCoordinates: () => [0, 0] }) },
			currentBearing: 45, previousAngle: 180, currentDisplaySpeed: 120,
			manualControlState: { isManualMode: true, currentSpeed: 25 }
		};
		expect(getVehiclePose(state, coords => coords)).toEqual({ lng: 0, lat: 0, bearing: 45, speed: 25 });
	});

	it('uses a route start when no vehicle exists and rejects missing coordinates', () => {
		expect(getVehiclePose({ route: [{ latlng: { lng: 0, lat: 0 } }] }, vi.fn()))
			.toEqual({ lng: 0, lat: 0, bearing: 0, speed: 0 });
		expect(getVehiclePose({ route: [] }, vi.fn())).toBeNull();
	});
});

describe('3D chase offset', () => {
	it('keeps the correct distance and direction at high latitudes', () => {
		const behind = offsetPosition(70, 60, 270, 1000);
		expect(behind.lat).toBeCloseTo(60, 4);
		expect(behind.lng).toBeCloseTo(69.982, 3);
	});

	describe('terrain height used by 3D cameras', () => {
		it('rejects missing and invalid coarse-tile elevations while retaining real terrain heights', () => {
			expect(safeTerrainHeight(undefined)).toBe(0);
			expect(safeTerrainHeight(-67144)).toBe(0);
			expect(safeTerrainHeight(-10)).toBe(0);
			expect(safeTerrainHeight(1800)).toBe(1800);
		});
	});

	it('wraps longitude across the date line', () => {
		const result = offsetPosition(179.999, 0, 90, 1000);
		expect(result.lng).toBeLessThan(-179.99);
		expect(result.lat).toBeCloseTo(0, 6);
	});
});
