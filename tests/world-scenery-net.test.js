import { describe, expect, it } from 'vitest';
import { categorizeSatelliteRgb, deriveSatelliteScenery, satelliteTileIndices, satelliteTileUrl } from '../js/modules/net/worldScenery.js';

describe('world satellite coordinates', () => {
	it('wraps satellite tile indices and produces the pinned Esri endpoint', () => {
		expect(satelliteTileIndices(0, 0, 2)).toMatchObject({ zoom: 2, tileX: 2, tileY: 2 });
		expect(satelliteTileUrl(14, 8192, 5461)).toContain('/tile/14/5461/8192');
		expect(satelliteTileUrl(2, -1, 4)).toContain('/tile/2/0/3');
	});

	it('classifies vegetation and structure colours conservatively', () => {
		expect(categorizeSatelliteRgb(45, 100, 38)).toBe('forest');
		expect(categorizeSatelliteRgb(150, 95, 72)).toBe('building');
		expect(categorizeSatelliteRgb(5, 5, 5)).toBe('none');
	});

	it('derives batched location footprints from loaded satellite pixels', () => {
		const width = 768;
		const pixels = new Uint8ClampedArray(width * width * 4);
		for (let index = 0; index < pixels.length; index += 4) {
			pixels[index] = 160;
			pixels[index + 1] = 110;
			pixels[index + 2] = 75;
			pixels[index + 3] = 255;
		}
		const imagery = {
			loaded: 9,
			metresPerPixel: 9,
			center: { lat: 11, lng: 78 },
			canvas: { width, height: width, getContext: () => ({ getImageData: () => ({ data: pixels }) }) }
		};
		const collection = deriveSatelliteScenery(imagery, [
			{ lat: 11, lng: 78 }, { lat: 11.002, lng: 78.002 }
		]);
		expect(collection.features.length).toBeGreaterThan(0);
		expect(collection.features.every(feature => feature.properties.source === 'satellite-derived')).toBe(true);
		expect(collection.features.every(feature => feature.geometry.coordinates[0].length === 5)).toBe(true);
	});
});
