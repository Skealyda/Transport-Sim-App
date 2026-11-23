export const GRAPHICS_QUALITY_PRESETS = Object.freeze({
	performance: Object.freeze({
		maxPixelRatio: 1,
		minPixelRatio: 0.6,
		adaptiveStep: 0.1,
		maxViewDistance: 1500,
		cullDistance: 1500,
		sceneDetail: 0.55,
		fogNear: 320,
		fogFar: 900,
		shadowMapSize: 512,
		maxAnisotropy: 1,
		shadows: false
	}),
	balanced: Object.freeze({
		maxPixelRatio: 1.5,
		minPixelRatio: 0.7,
		adaptiveStep: 0.05,
		maxViewDistance: 2000,
		cullDistance: 2000,
		sceneDetail: 1,
		fogNear: 400,
		fogFar: 1200,
		shadowMapSize: 1024,
		maxAnisotropy: 4,
		shadows: true
	}),
	high: Object.freeze({
		maxPixelRatio: 1.5,
		minPixelRatio: 0.8,
		adaptiveStep: 0.05,
		maxViewDistance: 2400,
		cullDistance: 2400,
		sceneDetail: 1.25,
		fogNear: 450,
		fogFar: 1400,
		shadowMapSize: 2048,
		maxAnisotropy: 8,
		shadows: true
	})
});

export function normalizeGraphicsQuality(value) {
	return Object.hasOwn(GRAPHICS_QUALITY_PRESETS, value) ? value : null;
}

export function defaultGraphicsQuality({ mobile = false, hardwareConcurrency = 4 } = {}) {
	return mobile || hardwareConcurrency <= 2 ? 'performance' : 'balanced';
}

export function resolveGraphicsQuality(value, {
	devicePixelRatio = 1,
	mobile = false,
	performanceMode = false,
	viewportWidth = 1280
} = {}) {
	const quality = normalizeGraphicsQuality(value) || 'balanced';
	const preset = GRAPHICS_QUALITY_PRESETS[quality];
	const rawRatio = Number(devicePixelRatio);
	const safeDeviceRatio = Number.isFinite(rawRatio) && rawRatio > 0 ? rawRatio : 1;
	const maxPixelRatio = performanceMode ? 1 : preset.maxPixelRatio;
	const minPixelRatio = Math.min(maxPixelRatio, performanceMode ? 0.6 : preset.minPixelRatio);
	const pixelRatio = Math.max(minPixelRatio, Math.min(maxPixelRatio, safeDeviceRatio));
	const shadows = preset.shadows && !performanceMode && viewportWidth > 768;
	return {
		quality,
		pixelRatio,
		minPixelRatio,
		maxPixelRatio,
		adaptiveStep: preset.adaptiveStep,
		cullDistance: performanceMode ? Math.min(preset.cullDistance, 1500) : preset.cullDistance,
		maxViewDistance: performanceMode ? Math.min(preset.maxViewDistance, 1500) : preset.maxViewDistance,
		sceneDetail: performanceMode ? Math.min(preset.sceneDetail, 0.55) : preset.sceneDetail,
		fogNear: preset.fogNear,
		fogFar: performanceMode ? Math.min(preset.fogFar, 900) : preset.fogFar,
		shadowMapSize: preset.shadowMapSize,
		maxAnisotropy: performanceMode ? 1 : preset.maxAnisotropy,
		shadows,
		performanceCapped: performanceMode || (mobile && quality === 'high')
	};
}

export function graphicsQualityOptions() {
	return Object.keys(GRAPHICS_QUALITY_PRESETS);
}

export function nextAdaptivePixelRatio(current, config, {
	frameTimeMs,
	targetFps = 60,
	overBudgetFactor = 1.3,
	underBudgetFactor = 1.05
} = {}) {
	const safeCurrent = Number.isFinite(current) ? current : config.pixelRatio;
	const targetMs = 1000 / Math.max(1, Number(targetFps) || 60);
	const measuredMs = Number(frameTimeMs);
	if (!Number.isFinite(measuredMs) || measuredMs <= 0) return safeCurrent;
	const next = measuredMs > targetMs * overBudgetFactor
		? safeCurrent - config.adaptiveStep
		: measuredMs < targetMs * underBudgetFactor
			? safeCurrent + config.adaptiveStep
			: safeCurrent;
	return Math.max(config.minPixelRatio, Math.min(config.maxPixelRatio, next));
}

export function readGraphicsTelemetry(renderer, config) {
	return {
		quality: config?.quality || 'balanced',
		sceneDetail: config?.sceneDetail ?? 1,
		maxViewDistance: config?.maxViewDistance ?? 0,
		cullDistance: config?.cullDistance ?? 0,
		drawCalls: renderer?.info?.render?.calls ?? 0,
		triangles: renderer?.info?.render?.triangles ?? 0
	};
}
