import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createProceduralTrain, disposeProceduralTrain } from '../js/modules/three-d/trainModel.js';

function named(train, name) {
	return train.getObjectByName(name);
}

describe('procedural 3D train model', () => {
	it('keeps locomotive and coaches as direct children in movement order', () => {
		const train = createProceduralTrain(THREE, 4, { locomotive: '#eeeeee', coach: '#225588' });
		expect(train.children).toHaveLength(4);
		expect(train.children.map(child => child.userData.trainPart)).toEqual([
			'locomotive', 'coach', 'coach', 'coach'
		]);
		expect(train.children.map(child => child.userData.trainIndex)).toEqual([0, 1, 2, 3]);
		expect(train.children.map(child => child.userData.length)).toEqual([18, 22, 22, 22]);
		expect(train.userData.trainDiagnostics.orderedChildren).toEqual([
			'locomotive', 'coach', 'coach', 'coach'
		]);
		disposeProceduralTrain(train);
	});

	it('includes detailed locomotive, coach and running-gear features', () => {
		const train = createProceduralTrain(THREE, 2);
		for (const name of [
			'locomotive-shell',
			'cab-windshields',
			'cab-side-windows',
			'locomotive-headlights',
			'roof-equipment',
			'pantograph',
			'locomotive-bogies',
			'locomotive-wheels',
			'coach-1',
			'coach-windows',
			'coach-door',
			'coach-roof-equipment',
			'coach-wheels'
		]) expect(named(train, name), name).toBeTruthy();

		const coach = train.children[1];
		expect(coach.children.filter(child => child.name === 'coach-door')).toHaveLength(4);
		expect(named(train, 'locomotive-front-coupler')).toBeTruthy();
		expect(named(train, 'coach-rear-coupler')).toBeTruthy();
		expect(train.userData.trainDiagnostics.features).toMatchObject({
			locomotiveShell: 1,
			windshields: 2,
			pantographs: 1,
			coaches: 1,
			doors: 4,
			wheels: 16
		});
		disposeProceduralTrain(train);
	});

	it('shares resources and batches repeated wheels and windows', () => {
		const train = createProceduralTrain(THREE, 3);
		const stats = train.userData.trainDiagnostics;
		expect(stats.sharedGeometries).toBe(3);
		expect(stats.sharedMaterials).toBe(11);
		expect(stats.instancedMeshes).toBeGreaterThan(20);
		expect(stats.instances).toBeGreaterThan(stats.meshCount);
		expect(stats.drawItems).toBeLessThan(stats.instances / 2);
		expect(named(train, 'locomotive-wheels')).toBeInstanceOf(THREE.InstancedMesh);
		expect(named(train, 'coach-windows')).toBeInstanceOf(THREE.InstancedMesh);
		disposeProceduralTrain(train);
		expect(train.userData.trainModelResources).toBeNull();
	});

	it('clamps invalid or absent coach counts to one locomotive', () => {
		for (const count of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
			const train = createProceduralTrain(THREE, count);
			expect(train.children).toHaveLength(1);
			expect(train.userData.trainDiagnostics.coaches).toBe(0);
			disposeProceduralTrain(train);
		}
	});
});
