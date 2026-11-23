// ====================================
// CACHING SYSTEM
// ====================================

// Persistent cache with localStorage
export const PersistentCache = {
    // Load cache from localStorage
    load(key) {
        try {
            const data = localStorage.getItem(key);
            if (!data) return null;
            const parsed = JSON.parse(data);
            if (Date.now() - parsed.timestamp > parsed.maxAge) {
                localStorage.removeItem(key);
                return null;
            }
            return parsed.data;
        } catch (e) {
            console.warn('Cache load error:', e);
            return null;
        }
    },

    // Save cache to localStorage
    save(key, data, maxAge) {
        try {
            localStorage.setItem(key, JSON.stringify({
                data: data,
                timestamp: Date.now(),
                maxAge: maxAge
            }));
        } catch (e) {
            console.warn('Cache save error:', e);
        }
    },

    // Calculate distance between two coordinates (km)
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
};

// API request tracker for monitoring
export const APIMonitor = {
    requests: [],

    log(type, url, cached = false) {
        this.requests.push({
            type,
            url,
            cached,
            timestamp: Date.now()
        });

        // Keep only last 100 requests
        if (this.requests.length > 100) {
            this.requests = this.requests.slice(-100);
        }
    },

    getStats() {
        const total = this.requests.length;
        if (total === 0) return { total: 0, cached: 0, hitRate: 0 };

        const cached = this.requests.filter(r => r.cached).length;
        return {
            total,
            cached,
            hitRate: (cached / total * 100).toFixed(1)
        };
    }
};

// Global Monitored Fetch Wrapper
export async function monitoredFetch(url, options = {}) {
    const redact = value => {
        try {
            const parsed = new URL(String(value), window.location.href);
            for (const key of ['key', 'appid', 'token', 'access_token']) {
                if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '[redacted]');
            }
            return parsed.toString();
        } catch {
            return '[invalid URL]';
        }
    };
    // Determine type for logging
    const urlStr = redact(url);
    const type = urlStr.includes('weather') ? 'weather' :
            urlStr.includes('nominatim') ? 'geocode' :
                urlStr.includes('route') ? 'route' : 'api';

    // Log as a network request (not cached, since fetch is a real request)
    APIMonitor.log(type, urlStr, false);

    try {
        const response = await fetch(url, options);
        return response;
    } catch (error) {
        console.error(`Fetch error for ${urlStr}:`, error);
        throw error;
    }
}

// Initialize caches
export function initCaches() {
    // Drop caches written by older key formats (geocode/weather now live in net/*.js).
    ['weather_cache_v2', 'geocode_cache_v2'].forEach(k => localStorage.removeItem(k));
}
