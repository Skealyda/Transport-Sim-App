import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRoadCurvePhysics } from '../js/modules/curveEngine.js';
import { calculateGForces, updateGForceDisplay } from '../js/modules/gforce.js';
import { fetchRoadRoute } from '../js/modules/routeManager.js';
import state from '../js/modules/state.js';
import { calculateDistance } from '../js/modules/utils.js';

vi.mock('../js/modules/hud.js', () => ({ updateRouteInfo: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

const metre = 1 / 111195;

function path(coords) {
    const points = coords.map(([x, y], i) => ({
        lat: y * metre, lng: x * metre, originalIndex: 0,
        originalProgress: 0
    }));
    const distances = points.slice(1).map((p, i) => calculateDistance(points[i], p));
    const total = distances.reduce((a, b) => a + b, 0);
    let distance = 0;
    points.forEach((point, i) => {
        point.originalProgress = distance / total;
        distance += distances[i] || 0;
    });
    return { points, distances };
}

function physics(route, progress) {
    return getRoadCurvePhysics(route.points, route.distances, 0, progress, 0.1, 0.05 * 9.81);
}

describe('road curve physics', () => {
    it('ignores dense, tiny zigzags without limiting speed or producing curve G', () => {
        const route = path(Array.from({ length: 201 }, (_, i) => [i * 5, i % 2 ? 0.2 : 0]));
        const result = physics(route, 0.5);
        expect(result.curvature).toBe(0);
        expect(result.speedCap).toBe(Infinity);
    });

    it('brakes for a real turn based on distance and releases the limit afterwards', () => {
        const route = path([[0, 0], [1000, 0], [1000, 1000]]);
        const far = physics(route, 0.25);
        const near = physics(route, 0.49);
        const turn = physics(route, 0.5);
        const past = physics(route, 0.55);
        expect(far.speedCap).toBeGreaterThan(80);
        expect(near.speedCap).toBeLessThan(30);
        expect(Math.abs(turn.curvature)).toBeGreaterThan(0.02);
        expect(past.speedCap).toBe(Infinity);
        expect(past.curvature).toBe(0);
    });

    it('gives similar results for sparse and dense representations of the same turn', () => {
        const sparse = path([[0, 0], [1000, 0], [1000, 1000]]);
        const dense = path([
            ...Array.from({ length: 101 }, (_, i) => [i * 10, 0]),
            ...Array.from({ length: 100 }, (_, i) => [1000, (i + 1) * 10])
        ]);
        expect(physics(dense, 0.49).speedCap).toBeCloseTo(physics(sparse, 0.49).speedCap, 2);
        expect(physics(dense, 0.5).curvature).toBeCloseTo(physics(sparse, 0.5).curvature, 5);
    });

    it('can anticipate a bend beyond 700 metres at higher speeds', () => {
        const route = path([[0, 0], [2000, 0], [2000, 2000]]);
        const shortScan = getRoadCurvePhysics(route.points, route.distances, 0, 0.25, 0.1, 0.05 * 9.81, 0.7);
        const brakingScan = getRoadCurvePhysics(route.points, route.distances, 0, 0.25, 0.1, 0.05 * 9.81, 1.2);
        expect(shortScan.speedCap).toBe(Infinity);
        expect(brakingScan.speedCap).toBeGreaterThan(100);
        expect(brakingScan.speedCap).toBeLessThan(120);
    });

    it('uses road curvature instead of visual heading jumps for G-force', () => {
        vi.stubGlobal('document', { querySelector: () => null, getElementById: () => null });
        state.previousTimestamp = 0;
        updateGForceDisplay(0, 0, 0);
        calculateGForces(24, [0, 0], 359, 1000, 0);
        expect(calculateGForces(24, [1, 0], 15, 1016, 0)).toBe(0);
        const result = calculateGForces(24, [2, 0], 15, 1032, 0.01);
        expect(result).toBeCloseTo(0.15 * (24 / 3.6) ** 2 * 0.01 / 9.81, 5);
    });
});

describe('OSRM road geometry', () => {
    it('includes the endpoint distance and maps progress across waypoint boundaries', async () => {
        const coords = [[0, 0], [0.001, 0], [0.002, 0], [0.003, 0], [0.004, 0]];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ routes: [{ geometry: { coordinates: coords }, legs: [] }] })
        }));
        const stops = [coords[0], coords[2], coords[4]].map(([lng, lat]) => ({ latlng: { lat, lng } }));
        await fetchRoadRoute(stops);
        const { roadSmoothRoute: route, roadSmoothDistances: distances } = state;
        expect(distances).toHaveLength(route.length - 1);
        expect(route[1].originalProgress).toBeCloseTo(0.5, 5);
        expect(route[3].originalProgress).toBeCloseTo(0.5, 5);
        expect(distances.reduce((a, b) => a + b, 0)).toBeCloseTo(calculateDistance(route[0], route[4]), 8);
    });
});
