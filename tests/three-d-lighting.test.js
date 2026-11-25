import { expect, it } from 'vitest';
import { resolveEnvironmentDate, resolveEnvironmentWeather, solarDirection, solarElevation, tunnelLightingBand } from '../js/modules/three-d/worldView.js';

it('uses UTC and route longitude for daytime and nighttime', () => {
	const middayIndia = new Date('2025-03-20T06:30:00Z');
	const midnightIndia = new Date('2025-03-20T18:30:00Z');
	expect(solarElevation(middayIndia, 11, 78)).toBeGreaterThan(1);
	expect(solarElevation(midnightIndia, 11, 78)).toBeLessThan(-1);
	expect(solarElevation(middayIndia, 11, -102)).toBeLessThan(-1);
	expect(solarDirection(new Date('2025-03-20T01:00:00Z'), 11, 78).east).toBeGreaterThan(0.9);
	expect(solarDirection(new Date('2025-03-20T13:00:00Z'), 11, 78).east).toBeLessThan(-0.9);
});

it('keeps station surfaces bright and tunnel light pools fixed along the track', () => {
	const stations = [{ distance: 500 }];
	expect(tunnelLightingBand(500, stations)).toBe(3);
	expect(tunnelLightingBand(400, stations)).toBe(3);
	expect(tunnelLightingBand(0, stations)).toBe(2);
	expect(tunnelLightingBand(8, stations)).toBe(1);
	expect(tunnelLightingBand(16, stations)).toBe(0);
	expect(tunnelLightingBand(-8, stations)).toBe(1);
	expect(tunnelLightingBand(32, stations)).toBe(tunnelLightingBand(0, stations));
});

it('applies a route-local manual 3D time and explicit weather override', () => {
	const date = resolveEnvironmentDate(
		new Date('2025-03-20T03:00:00Z'),
		78,
		{ timeMode: 'custom', customTime: '12:00' }
	);
	expect(date.toISOString()).toBe('2025-03-20T06:48:00.000Z');
	expect(solarElevation(date, 11, 78)).toBeGreaterThan(1);
	expect(resolveEnvironmentWeather('Heavy Rain', { weather: 'clear' })).toBe('Clear');
	expect(resolveEnvironmentWeather('Heavy Rain', { weather: 'live' })).toBe('Heavy Rain');
});
