import { describe, expect, it } from 'vitest';
import {
	defaultGraphicsQuality,
	nextAdaptivePixelRatio,
	normalizeGraphicsQuality,
	readGraphicsTelemetry,
	resolveGraphicsQuality
} from '../js/modules/graphicsQuality.js';

describe('3D graphics quality configuration', () => {
	it('uses browser-safe defaults and validates presets', () => {
		expect(defaultGraphicsQuality({ mobile: true, hardwareConcurrency: 8 })).toBe('performance');
		expect(defaultGraphicsQuality({ mobile: false, hardwareConcurrency: 2 })).toBe('performance');
		expect(defaultGraphicsQuality({ mobile: false, hardwareConcurrency: 8 })).toBe('balanced');
		expect(normalizeGraphicsQuality('ultra')).toBeNull();
	});

	it('caps resolution and expensive parameters in Performance Mode', () => {
		const config = resolveGraphicsQuality('high', {
			devicePixelRatio: 3,
			viewportWidth: 1440,
			performanceMode: true
		});
		expect(config.pixelRatio).toBe(1);
		expect(config.shadows).toBe(false);
		expect(config.maxViewDistance).toBe(1500);
		expect(config.sceneDetail).toBe(0.55);
		expect(config.maxAnisotropy).toBe(1);
	});

	it('exposes scene detail, view distance and adaptive pixel-ratio bounds', () => {
		const config = resolveGraphicsQuality('high', { devicePixelRatio: 3 });
		expect(config.maxViewDistance).toBeGreaterThan(resolveGraphicsQuality('balanced').maxViewDistance);
		expect(config.sceneDetail).toBeGreaterThan(1);
		expect(nextAdaptivePixelRatio(1.4, config, { frameTimeMs: 30, targetFps: 60 })).toBeCloseTo(1.35);
		expect(nextAdaptivePixelRatio(0.8, config, { frameTimeMs: 10, targetFps: 60 })).toBeCloseTo(0.85);
		expect(nextAdaptivePixelRatio(0.8, config, { frameTimeMs: 18, targetFps: 60 })).toBe(0.8);
	});

	it('provides draw-call and triangle telemetry without requiring a renderer', () => {
		expect(readGraphicsTelemetry(null, resolveGraphicsQuality('performance'))).toMatchObject({
			quality: 'performance',
			drawCalls: 0,
			triangles: 0
		});
		expect(readGraphicsTelemetry({ info: { render: { calls: 12, triangles: 3456 } } }, resolveGraphicsQuality('balanced')))
			.toMatchObject({ drawCalls: 12, triangles: 3456 });
	});
});
