import { describe, expect, it } from 'vitest';
import { createGeoScenery, GeoSceneryError, pointInPolygon } from '../js/modules/three-d/geoScenery.js';

const ring = (west, south, east, north) => [
	[west, south], [east, south], [east, north], [west, north], [west, south]
];
const feature = (id, properties, geometry) => ({ type: 'Feature', id, properties, geometry });
const polygon = (...rings) => ({ type: 'Polygon', coordinates: rings });
const collection = (...features) => ({ type: 'FeatureCollection', features });

describe('geographic scenery', () => {
	it('normalizes polygons and holes without mutating input, including footprint metadata', () => {
		const input = collection(feature('house', { building: 'yes', height: '12.5 m', 'building:levels': '3' },
			polygon(ring(0, 0, 10, 10), ring(3, 3, 7, 7))));
		const original = structuredClone(input);
		const scene = createGeoScenery(input);
		expect(input).toEqual(original);
		expect(scene.footprints).toHaveLength(1);
		const footprint = scene.footprints[0];
		expect(footprint).toMatchObject({ id: 'house', heightMetres: 12.5, levels: 3 });
		expect(footprint.polygons[0].outer[0]).toEqual({ lng: 0, lat: 0 });
		expect(pointInPolygon({ lng: 2, lat: 2 }, footprint.polygons[0])).toBe(true);
		expect(pointInPolygon({ lng: 5, lat: 5 }, footprint.polygons[0])).toBe(false);
		expect(pointInPolygon({ lng: 0, lat: 5 }, footprint.polygons[0])).toBe(true);
		expect(pointInPolygon({ lng: 3, lat: 5 }, footprint.polygons[0])).toBe(false);
		expect(scene.classify({ lng: 5, lat: 5 }).category).toBeNull();
		input.features[0].geometry.coordinates[0][0][0] = 50;
		expect(footprint.polygons[0].outer[0].lng).toBe(0);
	});

	it('classifies overlaps by fixed priority and returns all matching records and footprints', () => {
		const area = polygon(ring(0, 0, 10, 10));
		const scene = createGeoScenery(collection(
			feature('grass', { landuse: 'meadow' }, area),
			feature('forest', { natural: 'wood' }, area),
			feature('field', { landuse: 'farmland' }, area),
			feature('lake', { natural: 'water' }, area),
			feature('house', { building: 'residential', landuse: 'forest' }, area),
			feature('not-house', { building: 'no' }, area)
		));
		const result = scene.classify({ lng: 2, lat: 2 });
		expect(result.category).toBe('building');
		expect(result.categories).toEqual(['building', 'water', 'forest', 'farmland', 'grass']);
		expect(result.matches.map(record => record.id)).toEqual(['grass', 'forest', 'field', 'lake', 'house']);
		expect(result.footprints.map(record => record.id)).toEqual(['house']);
		expect(scene.classify({ lng: 20, lat: 2 })).toEqual({
			category: null, categories: [], matches: [], footprints: []
		});
	});

	it('handles multipolygons, geometry collections and dateline crossings', () => {
		const scene = createGeoScenery(collection(
			feature(9, { landuse: 'forest' }, { type: 'MultiPolygon', coordinates: [
				[ring(0, 0, 2, 2)], [ring(4, 4, 6, 6), ring(4.5, 4.5, 5.5, 5.5)]
			] }),
			feature('date', { landuse: 'grass' }, { type: 'GeometryCollection', geometries: [
				{ type: 'Point', coordinates: [0, 0] },
				polygon([[179, -1], [-179, -1], [-179, 1], [179, 1], [179, -1]])
			] })
		));
		expect(scene.records[0].polygons).toHaveLength(2);
		expect(scene.classify({ lng: 1, lat: 1 }).category).toBe('forest');
		expect(scene.classify({ lng: 5, lat: 5 }).category).toBeNull();
		expect(scene.classify({ lng: 179.5, lat: 0 }).category).toBe('grass');
		expect(scene.classify({ lng: -179.5, lat: 0 }).category).toBe('grass');
		expect(scene.classify({ lng: 0, lat: -0.5 }).category).toBeNull();
		expect(scene.classify({ lng: 0, lat: 0 }).category).toBe('forest');
	});

	it('distinguishes empty and ignored valid features from unavailable data', () => {
		const scene = createGeoScenery(collection(
			feature('point', { building: 'yes' }, { type: 'Point', coordinates: [1, 2] }),
			feature('null', null, null),
			feature('other', { amenity: 'school' }, polygon(ring(0, 0, 1, 1)))
		));
		expect(createGeoScenery(collection()).records).toEqual([]);
		expect(scene.records).toEqual([]);
		expect(scene.classify({ lng: 0, lat: 0 }).category).toBeNull();
		for (const value of [null, undefined]) {
			expect(() => createGeoScenery(value)).toThrowError(expect.objectContaining({
				name: 'GeoSceneryError', code: 'UNAVAILABLE'
			}));
		}
	});

	it.each([
		['wrong root', {}],
		['bad feature', collection({ type: 'Feature', properties: {} })],
		['unclosed ring', collection(feature('x', {}, polygon([[0, 0], [1, 0], [1, 1], [0, 1]])))],
		['non-finite coordinate', collection(feature('x', {}, polygon([[0, 0], [1, 0], [1, NaN], [0, 0]])))],
		['out-of-range coordinate', collection(feature('x', {}, polygon(ring(181, 0, 182, 1))))],
		['degenerate ring', collection(feature('x', {}, polygon([[0, 0], [1, 1], [2, 2], [0, 0]])))],
		['empty polygon', collection(feature('x', {}, polygon()))],
		['empty multipolygon', collection(feature('x', {}, { type: 'MultiPolygon', coordinates: [] }))],
		['invalid point', collection(feature('x', {}, { type: 'Point', coordinates: [NaN, 0] }))],
		['invalid line', collection(feature('x', {}, { type: 'LineString', coordinates: [[0, 0]] }))],
		['unknown geometry', collection(feature('x', {}, { type: 'Nope', coordinates: [] }))]
	])('rejects %s even on unclassified features', (_name, input) => {
		expect(() => createGeoScenery(input)).toThrowError(expect.objectContaining({
			name: 'GeoSceneryError', code: 'INVALID_DATA'
		}));
	});

	it('rejects invalid query points and malformed normalized polygons explicitly', () => {
		const scene = createGeoScenery(collection());
		expect(() => scene.classify({ lng: 181, lat: 0 })).toThrow(GeoSceneryError);
		expect(() => pointInPolygon({ lng: 0, lat: NaN }, { outer: [], holes: [] })).toThrow(GeoSceneryError);
		expect(() => pointInPolygon({ lng: 0, lat: 0 }, { outer: [], holes: [] })).toThrow(GeoSceneryError);
	});
});
