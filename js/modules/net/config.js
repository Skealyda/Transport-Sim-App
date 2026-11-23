const LOCAL_CONFIG_KEY = 'transportSimulator_apiSettings_v1';
const runtime = globalThis.__TRANSPORT_SIM_CONFIG__ || {};
const baseConfig = Object.freeze({
	cesiumIonToken: runtime.cesiumIonToken || null,
	googleMapsApiKey: runtime.googleMapsApiKey || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || null,
	googleMapsKeyId: runtime.googleMapsKeyId || null,
	openWeatherApiKey: null,
	weatherProxyUrl: null,
	thunderforestApiKey: runtime.thunderforestApiKey || import.meta.env.VITE_THUNDERFOREST_API_KEY || null,
	keepalive: false
});

const editableKeys = [
	'googleMapsApiKey',
	'cesiumIonToken',
	'openWeatherApiKey',
	'weatherProxyUrl'
];

function normalizeLocalConfig(value) {
	const normalized = {};
	if (!value || typeof value !== 'object') return normalized;
	for (const key of editableKeys) {
		if (!Object.hasOwn(value, key)) continue;
		const candidate = typeof value[key] === 'string' ? value[key].trim() : '';
		normalized[key] = candidate || null;
	}
	return normalized;
}

function readLocalConfig() {
	try {
		return normalizeLocalConfig(JSON.parse(localStorage.getItem(LOCAL_CONFIG_KEY) || '{}'));
	} catch {
		console.warn('Local API settings could not be read; using provider defaults');
		return {};
	}
}

function resolveConfig(local = readLocalConfig()) {
	const merged = { ...baseConfig, ...local };
	merged.weatherAvailable = Boolean(merged.weatherProxyUrl || merged.openWeatherApiKey);
	return merged;
}

const config = resolveConfig();

export function loadClientConfig() {
	return Promise.resolve(config);
}

// Synchronous read for providers that initialize before asynchronous setup.
export function getClientConfig() {
	return config;
}

export function getLocalClientConfig() {
	return normalizeLocalConfig(readLocalConfig());
}

export function saveLocalClientConfig(values) {
	const local = normalizeLocalConfig(values);
	try {
		localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(local));
	} catch (error) {
		throw new Error(`Could not save API settings on this device: ${error.message}`);
	}
	Object.assign(config, resolveConfig(local));
	return config;
}

export function clearLocalClientConfig() {
	try {
		localStorage.removeItem(LOCAL_CONFIG_KEY);
	} catch (error) {
		throw new Error(`Could not clear API settings on this device: ${error.message}`);
	}
	Object.assign(config, resolveConfig({}));
	return config;
}
