// ====================================
// ROUTE CURVE ENGINE
// ====================================
// Generates densified, smooth route paths from raw stop/waypoint arrays.
// - Catmull-Rom splines for rail/hyperloop (C¹-continuous, passes through all points)
// - Great-circle interpolation for air routes (geodesic arcs)
// - Straight-line passthrough for road (OSRM already provides geometry)

import { calculateDistance } from './utils.js';

// ========================================
// CATMULL-ROM SPLINE (Rail / Hyperloop)
// ========================================

/**
 * Evaluate a single Catmull-Rom spline segment at parameter t ∈ [0,1].
 * Uses centripetal parameterisation (alpha = 0.5) by default.
 * p0–p3 are {lat, lng} objects; p1–p2 is the segment being interpolated.
 */
function catmullRomPoint(p0, p1, p2, p3, t, alpha = 0.5) {
    // Knot parameterisation based on centripetal distance
    function knotInterval(pA, pB, a) {
        const dx = pB.lng - pA.lng;
        const dy = pB.lat - pA.lat;
        const d = Math.sqrt(dx * dx + dy * dy);
        return Math.pow(d, a);
    }

    const t01 = knotInterval(p0, p1, alpha);
    const t12 = knotInterval(p1, p2, alpha);
    const t23 = knotInterval(p2, p3, alpha);

    // Avoid division by zero on coincident points
    if (t01 < 1e-12 || t12 < 1e-12 || t23 < 1e-12) {
        // Fall back to linear interpolation between p1 and p2
        return {
            lat: p1.lat + (p2.lat - p1.lat) * t,
            lng: p1.lng + (p2.lng - p1.lng) * t
        };
    }

    // Barry-Goldman algorithm for Catmull-Rom
    const m1Lat = (p2.lat - p1.lat + t12 * ((p1.lat - p0.lat) / t01 - (p2.lat - p0.lat) / (t01 + t12)));
    const m1Lng = (p2.lng - p1.lng + t12 * ((p1.lng - p0.lng) / t01 - (p2.lng - p0.lng) / (t01 + t12)));
    const m2Lat = (p2.lat - p1.lat + t12 * ((p3.lat - p2.lat) / t23 - (p3.lat - p1.lat) / (t12 + t23)));
    const m2Lng = (p2.lng - p1.lng + t12 * ((p3.lng - p2.lng) / t23 - (p3.lng - p1.lng) / (t12 + t23)));

    // Hermite basis functions
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    return {
        lat: h00 * p1.lat + h10 * m1Lat + h01 * p2.lat + h11 * m2Lat,
        lng: h00 * p1.lng + h10 * m1Lng + h01 * p2.lng + h11 * m2Lng
    };
}

/**
 * Generate a Catmull-Rom spline through an array of {lat, lng} points.
 * Returns a densified array of sub-points.
 *
 * @param {Array} points - Array of {lat, lng} (the original route stops/waypoints)
 * @param {number} alpha - Catmull-Rom tension (0.5 = centripetal, 0.3 = wider curves)
 * @param {number} spacingKm - Target distance between sub-points in km
 * @returns {Array} - [{lat, lng, originalIndex, originalProgress}]
 */
function generateCatmullRomPath(points, alpha = 0.5, spacingKm = 0.05) {
    if (!points || points.length < 2) return [];

    const result = [];

    for (let i = 0; i < points.length - 1; i++) {
        // Get the 4 control points (clamp at boundaries)
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];

        // Estimate segment distance to determine how many sub-points we need
        const segmentDist = calculateDistance(p1, p2);
        const numSubPoints = Math.max(2, Math.ceil(segmentDist / spacingKm));

        for (let j = 0; j < numSubPoints; j++) {
            const t = j / numSubPoints;
            const pt = catmullRomPoint(p0, p1, p2, p3, t, alpha);

            result.push({
                lat: pt.lat,
                lng: pt.lng,
                originalIndex: i,       // Which segment of state.route this belongs to
                originalProgress: t     // Progress within that segment (0–1)
            });
        }
    }

    // Add the final point
    const lastPt = points[points.length - 1];
    result.push({
        lat: lastPt.lat,
        lng: lastPt.lng,
        originalIndex: points.length - 2,
        originalProgress: 1.0
    });

    return result;
}

// ========================================
// GREAT-CIRCLE INTERPOLATION (Air)
// ========================================

/**
 * Returns an intermediate point on the great-circle arc between p1 and p2.
 * Uses the Haversine intermediate point formula.
 *
 * @param {{lat, lng}} p1 - Start point
 * @param {{lat, lng}} p2 - End point
 * @param {number} f - Fraction along the arc (0 = p1, 1 = p2)
 * @returns {{lat, lng}}
 */
function greatCirclePoint(p1, p2, f) {
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;

    const lat1 = p1.lat * toRad;
    const lng1 = p1.lng * toRad;
    const lat2 = p2.lat * toRad;
    const lng2 = p2.lng * toRad;

    // Angular distance between the two points
    const d = 2 * Math.asin(Math.sqrt(
        Math.pow(Math.sin((lat2 - lat1) / 2), 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin((lng2 - lng1) / 2), 2)
    ));

    if (d < 1e-10) {
        // Points are essentially the same
        return { lat: p1.lat, lng: p1.lng };
    }

    const sinD = Math.sin(d);
    const a = Math.sin((1 - f) * d) / sinD;
    const b = Math.sin(f * d) / sinD;

    const x = a * Math.cos(lat1) * Math.cos(lng1) + b * Math.cos(lat2) * Math.cos(lng2);
    const y = a * Math.cos(lat1) * Math.sin(lng1) + b * Math.cos(lat2) * Math.sin(lng2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);

    return {
        lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg,
        lng: Math.atan2(y, x) * toDeg
    };
}

/**
 * Generate a great-circle path between all pairs of consecutive points.
 *
 * @param {Array} points - Array of {lat, lng}
 * @param {number} spacingKm - Target spacing between sub-points (default 10km for flights)
 * @returns {Array} - [{lat, lng, originalIndex, originalProgress}]
 */
function generateGreatCirclePath(points, spacingKm = 10) {
    if (!points || points.length < 2) return [];

    const result = [];

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const segmentDist = calculateDistance(p1, p2);
        const numSubPoints = Math.max(2, Math.ceil(segmentDist / spacingKm));

        for (let j = 0; j < numSubPoints; j++) {
            const f = j / numSubPoints;
            const pt = greatCirclePoint(p1, p2, f);

            result.push({
                lat: pt.lat,
                lng: pt.lng,
                originalIndex: i,
                originalProgress: f
            });
        }
    }

    // Add final point
    const lastPt = points[points.length - 1];
    result.push({
        lat: lastPt.lat,
        lng: lastPt.lng,
        originalIndex: points.length - 2,
        originalProgress: 1.0
    });

    return result;
}

// ========================================
// MAIN ENTRY POINT
// ========================================

/**
 * Generate a smooth, densified route from the raw route points.
 *
 * @param {Array} route - state.route array [{latlng: {lat, lng}, placeName, type}, ...]
 * @param {string} routeType - 'rail', 'hyperloop', 'air', 'road'
 * @returns {{smoothRoute: Array, smoothRouteDistances: Array}}
 */
/**
 * Linear fallback — just copy original points with originalIndex mapping.
 */
function generateLinearPath(points) {
    if (!points || points.length < 2) return [];

    const result = [];

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const segmentDist = calculateDistance(p1, p2);
        const numSubPoints = Math.max(2, Math.ceil(segmentDist / 0.05)); // 50m spacing

        for (let j = 0; j < numSubPoints; j++) {
            const t = j / numSubPoints;
            result.push({
                lat: p1.lat + (p2.lat - p1.lat) * t,
                lng: p1.lng + (p2.lng - p1.lng) * t,
                originalIndex: i,
                originalProgress: t
            });
        }
    }

    // Final point
    const last = points[points.length - 1];
    result.push({
        lat: last.lat,
        lng: last.lng,
        originalIndex: points.length - 2,
        originalProgress: 1.0
    });

    return result;
}
// ========================================
// CURVE-AWARE SPEED LIMITING
// ========================================

/**
 * Scan ahead along smoothRoute to find the tightest upcoming curve
 * and return the maximum safe speed for it.
 *
 * @param {Array} smoothRoute - The densified route array
 * @param {Array} smoothRouteDistances - Pre-computed distances between sub-points
 * @param {number} currentIndex - Current position in smoothRoute
 * @param {number} lookaheadKm - How far ahead to scan (km)
 * @param {number} gForceLimit - User's G-force limit
 * @returns {number} - Maximum safe speed in km/h for the upcoming curvature
 */
function getUpcomingCurvature(
    smoothRoute,
    smoothRouteDistances,
    currentIndex,
    lookaheadKm = 2.0,
    gForceLimit = 0.5,
    options = {}
) {
    if (!smoothRoute || smoothRoute.length < 3 || currentIndex >= smoothRoute.length - 2) {
        return Infinity; // No curve data, don't limit
    }

    const sampleStepKm = Math.max(0.005, options.sampleStepKm ?? 0.03);
    const angleDeadbandRad = Math.max(0, options.angleDeadbandRad ?? (2 * Math.PI / 180));
    const minRadiusMeters = Math.max(1, options.minRadiusMeters ?? 8);

    let accDistance = 0;
    let tightestRadius = Infinity;

    function advanceByDistance(startIdx, targetKm) {
        let i = startIdx;
        let d = 0;
        while (i < smoothRoute.length - 1 && d < targetKm) {
            d += smoothRouteDistances[i] || 0;
            i++;
        }
        return Math.min(i, smoothRoute.length - 1);
    }

    // Scan ahead through sub-points using distance-based heading samples.
    // This avoids overreacting to tiny zig-zags from dense road geometry.
    for (let i = currentIndex; i < smoothRoute.length - 2 && accDistance < lookaheadKm; i++) {
        if (smoothRouteDistances[i] !== undefined) {
            accDistance += smoothRouteDistances[i];
        }

        const i1 = advanceByDistance(i, sampleStepKm);
        const i2 = advanceByDistance(i1, sampleStepKm);
        if (i1 <= i || i2 <= i1) continue;

        const p0 = smoothRoute[i];
        const p1 = smoothRoute[i1];
        const p2 = smoothRoute[i2];

        const bearing1 = Math.atan2(p1.lng - p0.lng, p1.lat - p0.lat);
        const bearing2 = Math.atan2(p2.lng - p1.lng, p2.lat - p1.lat);

        let angleDiff = Math.abs(bearing2 - bearing1);
        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

        if (angleDiff > angleDeadbandRad) {
            // Estimate radius of curvature: R = distance / angle
            let chordKm = 0;
            for (let k = i; k < i1; k++) chordKm += smoothRouteDistances[k] || 0;
            const segDist = Math.max(chordKm, 0.001) * 1000; // meters
            const radius = Math.max(minRadiusMeters, segDist / angleDiff);

            if (radius < tightestRadius) {
                tightestRadius = radius;
            }
        }
    }

    if (tightestRadius === Infinity || tightestRadius > 50000) {
        return Infinity; // Essentially straight, no speed limit
    }

    // Centripetal force: F = mv²/R, G-force = v²/(R*g)
    // Safe speed: v = sqrt(gForceLimit * g * R)
    const safeSpeedMs = Math.sqrt(gForceLimit * 9.81 * tightestRadius);
    const safeSpeedKmh = safeSpeedMs * 3.6;

    return Math.max(safeSpeedKmh, 10); // Never go below 10 km/h
}

// Road geometry may have vertices centimetres apart or hundreds of metres apart.
// Measure turns over a fixed physical distance rather than per-vertex headings.
const roadPathCache = new WeakMap();
const ROAD_CURVE_WINDOW_KM = 0.025;
const ROAD_CURVE_SAMPLE_KM = 0.01;
const ROAD_CURVE_DEADBAND = 3 * Math.PI / 180;

function roadPathData(route, distances) {
    let data = roadPathCache.get(route);
    if (!data || data.distances !== distances) {
        const cumulative = [0];
        for (let i = 0; i < route.length - 1; i++) {
            cumulative.push(cumulative[i] + (distances[i] || 0));
        }
        data = { distances, cumulative };
        roadPathCache.set(route, data);
    }
    return data;
}

function roadPointAtDistance(route, cumulative, distance) {
    const last = cumulative.length - 1;
    const target = Math.max(0, Math.min(distance, cumulative[last]));
    let lo = 0, hi = last;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cumulative[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    if (lo === 0) return route[0];
    const start = route[lo - 1], end = route[lo];
    const span = cumulative[lo] - cumulative[lo - 1];
    const t = span > 0 ? (target - cumulative[lo - 1]) / span : 0;
    return { lat: start.lat + (end.lat - start.lat) * t, lng: start.lng + (end.lng - start.lng) * t };
}

function roadRouteDistance(route, distances, originalIndex, progress) {
    const { cumulative } = roadPathData(route, distances);
    let lo = 0, hi = route.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const point = route[mid];
        if (point.originalIndex < originalIndex ||
            (point.originalIndex === originalIndex && point.originalProgress < progress)) lo = mid + 1;
        else hi = mid;
    }
    if (lo === 0) return 0;
    const prev = route[lo - 1], next = route[lo];
    if (prev.originalIndex !== originalIndex) return cumulative[lo];
    const endProgress = next.originalIndex === originalIndex ? next.originalProgress : 1;
    const span = endProgress - prev.originalProgress;
    const t = span > 0 ? Math.max(0, Math.min(1, (progress - prev.originalProgress) / span)) : 0;
    return cumulative[lo - 1] + (cumulative[lo] - cumulative[lo - 1]) * t;
}

// Signed curvature in radians per metre, positive for a right turn.
function roadCurvatureAtDistance(route, cumulative, distance) {
    const total = cumulative[cumulative.length - 1];
    const window = Math.min(ROAD_CURVE_WINDOW_KM, distance, total - distance);
    if (window < ROAD_CURVE_WINDOW_KM * 0.5) return 0;
    const a = roadPointAtDistance(route, cumulative, distance - window);
    const b = roadPointAtDistance(route, cumulative, distance);
    const c = roadPointAtDistance(route, cumulative, distance + window);
    const latScale = Math.cos(b.lat * Math.PI / 180);
    const first = Math.atan2((b.lng - a.lng) * latScale, b.lat - a.lat);
    const second = Math.atan2((c.lng - b.lng) * latScale, c.lat - b.lat);
    const angle = ((second - first + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    return Math.abs(angle) < ROAD_CURVE_DEADBAND ? 0 : angle / (window * 1000);
}

function getRoadCurvePhysics(route, distances, originalIndex, progress, gLimit, decelMS2, lookaheadKm = 0.7) {
    if (!route || route.length < 3 || !distances || distances.length !== route.length - 1) {
        return { curvature: 0, speedCap: Infinity };
    }
    const { cumulative } = roadPathData(route, distances);
    const position = roadRouteDistance(route, distances, originalIndex, progress);
    const curvature = roadCurvatureAtDistance(route, cumulative, position);
    let speedCap = Infinity;
    const end = Math.min(cumulative[cumulative.length - 1], position + lookaheadKm);
    for (let d = position; d <= end; d += ROAD_CURVE_SAMPLE_KM) {
        const k = Math.abs(roadCurvatureAtDistance(route, cumulative, d));
        if (k > 0) {
            const allowedSpeedSquared = gLimit * 9.81 / k + 2 * decelMS2 * (d - position) * 1000;
            speedCap = Math.min(speedCap, Math.sqrt(allowedSpeedSquared) * 3.6);
        }
    }
    return { curvature, speedCap };
}

// ========================================
// LOCAL SMOOTH ROUTE CACHE
// ========================================
// Preserve the public warm-up hook for callers; the standalone build performs
// route interpolation locally and avoids a non-existent backend request.

/**
 * Fire-and-forget: ask the server to pre-compute the smooth route and cache
 * the result.  Call this right after state.route is set (e.g. in loadSelectedRoute).
 */
async function warmSmoothRouteCache(route, routeType) {
    if (!route || route.length < 2) return;
    void routeType;
}

function generateSmoothRoute(route, routeType = 'rail') {
    if (!route || route.length < 2) {
        return { smoothRoute: [], smoothRouteDistances: [] };
    }

    // Local route computation
    const points = route.map(p => ({ lat: p.latlng.lat, lng: p.latlng.lng }));

    let smoothRoute;
    switch (routeType) {
        case 'rail':
            smoothRoute = generateCatmullRomPath(points, 0.5, 0.05);
            break;
        case 'hyperloop':
            smoothRoute = generateCatmullRomPath(points, 0.3, 0.2);
            break;
        case 'air':
            smoothRoute = generateGreatCirclePath(points, 10);
            break;
        case 'road':
        default:
            smoothRoute = generateLinearPath(points);
            break;
    }

    const smoothRouteDistances = [];
    for (let i = 0; i < smoothRoute.length - 1; i++) {
        smoothRouteDistances.push(calculateDistance(smoothRoute[i], smoothRoute[i + 1]));
    }
    console.log(`🛤️ Smooth route generated: ${smoothRoute.length} points for ${routeType} (${smoothRouteDistances.reduce((a, b) => a + b, 0).toFixed(2)} km total)`);
    return { smoothRoute, smoothRouteDistances };
}

// ========================================
// STATION EASING (Rail)
// ========================================

/**
 * Replaces the track around each intermediate station with a cubic Bézier that is
 * tangent to the incoming and outgoing track, so stations sit on a smooth sweeping
 * curve instead of the sharp kink a spline makes at a stop vertex. Returns new arrays;
 * the input (which may be a shared cache entry) is never mutated.
 *
 * @param {Array} smoothRoute - [{lat, lng, originalIndex, originalProgress}]
 * @param {Array} route - state.route ({latlng, type})
 * @param {number} halfWindowKm - Half the eased length, centred on each station
 */
function easeStationCurves(smoothRoute, route, halfWindowKm) {
    if (!smoothRoute || smoothRoute.length < 3 || !route || route.length < 3) return null;
    const lat0 = smoothRoute[0].lat * Math.PI / 180;
    const toXY = p => [p.lng * 111.32 * Math.cos(lat0), p.lat * 110.574];
    const toLL = c => ({ lat: c[1] / 110.574, lng: c[0] / (111.32 * Math.cos(lat0)) });
    const xy = smoothRoute.map(toXY);
    const cum = [0];
    for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
    const firstIdx = new Array(route.length).fill(-1);
    smoothRoute.forEach((p, i) => { if (firstIdx[p.originalIndex] < 0) firstIdx[p.originalIndex] = i; });
    const segStart = k => (k <= 0 ? 0 : firstIdx[k] >= 0 ? cum[firstIdx[k]] : null);
    const segEnd = k => (k + 1 >= route.length - 1 ? cum[cum.length - 1] : segStart(k + 1));

    const at = s => {
        let i = 0;
        while (i < cum.length - 2 && cum[i + 1] < s) i++;
        const len = cum[i + 1] - cum[i] || 1e-9;
        const t = (s - cum[i]) / len;
        const a = xy[i], b = xy[i + 1];
        return { c: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] };
    };

    const windows = [];
    for (let k = 1; k < route.length - 1; k++) {
        const type = route[k].type || 'stop';
        if (type === 'waypoint' || type === 'dummy') continue;
        const sC = segStart(k), inStart = segStart(k - 1), outEnd = segEnd(k);
        if (sC === null || inStart === null || outEnd === null) continue;
        const h = Math.min(halfWindowKm, 0.45 * (sC - inStart), 0.45 * (outEnd - sC));
        if (!(h > 0.02)) continue;
        const A = at(sC - h), B = at(sC + h);
        const turn = Math.acos(Math.max(-1, Math.min(1, A.d[0] * B.d[0] + A.d[1] * B.d[1])));
        if (turn < 0.02) continue; // already straight
        const chord = Math.hypot(B.c[0] - A.c[0], B.c[1] - A.c[1]);
        const handle = chord / 3;
        const P1 = [A.c[0] + A.d[0] * handle, A.c[1] + A.d[1] * handle];
        const P2 = [B.c[0] - B.d[0] * handle, B.c[1] - B.d[1] * handle];
        const n = Math.max(8, Math.ceil((2 * h) / 0.02));
        const pts = [];
        for (let j = 0; j <= n; j++) {
            const t = j / n, u = 1 - t;
            const c = [0, 1].map(e => u * u * u * A.c[e] + 3 * u * u * t * P1[e] + 3 * u * t * t * P2[e] + t * t * t * B.c[e]);
            pts.push(c);
        }
        // The arc-length midpoint becomes the stop: before it belongs to segment k-1, after to k.
        const arc = [0];
        for (let j = 1; j < pts.length; j++) arc.push(arc[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
        const half = arc[arc.length - 1] / 2;
        const samples = pts.map((c, j) => ({ ...toLL(c), originalIndex: arc[j] < half && j < pts.length - 1 ? k - 1 : k, originalProgress: 0 }));
        windows.push({ s0: sC - h, s1: sC + h, samples });
    }
    if (!windows.length) return null;

    const out = [];
    let w = 0;
    for (let i = 0; i < smoothRoute.length; i++) {
        const win = windows[w];
        if (win && cum[i] >= win.s0) {
            out.push(...win.samples);
            while (i + 1 < smoothRoute.length && cum[i + 1] <= win.s1) i++;
            w++;
            continue;
        }
        out.push(smoothRoute[i]);
    }
    const distances = [];
    for (let i = 0; i < out.length - 1; i++) distances.push(calculateDistance(out[i], out[i + 1]));
    return { smoothRoute: out, smoothRouteDistances: distances };
}

export { generateSmoothRoute, warmSmoothRouteCache, catmullRomPoint, greatCirclePoint, generateCatmullRomPath, generateGreatCirclePath, getUpcomingCurvature, getRoadCurvePhysics, easeStationCurves };
