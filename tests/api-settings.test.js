import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage() {
	const values = new Map();
	return {
		getItem: key => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, String(value)),
		removeItem: key => values.delete(key)
	};
}

describe('local API settings', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubGlobal('localStorage', memoryStorage());
		vi.stubGlobal('__TRANSPORT_SIM_CONFIG__', {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('persists provider settings only in browser storage and activates weather', async () => {
		const { getClientConfig, getLocalClientConfig, saveLocalClientConfig } =
			await import('../js/modules/net/config.js');

		saveLocalClientConfig({
			googleMapsApiKey: 'google-browser-key',
			openWeatherApiKey: 'weather-browser-key',
			weatherProxyUrl: 'https://weather.example/current'
		});

		expect(getLocalClientConfig()).toMatchObject({
			googleMapsApiKey: 'google-browser-key',
			openWeatherApiKey: 'weather-browser-key',
			weatherProxyUrl: 'https://weather.example/current'
		});
		expect(getClientConfig().weatherAvailable).toBe(true);
	});

	it('clears local secrets and restores a weather-disabled configuration', async () => {
		const { clearLocalClientConfig, getLocalClientConfig, saveLocalClientConfig } =
			await import('../js/modules/net/config.js');

		saveLocalClientConfig({ openWeatherApiKey: 'temporary-key' });
		clearLocalClientConfig();

		expect(getLocalClientConfig()).toEqual({});
		expect(JSON.parse(localStorage.getItem('transportSimulator_apiSettings_v1') || 'null')).toBeNull();
	});
});
