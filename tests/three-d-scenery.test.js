import { describe, expect, it } from 'vitest';
import { createRoutePath } from '../js/modules/three-d/routePath.js';
import { generateCorridorScenery } from '../js/modules/three-d/scenery.js';

describe('illustrative 3D corridor scenery', () => {
	it('is deterministic, bounded and stays outside the track corridor', () => {
		const path = createRoutePath([{ lng: 78, lat: 11 }, { lng: 78.1, lat: 11 }]);
		const scene = generateCorridorScenery(path, 500);
		expect(generateCorridorScenery(path, 500)).toEqual(scene);
		expect(scene.trees.length).toBeGreaterThan(40);
		expect(scene.trees.length).toBeLessThanOrEqual(120);
		expect(new Set(scene.trees.map(tree => tree.species)).size).toBe(5);
		expect(scene.buildings.length).toBeLessThanOrEqual(5);
		expect(scene.fields.length).toBeLessThanOrEqual(10);
		for (const point of [...scene.trees, ...scene.buildings]) {
			expect(path.project(point).error).toBeGreaterThan(13);
		}
		expect(generateCorridorScenery(path, 500, true).trees.length).toBeLessThan(scene.trees.length);
	});

	it('does not place scenery before a short route or beyond its end', () => {
		const path = createRoutePath([{ lng: 78, lat: 11 }, { lng: 78.0001, lat: 11 }]);
		const scene = generateCorridorScenery(path, 0);
		for (const point of scene.trees) {
			const projection = path.project(point);
			expect(projection.distance).toBeGreaterThanOrEqual(0);
			expect(projection.distance).toBeLessThanOrEqual(path.length);
		}
	});
});
