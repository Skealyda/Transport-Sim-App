// ====================================
// WEATHER API CONFIGURATION
// ====================================
// Weather is disabled until the user configures a proxy or personal key in Settings.
export const WEATHER_CONFIG = {
    enableRealWeather: true,
    endpoint: 'https://api.openweathermap.org/data/2.5/weather',
    requestTimeout: 5000, // 5 seconds API timeout
    minRefreshMs: 10 * 60 * 1000 // Re-check the same grid cells at most every 10 minutes
};

// ====================================
// ADVANCED CACHING SYSTEM
// ====================================
export const CACHE_CONFIG = {
    weather: {
        maxAge: 30 * 60 * 1000, // 30 minutes
        storageKey: 'weather_cache_v3',
        gridPrecision: 0.1 // ~11km cells — weather doesn't vary meaningfully below this
    },
    geocode: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days — place names rarely change
        storageKey: 'geocode_cache_v3',
        gridPrecision: 0.01 // ~1km grid resolution
    }
};

// ====================================
// PERFORMANCE CONSTANTS
// ====================================
export const TARGET_FPS = 60;
export const FRAME_INTERVAL = 1000 / TARGET_FPS;

// Throttling interval for G-Force display updates
export const GFORCE_UPDATE_INTERVAL = 300; // Update every 300ms for responsive display

export const MAP_QUALITY_OPTIONS = {
    low: { maxZoom: 16, highDpi: false },
    medium: { maxZoom: 19, highDpi: false },
    high: { maxZoom: 22, highDpi: true }
};

// ====================================
// ROAD DRIVING STYLES
// ====================================
// Speed multiplier applied to the selected road target speed.
//   smooth  → stays ~12% under the target for a relaxed feel
//   normal  → drives at the target
//   rushed  → approaches the target more aggressively, without exceeding it
//
// G-force multipliers scale the comfort G targets in intelligentControl.js.
export const DRIVING_STYLES = {
    smooth: { label: '🌊 Smooth',  speedMult: 0.88, gForceMult: 0.6 },
    normal: { label: '🚗 Normal',  speedMult: 1.00, gForceMult: 1.0 },
    rushed: { label: '💨 Rushed',  speedMult: 1.175, gForceMult: 1.5 }
};
