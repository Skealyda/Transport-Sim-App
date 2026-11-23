// ====================================
// UTILITY FUNCTIONS
// ====================================

// Debounce: Delays execution until after `wait` ms of inactivity
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle: Limits execution to once per `limit` ms
export function throttle(func, limit) {
    let inThrottle;
    return function () {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// Calculate distance between two route points (km) — Haversine formula
export function calculateDistance(p1, p2) {
    const lat1 = p1.lat !== undefined ? p1.lat : p1[0];
    const lon1 = p1.lng !== undefined ? p1.lng : p1[1];
    const lat2 = p2.lat !== undefined ? p2.lat : p2[0];
    const lon2 = p2.lng !== undefined ? p2.lng : p2[1];
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Calculate rotation angle between two coordinate points
export function calculateRotationAngle(pointA, pointB) {
    // Calculate the bearing (angle) between two geographic points
    const lon1 = (pointA.lng !== undefined ? pointA.lng : pointA[0]) * Math.PI / 180;
    const lat1 = (pointA.lat !== undefined ? pointA.lat : pointA[1]) * Math.PI / 180;
    const lon2 = (pointB.lng !== undefined ? pointB.lng : pointB[0]) * Math.PI / 180;
    const lat2 = (pointB.lat !== undefined ? pointB.lat : pointB[1]) * Math.PI / 180;

    const dLon = lon2 - lon1;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let bearing = Math.atan2(y, x);
    // Convert to degrees and normalize to [0, 360]
    let degrees = (bearing * 180 / Math.PI + 360) % 360;
    return degrees;
}

// Format duration from milliseconds to HH:MM:SS
export function formatDuration(durationMs) {
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

// Convert time (seconds) to HH:MM format
export function formatTime(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--:--';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// Convert seconds to HH:MM:SS format
export function formatTimeHHMMSS(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '00:00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Play audio element by ID with error handling
export function playAudio(audioId) {
    const audio = document.getElementById(audioId);
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(err => {
            // Silently fail - autoplay may be blocked
            console.log(`Audio ${audioId} blocked:`, err.message);
        });
    }
}

// ====================================
// TEXT-TO-SPEECH
// ====================================

// Cache voice selection
let cachedVoice = null;
export function getCachedVoice() {
    if (!cachedVoice) {
        const voices = speechSynthesis.getVoices();
        cachedVoice = voices.find(voice => voice.lang === 'en-IN' && voice.name.includes('female')) || voices[0];
    }
    return cachedVoice;
}

// Spoken announcements live in announcer.js (queued, prioritised, toggleable).

// ====================================
// UNIT CONVERSION HELPERS
// ====================================
export const KM_TO_MILES = 0.621371;

// Format a km distance as a string, auto-switching to miles when useImperial is true
export function formatDistance(km, useImperial) {
    if (useImperial) return `${(km * KM_TO_MILES).toFixed(2)} mi`;
    return `${km.toFixed(2)} km`;
}

// Shorter 1-decimal form for compact HUD displays
export function formatDistanceShort(km, useImperial) {
    if (useImperial) return `${(km * KM_TO_MILES).toFixed(1)} mi`;
    return `${km.toFixed(1)} km`;
}

// Return the numeric speed value converted to the display unit (no rounding)
export function convertSpeed(kmh, useImperial) {
    return useImperial ? kmh * KM_TO_MILES : kmh;
}

// Speed unit label string
export function getSpeedUnit(useImperial) {
    return useImperial ? 'mph' : 'km/h';
}
