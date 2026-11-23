import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createTreeModels } from '../js/modules/three-d/treeModels.js';

describe('procedural 3D tree models', () => {
	it('builds detailed, finite bark and foliage geometry for each species', () => {
		const models = createTreeModels(THREE);
		expect(models).toHaveLength(5);
		for (const { bark, leaves } of models) {
			expect(bark.attributes.position.count).toBeGreaterThan(100);
			expect(leaves.attributes.position.count).toBeGreaterThanOrEqual(300);
			for (const geometry of [bark, leaves]) {
				expect(Array.from(geometry.attributes.position.array).every(Number.isFinite)).toBe(true);
				expect(Array.from(geometry.attributes.normal.array).every(Number.isFinite)).toBe(true);
				geometry.computeBoundingBox();
				expect(geometry.boundingBox.max.y).toBeGreaterThan(0.7);
				expect(geometry.boundingBox.max.x - geometry.boundingBox.min.x).toBeGreaterThan(0.03);
				geometry.dispose();
			}
		}
	});

	it('creates distinct broadleaf, conifer and palm silhouettes', () => {
		const models = createTreeModels(THREE);
		const counts = [0, 2, 4].map(index => models[index].leaves.attributes.position.count);
		expect(new Set(counts).size).toBe(3);
		models.forEach(({ bark, leaves }) => { bark.dispose(); leaves.dispose(); });
	});
});
