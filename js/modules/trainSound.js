// ====================================
// TRAIN SOUND ENGINE — speed-synchronised traction, track, brakes, doors and horns
// ====================================
// Three Indian Railways soundscapes, all procedurally synthesised on the Web Audio clock:
// - electric (default): WAP-7 three-phase loco (blower whirr, transformer hum, converter and
//              gear whine, compressor) hauling LHB coaches — cushioned rhythmic weld thumps
//              under a heavy low roar
// - metro    : lightweight EMU heard from a sealed saloon (VVVF inverter "song", motor whine,
//              air-con) on slab track with rail-corrugation roar
// - diesel   : ALCO WDM-3A (looped 16-cylinder exhaust pulses — the chug — notching, turbo
//              whistle) hauling ICF coaches on 13 m jointed rails: "tak-tak… tak-tak", shutter
//              rattle, vestibule creak
// Wheel impacts are noise-excited, damped steel resonances muffled by the coach floor (not
// tonal modes). Horns model an air-driven diaphragm and flared trumpet.
// Track events are placed in route metres: rail joints, station-yard turnouts (toe → frog →
// check rail), steel girder bridges (hollow resonant drumroll) and curve flange squeal. Real
// bridges/turnouts come from OpenStreetMap when available (one cached request per route).
// All nodes feed the shared mixing graph (soundEngine.js), so music apps keep playing.

import state from './state.js';
import { getAudioGraph, loadSample, makeSeamlessLoop, holdAudio, isLowPowerAudio } from './soundEngine.js';
import { getRailFeatures } from './net/railFeatures.js';

const STORAGE_KEY = 'trainSoundProfile';
const LEGACY_PROFILES = { default: 'metro', indian: 'diesel' };
const LOW_POWER = isLowPowerAudio();
const LOOKAHEAD = 0.06;
const MAX_HITS_PER_SEC = LOW_POWER ? 36 : 64;
const PARAM_INTERVAL = LOW_POWER ? 0.09 : 0.045;
const HIT_VARIANTS = LOW_POWER ? 3 : 5;

// Event kinds placed along the route (metres).
const EV_JOINT = 0;
const EV_TOE = 1;
const EV_FROG = 2;
const EV_CHECK = 3;
const EV_GIRDER = 4;
const EVENT_LEVEL = [1, 0.75, 1.35, 0.5, 0.8];

const PROFILES = {
	metro: {
		traction: 'emu',
		// Ballastless slab track with long welded rails: only occasional insulated joints.
		railLength: 0,
		sparseJoints: [700, 1600],
		jointGain: 0.32,
		coachLength: 21.6,
		bogieCentres: 14.8,
		axleSpacing: 2.5,
		listener: 'mid',
		falloff: 6,
		// Resilient slab fastenings: a soft, low "dup" rather than a clack.
		hit: { thud: [78, 1, 0.028], click: 0.25, res: [[380, 4, 0.35], [950, 6, 0.2]], muffle: 1500, gap: 0 },
		switchHit: { thud: [72, 1, 0.04], click: 0.35, res: [[340, 4, 0.45], [880, 6, 0.3], [1900, 9, 0.12]], muffle: 1800, gap: 0.003 },
		turnoutsAtTerminiOnly: true,
		roar: { base: 220, slope: 3.2, gain: 0.05 },
		// Rail corrugation on slab track: the tonal metro "roaring rail" (~5 cm wavelength).
		corrugation: { wavelength: 0.055, gain: 0.03 },
		rumble: 0.8,
		wind: 0.025,
		windFrom: 60,
		brakeSqueal: 0.02,
		squealFreq: 3150,
		flange: 0.035,
		airBrakeHiss: 0,
		hissGain: 0.2,
		rattle: 0,
		creak: 0,
		passingTrains: false,
		ambience: 0.45,
		horn: { notes: [659.3, 830.6], wave: 'triangle', filter: 4200, gain: 0.075, drive: 1 },
		hornDepart: [[0.22, 0.1], [0.3, 0]],
		hornApproach: [[0.3, 0]],
		doors: 'metro'
	},
	electric: {
		traction: 'electric',
		// LHB (Fiat bogies, disc brakes) on welded rails: the rhythmic, cushioned thump of
		// flash-butt welds and insulated joints every ~26 m, under a heavy low roar.
		railLength: 26,
		sparseJoints: null,
		jointGain: 0.42,
		coachLength: 23.54,
		bogieCentres: 14.9,
		axleSpacing: 2.56,
		listener: 'mid',
		falloff: 7,
		hit: { thud: [64, 1, 0.045], click: 0.3, res: [[300, 4, 0.4], [720, 6, 0.25], [1500, 8, 0.1]], muffle: 1300, gap: 0 },
		switchHit: { thud: [68, 1, 0.055], click: 0.45, res: [[280, 4, 0.5], [700, 6, 0.4], [1500, 9, 0.2]], muffle: 2000, gap: 0.004 },
		turnoutsAtTerminiOnly: false,
		roar: { base: 150, slope: 2.6, gain: 0.08 },
		corrugation: null,
		rumble: 1.3,
		wind: 0.08,
		windFrom: 50,
		brakeSqueal: 0.015,
		squealFreq: 2900,
		flange: 0.04,
		airBrakeHiss: 0.16,
		hissGain: 0.3,
		rattle: 0,
		creak: 0,
		passingTrains: true,
		ambience: 0.8,
		horn: { notes: [415.3, 523.3], wave: 'sawtooth', filter: 5200, gain: 0.11, drive: 2, duty: 0.28 },
		hornDepart: [[1.1, 0]],
		hornApproach: [[0.5, 0.15], [0.8, 0]],
		doors: 'mainline'
	},
	diesel: {
		traction: 'diesel',
		// ICF coaches on 13 m fishplated rails; listener over a bogie gives the classic double tap.
		railLength: 13,
		sparseJoints: null,
		jointGain: 0.62,
		coachLength: 23.5,
		bogieCentres: 14.9,
		axleSpacing: 2.56,
		listener: 'bogie',
		falloff: 4.5,
		hit: {
			// The crisp ICF "tak": wheel drops into the 13 m fishplate gap, strikes the far rail.
			thud: [92, 0.9, 0.03],
			click: 0.55,
			res: [[520, 5, 0.45], [1150, 8, 0.4], [2300, 11, 0.22]],
			muffle: 3000,
			gap: 0.0045
		},
		switchHit: { thud: [80, 1, 0.05], click: 0.6, res: [[450, 5, 0.55], [1050, 8, 0.45], [2100, 10, 0.25]], muffle: 3200, gap: 0.006 },
		turnoutsAtTerminiOnly: false,
		roar: { base: 190, slope: 3.6, gain: 0.065 },
		corrugation: null,
		rumble: 1,
		wind: 0.2,
		windFrom: 25,
		brakeSqueal: 0.07,
		squealFreq: 2450,
		flange: 0.05,
		airBrakeHiss: 0.08,
		hissGain: 0.38,
		rattle: 0.3,
		creak: 1,
		passingTrains: true,
		ambience: 0.8,
		horn: { notes: [349.2, 440.0], wave: 'square', filter: 4600, gain: 0.11, drive: 2.4, duty: 0.34 },
		hornDepart: [[1.35, 0]],
		hornApproach: [[0.4, 0.18], [0.9, 0]],
		doors: 'mainline'
	}
};

const DEFAULT_PROFILE = 'electric';

let profileName = DEFAULT_PROFILE;
let graph = null;
let nodes = null;
let traction = null;
let active = false;
let distanceM = 0;
let lastTrackKm = NaN;
let lastSpeed = 0;
let accelSmoothed = 0;
let paramClock = 0;
let lastUpdateWall = 0;
let stallTimer = null;
let silenced = true;
let hitBudget = { second: 0, count: 0 };
let noiseBuffer = null;
let buffers = { profile: null, joint: [], switch: [], rattle: null, creak: null, slam: null };
let lastHissAt = -10;
let lastAirBrakeAt = -10;
let brakeApplied = false;
let nextCreakAt = 0;
let nextPassAt = 0;

// Route geometry (metres) and the profile-specific events placed on it.
let geometry = null;
let realFeatures = null;
let track = { profile: null, pos: new Float64Array(0), kind: new Uint8Array(0), bridges: [] };
let curveCursor = 0;
let journeyToken = 0;

const profile = () => PROFILES[profileName] || PROFILES[DEFAULT_PROFILE];
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, v) => {
	const t = clamp((v - a) / (b - a));
	return t * t * (3 - 2 * t);
};

// ---------- Settings ----------

function normaliseProfile(name) {
	const value = LEGACY_PROFILES[name] || name;
	return PROFILES[value] ? value : DEFAULT_PROFILE;
}

export function initTrainSoundSettings() {
	const saved = localStorage.getItem(STORAGE_KEY);
	profileName = normaliseProfile(saved);
	if (saved && saved !== profileName) localStorage.setItem(STORAGE_KEY, profileName);
	const select = document.getElementById('trainSoundProfileSelect');
	if (select) select.value = profileName;
}

export function setTrainSoundProfile(name) {
	profileName = normaliseProfile(name);
	localStorage.setItem(STORAGE_KEY, profileName);
	const select = document.getElementById('trainSoundProfileSelect');
	if (select) select.value = profileName;
	if (nodes) {
		configureProfile();
		buildTrackEvents();
		if (active) {
			traction.start?.(graph.ctx.currentTime);
			traction.idle(graph.ctx.currentTime);
		}
	}
}

export function previewTrainHorn() {
	if (!ensureGraph()) return;
	playHorn(profile().hornDepart);
}

// ---------- Synthesis helpers ----------

function sampleUrl(id) {
	const el = document.getElementById(id);
	return el?.dataset.src || el?.querySelector('source')?.getAttribute('src') || null;
}

function makeNoise(ctx) {
	const length = ctx.sampleRate * 2;
	const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
	return buffer;
}

function makeBrownNoise(ctx) {
	const length = ctx.sampleRate * 3;
	const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
	const data = buffer.getChannelData(0);
	let last = 0;
	for (let i = 0; i < length; i++) {
		last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
		data[i] = last * 3.5;
	}
	return makeSeamlessLoop(ctx, buffer, 0.1);
}

function seededRandom(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6D2B79F5) >>> 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function normalise(buffer, peakTarget = 0.9, fadeSec = 0.02) {
	const d = buffer.getChannelData(0);
	const length = d.length;
	let peak = 0;
	for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(d[i]));
	const scale = peak > 0 ? peakTarget / peak : 1;
	const fadeStart = length - Math.floor(buffer.sampleRate * fadeSec);
	for (let i = 0; i < length; i++) d[i] *= scale * (i > fadeStart ? (length - i) / (length - fadeStart) : 1);
	return buffer;
}

// Two-pole band-pass resonator (RBJ, 0 dB peak) run over an excitation signal in place.
function resonate(src, sr, freq, Q) {
	const w = 2 * Math.PI * Math.min(freq, sr * 0.45) / sr;
	const alpha = Math.sin(w) / (2 * Q);
	const a0 = 1 + alpha;
	const b0 = alpha / a0;
	const a1 = -2 * Math.cos(w) / a0;
	const a2 = (1 - alpha) / a0;
	const out = new Float32Array(src.length);
	let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
	for (let i = 0; i < src.length; i++) {
		const x = src[i];
		const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
		x2 = x1; x1 = x; y2 = y1; y1 = y;
		out[i] = y;
	}
	return out;
}

// Two cascaded one-pole low-passes: the coach floor and body muffle what the wheel radiates.
function muffle(d, sr, cutoff) {
	if (!cutoff) return;
	const k = 1 - Math.exp(-2 * Math.PI * cutoff / sr);
	let a = 0, b = 0;
	for (let i = 0; i < d.length; i++) {
		a += k * (d[i] - a);
		b += k * (a - b);
		d[i] = b;
	}
}

/**
 * One wheel striking a rail discontinuity. Steel-on-steel is broadband, not tonal: a noise
 * contact burst excites short, heavily damped wheel/rail resonances, the unsprung mass gives
 * a low body thump, and the coach floor filters the lot. spec:
 * { thud: [Hz, level, tau], click, res: [[Hz, Q, level]…], muffle: Hz, gap: s }
 */
function renderImpact(ctx, spec, seed, seconds = 0.24) {
	const sr = ctx.sampleRate;
	const length = Math.floor(sr * seconds);
	const buffer = ctx.createBuffer(1, length, sr);
	const d = buffer.getChannelData(0);
	const rnd = seededRandom(seed);
	const jitter = (amount = 0.1) => 1 + (rnd() - 0.5) * amount;
	const excitation = new Float32Array(length);

	const strike = (startSec, amp) => {
		const i0 = Math.floor(startSec * sr);
		const burst = Math.min(length - i0, Math.floor(sr * 0.012));
		const tau = sr * 0.0012 * jitter(0.4);
		for (let i = 0; i < burst; i++) excitation[i0 + i] += amp * (rnd() * 2 - 1) * Math.exp(-i / tau);
		const [thudFreq, thudLevel, thudTau] = spec.thud;
		const f0 = thudFreq * jitter(0.2);
		const decay = thudTau * jitter(0.25) * sr;
		const n = Math.min(length - i0, Math.floor(decay * 6));
		let ph = 0;
		for (let i = 0; i < n; i++) {
			// Pitch sags as the wheel settles: a "thump", not a tone.
			ph += 2 * Math.PI * f0 * (0.7 + 0.3 * Math.exp(-i / (sr * 0.012))) / sr;
			const attack = Math.min(1, i / (sr * 0.0015));
			d[i0 + i] += amp * thudLevel * attack * Math.sin(ph) * Math.exp(-i / decay);
		}
	};

	if (spec.gap) {
		// The wheel drops into the joint gap, then strikes the far rail end harder.
		strike(0, 0.45);
		strike(spec.gap * jitter(0.35), 1);
	} else {
		strike(0, 1);
	}
	for (let i = 0; i < length; i++) d[i] += excitation[i] * spec.click;
	for (const [freq, Q, level] of spec.res) {
		const ring = resonate(excitation, sr, freq * jitter(0.12), Q * jitter(0.3));
		for (let i = 0; i < length; i++) d[i] += ring[i] * level * 3;
	}
	muffle(d, sr, spec.muffle);
	return normalise(buffer);
}

// ICF window shutters and fittings: a short burst of loose, damped metallic knocks.
function renderRattle(ctx, seed) {
	const sr = ctx.sampleRate;
	const length = Math.floor(sr * 0.32);
	const buffer = ctx.createBuffer(1, length, sr);
	const d = buffer.getChannelData(0);
	const rnd = seededRandom(seed);
	const excitation = new Float32Array(length);
	for (let c = 0; c < 11; c++) {
		const at = Math.floor(Math.pow(rnd(), 1.5) * (length - sr * 0.02));
		const amp = (0.4 + rnd() * 0.6) * Math.exp(-at / (sr * 0.12));
		for (let i = 0; i < sr * 0.002 && at + i < length; i++) excitation[at + i] += amp * (rnd() * 2 - 1) * Math.exp(-i / (sr * 0.0005));
	}
	[[900, 6, 0.6], [1900, 9, 0.5], [3300, 12, 0.3]].forEach(([freq, Q, level]) => {
		const ring = resonate(excitation, sr, freq * (0.9 + rnd() * 0.2), Q);
		for (let i = 0; i < length; i++) d[i] += ring[i] * level;
	});
	muffle(d, sr, 4200);
	return normalise(buffer, 0.8);
}

/**
 * Diesel exhaust: integer engine cycles (720° of crank) at a reference 600 rpm, one pulse per
 * cylinder firing. Each pulse is a low exhaust "pop" through the stack resonance; the ALCO's
 * uneven cylinder balance accents some firings, which is what the ear hears as the chug.
 * Looped with playbackRate = rpm / 600, so it stays seamless at any notch.
 */
const DIESEL_REF_RPM = 600;
function renderDieselCycles(ctx, seed, cylinders = 16, cycles = LOW_POWER ? 4 : 8) {
	const sr = ctx.sampleRate;
	const cycleSec = 2 * 60 / DIESEL_REF_RPM;
	const length = Math.floor(sr * cycleSec * cycles);
	const buffer = ctx.createBuffer(1, length, sr);
	const d = buffer.getChannelData(0);
	const rnd = seededRandom(seed);
	const excitation = new Float32Array(length);
	// Firing-order accent pattern: strong/weak banks give the lumpy ALCO beat.
	const accent = [1, 0.55, 0.8, 0.5, 0.95, 0.6, 0.7, 0.45, 1, 0.5, 0.85, 0.55, 0.9, 0.6, 0.75, 0.5];
	const spacing = length / (cycles * cylinders);
	for (let c = 0; c < cycles; c++) {
		const cycleGain = 0.85 + rnd() * 0.3;
		for (let k = 0; k < cylinders; k++) {
			const i0 = Math.floor((c * cylinders + k) * spacing + (rnd() - 0.5) * spacing * 0.08);
			const amp = accent[k % accent.length] * cycleGain * (0.9 + rnd() * 0.2);
			const tau = sr * 0.0035;
			for (let i = 0; i < sr * 0.02; i++) {
				const at = (i0 + i) % length;
				excitation[at] += amp * (rnd() * 2 - 1) * Math.exp(-i / tau);
			}
			// Low-frequency pressure pulse (wraps around so the loop is seamless).
			const pulse = Math.floor(spacing * 1.6);
			for (let i = 0; i < pulse; i++) {
				const at = (i0 + i) % length;
				d[at] += amp * 0.9 * Math.sin(Math.PI * i / pulse) ** 2 * Math.sin(2 * Math.PI * 46 * i / sr);
			}
		}
	}
	// Exhaust stack and manifold resonances. Running over two copies and keeping the second
	// lets the resonance tails wrap into the loop start, so the loop point is inaudible.
	const doubled = new Float32Array(length * 2);
	doubled.set(excitation);
	doubled.set(excitation, length);
	[[95, 2.5, 1], [210, 3, 0.6], [480, 4, 0.25]].forEach(([freq, Q, level]) => {
		const ring = resonate(doubled, sr, freq, Q);
		for (let i = 0; i < length; i++) d[i] += ring[length + i] * level * 2.2;
	});
	// Wrap the low-pass the same way.
	const wrapped = new Float32Array(length * 2);
	wrapped.set(d);
	wrapped.set(d, length);
	muffle(wrapped, sr, 1400);
	d.set(wrapped.subarray(length));
	normalise(buffer, 0.85, 0);
	return buffer;
}

// Vestibule plates and buffers: stick-slip friction — an irregular low pulse train through a resonance.
function renderCreak(ctx, seed) {
	const sr = ctx.sampleRate;
	const length = Math.floor(sr * 0.7);
	const buffer = ctx.createBuffer(1, length, sr);
	const d = buffer.getChannelData(0);
	const rnd = seededRandom(seed);
	const res = 2 * Math.PI * (650 + rnd() * 400) / sr;
	let y1 = 0;
	let y2 = 0;
	const r = 0.996;
	let next = 0;
	for (let i = 0; i < length; i++) {
		const t = i / length;
		const env = Math.sin(Math.PI * t) ** 0.7;
		let x = 0;
		if (i >= next) {
			x = env * (0.6 + rnd() * 0.4);
			const rate = 38 + 34 * Math.sin(Math.PI * t) + (rnd() - 0.5) * 14;
			next = i + Math.floor(sr / rate);
		}
		const y = x + 2 * r * Math.cos(res) * y1 - r * r * y2;
		y2 = y1;
		y1 = y;
		d[i] = y;
	}
	return normalise(buffer, 0.7);
}

function periodicWave(ctx, amplitudes) {
	const real = new Float32Array(amplitudes.length + 1);
	const imag = new Float32Array(amplitudes.length + 1);
	amplitudes.forEach((a, i) => { imag[i + 1] = a; });
	return ctx.createPeriodicWave(real, imag);
}

function gainNode(ctx, value = 0) {
	const g = ctx.createGain();
	g.gain.value = value;
	return g;
}

function filterNode(ctx, type, frequency, Q = 1) {
	const f = ctx.createBiquadFilter();
	f.type = type;
	f.frequency.value = frequency;
	f.Q.value = Q;
	return f;
}

function loopedNoise(ctx) {
	const src = ctx.createBufferSource();
	src.buffer = noiseBuffer;
	src.loop = true;
	src.loopStart = 0;
	return src;
}

function playBuffer(buffer, when, level, { rate = 1, destination = nodes.bus } = {}) {
	if (!buffer || level < 0.002) return;
	const ctx = graph.ctx;
	const src = ctx.createBufferSource();
	src.buffer = buffer;
	src.playbackRate.value = rate;
	const gain = gainNode(ctx, level);
	src.connect(gain).connect(destination);
	src.start(Math.max(ctx.currentTime, when));
}

function noiseBurst(when, duration, { type = 'highpass', freq = 2200, Q = 0.7, level = 0.2, attack = 0.03, hold = 0.2, destination } = {}) {
	const ctx = graph.ctx;
	const src = ctx.createBufferSource();
	src.buffer = noiseBuffer;
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.0001, when);
	gain.gain.exponentialRampToValueAtTime(level, when + attack);
	gain.gain.setValueAtTime(level, when + attack + hold);
	gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
	src.connect(filterNode(ctx, type, freq, Q)).connect(gain).connect(destination || nodes.bus);
	src.start(when, Math.random() * 0.3, duration + 0.05);
}

function stopAll(sources) {
	sources.forEach(s => { try { s.stop(); } catch { /* stopped */ } s.disconnect(); });
}

// ---------- Traction models ----------

// Metro EMU: three-phase induction motors behind IGBT VVVF inverters and a geared axle drive,
// heard from inside a sealed, air-conditioned saloon: everything arrives through the floor.
function buildEmu(ctx, out) {
	const sources = [];
	const floor = filterNode(ctx, 'lowpass', 2600, 0.6);
	floor.connect(out);

	const gear = ctx.createOscillator();
	gear.setPeriodicWave(periodicWave(ctx, [1, 0.3, 0.12]));
	const gearGain = gainNode(ctx);
	gear.connect(gearGain).connect(floor);

	// Motor magnetic whine: the rising "wheee" at 2×f(stator) with slot harmonics.
	const motor = ctx.createOscillator();
	motor.setPeriodicWave(periodicWave(ctx, [1, 0.5, 0.2, 0.1, 0.35, 0.05, 0.28, 0, 0, 0, 0.12, 0, 0.1]));
	const motorGain = gainNode(ctx);
	motor.connect(filterNode(ctx, 'lowpass', 1800, 0.7)).connect(motorGain).connect(floor);

	// PWM carrier with ±2·f(motor) sidebands: the inverter "song" when pulling away.
	const carrier = ctx.createOscillator();
	carrier.setPeriodicWave(periodicWave(ctx, [1, 0, 0.18]));
	const fm = ctx.createOscillator();
	const fmDepth = gainNode(ctx);
	fm.connect(fmDepth).connect(carrier.frequency);
	const carrierGain = gainNode(ctx);
	carrier.connect(carrierGain).connect(floor);
	// Switching noise around the carrier: real inverters sound grainy, not like a sine.
	const switching = loopedNoise(ctx);
	const switchingFilter = filterNode(ctx, 'bandpass', 1050, 5);
	const switchingGain = gainNode(ctx);
	switching.connect(switchingFilter).connect(switchingGain).connect(floor);

	// Auxiliary converter hum (100 Hz) and saloon air-conditioning, present even when stopped.
	const hum = ctx.createOscillator();
	hum.setPeriodicWave(periodicWave(ctx, [1, 0.45, 0.25, 0.12]));
	hum.frequency.value = 100;
	const humGain = gainNode(ctx);
	hum.connect(humGain).connect(out);
	const hvac = loopedNoise(ctx);
	const hvacGain = gainNode(ctx);
	hvac.connect(filterNode(ctx, 'lowpass', 700, 0.5)).connect(hvacGain).connect(out);
	sources.push(gear, motor, carrier, fm, switching, hum, hvac);

	let blowerGain = null;
	if (!LOW_POWER) {
		const blower = loopedNoise(ctx);
		blowerGain = gainNode(ctx);
		blower.connect(filterNode(ctx, 'bandpass', 520, 0.8)).connect(blowerGain).connect(floor);
		sources.push(blower);
	}
	sources.forEach(s => s.start());

	let mode = '';
	return {
		update({ speed, throttle, braking, moving, t, tc }) {
			const load = Math.max(throttle, braking * 0.85);
			const wheelRps = speed / 3.6 / (Math.PI * 0.86);
			const fElec = Math.max(0.5, wheelRps * 6.3 * 2);
			gear.frequency.setTargetAtTime(Math.max(20, wheelRps * 87), t, tc);
			gearGain.gain.setTargetAtTime(moving * (0.006 + 0.016 * clamp(speed / 90) + 0.02 * load), t, tc);
			motor.frequency.setTargetAtTime(Math.max(15, 2 * fElec), t, tc);
			motorGain.gain.setTargetAtTime(moving * (0.006 + 0.04 * load) * (1 - 0.4 * smoothstep(90, 160, speed)), t, tc);

			// Asynchronous PWM, then synchronous 9- and 3-pulse, then one-pulse (carrier gone).
			let next;
			let carrierFreq;
			if (fElec * 9 < 1050) { next = 'async'; carrierFreq = 1050; }
			else if (fElec * 9 < 1900) { next = 'sync9'; carrierFreq = fElec * 9; }
			else if (fElec < 105) { next = 'sync3'; carrierFreq = fElec * 3; }
			else { next = 'one'; carrierFreq = fElec * 3; }
			carrier.frequency.setTargetAtTime(carrierFreq, t, next !== mode ? 0.004 : tc);
			switchingFilter.frequency.setTargetAtTime(carrierFreq, t, next !== mode ? 0.004 : tc);
			mode = next;
			fm.frequency.setTargetAtTime(2 * fElec, t, tc);
			fmDepth.gain.setTargetAtTime(fElec * 2.2, t, tc);
			const carrierLevel = next === 'one' ? 0 : next === 'sync3' ? 0.5 : 1;
			carrierGain.gain.setTargetAtTime(0.011 * load * moving * carrierLevel, t, tc);
			switchingGain.gain.setTargetAtTime(0.03 * load * moving * carrierLevel, t, tc);
			humGain.gain.setTargetAtTime(0.006 + 0.006 * load, t, tc);
			hvacGain.gain.setTargetAtTime(0.03, t, 0.5);
			if (blowerGain) blowerGain.gain.setTargetAtTime(0.012 + 0.012 * load, t, tc);
		},
		idle(t) {
			[gearGain, motorGain, carrierGain, switchingGain].forEach(g => g.gain.setTargetAtTime(0, t, 0.15));
			humGain.gain.setTargetAtTime(0.006, t, 0.3);
			hvacGain.gain.setTargetAtTime(0.03, t, 0.5);
			if (blowerGain) blowerGain.gain.setTargetAtTime(0.012, t, 0.3);
		},
		silence(t) {
			[gearGain, motorGain, carrierGain, switchingGain, humGain, hvacGain, blowerGain].forEach(g => g?.gain.setTargetAtTime(0, t, 0.2));
		},
		dispose() { stopAll(sources); }
	};
}

// WAP-7 three-phase electric loco (25 kV AC): no engine — the sound is cooling blowers,
// transformer hum, GTO/IGBT converter whine, traction-motor harmonics and gear mesh whine.
function buildElectricLoco(ctx, out) {
	const sources = [];

	// Traction-motor and machine-room blowers: broadband air plus a blade-pass tone. Always running.
	const blowerA = loopedNoise(ctx);
	const blowerAGain = gainNode(ctx);
	blowerA.connect(filterNode(ctx, 'bandpass', 380, 0.9)).connect(blowerAGain).connect(out);
	const blade = ctx.createOscillator();
	blade.setPeriodicWave(periodicWave(ctx, [1, 0.35, 0.15]));
	blade.frequency.value = 147;
	const bladeGain = gainNode(ctx);
	blade.connect(bladeGain).connect(out);
	sources.push(blowerA, blade);
	let blowerBGain = null;
	if (!LOW_POWER) {
		const blowerB = loopedNoise(ctx);
		blowerBGain = gainNode(ctx);
		blowerB.connect(filterNode(ctx, 'bandpass', 1400, 1.2)).connect(blowerBGain).connect(out);
		sources.push(blowerB);
	}

	// Main transformer: 100 Hz magnetostriction hum that hardens with load.
	const hum = ctx.createOscillator();
	hum.setPeriodicWave(periodicWave(ctx, [1, 0.5, 0.3, 0.15, 0.08]));
	hum.frequency.value = 100;
	const humGain = gainNode(ctx);
	hum.connect(humGain).connect(out);

	// Traction converter: asynchronous carrier, then synchronised modes, with FM sidebands.
	const carrier = ctx.createOscillator();
	const fm = ctx.createOscillator();
	const fmDepth = gainNode(ctx);
	fm.connect(fmDepth).connect(carrier.frequency);
	const carrierFilter = filterNode(ctx, 'lowpass', 3000, 0.7);
	const carrierGain = gainNode(ctx);
	carrier.connect(carrierFilter).connect(carrierGain).connect(out);

	// Gear mesh (72:20 ratio): whine at wheel rps × 72.
	const gear = ctx.createOscillator();
	gear.setPeriodicWave(periodicWave(ctx, [1, 0.3, 0.12]));
	const gearGain = gainNode(ctx);
	gear.connect(gearGain).connect(out);
	sources.push(hum, carrier, fm, gear);

	let motorGain = null;
	let motor = null;
	if (!LOW_POWER) {
		motor = ctx.createOscillator();
		motor.setPeriodicWave(periodicWave(ctx, [1, 0, 0, 0, 0.35, 0, 0.28, 0, 0, 0, 0.12]));
		motorGain = gainNode(ctx);
		motor.connect(filterNode(ctx, 'lowpass', 1800, 0.7)).connect(motorGain).connect(out);
		sources.push(motor);
	}

	// Main compressor recharging the brake reservoirs after a stop: a ~12 Hz piston chug.
	const comp = loopedNoise(ctx);
	const compGain = gainNode(ctx);
	const compPulse = ctx.createOscillator();
	compPulse.type = 'square';
	compPulse.frequency.value = 12;
	const compDepth = gainNode(ctx);
	compPulse.connect(compDepth).connect(compGain.gain);
	comp.connect(filterNode(ctx, 'bandpass', 320, 1.1)).connect(compGain).connect(out);
	sources.push(comp, compPulse);
	sources.forEach(s => s.start());

	const clunk = renderImpact(ctx, { thud: [55, 1, 0.03], click: 0.5, res: [[180, 3, 0.6], [620, 6, 0.4], [1500, 9, 0.2]], muffle: 2500, gap: 0 }, 4242, 0.18);
	let powered = false;
	let stoppedAt = -1;
	let mode = '';

	const compressor = (t, speed) => {
		if (speed > 0.5) stoppedAt = -1;
		else if (stoppedAt < 0) stoppedAt = t;
		const on = stoppedAt >= 0 && t > stoppedAt + 1.5 && t < stoppedAt + 16.5 ? 1 : 0;
		compGain.gain.setTargetAtTime(on * 0.018, t, 0.25);
		compDepth.gain.setTargetAtTime(on * 0.016, t, 0.25);
	};

	const auxiliaries = (t, load, tc) => {
		blowerAGain.gain.setTargetAtTime(0.028 + 0.03 * load, t, tc * 4);
		bladeGain.gain.setTargetAtTime(0.006 + 0.006 * load, t, tc * 4);
		blade.frequency.setTargetAtTime(147 * (1 + 0.08 * load), t, 1.2);
		if (blowerBGain) blowerBGain.gain.setTargetAtTime(0.008 + 0.012 * load, t, tc * 4);
	};

	return {
		update({ speed, throttle, braking, moving, t, tc }) {
			const load = Math.max(throttle, braking * 0.9);
			// Line contactors close/open as the driver takes or cuts traction power.
			const nowPowered = load > 0.12 && speed > 0.2;
			if (nowPowered !== powered) {
				playBuffer(clunk, t + 0.02, 0.12, { destination: out });
				powered = nowPowered;
			}
			const wheelRps = speed / 3.6 / (Math.PI * 1.092);
			const fElec = Math.max(0.5, wheelRps * 3.6 * 2);
			gear.frequency.setTargetAtTime(Math.max(20, wheelRps * 72), t, tc);
			gearGain.gain.setTargetAtTime(moving * (0.004 + 0.012 * clamp(speed / 130) + 0.02 * load), t, tc);

			let next;
			let carrierFreq;
			if (fElec * 15 < 450) { next = 'async'; carrierFreq = 450; }
			else if (fElec * 15 < 1100) { next = 'sync15'; carrierFreq = fElec * 15; }
			else if (fElec * 5 < 700) { next = 'sync5'; carrierFreq = fElec * 5; }
			else { next = 'one'; carrierFreq = fElec * 3; }
			carrier.frequency.setTargetAtTime(carrierFreq, t, next !== mode ? 0.004 : tc);
			mode = next;
			fm.frequency.setTargetAtTime(2 * fElec, t, tc);
			fmDepth.gain.setTargetAtTime(fElec * 1.8, t, tc);
			const carrierLevel = next === 'one' ? 0.15 : next === 'sync5' ? 0.6 : 1;
			carrierGain.gain.setTargetAtTime(0.014 * load * moving * carrierLevel, t, tc);
			if (motor) {
				motor.frequency.setTargetAtTime(Math.max(12, 2 * fElec), t, tc);
				motorGain.gain.setTargetAtTime(moving * (0.003 + 0.022 * load), t, tc);
			}
			humGain.gain.setTargetAtTime(0.008 + 0.018 * load, t, tc);
			auxiliaries(t, load, tc);
			compressor(t, speed);
		},
		idle(t) {
			[gearGain, carrierGain, motorGain].forEach(g => g?.gain.setTargetAtTime(0, t, 0.15));
			if (powered) {
				playBuffer(clunk, t + 0.02, 0.1, { destination: out });
				powered = false;
			}
			humGain.gain.setTargetAtTime(0.008, t, 0.3);
			auxiliaries(t, 0, 0.1);
			compressor(t, 0);
		},
		start(t) {
			stoppedAt = t - 1.5;
			powered = false;
		},
		silence(t) {
			[gearGain, carrierGain, motorGain, humGain, blowerAGain, blowerBGain, bladeGain, compGain, compDepth]
				.forEach(g => g?.gain.setTargetAtTime(0, t, 0.25));
		},
		dispose() { stopAll(sources); }
	};
}

// ALCO WDM-3A style diesel-electric: 16-cylinder 4-stroke, 400–1000 rpm in 8 notches.
// The engine is a looped buffer of real exhaust pulses (see renderDieselCycles), so the chug
// is a rhythm of individual firings rather than a buzzing oscillator.
function buildDiesel(ctx, out) {
	const sources = [];
	const cycles = renderDieselCycles(ctx, 1977);

	const engine = ctx.createBufferSource();
	engine.buffer = cycles;
	engine.loop = true;
	const exhaustFilter = filterNode(ctx, 'lowpass', 700, 0.8);
	const exhaustGain = gainNode(ctx);
	engine.connect(exhaustFilter).connect(exhaustGain).connect(out);

	// Under load the stack barks: the same pulses, brighter, through a mid resonance.
	const bark = filterNode(ctx, 'bandpass', 420, 1.2);
	const barkGain = gainNode(ctx);
	engine.connect(bark).connect(barkGain).connect(out);

	// The ALCO turbocharger's famous whistle, lagging the throttle.
	const turbo = ctx.createOscillator();
	turbo.setPeriodicWave(periodicWave(ctx, [1, 0.15, 0.05]));
	const turboGain = gainNode(ctx);
	turbo.connect(turboGain).connect(out);
	const turboAir = loopedNoise(ctx);
	const turboAirFilter = filterNode(ctx, 'bandpass', 2400, 3);
	const turboAirGain = gainNode(ctx);
	turboAir.connect(turboAirFilter).connect(turboAirGain).connect(out);

	// Dynamic-brake grid blowers.
	const blower = loopedNoise(ctx);
	const blowerGain = gainNode(ctx);
	blower.connect(filterNode(ctx, 'bandpass', 950, 1.4)).connect(blowerGain).connect(out);
	sources.push(engine, turbo, turboAir, blower);

	// Valve-gear and injector clatter riding on the firings.
	let clatterGain = null;
	if (!LOW_POWER) {
		clatterGain = gainNode(ctx);
		engine.connect(filterNode(ctx, 'highpass', 1600, 0.7)).connect(clatterGain).connect(out);
	}
	sources.forEach(s => s.start());

	let rpm = 400;
	let notch = 0;
	let notchClock = 0;
	let boost = 0;
	let running = false;

	const apply = (t, tc, braking, speed) => {
		const load = notch / 8;
		engine.playbackRate.setTargetAtTime(rpm / DIESEL_REF_RPM, t, tc);
		exhaustFilter.frequency.setTargetAtTime(450 + rpm * 0.9 + 900 * load, t, tc);
		exhaustGain.gain.setTargetAtTime(0.11 + 0.09 * load, t, tc);
		bark.frequency.setTargetAtTime(300 + rpm * 0.35, t, tc);
		barkGain.gain.setTargetAtTime(0.02 + 0.09 * load * (0.4 + 0.6 * boost), t, tc);
		turbo.frequency.setTargetAtTime(1100 + 3400 * boost, t, tc);
		turboGain.gain.setTargetAtTime(0.002 + 0.016 * boost, t, tc);
		turboAirFilter.frequency.setTargetAtTime(1100 + 3400 * boost, t, tc);
		turboAirGain.gain.setTargetAtTime(0.004 + 0.03 * boost, t, tc);
		const dyn = braking > 0.1 && speed > 15 ? 0.035 * braking * clamp(speed / 80) : 0;
		blowerGain.gain.setTargetAtTime(dyn, t, 0.4);
		if (clatterGain) clatterGain.gain.setTargetAtTime(0.012 + 0.016 * (rpm - 400) / 600, t, tc);
	};

	const step = (dt, targetNotch) => {
		// The driver moves the controller one notch at a time.
		notchClock += dt;
		if (notchClock >= 0.8 && notch !== targetNotch) {
			notch += Math.sign(targetNotch - notch);
			notchClock = 0;
		}
		const rpmTarget = 400 + notch * 75;
		rpm += (rpmTarget - rpm) * clamp(dt / (rpmTarget > rpm ? 1.4 : 2.2));
		const boostTarget = (notch / 8) * (rpm - 400) / 600;
		boost += (boostTarget - boost) * clamp(dt / 2.5);
	};

	return {
		update({ speed, throttle, braking, dt, t, tc }) {
			running = true;
			let targetNotch;
			if (throttle > 0.12) targetNotch = 8;
			else if (braking > 0.1 || speed < 0.5) targetNotch = 0;
			else targetNotch = Math.round(clamp(2 + 4 * speed / 120, 2, 6));
			step(dt, targetNotch);
			apply(t, tc, braking, speed);
		},
		idle(t, dt = 0.2) {
			if (!running) return;
			step(dt, 0);
			apply(t, 0.25, 0, 0);
		},
		start(t) {
			running = true;
			rpm = 400;
			notch = 0;
			boost = 0;
			apply(t, 0.3, 0, 0);
		},
		silence(t) {
			running = false;
			[exhaustGain, barkGain, turboGain, turboAirGain, blowerGain, clatterGain].forEach(g => g?.gain.setTargetAtTime(0, t, 0.25));
		},
		dispose() { stopAll(sources); }
	};
}

const TRACTION_BUILDERS = { emu: buildEmu, electric: buildElectricLoco, diesel: buildDiesel };

// ---------- Graph ----------

function ensureGraph() {
	graph = getAudioGraph();
	if (!graph) return false;
	if (nodes) return true;
	const { ctx, master } = graph;
	noiseBuffer = makeNoise(ctx);

	const bus = gainNode(ctx, 0.9);
	bus.connect(master);

	const brown = ctx.createBufferSource();
	brown.buffer = makeBrownNoise(ctx);
	brown.loop = true;
	const rumbleGain = gainNode(ctx);
	brown.connect(filterNode(ctx, 'lowpass', 160)).connect(rumbleGain).connect(bus);

	// Continuous wheel–rail rolling roar: low-passed (not hissy) noise that opens up with
	// speed, slowly modulated by rail roughness so it never sounds like a static loop.
	const roar = loopedNoise(ctx);
	const roarFilter = filterNode(ctx, 'lowpass', 250, 0.5);
	const roarHp = filterNode(ctx, 'highpass', 55, 0.7);
	const roughness = gainNode(ctx, 0.85);
	const roughLfo = ctx.createOscillator();
	roughLfo.frequency.value = 0.37;
	const roughDepth = gainNode(ctx, 0.15);
	roughLfo.connect(roughDepth).connect(roughness.gain);
	const roarGain = gainNode(ctx);
	roar.connect(roarHp).connect(roarFilter).connect(roughness).connect(roarGain).connect(bus);

	// Rail corrugation: a narrow band whose pitch is speed / wavelength (metro "roaring rail").
	const corr = loopedNoise(ctx);
	const corrFilter = filterNode(ctx, 'bandpass', 400, 6);
	const corrGain = gainNode(ctx);
	corr.connect(corrFilter).connect(corrGain).connect(bus);

	// Rushing air through open windows and around the car body.
	const air = loopedNoise(ctx);
	const windFilter = filterNode(ctx, 'bandpass', 520, 0.5);
	const windGain = gainNode(ctx);
	air.connect(windFilter).connect(windGain).connect(bus);
	const sources = [brown, roar, roughLfo, corr, air];

	// Squeal: brake blocks at low speed, wheel flanges on tight curves.
	const squealOsc = ctx.createOscillator();
	const squealLfo = ctx.createOscillator();
	squealLfo.frequency.value = 6.5;
	const squealLfoDepth = gainNode(ctx, 28);
	squealLfo.connect(squealLfoDepth).connect(squealOsc.frequency);
	const squealGain = gainNode(ctx);
	squealOsc.connect(squealGain);
	squealGain.connect(bus);
	sources.push(squealOsc, squealLfo);
	let squealNoiseFilter = null;
	if (!LOW_POWER) {
		const squealNoise = loopedNoise(ctx);
		squealNoiseFilter = filterNode(ctx, 'bandpass', 3000, 9);
		squealNoise.connect(squealNoiseFilter).connect(gainNode(ctx, 0.6)).connect(squealGain);
		sources.push(squealNoise);
	}

	const jointBus = gainNode(ctx, 1);
	jointBus.connect(bus);
	const tractionBus = gainNode(ctx, 1);
	tractionBus.connect(bus);

	// Steel girder bridge: the open truss resonates under the roar and every wheel impact.
	const bridgeSend = gainNode(ctx, 0);
	roarGain.connect(bridgeSend);
	jointBus.connect(bridgeSend);
	rumbleGain.connect(bridgeSend);
	const bridgeOut = gainNode(ctx, LOW_POWER ? 5 : 4);
	(LOW_POWER ? [95, 160] : [88, 141, 212]).forEach(freq => {
		bridgeSend.connect(filterNode(ctx, 'bandpass', freq, 7)).connect(bridgeOut);
	});
	bridgeOut.connect(bus);
	sources.forEach(n => n.start());

	nodes = {
		bus, rumbleGain, roarFilter, roarGain, corrFilter, corrGain, windFilter, windGain,
		squealOsc, squealNoiseFilter, squealGain, jointBus, tractionBus, bridgeSend
	};
	configureProfile();
	return true;
}

function configureProfile() {
	const p = profile();
	if (!traction || traction.kind !== p.traction) {
		const now = graph.ctx.currentTime;
		if (traction) {
			const old = traction;
			old.silence(now);
			setTimeout(() => old.dispose(), 1200);
		}
		traction = TRACTION_BUILDERS[p.traction](graph.ctx, nodes.tractionBus);
		traction.kind = p.traction;
	}
	if (buffers.profile !== profileName) {
		const ctx = graph.ctx;
		const joint = [];
		const sw = [];
		for (let i = 0; i < HIT_VARIANTS; i++) {
			joint.push(renderImpact(ctx, p.hit, 1013 + i * 7919));
			sw.push(renderImpact(ctx, p.switchHit, 3301 + i * 6007, 0.3));
		}
		buffers = {
			profile: profileName,
			joint,
			switch: sw,
			rattle: p.rattle ? [renderRattle(ctx, 77), renderRattle(ctx, 91)] : null,
			creak: p.creak ? [renderCreak(ctx, 5), renderCreak(ctx, 17)] : null,
			slam: p.doors === 'mainline'
				? renderImpact(ctx, { thud: [65, 1, 0.06], click: 0.5, res: [[420, 5, 0.6], [980, 7, 0.4], [1900, 9, 0.2]], muffle: 3500, gap: 0 }, 909, 0.3)
				: null
		};
		cachedAxles.profile = null;
	}
}

function target(param, value, timeConstant = 0.08) {
	param.setTargetAtTime(value, graph.ctx.currentTime, timeConstant);
}

// Rolling sounds stop with the wheels; the traction unit keeps idling.
function silenceRolling(timeConstant = 0.12) {
	if (!nodes) return;
	[nodes.rumbleGain, nodes.roarGain, nodes.corrGain, nodes.windGain, nodes.squealGain, nodes.bridgeSend]
		.forEach(gain => gain && target(gain.gain, 0, timeConstant));
	traction?.idle(graph.ctx.currentTime);
	silenced = true;
}

// ---------- Track model (route metres) ----------

function buildGeometry() {
	const route = state.smoothRoute;
	const segKm = state.smoothRouteDistances;
	if (!route?.length || route.length < 2 || !segKm?.length) return null;
	const n = route.length;
	const cumulative = new Float64Array(n);
	for (let i = 1; i < n; i++) cumulative[i] = cumulative[i - 1] + (segKm[i - 1] || 0) * 1000;

	// Stops (not waypoints) from the user route, located on the smooth route.
	const stops = [];
	const points = state.route || [];
	const firstIndex = new Map();
	route.forEach((p, i) => { if (!firstIndex.has(p.originalIndex)) firstIndex.set(p.originalIndex, i); });
	points.forEach((point, k) => {
		if (point?.type === 'waypoint') return;
		if (k === points.length - 1) stops.push(cumulative[n - 1]);
		else if (firstIndex.has(k)) stops.push(cumulative[firstIndex.get(k)]);
	});

	// Curve radius per vertex → flange squeal intensity (tight curves, R < 350 m).
	const heading = i => {
		const a = route[i];
		const b = route[i + 1];
		return Math.atan2((b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat);
	};
	const raw = new Float32Array(n);
	for (let i = 1; i < n - 1; i++) {
		let delta = Math.abs(heading(i) - heading(i - 1));
		if (delta > Math.PI) delta = 2 * Math.PI - delta;
		const len = (cumulative[i + 1] - cumulative[i - 1]) / 2;
		const radius = delta > 1e-4 ? len / delta : Infinity;
		raw[i] = len < 400 ? clamp((350 - radius) / 250) : 0;
	}
	const curve = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		let sum = 0;
		let count = 0;
		for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) { sum += raw[j]; count++; }
		curve[i] = sum / count;
	}
	return { route, cumulative, stops, curve, total: cumulative[n - 1] };
}

function buildTrackEvents() {
	if (!geometry) {
		track = { profile: profileName, pos: new Float64Array(0), kind: new Uint8Array(0), bridges: [] };
		return;
	}
	const p = profile();
	const rnd = seededRandom(Math.round(geometry.total) ^ 0x5bd1e995);
	const events = [];
	const add = (pos, kind) => { if (pos > 0 && pos < geometry.total) events.push([pos, kind]); };
	const turnout = pos => {
		add(pos, EV_TOE);
		add(pos + 19 + rnd() * 3, EV_FROG);
		add(pos + 22 + rnd() * 3, EV_CHECK);
	};

	if (p.sparseJoints) {
		const [lo, hi] = p.sparseJoints;
		for (let x = lo * rnd(); x < geometry.total; x += lo + (hi - lo) * rnd()) add(x, EV_JOINT);
	}

	const realSwitches = realFeatures?.switches;
	if (realSwitches?.length) {
		realSwitches.forEach(turnout);
	} else {
		// Station yards: an entry throat before each stop and an exit throat after it.
		const stops = geometry.stops;
		stops.forEach((stop, i) => {
			const terminus = i === 0 || i === stops.length - 1;
			if (p.turnoutsAtTerminiOnly && !terminus) return;
			if (i > 0) {
				const entry = stop - (250 + rnd() * 200);
				turnout(entry);
				if (rnd() < 0.6) turnout(entry + 45 + rnd() * 20);
			}
			if (i < stops.length - 1) {
				const exit = stop + 60 + rnd() * 140;
				turnout(exit);
				if (rnd() < 0.5) turnout(exit + 45 + rnd() * 20);
			}
		});
	}

	const bridges = (realFeatures?.bridges || []).map(([a, b]) => [a, b]);
	bridges.forEach(([a, b]) => {
		for (let x = a; x <= b; x += 18.3) add(x, EV_GIRDER);
	});

	events.sort((a, b) => a[0] - b[0]);
	track = {
		profile: profileName,
		pos: Float64Array.from(events, e => e[0]),
		kind: Uint8Array.from(events, e => e[1]),
		bridges
	};
}

function prepareTrack() {
	const token = ++journeyToken;
	geometry = buildGeometry();
	realFeatures = null;
	curveCursor = 0;
	buildTrackEvents();
	if (!geometry || state.currentRouteType !== 'rail') return;
	getRailFeatures(geometry.route, Array.from(geometry.cumulative))
		.then(features => {
			if (!features || token !== journeyToken) return;
			realFeatures = features;
			buildTrackEvents();
			console.log(`🛤️ Rail features: ${features.bridges.length} bridges, ${features.switches.length} turnouts from OSM`);
		})
		.catch(() => {});
}

function lowerBound(arr, value) {
	let lo = 0;
	let hi = arr.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (arr[mid] <= value) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function curveAt(pos) {
	if (!geometry) return 0;
	const c = geometry.cumulative;
	if (curveCursor >= c.length || c[curveCursor] > pos) curveCursor = 0;
	while (curveCursor < c.length - 2 && c[curveCursor + 1] < pos) curveCursor++;
	return geometry.curve[curveCursor];
}

function onBridge(pos) {
	for (const [a, b] of track.bridges) if (pos >= a - 5 && pos <= b + 5) return true;
	return false;
}

// ---------- Lifecycle ----------

export function startTrainAudio() {
	if (!ensureGraph()) return;
	active = true;
	holdAudio('train', true);
	distanceM = 0;
	lastTrackKm = NaN;
	lastSpeed = 0;
	accelSmoothed = 0;
	paramClock = 0;
	brakeApplied = false;
	lastUpdateWall = performance.now();
	const now = graph.ctx.currentTime;
	nextCreakAt = now + 6;
	nextPassAt = now + 60 + Math.random() * 120;
	prepareTrack();
	silenceRolling(0.05);
	traction.start?.(now);
	traction.idle(now);
	// Frames stop when paused or dwelling at stations: drop the rolling noise, let the engine idle.
	clearInterval(stallTimer);
	stallTimer = setInterval(() => {
		if (!active || performance.now() - lastUpdateWall <= 300) return;
		if (!silenced) silenceRolling(0.15);
		else traction.idle(graph.ctx.currentTime, 0.25);
	}, 250);
}

export function stopTrainAudio() {
	active = false;
	journeyToken++;
	clearInterval(stallTimer);
	stallTimer = null;
	if (nodes) {
		silenceRolling(0.2);
		traction.silence(graph.ctx.currentTime);
	}
	setStationAmbience(false);
	holdAudio('train', false);
}

export function isTrainAudioActive() {
	return active;
}

/** Call every rendered frame with the current speed (km/h) and frame time (s). */
export function updateTrainAudio(speedKmh, dtSec) {
	if (!active || !nodes) return;
	const speed = Math.max(0, Number(speedKmh) || 0);
	const dt = clamp(Number(dtSec) || 0, 0, 0.5);
	lastUpdateWall = performance.now();
	if (dt <= 0) return;

	const accel = ((speed - lastSpeed) / 3.6) / dt;
	accelSmoothed += (accel - accelSmoothed) * clamp(dt / 0.35);
	scheduleTrack(speed, dt);

	paramClock += dt;
	const stopped = lastSpeed > 1 && speed <= 0.05;
	if (paramClock >= PARAM_INTERVAL || stopped || silenced) {
		applyContinuous(speed, paramClock);
		paramClock = 0;
	}
	if (stopped) playBrakeRelease();
	silenced = false;
	lastSpeed = speed;
}

function applyContinuous(speed, dt) {
	const p = profile();
	const t = graph.ctx.currentTime;
	const tc = PARAM_INTERVAL * 1.2;
	const throttle = clamp(accelSmoothed / 0.45);
	const braking = clamp(-accelSmoothed / 0.5);
	const moving = smoothstep(0.3, 6, speed);
	const bridge = onBridge(distanceM) ? 1 : 0;
	const curve = curveAt(distanceM);

	nodes.rumbleGain.gain.setTargetAtTime(moving * p.rumble * (0.1 + 0.22 * clamp(speed / 140)) * (1 + 0.8 * bridge), t, tc);
	nodes.roarFilter.frequency.setTargetAtTime(p.roar.base + p.roar.slope * Math.min(speed, 220), t, tc);
	nodes.roarGain.gain.setTargetAtTime(moving * p.roar.gain * Math.pow(clamp(speed / 160), 0.8) * 1.6, t, tc);
	if (p.corrugation) {
		nodes.corrFilter.frequency.setTargetAtTime(clamp(speed / 3.6 / p.corrugation.wavelength, 60, 2400), t, tc);
		nodes.corrGain.gain.setTargetAtTime(moving * p.corrugation.gain * smoothstep(15, 70, speed), t, tc);
	} else {
		nodes.corrGain.gain.setTargetAtTime(0, t, 0.3);
	}
	nodes.windFilter.frequency.setTargetAtTime(420 + 3 * Math.min(speed, 200), t, tc);
	nodes.windGain.gain.setTargetAtTime(smoothstep(p.windFrom, p.windFrom + 120, speed) * p.wind, t, tc);
	nodes.bridgeSend.gain.setTargetAtTime(bridge * moving, t, 0.35);

	// Friction brakes take over from electric braking at low speed; flanges squeal on tight curves.
	const brakeSqueal = braking > 0.15 && speed > 0.5 ? braking * (1 - smoothstep(4, 32, speed)) * p.brakeSqueal : 0;
	const flangeSqueal = curve * smoothstep(6, 20, speed) * (1 - smoothstep(70, 110, speed)) * p.flange;
	const squealFreq = flangeSqueal > brakeSqueal ? p.squealFreq * 1.35 : p.squealFreq;
	nodes.squealOsc.frequency.setTargetAtTime(squealFreq, t, 0.3);
	if (nodes.squealNoiseFilter) nodes.squealNoiseFilter.frequency.setTargetAtTime(squealFreq, t, 0.3);
	nodes.squealGain.gain.setTargetAtTime(Math.max(brakeSqueal, flangeSqueal * (0.7 + 0.3 * Math.sin(t * 2.3))), t, 0.12);

	// Air-brake application: a sharp hiss as the brake pipe vents.
	if (braking > 0.3 && !brakeApplied && speed > 8) {
		brakeApplied = true;
		if (p.airBrakeHiss && t - lastAirBrakeAt > 8) {
			lastAirBrakeAt = t;
			noiseBurst(t + 0.05, 0.55, { freq: 3200, level: p.airBrakeHiss, attack: 0.01, hold: 0.08 });
		}
	} else if (braking < 0.05) {
		brakeApplied = false;
	}

	// ICF vestibules: occasional creaks, more frequent on curves.
	if (buffers.creak && speed > 10 && t >= nextCreakAt) {
		playBuffer(buffers.creak[(Math.random() * buffers.creak.length) | 0], t + 0.05, 0.05 + 0.08 * curve, { rate: 0.85 + Math.random() * 0.3 });
		nextCreakAt = t + (6 + Math.random() * 14) / (1 + 2 * curve);
	}

	// Mainline: trains on the adjacent track.
	if (p.passingTrains && speed > 40 && t >= nextPassAt) {
		playPassingTrain(speed, t + 0.05);
		nextPassAt = t + 90 + Math.random() * 210;
	}

	traction.update({ speed, throttle, braking, moving, dt, t, tc });
}

// ---------- Track impacts ----------

function axleLayout(p) {
	const axles = [];
	const listener = p.listener === 'bogie'
		? p.coachLength + (p.coachLength + p.bogieCentres) / 2
		: p.coachLength * 1.5;
	for (let coach = 0; coach < 4; coach++) {
		const front = coach * p.coachLength;
		const bogies = [(p.coachLength - p.bogieCentres) / 2, (p.coachLength + p.bogieCentres) / 2];
		bogies.forEach(centre => {
			[-p.axleSpacing / 2, p.axleSpacing / 2].forEach(off => {
				const position = front + centre + off;
				const distance = Math.abs(position - listener);
				const gain = 1 / (1 + Math.pow(distance / p.falloff, 2));
				if (gain > (LOW_POWER ? 0.2 : 0.1)) axles.push({ position, gain });
			});
		});
	}
	return axles;
}

let cachedAxles = { profile: null, axles: [] };

function scheduleTrack(speed, dt) {
	const p = profile();
	let step = speed / 3.6 * dt;
	// Keep the audio odometer locked to the simulation's route position without jumps.
	const trackKm = Number(state.totalDistanceCovered);
	if (Number.isFinite(trackKm) && trackKm !== lastTrackKm) {
		const error = trackKm * 1000 - (distanceM + step);
		if (Math.abs(error) > 80) step += error;
		else step += error * clamp(dt / 2);
		lastTrackKm = trackKm;
	}
	const from = distanceM;
	distanceM = Math.max(0, distanceM + step);
	step = distanceM - from;
	if (speed < 1.5 || step <= 0 || step > 60 || !buffers.joint.length) return;
	if (cachedAxles.profile !== profileName) cachedAxles = { profile: profileName, axles: axleLayout(p) };
	if (track.profile !== profileName) buildTrackEvents();

	const ctx = graph.ctx;
	const frameStart = ctx.currentTime + LOOKAHEAD - dt;
	const intensity = p.jointGain * (0.25 + 0.75 * clamp(speed / 110));
	const when = pos => Math.max(ctx.currentTime, frameStart + ((pos - from) / step) * dt);
	for (const axle of cachedAxles.axles) {
		const a = from - axle.position;
		const b = distanceM - axle.position;
		if (p.railLength) {
			for (let k = Math.floor(a / p.railLength) + 1; k * p.railLength <= b; k++) {
				const at = when(k * p.railLength + axle.position);
				playImpact(buffers.joint, at, intensity * axle.gain, speed);
				if (buffers.rattle && axle.gain > 0.6 && Math.random() < p.rattle * clamp(speed / 100)) {
					playBuffer(buffers.rattle[(Math.random() * 2) | 0], at + 0.015, 0.035 * clamp(speed / 90), { destination: nodes.jointBus });
				}
			}
		}
		for (let i = lowerBound(track.pos, a); i < track.pos.length && track.pos[i] <= b; i++) {
			const kind = track.kind[i];
			const set = kind === EV_JOINT ? buffers.joint : buffers.switch;
			playImpact(set, when(track.pos[i] + axle.position), intensity * axle.gain * EVENT_LEVEL[kind], speed);
		}
	}
}

function playImpact(set, when, level, speed) {
	const second = Math.floor(when);
	if (hitBudget.second !== second) hitBudget = { second, count: 0 };
	if (++hitBudget.count > MAX_HITS_PER_SEC || level < 0.01) return;
	// Harder, brighter impacts at speed.
	const rate = 0.92 + 0.14 * clamp(speed / 160) + (Math.random() - 0.5) * 0.04;
	playBuffer(set[(Math.random() * set.length) | 0], when, level, { rate, destination: nodes.jointBus });
}

// ---------- Passing train (adjacent track) ----------

function playPassingTrain(ownSpeed, start) {
	const ctx = graph.ctx;
	// The oncoming horn is heard for ~1.4 s before the locomotive draws level at `when`.
	const when = Math.max(start, ctx.currentTime) + 1.5;
	const other = 70 + Math.random() * 50;
	const closing = (ownSpeed + other) / 3.6;
	const duration = clamp(24 * 23.5 / closing, 5, 12);
	const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
	const out = gainNode(ctx, 1);
	if (panner) {
		panner.pan.setValueAtTime(-0.35, when - 1.5);
		panner.pan.linearRampToValueAtTime(-0.85, when + 0.3);
		panner.pan.linearRampToValueAtTime(-0.6, when + duration);
		out.connect(panner).connect(nodes.bus);
	} else {
		out.connect(nodes.bus);
	}

	// Doppler two-tone horn from the oncoming loco: high while approaching, drops as it passes.
	const c = 343;
	const vOther = other / 3.6;
	const hornGain = ctx.createGain();
	hornGain.gain.setValueAtTime(0.0001, when - 1.4);
	hornGain.gain.exponentialRampToValueAtTime(0.05, when - 0.1);
	hornGain.gain.setValueAtTime(0.05, when + 0.15);
	hornGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
	const hornFilter = filterNode(ctx, 'lowpass', 2600, 0.8);
	hornFilter.connect(hornGain).connect(out);
	[392, 493.9].forEach(f => {
		const osc = ctx.createOscillator();
		osc.type = 'sawtooth';
		const vRel = closing - vOther / 2;
		osc.frequency.setValueAtTime(f * c / (c - vRel), when - 1.4);
		osc.frequency.setValueAtTime(f * c / (c - vRel), when - 0.12);
		osc.frequency.linearRampToValueAtTime(f * c / (c + vRel), when + 0.18);
		osc.connect(hornFilter);
		osc.start(when - 1.4);
		osc.stop(when + 1);
	});

	// Pressure wave as the locomotive nose passes the window.
	const thump = ctx.createOscillator();
	thump.frequency.setValueAtTime(48, when);
	thump.frequency.exponentialRampToValueAtTime(24, when + 0.3);
	const thumpGain = ctx.createGain();
	thumpGain.gain.setValueAtTime(0.0001, when);
	thumpGain.gain.exponentialRampToValueAtTime(0.18, when + 0.02);
	thumpGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.35);
	thump.connect(thumpGain).connect(out);
	thump.start(when);
	thump.stop(when + 0.4);
	noiseBurst(when, 0.4, { type: 'lowpass', freq: 300, level: 0.2, attack: 0.01, hold: 0.04, destination: out });

	// Whoosh of the coaches, amplitude-modulated by each inter-coach gap.
	const whoosh = ctx.createBufferSource();
	whoosh.buffer = noiseBuffer;
	whoosh.loop = true;
	const whooshFilter = filterNode(ctx, 'bandpass', 650, 0.6);
	const whooshEnv = ctx.createGain();
	whooshEnv.gain.setValueAtTime(0.0001, when);
	whooshEnv.gain.exponentialRampToValueAtTime(0.13, when + 0.08);
	whooshEnv.gain.setValueAtTime(0.11, when + duration - 0.6);
	whooshEnv.gain.exponentialRampToValueAtTime(0.0001, when + duration);
	const gapAm = gainNode(ctx, 0.7);
	const gapLfo = ctx.createOscillator();
	gapLfo.frequency.value = closing / 23.5;
	const gapDepth = gainNode(ctx, 0.3);
	gapLfo.connect(gapDepth).connect(gapAm.gain);
	whoosh.connect(whooshFilter).connect(gapAm).connect(whooshEnv).connect(out);
	whoosh.start(when);
	whoosh.stop(when + duration + 0.05);
	gapLfo.start(when);
	gapLfo.stop(when + duration + 0.05);

	// Its own wheelsets clattering over the joints, heard through the gap.
	const set = buffers.joint;
	const axlePeriod = 23.5 / closing;
	for (let x = 0.2; x < duration - 0.3 && set.length; x += axlePeriod) {
		playImpact(set, when + x, 0.06, ownSpeed);
		playImpact(set, when + x + 2.56 / closing, 0.05, ownSpeed);
	}
	setTimeout(() => out.disconnect(), (when - ctx.currentTime + duration + 1) * 1000);
}

// ---------- One-shots ----------

function playBrakeRelease(when = graph.ctx.currentTime + 0.25) {
	const ctx = graph.ctx;
	if (ctx.currentTime - lastHissAt < 3) return;
	lastHissAt = ctx.currentTime;
	noiseBurst(when, 1.6, { freq: 2200, level: profile().hissGain, attack: 0.03, hold: 0.32 });
}

function tone(when, freq, duration, { type = 'sine', level = 0.08, decay = false } = {}) {
	const ctx = graph.ctx;
	const osc = ctx.createOscillator();
	osc.type = type;
	osc.frequency.value = freq;
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.0001, when);
	gain.gain.exponentialRampToValueAtTime(level, when + 0.008);
	if (decay) {
		gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
	} else {
		gain.gain.setValueAtTime(level, when + duration - 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
	}
	osc.connect(gain).connect(nodes.bus);
	osc.start(when);
	osc.stop(when + duration + 0.02);
}

function bell(when, freq) {
	tone(when, freq, 1.3, { level: 0.09, decay: true });
	tone(when, freq * 2.76, 0.6, { level: 0.025, decay: true });
}

// Guard's pea whistle: ~2.9 kHz tone warbled by the rattling pea, plus breath noise.
function guardWhistle(when, blasts = [[0.18, 0.12], [0.18, 0.12], [0.7, 0]]) {
	const ctx = graph.ctx;
	let t = when;
	for (const [duration, gap] of blasts) {
		const osc = ctx.createOscillator();
		osc.frequency.value = 2900;
		const pea = ctx.createOscillator();
		pea.frequency.value = 33 + Math.random() * 6;
		const peaDepth = gainNode(ctx, 130);
		pea.connect(peaDepth).connect(osc.frequency);
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(0.045, t + 0.02);
		gain.gain.setValueAtTime(0.045, t + duration - 0.03);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
		osc.connect(gain).connect(nodes.bus);
		[osc, pea].forEach(o => { o.start(t); o.stop(t + duration + 0.02); });
		noiseBurst(t, duration, { type: 'bandpass', freq: 3000, Q: 1.5, level: 0.012, attack: 0.02, hold: Math.max(0, duration - 0.1) });
		t += duration + gap;
	}
	return t - when;
}

// Returns the time (s from `when`) at which the signal has finished.
function playDoorSignal(kind, when) {
	switch (kind) {
		case 'chime':
			bell(when, 659.3);
			bell(when + 0.42, 523.3);
			return 0.9;
		case 'chimeWarning':
			bell(when, 523.3);
			bell(when + 0.42, 659.3);
			for (let i = 0; i < 6; i++) tone(when + 0.95 + i * 0.16, 1250, 0.08, { type: 'square', level: 0.025 });
			return 1.95;
		default:
			return 0;
	}
}

function playDoorMechanism(when) {
	const url = sampleUrl('DoorAction');
	if (!url) return;
	loadSample(url).then(buffer => {
		playBuffer(buffer, when, 0.9);
	}).catch(() => {});
}

/**
 * Door sequence, resolving when the doors have finished.
 * Metro: chime/warning + powered doors. Mainline (ICF/LHB): hand-closed doors slam, and on
 * departure the guard blows his whistle.
 */
export function playDoorSequence(open) {
	if (!ensureGraph()) return Promise.resolve();
	const p = profile();
	const now = graph.ctx.currentTime + 0.03;
	let doneSec;
	if (p.doors === 'metro') {
		const signal = playDoorSignal(open ? 'chime' : 'chimeWarning', now);
		const mechanismAt = open ? now + 0.25 : now + signal;
		playDoorMechanism(mechanismAt);
		doneSec = (mechanismAt - graph.ctx.currentTime) + 1.4;
	} else {
		const slams = open ? [0.5, 1.3, 2.1] : [0, 0.55];
		slams.forEach(at => playBuffer(buffers.slam, now + at + Math.random() * 0.2, 0.12 + Math.random() * 0.08, { rate: 0.9 + Math.random() * 0.2 }));
		const whistle = open ? 0 : guardWhistle(now + 1.0) + 1.0;
		doneSec = open ? 2.4 : whistle + 0.2;
	}
	return new Promise(resolve => setTimeout(resolve, doneSec * 1000));
}

/**
 * Air horn: compressed air through a nozzle sets a steel diaphragm slapping against its seat.
 * The diaphragm closes the air path for part of each cycle, so the source is a rich pulse
 * train (strong even and odd harmonics); the flared trumpet adds formant peaks and projects
 * it. The pitch blooms up as pressure builds, flutters with the diaphragm, and sags as the
 * reservoir empties at release. Electronic metro horns (drive ≈ 1) are clean and steady.
 */
function hornWave(ctx, duty = 0.3) {
	const amps = [];
	for (let n = 1; n <= 28; n++) amps.push(Math.abs(Math.sin(Math.PI * n * duty)) / n ** 0.75);
	return periodicWave(ctx, amps);
}

function playHorn(pattern) {
	const ctx = graph.ctx;
	const p = profile().horn;
	const air = p.drive > 1.5;
	let t = ctx.currentTime + 0.03;
	const out = ctx.createGain();
	out.gain.value = p.gain;
	// Trumpet flare: formant lift around 1.2 and 2.6 kHz, then roll-off.
	const flare1 = ctx.createBiquadFilter();
	flare1.type = 'peaking';
	flare1.frequency.value = 1250;
	flare1.Q.value = 1.4;
	flare1.gain.value = air ? 7 : 2;
	const flare2 = ctx.createBiquadFilter();
	flare2.type = 'peaking';
	flare2.frequency.value = 2600;
	flare2.Q.value = 1.8;
	flare2.gain.value = air ? 5 : 1;
	const filter = filterNode(ctx, 'lowpass', p.filter, 0.7);
	const shaper = ctx.createWaveShaper();
	const curve = new Float32Array(1024);
	for (let i = 0; i < curve.length; i++) {
		const x = (i / (curve.length - 1)) * 2 - 1;
		curve[i] = Math.tanh(p.drive * x) / Math.tanh(p.drive);
	}
	shaper.curve = curve;
	flare1.connect(flare2).connect(filter).connect(shaper).connect(out).connect(nodes.bus);
	const wave = air ? hornWave(ctx, p.duty || 0.3) : null;

	let end = t;
	for (const [duration, gap] of pattern) {
		const release = air ? 0.28 : 0.12;
		p.notes.forEach((freq, i) => {
			const osc = ctx.createOscillator();
			if (wave) osc.setPeriodicWave(wave);
			else osc.type = p.wave;
			osc.detune.value = (i % 2 ? 1 : -1) * 6;
			const bloom = air ? 0.9 : 0.995;
			osc.frequency.setValueAtTime(freq * bloom, t);
			osc.frequency.exponentialRampToValueAtTime(freq, t + (air ? 0.16 : 0.03));
			osc.frequency.setValueAtTime(freq, t + duration);
			osc.frequency.exponentialRampToValueAtTime(freq * (air ? 0.95 : 0.995), t + duration + release);
			const env = ctx.createGain();
			const level = 1 / p.notes.length;
			env.gain.setValueAtTime(0.0001, t);
			env.gain.exponentialRampToValueAtTime(level, t + (air ? 0.09 : 0.03));
			env.gain.setValueAtTime(level, t + duration);
			env.gain.exponentialRampToValueAtTime(0.0001, t + duration + release);
			osc.connect(env).connect(flare1);
			const stops = [osc];
			if (air) {
				// Diaphragm flutter: fast, slightly irregular pitch wobble.
				const flutter = ctx.createOscillator();
				flutter.frequency.value = 17 + i * 6 + Math.random() * 4;
				const depth = gainNode(ctx, freq * 0.006);
				flutter.connect(depth).connect(osc.frequency);
				stops.push(flutter);
			}
			stops.forEach(o => { o.start(t); o.stop(t + duration + release + 0.05); });
		});
		if (air) {
			// Rush of air through the nozzle.
			noiseBurst(t, duration + release, { type: 'bandpass', freq: 1800, Q: 0.8, level: 0.25, attack: 0.05, hold: Math.max(0, duration - 0.05), destination: flare1 });
		}
		end = t + duration + release + 0.05;
		t += duration + gap;
	}
	setTimeout(() => out.disconnect(), (end - ctx.currentTime + 0.1) * 1000);
	return end - ctx.currentTime;
}

export function soundHorn(kind = 'depart') {
	if (!active || !ensureGraph()) return 0;
	const p = profile();
	return playHorn(kind === 'approach' ? p.hornApproach : p.hornDepart);
}

/** Close doors, then sound the departure horn. Resolves when the train may move. */
export async function prepareTrainDeparture() {
	if (!active) return;
	setStationAmbience(false);
	await playDoorSequence(false);
	const hornSec = soundHorn('depart');
	await new Promise(resolve => setTimeout(resolve, Math.min(hornSec, 0.8) * 1000));
}

// Arrival: air-brake release, then doors, then the platform fades in.
export function trainArrived() {
	if (!active || !ensureGraph()) return;
	updateTrainAudio(0, 0.05);
	playBrakeRelease();
	silenceRolling(0.1);
	setTimeout(() => {
		if (!active) return;
		playDoorSequence(true);
		setStationAmbience(true);
	}, 1300);
}

// ---------- Station ambience ----------

let ambienceFade = null;
export function setStationAmbience(on, ms = 1200) {
	const el = document.getElementById('StopAmbience');
	if (!el) return;
	clearInterval(ambienceFade);
	const to = on ? profile().ambience : 0;
	if (on && el.paused) {
		el.volume = 0;
		el.loop = true;
		el.play().catch(() => {});
	}
	const from = el.volume;
	const started = performance.now();
	ambienceFade = setInterval(() => {
		const t = clamp((performance.now() - started) / ms);
		el.volume = from + (to - from) * t;
		if (t >= 1) {
			clearInterval(ambienceFade);
			if (!on) el.pause();
		}
	}, 40);
}
