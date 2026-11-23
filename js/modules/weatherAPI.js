// ====================================
// WEATHER CARD SYSTEM
// ====================================
// Network access goes through net/weather.js (grid cache + backoff). This module only
// decides *when* the card needs new data and renders it.
import state from './state.js';
import { WEATHER_CONFIG } from './constants.js';
import { getWeather, weatherCellKey } from './net/weather.js';

let flipInterval = null;

function initializeWeatherCard() {
    if (flipInterval) clearInterval(flipInterval);
    flipInterval = setInterval(() => {
        if (!document.hidden) flipWeatherCard();
    }, 10000);
    updateWeatherCardData();
}

function flipWeatherCard() {
    const weatherCard = document.getElementById('weatherCard');
    const currentDot = document.getElementById('currentDot');
    const nextDot = document.getElementById('nextDot');
    if (!weatherCard || !currentDot || !nextDot) return;

    const wc = state.weatherCardState;
    wc.isFlipped = !wc.isFlipped;
    weatherCard.classList.toggle('flipped', wc.isFlipped);
    currentDot.classList.toggle('active', !wc.isFlipped);
    nextDot.classList.toggle('active', wc.isFlipped);
}

function getCurrentCoords() {
    const geometry = state.movingFeature?.getGeometry?.();
    if (geometry) {
        const [lng, lat] = ol.proj.toLonLat(geometry.getCoordinates());
        return { lat, lng };
    }
    if (!state.movingFeature && state.map) {
        const [lng, lat] = ol.proj.toLonLat(state.map.getView().getCenter());
        return { lat, lng };
    }
    if (Number.isFinite(state.fractionalLat) && Number.isFinite(state.fractionalLng)) {
        return { lat: state.fractionalLat, lng: state.fractionalLng };
    }
    if (Number.isFinite(state.newLat) && Number.isFinite(state.newLng)) {
        return { lat: state.newLat, lng: state.newLng };
    }
    return null;
}

function getCurrentName() {
    const text = document.getElementById('currentLocation')?.textContent.trim();
    return text && text !== 'Detecting...' ? text : 'Current Location';
}

function getNextPoint() {
    const nextIndex = Math.floor(state.index || 0) + 1;
    const point = state.route?.[nextIndex];
    if (point?.latlng) {
        return { coords: { lat: point.latlng.lat, lng: point.latlng.lng }, name: point.placeName || 'Next Stop' };
    }
    const text = document.getElementById('nextstop')?.textContent.trim().replace(/^\[Waypoint\]\s*/, '');
    return { coords: null, name: text || 'Next Stop' };
}

/**
 * Refreshes the card only when either location moves into a different weather grid cell,
 * or the data is older than WEATHER_CONFIG.minRefreshMs. Safe to call from frame loops.
 */
async function updateWeatherCardData() {
    const wc = state.weatherCardState;
    if (wc.isUpdating) return;

    const current = getCurrentCoords();
    const next = getNextPoint();
    const curKey = current ? weatherCellKey(current.lat, current.lng) : 'none';
    const nextKey = next.coords ? weatherCellKey(next.coords.lat, next.coords.lng) : 'none';
    const key = `${curKey}|${nextKey}`;
    const now = Date.now();
    if (key === wc.lastLocationUpdate && wc.currentWeatherData && now - (wc.lastUpdateTime || 0) < WEATHER_CONFIG.minRefreshMs) {
        return;
    }

    wc.isUpdating = true;
    wc.lastLocationUpdate = key;
    wc.lastUpdateTime = now;
    try {
        const currentName = getCurrentName();
        const [cur, nxt] = await Promise.all([
            resolveCardData(current, curKey, currentName),
            resolveCardData(next.coords, nextKey, next.name)
        ]);
        wc.currentWeatherData = cur;
        wc.nextWeatherData = nxt;
        updateWeatherSide('current', cur);
        updateWeatherSide('next', nxt);
    } finally {
        wc.isUpdating = false;
    }
}

async function resolveCardData(coords, cellKey, name) {
    if (coords) {
        const raw = await getWeather(coords.lat, coords.lng);
        if (raw) return convertApiDataToCardFormat(raw, name);
    }
    return unavailableFor(name, coords ? 'Unavailable' : 'No location yet');
}

// Shown instead of invented values when there is no position or live weather can't be reached.
function unavailableFor(location, condition) {
    return { location, condition, icon: '🌡️', temperature: '--', humidity: '--', windSpeed: '--', rainChance: '--', unavailable: true };
}

// Debug helper: raw proxy payload for a coordinate.
window.testWeatherAPI = (lat, lng) => getWeather(lat, lng);

// Convert OpenWeather API data to weather card format
function convertApiDataToCardFormat(apiData, locationName) {
    const weather = apiData.weather[0];
    const main = apiData.main;
    const wind = apiData.wind || {};

    // Map OpenWeather conditions to our icons
    const conditionMapping = {
        'Clear': '☀️',
        'Clouds': '☁️',
        'Rain': '🌧️',
        'Drizzle': '🌦️',
        'Thunderstorm': '⛈️',
        'Snow': '❄️',
        'Mist': '🌫️',
        'Fog': '🌫️',
        'Haze': '🌫️',
        'Dust': '💨',
        'Sand': '💨',
        'Ash': '💨',
        'Squall': '💨',
        'Tornado': '🌪️'
    };

    return {
        location: locationName || apiData.name || 'Unknown',
        condition: weather.main,
        icon: conditionMapping[weather.main] || '🌤️',
        temperature: Math.round(main.temp),
        humidity: main.humidity,
        windSpeed: Math.round((wind.speed || 0) * 3.6), // Convert m/s to km/h
        rainChance: main.humidity // Use humidity as rain chance approximation
    };
}

// Update a specific side of the weather card with enhanced visuals
function updateWeatherSide(side, weatherData) {
    const prefix = side === 'current' ? 'current' : 'next';
    const weatherSide = document.querySelector(`.weather-side.${side}-side`);
    const weatherVisualization = document.getElementById(`${prefix}WeatherVisualization`);

    // Apply weather-specific background class to the visualization area
    if (weatherVisualization) {
        // Remove existing weather classes
        weatherVisualization.classList.remove('weather-sunny', 'weather-rainy', 'weather-cloudy', 'weather-snowy', 'weather-night', 'weather-default');

        // Determine weather condition and apply appropriate class
        const condition = weatherData.condition.toLowerCase();
        const isNight = weatherData.isNight || false;

        if (isNight) {
            weatherVisualization.classList.add('weather-night');
        } else if (condition.includes('sunny') || condition.includes('clear')) {
            weatherVisualization.classList.add('weather-sunny');
        } else if (condition.includes('rain') || condition.includes('drizzle') || condition.includes('shower')) {
            weatherVisualization.classList.add('weather-rainy');
        } else if (condition.includes('snow') || condition.includes('blizzard')) {
            weatherVisualization.classList.add('weather-snowy');
        } else if (condition.includes('cloud') || condition.includes('overcast')) {
            weatherVisualization.classList.add('weather-cloudy');
        } else {
            weatherVisualization.classList.add('weather-default');
        }

    }

    // Apply weather-specific background class to the side (legacy support)
    if (weatherSide) {
        // Remove existing weather classes
        weatherSide.classList.remove('sunny', 'rainy', 'cloudy');

        // Add appropriate weather class for background effects
        if (weatherData.condition.includes('Sunny') || weatherData.condition.includes('Clear')) {
            weatherSide.classList.add('sunny');
        } else if (weatherData.condition.includes('Rain') || weatherData.condition.includes('Drizzle')) {
            weatherSide.classList.add('rainy');
        } else if (weatherData.condition.includes('Cloud')) {
            weatherSide.classList.add('cloudy');
        }
    }

    // Update location name
    const locationElement = document.getElementById(`${prefix}WeatherLocation`);
    if (locationElement) {
        locationElement.textContent = weatherData.location;
        locationElement.title = weatherData.location;
        fitTextToWidth(locationElement);
    }

    // Update temperature with icon
    const temperatureElement = document.getElementById(`${prefix}Temperature`);
    if (temperatureElement) {
        temperatureElement.innerHTML = `<span class="weather-icon">${weatherData.icon}</span>${weatherData.temperature}°C`;
    }

    // Update weather condition
    const conditionElement = document.getElementById(`${prefix}WeatherCondition`);
    if (conditionElement) {
        conditionElement.textContent = weatherData.condition;
        conditionElement.title = conditionElement.textContent;
    }

    // Update humidity
    const humidityElement = document.getElementById(`${prefix}Humidity`);
    if (humidityElement) {
        humidityElement.textContent = `${weatherData.humidity}%`;
    }

    // Update wind speed
    const windElement = document.getElementById(`${prefix}WindSpeed`);
    if (windElement) {
        windElement.textContent = `${weatherData.windSpeed} km/h`;
    }

    // Update rain chance
    const rainElement = document.getElementById(`${prefix}RainChance`);
    if (rainElement) {
        rainElement.textContent = `${weatherData.rainChance}%`;
    }
}

// Shrinks a single-line label until it fits its box so long place names stay fully readable.
function fitTextToWidth(element, minPx = 8) {
    element.style.fontSize = '';
    if (!element.clientWidth) return;
    let size = parseFloat(getComputedStyle(element).fontSize);
    while (element.scrollWidth > element.clientWidth && size > minPx) {
        size -= 0.5;
        element.style.fontSize = `${size}px`;
    }
}

export { initializeWeatherCard, flipWeatherCard, updateWeatherCardData };
