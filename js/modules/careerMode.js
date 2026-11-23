// ====================================
// CAREER / SURVIVAL MODE MODULE
// ====================================
// Economy system: passengers, fares, operating costs, G-force penalties, game-over.
// Career mode always uses semi-auto door mechanics.

import state from './state.js';
import { calculateDistance } from './utils.js';
import { getWaitingPassengers, setPassengerArrivalListener } from './passengerTraffic.js';
import { reverseGeocodeAddress } from './net/geo.js';

// ====================================
// CONSTANTS
// ====================================
export const CAREER = {
    STARTING_BALANCE: 9000,           // ₹9,000
    OPERATING_COST_PER_KM: 100,       // ₹100/km base
    EXTRA_COACH_COST_PER_KM: 50,      // ₹50/km per additional coach beyond 1
    FARE_RATE_PER_KM: 1,              // ₹1/km base fare
    FARE_ROUND_UP: 10,                // Round up to nearest ₹10
    MAX_PAX_PER_COACH: 30,
    INR_TO_USD: 90,                   // Static exchange rate: 1 USD = 90 INR
    // Passenger spawn density multipliers by place type
    SPAWN_DENSITY: {
        hamlet: 3,
        village: 6,
        town: 12,
        city: 22,
        metropolitan: 40
    },
    // G-force smoothness → penalty tiers
    // smoothness = % of journey frames where |gforce| < comfort threshold
    PENALTY_TIERS: [
        { minSmooth: 0.75, refundPct: 0 },    // ≥75% smooth → no penalty
        { minSmooth: 0.50, refundPct: 0.50 },  // 50-75% → 50% refund
        { minSmooth: 0.25, refundPct: 0.70 },  // 25-50% → 70% refund
        { minSmooth: 0,    refundPct: 1.00 }    // <25% → full refund
    ],
    // Legacy — kept for backward compat; color logic now uses DOT_SEGMENT_COLORS
    DOT_COLORS: []
};

// ====================================
// CAREER STATE
// ====================================
let careerState = null;

// ====================================
// BOARDING TICK STATE
// Tracks the gradual boarding/alighting queue at each station stop.
// ====================================
let boardingTickState = {
    running: false,
    alightQueue: [],   // {coach, pax} objects waiting to alight
    boardQueue: [],    // passenger objects waiting to board
    stopIndex: -1,
    intervalId: null,
    displayed: { alighted: 0, boarded: 0 }
};
let platformFeatures = [];
const stationFlows = new Map();

// Traffic rebasing: user-facing 1.0 should feel like legacy 1.8.
const TRAFFIC_BASELINE_FACTOR = 1.8;

function resetBoardingTickState() {
    if (boardingTickState.intervalId) {
        clearInterval(boardingTickState.intervalId);
    }
    boardingTickState = {
        running: false,
        alightQueue: [],
        boardQueue: [],
        stopIndex: -1,
        intervalId: null,
        displayed: { alighted: 0, boarded: 0 }
    };
}

function processBoardingTick() {
    const ts = boardingTickState;
    if (!careerState) { resetBoardingTickState(); return; }

    if (ts.alightQueue.length > 0) {
        const { coach, pax } = ts.alightQueue.shift();
        coach.passengers = coach.passengers.filter(p => p !== pax);
        careerState.totalPassengersServed++;
        ts.displayed.alighted++;
        showPassengerFlow(ts.stopIndex, 0, 1);
        const el = document.getElementById('saCareerAlighted');
        if (el) el.textContent = `⬇️ ${ts.displayed.alighted} alighted`;
        window.refreshActiveVehicleStyles?.();
    } else if (ts.boardQueue.length > 0) {
        const pax = ts.boardQueue.shift();
        let placed = false;
        for (const coach of careerState.coaches) {
            if (coach.passengers.length < CAREER.MAX_PAX_PER_COACH) {
                pax.boardedAt = ts.stopIndex;
                coach.passengers.push(pax);
                careerState.balance += pax.fare;
                careerState.totalRevenue += pax.fare;
                placed = true;
                ts.displayed.boarded++;
                showPassengerFlow(ts.stopIndex, 1, 0);
                window.refreshActiveVehicleStyles?.();
                break;
            }
        }
        if (!placed) {
            // No capacity — park back at station
            careerState.stationPassengers[ts.stopIndex] = careerState.stationPassengers[ts.stopIndex] || [];
            careerState.stationPassengers[ts.stopIndex].push(pax);
        }
        const elB = document.getElementById('saCareerBoarded');
        if (elB) elB.textContent = `⬆️ ${ts.displayed.boarded} boarded`;
    } else {
        // All done — stop interval
        clearInterval(ts.intervalId);
        ts.intervalId = null;
        ts.running = false;
    }

    // Update live on-board count and balance in overlay
    const elOB = document.getElementById('saCareerOnBoard');
    if (elOB) elOB.textContent = `🧑‍🤝‍🧑 ${getTotalPassengerCount()} on board`;
    const elBal = document.getElementById('saCareerBalance');
    if (elBal) elBal.textContent = `💰 ${formatMoney(careerState.balance)}`;

    updateEconomyHUD();
    if (ts.stopIndex >= 0) updateStationPlatform(ts.stopIndex);
}

/** Instantly process all remaining passengers in the boarding queue.
 *  Called before departure to ensure no one is left mid-boarding. */
export function flushBoardingQueue() {
    const ts = boardingTickState;
    if (!ts.running && ts.alightQueue.length === 0 && ts.boardQueue.length === 0) return;

    if (ts.intervalId) {
        clearInterval(ts.intervalId);
        ts.intervalId = null;
    }

    const stopIndex = ts.stopIndex;

    // Process all remaining alighters
    const alighted = ts.alightQueue.length;
    for (const { coach, pax } of ts.alightQueue) {
        coach.passengers = coach.passengers.filter(p => p !== pax);
        careerState.totalPassengersServed++;
    }
    ts.alightQueue = [];

    // Process all remaining boarders
    const leftover = [];
    let boarded = 0;
    for (const pax of ts.boardQueue) {
        let placed = false;
        for (const coach of careerState.coaches) {
            if (coach.passengers.length < CAREER.MAX_PAX_PER_COACH) {
                pax.boardedAt = stopIndex;
                coach.passengers.push(pax);
                careerState.balance += pax.fare;
                careerState.totalRevenue += pax.fare;
                placed = true;
                boarded++;
                break;
            }
        }
        if (!placed) leftover.push(pax);
    }
    ts.boardQueue = [];
    if (leftover.length > 0) {
        careerState.stationPassengers[stopIndex] = careerState.stationPassengers[stopIndex] || [];
        careerState.stationPassengers[stopIndex].push(...leftover);
    }

    ts.running = false;
    showPassengerFlow(stopIndex, boarded, alighted);
    if (careerState) updateEconomyHUD();
    if (stopIndex >= 0) updateStationPlatform(stopIndex);
}

function createFreshState() {
    return {
        active: false,
        balance: CAREER.STARTING_BALANCE,
        totalRevenue: 0,
        totalCosts: 0,
        totalPassengersServed: 0,
        totalDistanceRun: 0,
        currency: localStorage.getItem('careerCurrency') || 'INR',

        // Coaches: array of { passengers: [] }
        // Each passenger: { id, origin, destination, destIndex, fare, boardedAt, remainingKm }
        coaches: [],
        coachCount: 1,

        // Passengers waiting at each stop: { stopIndex -> [passenger, ...] }
        stationPassengers: {},

        // G-force tracking for penalty calculation
        gforceFrames: 0,       // total frames tracked
        smoothFrames: 0,       // frames under comfort threshold
        comfortThreshold: 0.3, // G-force considered "smooth" (absolute)

        // Game over
        gameOver: false,
        gameOverReason: '',

        // Station interaction state
        currentStopIndex: -1,
        lastProcessedKm: 0
    };
}

function getCareerConfig() {
    const fareRate = parseFloat(localStorage.getItem('careerFareRatePerKm') || `${CAREER.FARE_RATE_PER_KM}`);
    const baseCost = parseFloat(localStorage.getItem('careerOperatingCostPerKm') || `${CAREER.OPERATING_COST_PER_KM}`);
    const coachCost = parseFloat(localStorage.getItem('careerExtraCoachCostPerKm') || `${CAREER.EXTRA_COACH_COST_PER_KM}`);
    const trafficMultiplier = parseFloat(localStorage.getItem('careerPassengerTrafficMultiplier') || '1');
    return {
        fareRate: Number.isFinite(fareRate) ? Math.max(0.1, fareRate) : CAREER.FARE_RATE_PER_KM,
        baseCost: Number.isFinite(baseCost) ? Math.max(1, baseCost) : CAREER.OPERATING_COST_PER_KM,
        coachCost: Number.isFinite(coachCost) ? Math.max(0, coachCost) : CAREER.EXTRA_COACH_COST_PER_KM,
        trafficMultiplier: (Number.isFinite(trafficMultiplier)
            ? Math.max(0.1, Math.min(5, trafficMultiplier))
            : 1) * TRAFFIC_BASELINE_FACTOR
    };
}

// ====================================
// INITIALIZATION
// ====================================
export function initCareerMode(coachCount) {
    careerState = createFreshState();
    careerState.active = true;
    careerState.coachCount = coachCount;

    if (!localStorage.getItem('careerEconomyCollapsed')) {
        localStorage.setItem('careerEconomyCollapsed', 'true');
    }

    ensureSegmentDistances();

    // Initialize coach slots
    careerState.coaches = [];
    for (let i = 0; i < coachCount; i++) {
        careerState.coaches.push({ passengers: [] });
    }

    // Pre-spawn passengers at all stops
    spawnAllStationPassengers();

    // Create visual platform features at each stop
    createStationPlatforms();
    setRoutePointLabelsHidden(true);

    // Initialize hover tooltip for passenger dots
    initPlatformTooltip();
    // Initialize right-click context menu on train coaches
    initTrainContextMenu();


    // Signal semi-auto
    state.semiAutoMode = true;
    state.careerMode = true;

    return careerState;
}

export function getCareerState() {
    return careerState;
}

export function isCareerActive() {
    return careerState && careerState.active;
}

export function isGameOver() {
    return careerState && careerState.gameOver;
}

// ====================================
// CURRENCY HELPERS
// ====================================
export function formatMoney(amountINR) {
    if (!careerState) return '₹0';
    if (careerState.currency === 'USD') {
        const usd = amountINR / CAREER.INR_TO_USD;
        return '$' + usd.toFixed(2);
    }
    return '₹' + Math.round(amountINR).toLocaleString('en-IN');
}

export function toggleCurrency() {
    if (!careerState) return;
    careerState.currency = careerState.currency === 'INR' ? 'USD' : 'INR';
    localStorage.setItem('careerCurrency', careerState.currency);
}

// ====================================
// FARE CALCULATION
// ====================================
export function calculateFare(distanceKm) {
    const cfg = getCareerConfig();
    const raw = distanceKm * cfg.fareRate;
    return Math.ceil(raw / CAREER.FARE_ROUND_UP) * CAREER.FARE_ROUND_UP;
}

// ====================================
// OPERATING COST
// ====================================
function getOperatingCostPerKm() {
    if (!careerState) return 0;
    const cfg = getCareerConfig();
    // Base + extra per additional coach
    const extraCoaches = Math.max(0, careerState.coachCount - 1);
    return cfg.baseCost + (extraCoaches * cfg.coachCost);
}

// ====================================
// PASSENGER SPAWNING
// ====================================
function getStopPlaceType(stop) {
    return stop.placeType || 'village';
}

function isRouteLooping() {
    if (!state.route || state.route.length < 3) return false;
    const first = state.route[0];
    const last = state.route[state.route.length - 1];
    const distKm = calculateDistance(first.latlng, last.latlng);
    // Treat as loop if endpoints are within 10 meters (0.01 km)
    if (distKm < 0.01) return true;
    const fn = (first.placeName || '').trim().toLowerCase();
    const ln = (last.placeName || '').trim().toLowerCase();
    return fn.length > 0 && fn === ln;
}

function getStopsBeyondIndex(fromIndex) {
    // All stops (not waypoints/dummies) after fromIndex
    // If route is a loop, exclude the loop endpoint (it's the same station as index 0)
    const loopEndIdx = isRouteLooping() ? state.route.length - 1 : -1;
    const stops = [];
    for (let i = fromIndex + 1; i < state.route.length; i++) {
        if (i === loopEndIdx) continue; // skip duplicate loop endpoint
        const pt = state.route[i].type || 'stop';
        if (pt !== 'waypoint' && pt !== 'dummy') {
            stops.push({ stop: state.route[i], index: i });
        }
    }
    return stops;
}

function distanceBetweenStopIndices(fromIdx, toIdx) {
    if (!state.segmentDistances || !state.segmentDistances.length) return 0;
    let d = 0;
    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);
    for (let i = start; i < end && i < state.segmentDistances.length; i++) {
        d += state.segmentDistances[i];
    }
    return d;
}

function ensureSegmentDistances() {
    if (state.segmentDistances && state.segmentDistances.length === Math.max(0, state.route.length - 1)) {
        return;
    }

    state.segmentDistances = [];
    for (let i = 0; i < state.route.length - 1; i++) {
        state.segmentDistances[i] = calculateDistance(state.route[i].latlng, state.route[i + 1].latlng);
    }
}

function spawnPassengersForStop(stopIndex) {
    const stop = state.route[stopIndex];
    if (!stop || (stop.type || 'stop') === 'waypoint') return;

    const placeType = getStopPlaceType(stop);
    const cfg = getCareerConfig();
    const density = (CAREER.SPAWN_DENSITY[placeType] || CAREER.SPAWN_DENSITY.village) * cfg.trafficMultiplier;

    // Get possible destination stops
    const destinations = getStopsBeyondIndex(stopIndex);
    if (destinations.length === 0) return; // Last stop — no passengers to spawn

    // Weight destinations: cities/metros get higher weight
    const weightedDests = destinations.map(d => {
        const destType = getStopPlaceType(d.stop);
        const weight = (CAREER.SPAWN_DENSITY[destType] || 6) / 6;
        return { ...d, weight };
    });
    const totalWeight = weightedDests.reduce((s, d) => s + d.weight, 0);

    // Spawn density ± 30% randomness
    const count = Math.max(1, Math.round(density * (0.7 + Math.random() * 0.6)));

    const passengers = [];
    for (let p = 0; p < count; p++) {
        // Weighted random destination
        let r = Math.random() * totalWeight;
        let dest = weightedDests[weightedDests.length - 1];
        for (const wd of weightedDests) {
            r -= wd.weight;
            if (r <= 0) { dest = wd; break; }
        }

        const distKm = distanceBetweenStopIndices(stopIndex, dest.index);
        const fare = calculateFare(distKm);

        passengers.push({
            id: `pax-${stopIndex}-${p}-${Date.now()}`,
            origin: stop.placeName,
            originIndex: stopIndex,
            destination: dest.stop.placeName,
            destIndex: dest.index,
            fare: fare,
            distanceKm: distKm,
            remainingKm: distKm,
            boardedAt: null // null = waiting at station
        });
    }

    careerState.stationPassengers[stopIndex] = passengers;
}

function spawnAllStationPassengers() {
    if (!state.route || !careerState) return;
    careerState.stationPassengers = {};
    const loopEndIdx = isRouteLooping() ? state.route.length - 1 : -1;
    for (let i = 0; i < state.route.length; i++) {
        if (i === loopEndIdx) continue; // loop endpoint == start, don't double-spawn
        const pt = state.route[i].type || 'stop';
        if (pt !== 'waypoint' && pt !== 'dummy') {
            spawnPassengersForStop(i);
        }
    }
}

// ====================================
// STATION ARRIVAL / DEPARTURE
// ====================================
export function handleStationArrival(stopIndex) {
    if (!careerState || !careerState.active || careerState.gameOver) return { boarded: 0, alighted: 0 };

    resetBoardingTickState();
    careerState.currentStopIndex = stopIndex;
    boardingTickState.stopIndex = stopIndex;

    // 1) Build alight queue — passengers whose destination is this stop
    for (const coach of careerState.coaches) {
        for (const pax of coach.passengers) {
            if (pax.destIndex === stopIndex) {
                boardingTickState.alightQueue.push({ coach, pax });
            }
        }
    }

    // 2) Build board queue from waiting passengers
    const waiting = careerState.stationPassengers[stopIndex] || [];
    boardingTickState.boardQueue = [...waiting];
    careerState.stationPassengers[stopIndex] = []; // will be repopulated with overflow

    const totalCount = boardingTickState.alightQueue.length + boardingTickState.boardQueue.length;

    // Target ~15 seconds for a typical crowd; clamp per-passenger interval to 400–2000 ms
    const msPerPassenger = totalCount > 0
        ? Math.max(400, Math.min(2000, 15000 / totalCount))
        : 0;

    if (totalCount > 0) {
        boardingTickState.running = true;
        boardingTickState.intervalId = setInterval(processBoardingTick, msPerPassenger);
    }

    // Refresh the platform visual
    updateStationPlatform(stopIndex);

    // Return preview totals (displayed counts start at 0 and animate up)
    return {
        boarded: boardingTickState.boardQueue.length,
        alighted: boardingTickState.alightQueue.length
    };
}

export function handleStationDeparture(stopIndex) {
    if (!careerState || !careerState.active) return;
    // Apply G-force penalty for passengers who've been on board since last stop
    applyGForcePenalty();
    // Reset G-force tracking for next segment
    careerState.gforceFrames = 0;
    careerState.smoothFrames = 0;
}

// ====================================
// FRAME UPDATE (called every animation frame)
// ====================================
export function updateCareerFrame(deltaDistanceKm, currentGForce, isPowered = true) {
    if (!careerState || !careerState.active || careerState.gameOver) return;

    // Deduct operating cost only while traction is actively powering the train.
    if (isPowered) {
        const cost = getOperatingCostPerKm() * deltaDistanceKm;
        careerState.balance -= cost;
        careerState.totalCosts += cost;
    }
    careerState.totalDistanceRun += deltaDistanceKm;

    // Track G-force smoothness
    careerState.gforceFrames++;
    if (Math.abs(currentGForce) < careerState.comfortThreshold) {
        careerState.smoothFrames++;
    }

    // Update remaining km for boarded passengers
    for (const coach of careerState.coaches) {
        for (const pax of coach.passengers) {
            pax.remainingKm = Math.max(0, pax.remainingKm - deltaDistanceKm);
        }
    }

    // Check game over
    if (careerState.balance <= 0) {
        careerState.balance = 0;
        careerState.gameOver = true;
        careerState.gameOverReason = 'bankrupt';
    }
}

// ====================================
// G-FORCE PENALTY
// ====================================
function applyGForcePenalty() {
    if (!careerState || careerState.gforceFrames === 0) return;

    const smoothness = careerState.smoothFrames / careerState.gforceFrames;

    // Find applicable penalty tier
    let refundPct = 0;
    for (const tier of CAREER.PENALTY_TIERS) {
        if (smoothness >= tier.minSmooth) {
            refundPct = tier.refundPct;
            break;
        }
    }

    if (refundPct === 0) return; // No penalty

    // Refund percentage of fares from ALL currently boarded passengers
    let totalRefund = 0;
    for (const coach of careerState.coaches) {
        for (const pax of coach.passengers) {
            const refund = Math.round(pax.fare * refundPct);
            totalRefund += refund;
        }
    }

    if (totalRefund > 0) {
        careerState.balance -= totalRefund;
        careerState.totalCosts += totalRefund;
    }
}

// ====================================
// ADD COACH (runtime)
// ====================================
export function addCoach() {
    if (!careerState || !careerState.active || careerState.gameOver) return false;
    if (!isAtStop()) return false;
    careerState.coachCount++;
    careerState.coaches.push({ passengers: [] });
    return true;
}

export function removeCoach() {
    if (!careerState || !careerState.active || careerState.gameOver) return false;
    if (!isAtStop()) return false;
    if (careerState.coachCount <= 1) return false;
    // Remove last coach — relocate any passengers to other coaches
    const removed = careerState.coaches.pop();
    careerState.coachCount--;
    if (removed && removed.passengers.length > 0) {
        for (const pax of removed.passengers) {
            let placed = false;
            for (const coach of careerState.coaches) {
                if (coach.passengers.length < CAREER.MAX_PAX_PER_COACH) {
                    coach.passengers.push(pax);
                    placed = true;
                    break;
                }
            }
            // If no room, passengers are lost (left at station)
            if (!placed) careerState.totalPassengersServed++;
        }
    }
    return true;
}

export function isAtStop() {
    return careerState && careerState.currentStopIndex >= 0;
}

// ====================================
// AUTOMATION (career settings)
// ====================================
const AUTO_MAX_COACHES = 10;

export function getCareerAutomation() {
    return {
        doors: localStorage.getItem('careerAutoDoors') === 'true',
        coaches: localStorage.getItem('careerAutoCoaches') === 'true',
        startCoaches: localStorage.getItem('careerAutoStartCoaches') !== 'false'
    };
}

export function isBoardingInProgress() {
    const ts = boardingTickState;
    return ts.running || ts.alightQueue.length > 0 || ts.boardQueue.length > 0;
}

function nextStopDistanceKm(stopIndex) {
    const next = getStopsBeyondIndex(stopIndex)[0];
    return next ? distanceBetweenStopIndices(stopIndex, next.index) : 0;
}

// Extra coaches pay off only if the fares of the passengers they carry beat their running cost
// to the next stop (where the rake is re-evaluated).
function profitableExtraCoaches(unseated, avgFare, legKm, coachCost, maxExtra) {
    let extra = 0;
    while (unseated > 0 && extra < maxExtra) {
        const carried = Math.min(CAREER.MAX_PAX_PER_COACH, unseated);
        if (carried * avgFare <= coachCost * legKm) break;
        unseated -= carried;
        extra++;
    }
    return extra;
}

/** Coaches needed at the given stop: staying passengers plus profitable waiting demand. */
function planCoachesAtStop(stopIndex) {
    const cfg = getCareerConfig();
    const cap = CAREER.MAX_PAX_PER_COACH;
    let staying = 0;
    for (const coach of careerState.coaches) {
        for (const pax of coach.passengers) if (pax.destIndex !== stopIndex) staying++;
    }
    const waiting = careerState.stationPassengers[stopIndex] || [];
    const avgFare = waiting.length ? waiting.reduce((s, p) => s + p.fare, 0) / waiting.length : 0;
    const base = Math.max(1, Math.ceil(staying / cap));
    const freeSeats = base * cap - staying;
    const unseated = Math.max(0, waiting.length - freeSeats);
    const extra = profitableExtraCoaches(unseated, avgFare, nextStopDistanceKm(stopIndex), cfg.coachCost, AUTO_MAX_COACHES - base);
    return Math.min(AUTO_MAX_COACHES, base + extra);
}

/** On arrival: add coaches so profitable waiting demand can board. Returns coaches added. */
export function autoAddCoachesForDemand(stopIndex) {
    if (!careerState?.active || careerState.gameOver || !getCareerAutomation().coaches) return 0;
    const target = planCoachesAtStop(stopIndex);
    let added = 0;
    while (careerState.coachCount < target && addCoach()) added++;
    return added;
}

/** Before departure (boarding done): drop surplus coaches the remaining load doesn't need. */
export function autoTrimCoaches() {
    if (!careerState?.active || careerState.gameOver || !getCareerAutomation().coaches) return 0;
    const needed = Math.max(1, Math.ceil(getTotalPassengerCount() / CAREER.MAX_PAX_PER_COACH));
    let removed = 0;
    while (careerState.coachCount > needed && removeCoach()) removed++;
    return removed;
}

/** Starting rake from expected traffic. With auto coaches the rake is re-planned at every stop, so
 *  size it for the origin's demand; otherwise size a fixed rake whose extra coaches earn more over
 *  the route's load profile than they cost to haul end to end. */
export function recommendStartingCoaches() {
    if (!careerState || !state.route?.length) return 1;
    const cap = CAREER.MAX_PAX_PER_COACH;
    const stopIdx = [];
    const loopEndIdx = isRouteLooping() ? state.route.length - 1 : -1;
    for (let i = 0; i < state.route.length; i++) {
        const t = state.route[i].type || 'stop';
        if (i !== loopEndIdx && t !== 'waypoint' && t !== 'dummy') stopIdx.push(i);
    }
    if (!stopIdx.length) return 1;
    if (getCareerAutomation().coaches) return planCoachesAtStop(stopIdx[0]);

    const legs = [];
    let onboard = [];
    let fares = 0;
    let paxKm = 0;
    for (const i of stopIdx) {
        const boarding = careerState.stationPassengers[i] || [];
        for (const p of boarding) { fares += p.fare; paxKm += p.distanceKm; }
        onboard = onboard.filter(p => p.destIndex !== i).concat(boarding);
        const km = nextStopDistanceKm(i);
        if (km > 0) legs.push({ load: onboard.length, km });
    }
    if (!legs.length || paxKm <= 0) return 1;
    const revenuePerPaxKm = fares / paxKm;
    const routeKm = legs.reduce((s, l) => s + l.km, 0);
    const coachCost = getCareerConfig().coachCost;
    let coaches = 1;
    while (coaches < AUTO_MAX_COACHES) {
        const seatKm = legs.reduce((s, l) => s + Math.min(cap, Math.max(0, l.load - coaches * cap)) * l.km, 0);
        if (seatKm * revenuePerPaxKm <= coachCost * routeKm) break;
        coaches++;
    }
    return coaches;
}

/** Resize the rake before departure from the origin (no passengers on board yet). */
export function setStartingCoachCount(count) {
    if (!careerState) return;
    const n = Math.max(1, Math.min(AUTO_MAX_COACHES, Math.round(count)));
    careerState.coachCount = n;
    careerState.coaches = Array.from({ length: n }, () => ({ passengers: [] }));
}

export function setAtStop(stopIndex) {
    if (!careerState) return;
    careerState.currentStopIndex = stopIndex;
}

export function clearAtStop() {
    if (!careerState) return;
    careerState.currentStopIndex = -1;
}

// ====================================
// PASSENGER QUERY HELPERS
// ====================================
export function getTotalPassengerCount() {
    if (!careerState) return 0;
    return careerState.coaches.reduce((sum, c) => sum + c.passengers.length, 0);
}

export function getPassengersForCoach(coachIndex) {
    if (!careerState || coachIndex >= careerState.coaches.length) return [];
    return careerState.coaches[coachIndex].passengers;
}

export function getStationPassengers(stopIndex) {
    if (!careerState) return [];
    return careerState.stationPassengers[stopIndex] || [];
}

function getVisibleStationPassengers(stopIndex) {
    const waiting = careerState ? getStationPassengers(stopIndex) : getWaitingPassengers(stopIndex);
    const ts = boardingTickState;

    // While boarding is active at this stop, render the live queue so dots
    // disappear progressively with each tick instead of vanishing instantly.
    if (careerState && ts.stopIndex === stopIndex) {
        return [...ts.boardQueue, ...waiting];
    }

    return waiting;
}

export function getSmoothnessPercent() {
    if (!careerState || careerState.gforceFrames === 0) return 100;
    return Math.round((careerState.smoothFrames / careerState.gforceFrames) * 100);
}

// 8-step gradient from green (almost arrived) → dark-red (long journey ahead).
// Thresholds are expressed as fractions of the total route length so that the
// full colour range is always visible regardless of route distance.
const DOT_SEGMENT_COLORS = [
    '#4ade80', // 0  – 0–12.5 % remaining  → green
    '#a3e635', // 1  – 12.5–25 %           → lime
    '#facc15', // 2  – 25–37.5 %           → yellow
    '#fbbf24', // 3  – 37.5–50 %           → amber
    '#fb923c', // 4  – 50–62.5 %           → orange
    '#f87171', // 5  – 62.5–75 %           → light red
    '#dc2626', // 6  – 75–87.5 %           → red
    '#7f1d1d', // 7  – 87.5–100 %          → dark red
];

/**
 * Returns the 0-based colour-bucket index (0 = almost arrived, 7 = just boarded).
 * Uses state.totalRouteDistance so the full 8-step gradient spans the whole route.
 */
export function getDotColorIndex(remainingKm) {
    let total = state.totalRouteDistance || 0;
    // totalRouteDistance is set by animateMovement, but initCareerMode runs before
    // that. Fall back to segmentDistances (always populated by ensureSegmentDistances).
    if (total <= 0 && state.segmentDistances && state.segmentDistances.length > 0) {
        total = state.segmentDistances.reduce((s, d) => s + d, 0);
    }
    if (total <= 0) return 7; // last-resort fallback: dark red
    const fraction = Math.min(1, Math.max(0, remainingKm / total));
    return Math.min(7, Math.floor(fraction * 8));
}

export function getDotColor(remainingKm) {
    return DOT_SEGMENT_COLORS[getDotColorIndex(remainingKm)];
}

// ====================================
// STATION TRACK GEOMETRY
// ====================================
// Stations are cut from the same smoothed polyline the train runs on, so the
// platforms sit exactly on the track and bend with it through curves.
let _trackCache = null;

function getTrackPath() {
    const smooth = state.smoothRoute && state.smoothRoute.length > 2 ? state.smoothRoute : null;
    if (_trackCache && _trackCache.smooth === smooth && _trackCache.route === state.route) return _trackCache;
    const pts = smooth
        ? smooth.map(p => ({ c: ol.proj.fromLonLat([p.lng, p.lat]), seg: p.originalIndex }))
        : (state.route || []).map((p, i) => ({ c: ol.proj.fromLonLat([p.latlng.lng, p.latlng.lat]), seg: i }));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1].c, b = pts[i].c;
        cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    _trackCache = { smooth, route: state.route, pts, cum };
    return _trackCache;
}

// Arc length (projected units) where the stop sits on the track. Only the two
// segments touching the stop are searched so out-and-back routes pick the right pass.
function locateStopOnTrack(track, stopIndex) {
    const ll = state.route[stopIndex].latlng;
    const target = ol.proj.fromLonLat([ll.lng, ll.lat]);
    let best = null;
    const scan = (accept) => {
        for (let i = 0; i < track.pts.length - 1; i++) {
            if (accept && !accept(track.pts[i].seg)) continue;
            const a = track.pts[i].c, b = track.pts[i + 1].c;
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const len2 = dx * dx + dy * dy;
            const t = len2 > 0 ? clamp(((target[0] - a[0]) * dx + (target[1] - a[1]) * dy) / len2, 0, 1) : 0;
            const ex = a[0] + dx * t - target[0], ey = a[1] + dy * t - target[1];
            const d2 = ex * ex + ey * ey;
            if (!best || d2 < best.d2) best = { d2, s: track.cum[i] + Math.sqrt(len2) * t };
        }
    };
    scan(seg => seg === stopIndex || seg === stopIndex - 1);
    if (!best) scan(null);
    return best ? best.s : 0;
}

// Point and unit direction at arc length s; beyond either end the first/last segment is extended.
function pointAlong(coords, cum, s) {
    const n = coords.length;
    let i = 0;
    if (s >= cum[n - 1]) i = n - 2;
    else if (s > 0) {
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
        i = lo;
    }
    const a = coords[i], b = coords[i + 1];
    const len = cum[i + 1] - cum[i];
    if (!(len > 1e-9)) return { c: a.slice(), dir: [1, 0] };
    const t = (s - cum[i]) / len;
    return { c: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] };
}

function getStationLengthMeters() {
    const sizeMultiplier = Number.isFinite(state.stationSizeMultiplier) ? state.stationSizeMultiplier : 1.2;
    return STATION_WORLD_LENGTH_M * sizeMultiplier;
}

// Centripetal Catmull-Rom through every track vertex: the platform arcs smoothly
// through bends yet still passes exactly through the track points.
function densifyCentripetal(points, steps) {
    if (points.length < 3) return points.map(p => p.slice());
    const out = [points[0].slice()];
    const knot = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i], p2 = points[i + 1];
        const p0 = points[i - 1] || [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
        const p3 = points[i + 2] || [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
        const t1 = knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
        for (let k = 1; k <= steps; k++) {
            const t = t1 + (t2 - t1) * (k / steps);
            const lerp = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
            const a1 = lerp(p0, p1, 0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
            const b1 = lerp(a1, a2, 0, t2), b2 = lerp(a2, a3, t1, t3);
            out.push(k === steps ? p2.slice() : lerp(b1, b2, t1, t2));
        }
    }
    return out;
}

function buildStationPath(stopIndex) {
    const track = getTrackPath();
    if (track.pts.length < 2 || !state.route[stopIndex]) return null;
    const center = locateStopOnTrack(track, stopIndex);
    const trackCoords = track.pts.map(p => p.c);
    // Web Mercator stretches distances by 1/cos(lat).
    const mercator = 1 / Math.max(0.05, Math.cos(state.route[stopIndex].latlng.lat * Math.PI / 180));
    const halfLen = getStationLengthMeters() * mercator / 2;
    const s0 = center - halfLen, s1 = center + halfLen;
    const coords = [pointAlong(trackCoords, track.cum, s0).c];
    for (let i = 0; i < trackCoords.length; i++) {
        if (track.cum[i] > s0 && track.cum[i] < s1) coords.push(trackCoords[i].slice());
    }
    coords.push(pointAlong(trackCoords, track.cum, s1).c);
    const deduped = coords.filter((c, i) => i === 0 || Math.hypot(c[0] - coords[i - 1][0], c[1] - coords[i - 1][1]) > 1e-6);
    if (deduped.length < 2) return null;
    const smooth = densifyCentripetal(deduped, 6);
    const cum = [0];
    for (let i = 1; i < smooth.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(smooth[i][0] - smooth[i - 1][0], smooth[i][1] - smooth[i - 1][1]));
    }
    return {
        track,
        coords: smooth,
        cum,
        lengthProj: cum[cum.length - 1],
        widthProj: cum[cum.length - 1] * (PLAT_H / PLAT_W),
        center: pointAlong(trackCoords, track.cum, center).c
    };
}

// Maps a crowd-canvas position (x along the station, y across it) onto the curved station.
function stationCanvasToMap(path, x, y) {
    const { c, dir } = pointAlong(path.coords, path.cum, (x / PLAT_W) * path.lengthProj);
    const offset = ((PLAT_H / 2 - y) / PLAT_H) * path.widthProj;
    return [c[0] - dir[1] * offset, c[1] + dir[0] * offset];
}

// ====================================
// STATION PLATFORM FEATURES
// ====================================
const PLAT_W = 150;
const PLAT_H = 40;
const PLAT_DOT_R = 2.4;
const PLATFORM_DOT_MOVE_MS = 200;
const STATION_WORLD_LENGTH_M = 220;
const STATION_HIDE_SCALE_THRESHOLD = 0.018;
const _stationCrowdState = new Map();
let _platformMotionTimer = null;

function hashForCrowdJitter(input) {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function showPassengerFlow(stopIndex, boarded, alighted) {
    if (boarded + alighted <= 0) return;
    const now = Date.now();
    const dots = stationFlows.get(stopIndex) || [];
    const add = (count, entering) => {
        const visibleCount = Math.min(10, count);
        for (let i = 0; i < visibleCount; i++) {
            const side = i % 2 === 0 ? 'top' : 'bottom';
            const bounds = CROWD_BOUNDS[side];
            const startY = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
            const trackY = side === 'top' ? 14 : 26;
            dots.push({
                x: bounds.minX + Math.random() * (bounds.maxX - bounds.minX),
                y: entering ? startY : trackY,
                startY: entering ? startY : trackY,
                targetY: entering ? trackY : startY,
                startedAt: now,
                color: entering ? '#67e8f9' : '#fda4af'
            });
        }
    };
    add(boarded, true);
    add(alighted, false);
    stationFlows.set(stopIndex, dots);
    updateStationPlatform(stopIndex);
    state.world3D?.animatePassengerFlow?.({ stopIndex, boarded, alighted });
    ensurePlatformSyncListeners();
}

setPassengerArrivalListener(({ stopIndex, boarded, alighted }) => showPassengerFlow(stopIndex, boarded, alighted));

// Crowd-simulation space: a PLAT_W x PLAT_H station with platforms either side of a centre track.
const STATION_TRACK_UNITS = 10;
const STATION_PLATFORM_UNITS = PLAT_H - 6;
const CROWD_BOUNDS = (() => {
    const platH = Math.floor((PLAT_H - STATION_TRACK_UNITS - 6) / 2);
    const topY = 3, bottomY = topY + platH + STATION_TRACK_UNITS;
    const minX = 10, maxX = PLAT_W - 10;
    return {
        top: { minX, maxX, minY: topY + 3, maxY: topY + Math.max(3, platH - 3) },
        bottom: { minX, maxX, minY: bottomY + 3, maxY: bottomY + Math.max(3, platH - 3) }
    };
})();

function refreshStationFeature(feature) {
    const idx = feature.get('careerPlatformIdx');
    if (typeof idx !== 'number') return;
    const path = feature.get('stationPath');
    if (!path || path.track !== getTrackPath()) {
        const fresh = buildStationPath(idx);
        if (fresh) {
            feature.set('stationPath', fresh, true);
            feature.getGeometry().setCoordinates(fresh.coords);
        }
    }
    feature.set('crowdDots', computeCrowdDots(idx, getVisibleStationPassengers(idx), CROWD_BOUNDS));
    feature.set('flowDots', stationFlows.get(idx) || []);
}

function refreshAllStationPlatforms() {
    for (const f of platformFeatures) refreshStationFeature(f);
}

function ensurePlatformSyncListeners() {
    if (!_platformMotionTimer) {
        _platformMotionTimer = setInterval(() => {
            const now = Date.now();
            for (const [index, dots] of stationFlows) {
                const active = dots.filter(dot => now - dot.startedAt < 2200);
                if (active.length) stationFlows.set(index, active);
                else stationFlows.delete(index);
            }
            if (platformFeatures.length) refreshAllStationPlatforms();
            if (!careerState?.active && stationFlows.size === 0) clearPlatformMotionTimer();
        }, PLATFORM_DOT_MOVE_MS);
    }
}

function clearPlatformMotionTimer() {
    if (_platformMotionTimer) {
        clearInterval(_platformMotionTimer);
        _platformMotionTimer = null;
    }
}

function ensureCrowdDotPosition(dot, sideBounds, minDist, existing) {
    for (let tries = 0; tries < 48; tries++) {
        const x = sideBounds.minX + Math.random() * (sideBounds.maxX - sideBounds.minX);
        const y = sideBounds.minY + Math.random() * (sideBounds.maxY - sideBounds.minY);
        let ok = true;
        for (const other of existing) {
            const dx = x - other.x;
            const dy = y - other.y;
            if (dx * dx + dy * dy < minDist * minDist) {
                ok = false;
                break;
            }
        }
        if (ok) {
            dot.x = x;
            dot.y = y;
            return;
        }
    }

    dot.x = sideBounds.minX + Math.random() * (sideBounds.maxX - sideBounds.minX);
    dot.y = sideBounds.minY + Math.random() * (sideBounds.maxY - sideBounds.minY);
}

function computeCrowdDots(stopIndex, passengers, bounds) {
    const now = Date.now();
    const speedMin = 1.2;
    const speedMax = 3.2;
    const minDist = PLAT_DOT_R * 2.6;

    let stationState = _stationCrowdState.get(stopIndex);
    if (!stationState) {
        stationState = { dots: new Map(), lastTs: now };
        _stationCrowdState.set(stopIndex, stationState);
    }

    const dt = clamp((now - stationState.lastTs) / 1000, 0.01, 0.08);
    stationState.lastTs = now;

    const wantedKeys = new Set();
    const topDots = [];
    const bottomDots = [];
    let topCount = 0;
    let bottomCount = 0;

    for (let i = 0; i < passengers.length; i++) {
        const p = passengers[i];
        const key = p.id || `${stopIndex}-${i}-${p.originIndex || 0}-${p.destIndex || 0}`;
        wantedKeys.add(key);

        let dot = stationState.dots.get(key);
        if (!dot) {
            const side = topCount === bottomCount
                ? (Math.random() < 0.5 ? 'top' : 'bottom')
                : (topCount < bottomCount ? 'top' : 'bottom');
            dot = {
                key,
                side,
                x: Number.NaN,
                y: Number.NaN,
                vx: 0,
                vy: 0,
                turnAt: 0,
                color: getDotColor(p.remainingKm)
            };
            stationState.dots.set(key, dot);
            const seededSpeed = speedMin + Math.random() * (speedMax - speedMin);
            const angle = Math.random() * Math.PI * 2;
            dot.vx = Math.cos(angle) * seededSpeed;
            dot.vy = Math.sin(angle) * seededSpeed;
            dot.turnAt = now + 1200 + Math.random() * 2200;
        }

        dot.color = getDotColor(p.remainingKm);
        const sideBounds = dot.side === 'top' ? bounds.top : bounds.bottom;
        if (!Number.isFinite(dot.x) || !Number.isFinite(dot.y)) {
            ensureCrowdDotPosition(dot, sideBounds, minDist, dot.side === 'top' ? topDots : bottomDots);
        }

        if (now >= dot.turnAt) {
            const angle = Math.random() * Math.PI * 2;
            const speed = speedMin + Math.random() * (speedMax - speedMin);
            dot.vx = Math.cos(angle) * speed;
            dot.vy = Math.sin(angle) * speed;
            dot.turnAt = now + 1200 + Math.random() * 2800;
        }

        dot.x += dot.vx * dt;
        dot.y += dot.vy * dt;

        if (dot.x < sideBounds.minX) { dot.x = sideBounds.minX; dot.vx = Math.abs(dot.vx); }
        if (dot.x > sideBounds.maxX) { dot.x = sideBounds.maxX; dot.vx = -Math.abs(dot.vx); }
        if (dot.y < sideBounds.minY) { dot.y = sideBounds.minY; dot.vy = Math.abs(dot.vy); }
        if (dot.y > sideBounds.maxY) { dot.y = sideBounds.maxY; dot.vy = -Math.abs(dot.vy); }

        if (dot.side === 'top') {
            topDots.push(dot);
            topCount++;
        } else {
            bottomDots.push(dot);
            bottomCount++;
        }
    }

    for (const key of Array.from(stationState.dots.keys())) {
        if (!wantedKeys.has(key)) stationState.dots.delete(key);
    }

    function repel(list, sideBounds) {
        for (let iter = 0; iter < 3; iter++) {
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    const a = list[i];
                    const b = list[j];
                    let dx = a.x - b.x;
                    let dy = a.y - b.y;
                    let d2 = dx * dx + dy * dy;
                    if (d2 < 0.0001) {
                        dx = (Math.random() - 0.5) * 0.2;
                        dy = (Math.random() - 0.5) * 0.2;
                        d2 = dx * dx + dy * dy;
                    }
                    const d = Math.sqrt(d2);
                    if (d < minDist) {
                        const push = (minDist - d) * 0.5;
                        const nx = dx / d;
                        const ny = dy / d;
                        a.x += nx * push;
                        a.y += ny * push;
                        b.x -= nx * push;
                        b.y -= ny * push;
                    }
                }
                list[i].x = clamp(list[i].x, sideBounds.minX, sideBounds.maxX);
                list[i].y = clamp(list[i].y, sideBounds.minY, sideBounds.maxY);
            }
        }
    }

    repel(topDots, bounds.top);
    repel(bottomDots, bounds.bottom);

    return [...topDots, ...bottomDots];
}

function stationStroke(color, widthPx) {
    return new ol.style.Style({
        stroke: new ol.style.Stroke({ color, width: Math.max(0.6, widthPx), lineCap: 'butt', lineJoin: 'round' }),
        zIndex: 90
    });
}

// Layered strokes along the curved station centreline: outline, deck, two
// platforms, the track bed with rails, then the waiting-passenger crowd.
function stationStyleFunction(feature, resolution) {
    const path = feature.get('stationPath');
    if (!path || !(resolution > 0)) return null;
    const lengthPx = path.lengthProj / resolution;
    if (lengthPx / PLAT_W <= STATION_HIDE_SCALE_THRESHOLD) return null;
    const dots = feature.get('crowdDots') || [];
    const flowDots = feature.get('flowDots') || [];
    const cache = feature.get('_stationStyleCache');
    if (cache && cache.resolution === resolution && cache.dots === dots && cache.flowDots === flowDots && cache.path === path) return cache.styles;

    const unit = path.widthProj / resolution / PLAT_H;
    const styles = [
        stationStroke('#475569', PLAT_H * unit),
        stationStroke('rgba(20, 28, 42, 0.92)', (PLAT_H - 3.2) * unit),
        stationStroke('rgba(148, 163, 184, 0.18)', STATION_PLATFORM_UNITS * unit),
        stationStroke('rgba(15, 23, 42, 0.95)', STATION_TRACK_UNITS * unit),
        stationStroke('rgba(100, 116, 139, 0.65)', (STATION_TRACK_UNITS - 3) * unit),
        stationStroke('rgba(15, 23, 42, 0.95)', (STATION_TRACK_UNITS - 5) * unit)
    ];

    const byColor = new Map();
    for (const dot of dots) {
        if (!byColor.has(dot.color)) byColor.set(dot.color, []);
        byColor.get(dot.color).push(stationCanvasToMap(path, dot.x, dot.y));
    }
    const now = Date.now();
    for (const dot of flowDots) {
        const progress = clamp((now - dot.startedAt) / 2200, 0, 1);
        const y = dot.startY + (dot.targetY - dot.startY) * progress;
        if (!byColor.has(dot.color)) byColor.set(dot.color, []);
        byColor.get(dot.color).push(stationCanvasToMap(path, dot.x, y));
    }
    const dotRadius = Math.max(1.2, PLAT_DOT_R * unit);
    for (const [color, points] of byColor) {
        styles.push(new ol.style.Style({
            geometry: new ol.geom.MultiPoint(points),
            image: new ol.style.Circle({ radius: dotRadius, fill: new ol.style.Fill({ color }) }),
            zIndex: 90
        }));
    }

    const stopName = state.route[feature.get('careerPlatformIdx')]?.placeName || '';
    styles.push(new ol.style.Style({
        geometry: new ol.geom.Point(path.center),
        text: new ol.style.Text({
            text: stopName,
            font: 'bold 11px "Segoe UI", sans-serif',
            fill: new ol.style.Fill({ color: '#fde68a' }),
            stroke: new ol.style.Stroke({ color: '#111827', width: 3 }),
            offsetY: -(Math.max(6, (PLAT_H * unit) / 2) + 8),
            textAlign: 'center',
            rotateWithView: false
        }),
        zIndex: 91
    }));

    feature.set('_stationStyleCache', { resolution, dots, flowDots, path, styles }, true);
    return styles;
}

export function createStationPlatforms() {
    if (!state.vectorSource || !state.route || (state.currentRouteType && state.currentRouteType !== 'rail')) return;
    removeStationPlatforms();
    platformFeatures = [];
    if (careerState) careerState.platformFeatures = platformFeatures;
    ensurePlatformSyncListeners();

    const loopEndIdx = isRouteLooping() ? state.route.length - 1 : -1;
    for (let i = 0; i < state.route.length; i++) {
        if (i === loopEndIdx) continue; // loop endpoint == start, skip duplicate platform
        const pt = state.route[i];
        const ptType = pt.type || 'stop';
        if (ptType === 'waypoint' || ptType === 'dummy') continue;
        const path = buildStationPath(i);
        if (!path) continue;
        const feature = new ol.Feature({ geometry: new ol.geom.LineString(path.coords) });
        feature.set('careerPlatformIdx', i);
        feature.set('stationPath', path);
        feature.setStyle(stationStyleFunction);
        refreshStationFeature(feature);
        state.vectorSource.addFeature(feature);
        platformFeatures.push(feature);
    }
}

export function updateStationPlatform(stopIndex) {
    for (const f of platformFeatures) {
        if (f.get('careerPlatformIdx') === stopIndex) {
            refreshStationFeature(f);
            break;
        }
    }
}

export function removeStationPlatforms() {
    for (const f of platformFeatures) {
        if (state.vectorSource && state.vectorSource.hasFeature(f)) {
            state.vectorSource.removeFeature(f);
        }
    }
    platformFeatures = [];
    if (careerState) careerState.platformFeatures = platformFeatures;
    stationFlows.clear();
    clearPlatformMotionTimer();
    _stationCrowdState.clear();
}

function setRoutePointLabelsHidden(hidden) {
    if (!state.vectorSource) return;

    for (const feature of state.vectorSource.getFeatures()) {
        if (feature.get('careerPlatformIdx') !== undefined) continue;

        const geometry = feature.getGeometry();
        if (!(geometry instanceof ol.geom.Point)) continue;

        const style = feature.getStyle();
        if (!style || Array.isArray(style) || typeof style.getText !== 'function') continue;
        if (!style.getText()) continue;

        if (hidden) {
            if (!feature.get('_careerOriginalStyle') && typeof style.clone === 'function') {
                feature.set('_careerOriginalStyle', style);
                const hiddenStyle = style.clone();
                hiddenStyle.setText(undefined);
                feature.setStyle(hiddenStyle);
            }
        } else {
            const originalStyle = feature.get('_careerOriginalStyle');
            if (originalStyle) {
                feature.setStyle(originalStyle);
                feature.unset('_careerOriginalStyle', true);
            }
        }
    }
}

// ====================================
// CLASSIFY ROUTE (async, direct rate-limited geocoding with local defaults)
// ====================================
export async function classifyRouteIfNeeded(routeName) {
    if (!state.route || state.route.length === 0) return;
    // Check if any stops lack placeType
    const needsClassification = state.route.some(p =>
        (p.type || 'stop') !== 'waypoint' && !p.placeType
    );
    if (!needsClassification) return;

    for (const point of state.route) {
        if ((point.type || 'stop') === 'waypoint' || point.placeType) continue;
        try {
            const location = await reverseGeocodeAddress(point.latlng.lat, point.latlng.lng, 10);
            const address = location?.address || {};
            point.placeType = address.city || address.municipality ? 'city'
                : address.suburb ? 'city'
                    : address.town ? 'town'
                        : address.hamlet ? 'hamlet'
                            : 'village';
        } catch (e) {
            point.placeType = 'village';
            console.warn(`⚠️ Could not classify ${routeName || point.placeName}; using village.`, e);
        }
    }
}

// ====================================
// RESET / CLEANUP
// ====================================
export function resetCareerMode() {
    if (careerState) {
        removeStationPlatforms();
        setRoutePointLabelsHidden(false);
        careerState.active = false;
    }
    careerState = null;
    state.careerMode = false;
}

// ====================================
// HIGH SCORE
// ====================================
export function saveHighScore() {
    if (!careerState) return;
    const scores = JSON.parse(localStorage.getItem('careerHighScores') || '[]');
    scores.push({
        date: new Date().toISOString(),
        distance: careerState.totalDistanceRun.toFixed(1),
        revenue: careerState.totalRevenue,
        passengers: careerState.totalPassengersServed,
        balance: careerState.balance
    });
    // Keep top 10 by distance
    scores.sort((a, b) => parseFloat(b.distance) - parseFloat(a.distance));
    localStorage.setItem('careerHighScores', JSON.stringify(scores.slice(0, 10)));
}

// ====================================
// ECONOMY HUD UPDATE
// ====================================
export function updateEconomyHUD() {
    if (!careerState) return;

    const balanceEl = document.getElementById('economyBalance');
    const paxEl = document.getElementById('economyPax');
    const revenueEl = document.getElementById('economyRevenue');
    const costsEl = document.getElementById('economyCosts');
    const coachesEl = document.getElementById('economyCoaches');
    const smoothEl = document.getElementById('economySmoothness');
    const netEl = document.getElementById('economyNetProfit');
    const currBtn = document.getElementById('currencyToggleBtn');
    const panel = document.getElementById('economyPanel');

    if (panel) {
        const collapsed = localStorage.getItem('careerEconomyCollapsed') !== 'false';
        panel.classList.toggle('economy-panel-collapsed', collapsed);
    }

    if (balanceEl) {
        balanceEl.textContent = formatMoney(careerState.balance);
        balanceEl.classList.toggle('economy-low', careerState.balance < 1000);
        balanceEl.classList.toggle('economy-draining', careerState.balance >= 1000 && careerState.totalCosts > careerState.totalRevenue);
    }
    if (paxEl) paxEl.textContent = getTotalPassengerCount();
    if (revenueEl) revenueEl.textContent = formatMoney(careerState.totalRevenue);
    if (costsEl) costsEl.textContent = formatMoney(careerState.totalCosts);
    if (coachesEl) coachesEl.textContent = careerState.coachCount;
    if (smoothEl) smoothEl.textContent = getSmoothnessPercent() + '%';
    if (netEl) {
        const net = careerState.totalRevenue - careerState.totalCosts;
        netEl.textContent = formatMoney(net);
        netEl.classList.toggle('economy-green', net >= 0);
        netEl.classList.toggle('economy-red', net < 0);
    }
    if (currBtn) currBtn.textContent = careerState.currency === 'INR' ? '₹' : '$';
}

export function toggleEconomyPanelCollapsed() {
    const collapsed = localStorage.getItem('careerEconomyCollapsed') !== 'false';
    localStorage.setItem('careerEconomyCollapsed', collapsed ? 'false' : 'true');
    updateEconomyHUD();
}

// ====================================
// GAME OVER OVERLAY
// ====================================
export function showGameOverOverlay() {
    if (!careerState) return;
    saveHighScore();

    const overlay = document.getElementById('careerGameOverOverlay');
    if (!overlay || overlay.style.display !== 'none') return;

    document.getElementById('goDistance').textContent = careerState.totalDistanceRun.toFixed(1) + ' km';
    document.getElementById('goPassengers').textContent = careerState.totalPassengersServed;
    document.getElementById('goRevenue').textContent = formatMoney(careerState.totalRevenue);
    document.getElementById('goCosts').textContent = formatMoney(careerState.totalCosts);

    overlay.style.display = '';
}

// ====================================
// PASSENGER HOVER TOOLTIP
// ====================================
let paxTooltipEl = null;

function ensureTooltip() {
    if (paxTooltipEl) return paxTooltipEl;
    paxTooltipEl = document.createElement('div');
    paxTooltipEl.id = 'paxTooltip';
    Object.assign(paxTooltipEl.style, {
        position: 'absolute', pointerEvents: 'none', display: 'none',
        background: 'rgba(15,23,42,0.92)', color: '#e2e8f0',
        padding: '3px 7px', borderRadius: '4px', fontSize: '11px',
        whiteSpace: 'nowrap', zIndex: '9999', border: '1px solid #334155',
        transform: 'translate(-50%, -100%)', marginTop: '-8px'
    });
    document.body.appendChild(paxTooltipEl);
    return paxTooltipEl;
}

let _coachHoverTimer = null;
let _coachHoverX = 0, _coachHoverY = 0;

export function initPlatformTooltip() {
    if (!state.map) return;
    state.map.on('pointermove', (evt) => {
        if (evt.dragging) { clearTimeout(_coachHoverTimer); _coachHoverTimer = null; }
        if (evt.dragging) { hideTooltip(); clearTimeout(_coachHoverTimer); return; }

        // Priority 1: hovering over a moving train coach → show on-board passengers
        if (isCareerActive() && state.trainCoaches && state.trainCoaches.length > 0) {
            let coachFeature = null;
            state.map.forEachFeatureAtPixel(evt.pixel, (f) => {
                if (!coachFeature && state.trainCoaches.includes(f)) coachFeature = f;
            });
            if (coachFeature) {
                const coachIdx = state.trainCoaches.indexOf(coachFeature);
                const passengers = getPassengersForCoach(coachIdx);
                const tip = ensureTooltip();
                if (!passengers || passengers.length === 0) {
                    tip.innerHTML = `<div style="color:#94a3b8;font-size:10px">Coach ${coachIdx + 1} — empty</div>`;
                } else {
                    // Detect which specific passenger dot is being hovered (if any)
                    const coachGeom = coachFeature.getGeometry();
                    const coachScreenPos = state.map.getPixelFromCoordinate(coachGeom.getCoordinates());
                    const mouseX = evt.pixel[0];
                    const mouseY = evt.pixel[1];
                    const CANVAS_W = 100, CANVAS_H = 32, DOT_COLS = 10, DOT_ROWS = 3;
                    const DOT_PAD_X = 7, DOT_PAD_Y = 5;
                    const DOT_STEP_X = (CANVAS_W - DOT_PAD_X * 2) / DOT_COLS;
                    const DOT_STEP_Y = (CANVAS_H - DOT_PAD_Y * 2) / DOT_ROWS;
                    const capacity = CAREER.MAX_PAX_PER_COACH;

                    // Compute actual rendered icon half-dimensions (matches vehicle.js career icon scale)
                    const currentZoom = state.map.getView().getZoom();
                    const nz = Math.max(0, Math.min(1, (currentZoom - 5) / 11));
                    const ez = nz * nz * (3 - 2 * nz);
                    const zs = (0.02 + 0.028 * ez) * (state.vehicleSizeMultiplier || 1.0);
                    const iconScale = zs * 12;
                    const halfW = (CANVAS_W / 2) * iconScale; // icon half-width in screen px
                    const halfH = (CANVAS_H / 2) * iconScale; // icon half-height in screen px

                    // Forward-project each dot from canvas space → screen space.
                    // OL icon rotation is clockwise-positive: rotation = (bearing-90)*π/180.
                    // With rotateWithView:true the map's view rotation adds to effective screen rotation.
                    const theta = ((state.currentBearing || 0) - 90) * (Math.PI / 180)
                        + (state.map.getView().getRotation() || 0);
                    const cosT = Math.cos(theta);
                    const sinT = Math.sin(theta);

                    // Accept nearest dot within 1.5× dot-cell radius, minimum 10px
                    const hitRadius = Math.max(10, (halfW * 2 / DOT_COLS) * 1.5);
                    let hoveredDotIndex = -1;
                    let nearestDist2 = hitRadius * hitRadius;

                    for (let slot = 0; slot < capacity; slot++) {
                        const col = slot % DOT_COLS;
                        const row = Math.floor(slot / DOT_COLS);
                        const dotCnX = DOT_PAD_X + col * DOT_STEP_X + DOT_STEP_X / 2;
                        const dotCnY = DOT_PAD_Y + row * DOT_STEP_Y + DOT_STEP_Y / 2;
                        // Canvas-relative offset from center in screen px
                        const canRelX = (dotCnX / CANVAS_W - 0.5) * 2 * halfW;
                        const canRelY = (dotCnY / CANVAS_H - 0.5) * 2 * halfH;
                        // Screen position of this dot (clockwise-positive rotation with Y-down)
                        const dotSX = coachScreenPos[0] + canRelX * cosT - canRelY * sinT;
                        const dotSY = coachScreenPos[1] + canRelX * sinT + canRelY * cosT;
                        const ddx = mouseX - dotSX;
                        const ddy = mouseY - dotSY;
                        const d2 = ddx * ddx + ddy * ddy;
                        if (d2 < nearestDist2) {
                            nearestDist2 = d2;
                            hoveredDotIndex = slot;
                        }
                    }
                    
                    if (hoveredDotIndex >= 0 && hoveredDotIndex < passengers.length) {
                        // Occupied seat — show this passenger only
                        const p = passengers[hoveredDotIndex];
                        const origin = state.route[p.originIndex]?.placeName || '?';
                        const dest = state.route[p.destIndex]?.placeName || '?';
                        const color = getDotColor(p.remainingKm);
                        tip.innerHTML = `<div style="font-weight:700;color:#7dd3fc;margin-bottom:4px">Passenger ${hoveredDotIndex + 1} · Coach ${coachIdx + 1}</div><div style="color:${color};">● ${origin} → ${dest}</div><div style="opacity:0.6;font-size:10px;margin-top:4px">Fare: ${p.fare} INR · Remaining: ${Math.round(p.remainingKm)} km</div>`;
                    } else if (hoveredDotIndex >= 0) {
                        // Empty seat
                        tip.innerHTML = `<div style="color:#475569;font-size:10px">Coach ${coachIdx + 1} · Seat ${hoveredDotIndex + 1} — empty</div>`;
                    } else {
                        // Hovered coach body but no dot found (shouldn't normally happen)
                        tip.innerHTML = `<div style="color:#94a3b8;font-size:10px">Coach ${coachIdx + 1} · ${passengers.length} passengers</div>`;
                    }
                }
                tip.style.left = (evt.originalEvent.pageX + 14) + 'px';
                tip.style.top = (evt.originalEvent.pageY + 14) + 'px';
                tip.style.display = '';
                // 3-second hover → nudge toward manual controls panel
                clearTimeout(_coachHoverTimer);
                _coachHoverX = evt.originalEvent.pageX;
                _coachHoverY = evt.originalEvent.pageY;
                _coachHoverTimer = setTimeout(() => {
                    if (window.showManualControlPanel) window.showManualControlPanel();
                }, 3000);
                return;
            }
        }

        // Priority 2: hovering over a station platform → show waiting passengers
        const feature = state.map.forEachFeatureAtPixel(evt.pixel, (f) => {
            return f.get('careerPlatformIdx') !== undefined ? f : null;
        });
        if (!feature) { hideTooltip(); return; }

        const stopIndex = feature.get('careerPlatformIdx');
        const passengers = getStationPassengers(stopIndex);
        const stopName = state.route[stopIndex]?.placeName || '';
        const tip = ensureTooltip();
        if (!passengers || passengers.length === 0) {
            tip.innerHTML = `<div style="font-weight:700;color:#94a3b8;margin-bottom:3px">${stopName}</div><span style="opacity:0.55">No passengers waiting</span>`;
        } else {
            const lines = passengers.slice(0, 8).map(p => {
                const origin = state.route[p.originIndex]?.placeName || '?';
                const dest = state.route[p.destIndex]?.placeName || '?';
                const color = getDotColor(p.remainingKm);
                return `<span style="color:${color}">●</span> ${dest}`;
            });
            if (passengers.length > 8) lines.push(`<span style="opacity:0.5">+${passengers.length - 8} more…</span>`);
            tip.innerHTML = `<div style="font-weight:700;color:#fde68a;margin-bottom:4px">🚉 ${stopName} · ${passengers.length} waiting</div>` + lines.join('<br>');
        }
        tip.style.left = evt.originalEvent.pageX + 'px';
        tip.style.top = evt.originalEvent.pageY + 'px';
        tip.style.display = '';
    });
}

function hideTooltip() {
    if (paxTooltipEl) paxTooltipEl.style.display = 'none';
}

// ====================================
// TRAIN RIGHT-CLICK CONTEXT MENU
// ====================================
function initTrainContextMenu() {
    if (!state.map) return;
    const mapEl = state.map.getTargetElement();
    if (!mapEl || mapEl._trainCtxBound) return;
    mapEl._trainCtxBound = true;

    mapEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const pixel = state.map.getEventPixel(e);
        let trainHit = false;
        state.map.forEachFeatureAtPixel(pixel, (f) => {
            if (!trainHit && state.trainCoaches && state.trainCoaches.includes(f)) trainHit = true;
        });
        if (!trainHit) return;
        _showTrainCtxMenu(e.pageX, e.pageY);
    });

    document.addEventListener('click', _hideTrainCtxMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') _hideTrainCtxMenu(); });
}

function _getOrCreateTrainCtxMenu() {
    let menu = document.getElementById('trainContextMenu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'trainContextMenu';
    menu.className = 'train-ctx-menu';
    menu.style.display = 'none';
    document.body.appendChild(menu);
    return menu;
}

function _showTrainCtxMenu(x, y) {
    const menu = _getOrCreateTrainCtxMenu();
    const career = isCareerActive();
    const cs = career ? getCareerState() : null;
    const speedVal = window.currentSimSpeed !== undefined ? Math.round(window.currentSimSpeed) : null;

    menu.innerHTML = `
        <div class="train-ctx-title">🚂 Train Controls</div>
        ${speedVal !== null ? `<div class="train-ctx-stat">${speedVal} km/h</div>` : ''}
        <div class="train-ctx-sep"></div>
        <button class="train-ctx-item" id="tctx-brake">🛑 Emergency Brake</button>
        <button class="train-ctx-item" id="tctx-doors">🚪 Toggle Doors</button>
        ${career && cs ? `<div class="train-ctx-sep"></div><div class="train-ctx-stat">💰 ${formatMoney(cs.balance)}</div>` : ''}
    `;

    const brakeBtn = menu.querySelector('#tctx-brake');
    const doorsBtn = menu.querySelector('#tctx-doors');
    if (brakeBtn) brakeBtn.onclick = () => { if (window.emergencyBrake) window.emergencyBrake(); _hideTrainCtxMenu(); };
    if (doorsBtn) doorsBtn.onclick = () => { if (window.toggleDoors) window.toggleDoors(); _hideTrainCtxMenu(); };

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = '';
    requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';
    });
}

function _hideTrainCtxMenu() {
    const menu = document.getElementById('trainContextMenu');
    if (menu) menu.style.display = 'none';
}
