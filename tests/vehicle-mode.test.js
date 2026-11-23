import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import state from '../js/modules/state.js';
import {
    initializeTrainCoaches,
    resetMap,
    realignTrainCoachesInstant,
    refreshActiveVehicleStyles,
    refreshTrainCoachColors
} from '../js/modules/vehicle.js';
import { removeStationPlatforms } from '../js/modules/careerMode.js';
import { getWaitingPassengers, startPassengerTraffic } from '../js/modules/passengerTraffic.js';
import { processPassengerArrival, stopPassengerTraffic } from '../js/modules/passengerTraffic.js';

vi.mock('../js/modules/careerMode.js', () => ({
    isCareerActive: () => false,
    getPassengersForCoach: () => [],
    getDotColor: vi.fn(),
    getDotColorIndex: vi.fn(),
    removeStationPlatforms: vi.fn(),
    CAREER: {}
}));

class Icon {
    constructor(options) { this.options = options; }
    getRotation() { return this.options.rotation; }
}
class Style {
    constructor({ image }) { this.image = image; }
    getImage() { return this.image; }
    setZIndex() {}
}
class Stroke {
    constructor(options) { this.options = options; }
}
class Point {
    constructor(coords) { this.coords = coords; }
    getCoordinates() { return this.coords; }
    setCoordinates(coords) { this.coords = coords; }
}
class LineString {
    constructor(coords) { this.coords = coords; }
    getCoordinates() { return this.coords; }
    setCoordinates(coords) { this.coords = coords; }
}
class Feature {
    constructor({ geometry }) { this.geometry = geometry; }
    setStyle(style) { this.style = style; }
    getStyle() { return this.style; }
    getGeometry() { return this.geometry; }
    setGeometry(geometry) { this.geometry = geometry; }
}

describe('active vehicle styles', () => {
    let resolutionChanged;
    const original = {};
    beforeAll(() => {
        for (const key of ['map', 'vectorSource', 'vectorLayer', 'route', 'totalDistance', 'trainCoaches', 'trainCouplings', 'movingFeature', 'activeVehicleMode', 'coachType']) {
            original[key] = state[key];
        }
        vi.stubGlobal('window', {});
        vi.stubGlobal('ol', { Feature, geom: { Point, LineString }, style: { Icon, Style, Stroke } });
        const view = { getZoom: () => 10, getResolution: () => 1, on: (_event, callback) => { resolutionChanged = callback; } };
        state.map = { getView: () => view, render: vi.fn() };
        state.vectorSource = { addFeature: vi.fn(), removeFeature: vi.fn() };
        state.trainCoaches = [];
        state.trainCouplings = [];
    });
    afterAll(() => {
        stopPassengerTraffic();
        Object.assign(state, original);
        vi.unstubAllGlobals();
    });

    it.each([
        ['car', 'car.png'],
        ['flight', 'airplane.png'],
        ['ship', 'ship.png']
    ])('keeps the %s icon through zoom, color refresh and departure alignment', (mode, filename) => {
        initializeTrainCoaches(mode, [0, 0], 90, 1);
        const iconSource = () => state.movingFeature.getStyle().getImage().options.src;
        expect(iconSource()).toContain(filename);
        resolutionChanged();
        expect(iconSource()).toContain(filename);
        refreshActiveVehicleStyles();
        refreshTrainCoachColors();
        realignTrainCoachesInstant(90);
        expect(iconSource()).toContain(filename);
    });

    it('still refreshes a train locomotive as a train', () => {
        state.activeVehicleMode = 'train';
        refreshActiveVehicleStyles();
        expect(state.movingFeature.getStyle().getImage().options.src).toContain('train.png');
        refreshTrainCoachColors();
        expect(state.movingFeature.getStyle().getImage().options.src).toContain('train.png');
    });

    it('clears station visuals and generated traffic when resetting the map', () => {
        const route = [
            { latlng: { lat: 0, lng: 0 }, placeName: 'A' },
            { latlng: { lat: 0, lng: 1 }, placeName: 'B' }
        ];
        startPassengerTraffic(route);
        expect(getWaitingPassengers(0).length).toBeGreaterThan(0);
        state.route = route;
        const clear = vi.fn();
        state.vectorLayer = { getSource: () => ({ clear }) };
        vi.stubGlobal('document', { getElementById: () => null });
        resetMap();
        expect(removeStationPlatforms).toHaveBeenCalled();
        expect(getWaitingPassengers(0)).toEqual([]);
        expect(state.route).toEqual([]);
        expect(clear).toHaveBeenCalledOnce();
    });

    it('renders transparent non-career coaches from onboard passenger data', () => {
        const route = [
            { latlng: { lat: 0, lng: 0 }, placeName: 'A' },
            { latlng: { lat: 0, lng: 1 }, placeName: 'B' }
        ];
        const context = {
            beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
            fillRect: vi.fn(), arc: vi.fn()
        };
        vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
        startPassengerTraffic(route, 30);
        processPassengerArrival(0);
        state.coachType = 'transparent';
        initializeTrainCoaches('train', [0, 0], 90, 2);
        const coachIcon = state.trainCoaches[1].getStyle().getImage().options;
        expect(coachIcon.img).toBeTruthy();
        expect(coachIcon.src).toBeUndefined();
        state.coachType = 'opaque';
    });
});
