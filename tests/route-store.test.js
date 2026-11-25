import { beforeAll, describe, expect, it } from 'vitest';

let normalizeRoute;
let parseRoutesDocument;

beforeAll(async () => {
	const storage = new Map();
	globalThis.localStorage = {
		getItem: key => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, String(value)),
		removeItem: key => storage.delete(key)
	};
	globalThis.window = {};
	({ normalizeRoute, parseRoutesDocument } = await import('../js/modules/routeStore.js'));
});

describe('route JSON import formats', () => {
	it('reads named route maps and common single-route exports', () => {
		const named = parseRoutesDocument({
			'Coastal line': {
				points: [
					{ latlng: [13.1, 80.2], placeName: 'Chennai' },
					{ latlng: { lat: 12.9, lng: 80.1 }, placeName: 'Tambaram' }
				],
				total_distance: '24.5'
			}
		});
		expect(named.routes['Coastal line'].total_distance).toBe(24.5);
		expect(named.routes['Coastal line'].points).toHaveLength(2);

		const single = parseRoutesDocument({
			route_name: 'Branch line',
			points: [
				{ latitude: 11, longitude: 77 },
				{ latitude: 11.1, longitude: 77.1 }
			]
		});
		expect(single.routes['Branch line'].total_distance).toBeGreaterThan(0);
	});

	it('reads wrapped arrays and GeoJSON LineString features', () => {
		const wrapped = parseRoutesDocument({
			routes: [
				{ name: 'One', points: [[10, 76], [10.1, 76.1]] },
				{ route_name: 'Two', points: [[9, 75], [9.1, 75.1]] }
			]
		});
		expect(Object.keys(wrapped.routes)).toEqual(['One', 'Two']);

		const geoJson = parseRoutesDocument({
			type: 'FeatureCollection',
			features: [{
				type: 'Feature',
				properties: { name: 'Geo route' },
				geometry: {
					type: 'LineString',
					coordinates: [[80.2, 13.1], [80.1, 12.9]]
				}
			}]
		});
		expect(geoJson.routes['Geo route'].points[0].latlng).toEqual([13.1, 80.2]);
	});

	it('rejects invalid coordinates and documents without routes', () => {
		expect(normalizeRoute({ points: [[95, 20], [10, 20]] })).toBeNull();
		expect(() => parseRoutesDocument({ message: 'not a route file' })).toThrow(/No valid routes/);
	});
});
