// ====================================
// WEATHER EFFECTS SYSTEM
// ====================================
// Particle-based rain/snow/day-night visual effects
import state from './state.js';
import { domCache } from './domCache.js';
import { changeMapTheme } from './mapInit.js';

// Visibility-based pause/resume — stop the particle interval when the tab
// is hidden (saves CPU/battery) and restart it when the user returns.
let _rainPausedByVisibility = false;
let _snowPausedByVisibility = false;
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (state.weatherState?.rainInterval) {
            clearInterval(state.weatherState.rainInterval);
            state.weatherState.rainInterval = null;
            _rainPausedByVisibility = true;
        }
        if (state.weatherState?.snowInterval) {
            clearInterval(state.weatherState.snowInterval);
            state.weatherState.snowInterval = null;
            _snowPausedByVisibility = true;
        }
    } else {
        if (_rainPausedByVisibility) {
            _rainPausedByVisibility = false;
            if (state.weatherState?.isRaining) startRain(state.weatherState.rainIntensity);
        }
        if (_snowPausedByVisibility) {
            _snowPausedByVisibility = false;
            if (state.weatherState?.isSnowing) startSnow(state.weatherState.snowIntensity);
        }
    }
});

export function showWeatherDialog() {
    const weatherDialog = domCache.weatherDialog || document.getElementById('weatherDialog');
    if (weatherDialog) weatherDialog.style.display = 'block';
}

export function closeWeatherDialog() {
    const weatherDialog = domCache.weatherDialog || document.getElementById('weatherDialog');
    if (weatherDialog) weatherDialog.style.display = 'none';
}

export function applyWeatherSettings() {
    const rainToggle = domCache.rainToggle || document.getElementById('rainToggle');
    const snowToggle = domCache.snowToggle || document.getElementById('snowToggle');
    const dayNightMode = document.querySelector('input[name="dayNightMode"]:checked');
    const rainIntensity = domCache.rainIntensity || document.getElementById('rainIntensity');
    const snowIntensity = domCache.snowIntensity || document.getElementById('snowIntensity');
    const weatherSpeed = domCache.weatherSpeed || document.getElementById('weatherSpeed');

    if (!dayNightMode || !rainToggle || !snowToggle || !rainIntensity || !snowIntensity || !weatherSpeed) {
        return; // Guard against missing elements
    }

    // Update weather state
    weatherState.isRaining = rainToggle.checked;
    state.weatherState.isSnowing = snowToggle.checked;
    state.weatherState.isDayMode = dayNightMode.value === 'day';
    state.weatherState.rainIntensity = parseInt(rainIntensity.value);
    state.weatherState.snowIntensity = parseInt(snowIntensity.value);
    state.weatherState.speed = parseFloat(weatherSpeed.value);

    // Apply day/night mode
    applyDayNightMode(state.weatherState.isDayMode);

    // Apply rain effect
    if (state.weatherState.isRaining) {
        startRain(state.weatherState.rainIntensity);
    } else {
        stopRain();
    }

    // Apply snow effect
    if (state.weatherState.isSnowing) {
        startSnow(state.weatherState.snowIntensity);
    } else {
        stopSnow();
    }

    closeWeatherDialog();
}

export function resetWeather() {
    // Reset all weather effects
    stopRain();
    stopSnow();
    applyDayNightMode(true); // Reset to day mode

    // Reset UI controls using cached elements
    const rainToggle = domCache.rainToggle || document.getElementById('rainToggle');
    const snowToggle = domCache.snowToggle || document.getElementById('snowToggle');
    const dayModeRadio = document.querySelector('input[name="dayNightMode"][value="day"]');
    const rainIntensity = domCache.rainIntensity || document.getElementById('rainIntensity');
    const snowIntensity = domCache.snowIntensity || document.getElementById('snowIntensity');

    if (rainToggle) rainToggle.checked = false;
    if (snowToggle) snowToggle.checked = false;
    if (dayModeRadio) dayModeRadio.checked = true;
    if (rainIntensity) {
        rainIntensity.value = 5;
        rainIntensity.disabled = true;
    }
    if (snowIntensity) {
        snowIntensity.value = 5;
        snowIntensity.disabled = true;
    }

    // Reset weather state
    weatherState = {
        isRaining: false,
        isSnowing: false,
        isDayMode: true,
        rainIntensity: 5,
        snowIntensity: 5,
        speed: 1.0,
        rainInterval: null,
        snowInterval: null,
        rainDrops: [],
        snowFlakes: [],
        maxParticles: 50
    };
}

export function applyDayNightMode(isDayMode) {
    let nightOverlay = document.getElementById('nightOverlay');

    if (!isDayMode) {
        // Create night overlay if it doesn't exist
        if (!nightOverlay) {
            nightOverlay = document.createElement('div');
            nightOverlay.id = 'nightOverlay';
            nightOverlay.className = 'night-overlay';
            document.getElementById('map').appendChild(nightOverlay);
        }
        // Switch to dark map theme
        changeMapTheme('darkmatter');
    } else {
        // Remove night overlay
        if (nightOverlay) {
            nightOverlay.remove();
        }
        // Switch back to default map theme
        changeMapTheme('osm');
    }
}

// DOM particles are composited every frame; keep fewer of them in Performance Mode.
function particleCap() {
    return state.performanceModeEnabled ? Math.min(20, state.weatherState.maxParticles) : state.weatherState.maxParticles;
}

export function startRain(intensity) {
    stopRain(); // Stop existing rain first

    const container = document.getElementById('weatherEffectsContainer');
    const mapElement = domCache.map || document.getElementById('map');
    if (!container || !mapElement) return;

    const mapRect = mapElement.getBoundingClientRect();

    // Performance-optimized intensity scaling
    const baseInterval = Math.max(100, 400 / intensity); // Minimum 100ms interval
    const generationInterval = Math.min(baseInterval, 300); // Maximum generation rate

    // Create steady rain generation with performance limits
    state.weatherState.rainInterval = setInterval(() => {
        if (state.weatherState.rainDrops.length < particleCap()) {
            createRainDrop(container, mapRect);
        }
    }, generationInterval);

    // Reduce initial particle burst for performance
    const initialDrops = Math.min(intensity * 2, 20);
    const staggerDelay = Math.max(50, 200 / intensity);

    for (let i = 0; i < initialDrops; i++) {
        setTimeout(() => {
            if (state.weatherState.rainDrops.length < particleCap()) {
                createRainDrop(container, mapRect);
            }
        }, i * staggerDelay);
    }
}

function createRainDrop(container, mapRect) {
    // Performance limit: Don't create if too many particles exist
    if (state.weatherState.rainDrops.length >= particleCap()) return;

    const drop = document.createElement('div');
    drop.className = 'rain-drop';

    // Distribute particles across entire map area
    const startX = Math.random() * 100;
    const startY = Math.random() * 300;

    drop.style.left = startX + '%';
    drop.style.top = '0px';
    drop.style.setProperty('--start-y', startY + 'px');

    // Simplified size categories for performance
    const sizeCategory = Math.random();
    let baseWidth, baseHeight;

    if (sizeCategory < 0.3) {
        baseWidth = 3;
        baseHeight = 16;
    } else {
        baseWidth = 2;
        baseHeight = 12;
    }

    drop.style.width = baseWidth + 'px';
    drop.style.height = baseHeight + 'px';

    // Reduced wind drift calculation
    const windDrift = (Math.random() - 0.5) * 4;
    drop.style.setProperty('--drift-x', windDrift + 'px');

    // Optimized animation duration
    const speedMultiplier = state.weatherState.speed || 1;
    const baseDuration = 2.5 + Math.random() * 0.3;
    const duration = baseDuration / speedMultiplier;
    drop.style.animationDuration = duration + 's';

    // GPU acceleration
    drop.style.willChange = 'transform, opacity';

    container.appendChild(drop);
    state.weatherState.rainDrops.push(drop);

    // Cleanup with performance optimization
    drop.addEventListener('animationiteration', () => {
        if (drop.parentNode) {
            drop.style.willChange = 'auto';
            container.removeChild(drop);
            const idx = state.weatherState.rainDrops.indexOf(drop);
            if (idx > -1) {
                state.weatherState.rainDrops.splice(idx, 1);
            }
        }
    }, { once: true });
}

export function stopRain() {
    if (state.weatherState.rainInterval) {
        clearInterval(state.weatherState.rainInterval);
        state.weatherState.rainInterval = null;
    }

    // Remove all existing raindrops
    state.weatherState.rainDrops.forEach(drop => {
        if (drop.parentNode) {
            drop.parentNode.removeChild(drop);
        }
    });
    state.weatherState.rainDrops = [];
}

export function startSnow(intensity) {
    stopSnow(); // Stop existing snow first

    const container = document.getElementById('weatherEffectsContainer');
    const mapRect = document.getElementById('map').getBoundingClientRect();

    // Much more dramatic intensity differences for snow
    const baseInterval = 600;
    const intervalReduction = Math.pow(intensity, 1.6);
    const generationInterval = Math.max(50, baseInterval / intervalReduction);

    // Create steady snow generation with dramatic intensity scaling
    state.weatherState.snowInterval = setInterval(() => {
        createSnowFlake(container, mapRect);
    }, generationInterval);

    // Dramatically more particles for higher intensity
    const initialFlakes = Math.min(intensity * intensity * 2.5, 70);
    const staggerDelay = Math.max(30, 120 / intensity);

    for (let i = 0; i < initialFlakes; i++) {
        setTimeout(() => createSnowFlake(container, mapRect), i * staggerDelay);
    }
}

function createSnowFlake(container, mapRect) {
    // Performance limit: Don't create if too many particles exist
    if (state.weatherState.snowFlakes.length > (state.performanceModeEnabled ? 20 : 80)) return;

    const flake = document.createElement('div');
    flake.className = 'snow-flake';

    // Distribute particles across entire map area
    const startX = Math.random() * 100;
    const startY = Math.random() * 500;

    flake.style.left = startX + '%';
    flake.style.top = '0px';
    flake.style.setProperty('--start-y', startY + 'px');

    // Size categories (20% large, 20% medium, 60% small)
    const sizeCategory = Math.random();
    let sizeClass;

    if (sizeCategory < 0.2) {
        sizeClass = 'large';
    } else if (sizeCategory < 0.4) {
        sizeClass = 'medium';
    } else {
        sizeClass = 'small';
    }

    flake.classList.add(sizeClass);

    // Random snowflake characters
    const snowChars = ['❄', '❅', '❆', '✻', '✼', '❋'];
    flake.textContent = snowChars[Math.floor(Math.random() * snowChars.length)];

    // Gentle wind drift
    const windDrift = (Math.random() - 0.5) * 12;
    flake.style.setProperty('--drift-x', windDrift + 'px');

    // Animation duration based on weather speed setting
    const speedMultiplier = state.weatherState.speed || 1;
    const baseDuration = 4 + Math.random() * 1;
    const duration = baseDuration / speedMultiplier;
    flake.style.animationDuration = duration + 's';

    // Performance optimization: Use will-change for GPU acceleration
    flake.style.willChange = 'transform, opacity';

    container.appendChild(flake);
    state.weatherState.snowFlakes.push(flake);

    // Remove after animation completes
    flake.addEventListener('animationiteration', () => {
        if (flake.parentNode) {
            flake.style.willChange = 'auto';
            flake.parentNode.removeChild(flake);
            const idx = state.weatherState.snowFlakes.indexOf(flake);
            if (idx > -1) {
                state.weatherState.snowFlakes.splice(idx, 1);
            }
        }
    }, { once: true });
}

export function stopSnow() {
    if (state.weatherState.snowInterval) {
        clearInterval(state.weatherState.snowInterval);
        state.weatherState.snowInterval = null;
    }

    // Remove all existing snowflakes
    state.weatherState.snowFlakes.forEach(flake => {
        if (flake.parentNode) {
            flake.parentNode.removeChild(flake);
        }
    });
    state.weatherState.snowFlakes = [];
}

export function initializeWeatherControls() {
    // Rain toggle event listener
    const rainToggle = document.getElementById('rainToggle');
    const rainIntensity = document.getElementById('rainIntensity');

    if (rainToggle && rainIntensity) {
        rainToggle.addEventListener('change', function () {
            rainIntensity.disabled = !this.checked;
        });
    }

    // Snow toggle event listener
    const snowToggle = document.getElementById('snowToggle');
    const snowIntensity = document.getElementById('snowIntensity');

    if (snowToggle && snowIntensity) {
        snowToggle.addEventListener('change', function () {
            snowIntensity.disabled = !this.checked;
        });
    }

    // Day/Night mode event listeners with initial setup
    const dayNightRadios = document.querySelectorAll('input[name="dayNightMode"]');
    if (dayNightRadios.length > 0) {
        dayNightRadios.forEach(radio => {
            // Set initial state for checked radio
            if (radio.checked) {
                radio.parentElement.style.background = 'linear-gradient(135deg, #60a5fa 0%, #8b5cf6 100%)';
                radio.parentElement.style.color = 'white';
                radio.parentElement.style.borderColor = '#60a5fa';
            }

            radio.addEventListener('change', function () {
                this.parentElement.style.background = 'linear-gradient(135deg, #60a5fa 0%, #8b5cf6 100%)';
                this.parentElement.style.color = 'white';
                this.parentElement.style.borderColor = '#60a5fa';

                // Reset other options
                dayNightRadios.forEach(otherRadio => {
                    if (otherRadio !== this) {
                        otherRadio.parentElement.style.background = 'rgba(51, 65, 85, 0.3)';
                        otherRadio.parentElement.style.color = '#cbd5e1';
                        otherRadio.parentElement.style.borderColor = '#475569';
                    }
                });
            });
        });

        // Weather speed control event listener
        const weatherSpeedSlider = document.getElementById('weatherSpeed');
        const speedValueDisplay = document.getElementById('speedValue');

        if (weatherSpeedSlider && speedValueDisplay) {
            weatherSpeedSlider.addEventListener('input', function () {
                const speedValue = parseFloat(this.value);
                speedValueDisplay.textContent = speedValue.toFixed(1) + 'x';
            });
        }
    }
}