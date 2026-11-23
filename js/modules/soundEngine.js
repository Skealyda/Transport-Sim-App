// ====================================
// MIXING SOUND ENGINE
// ====================================
// <audio> playback claims OS audio focus: Android pauses Spotify and other music apps, and iOS
// switches to the "playback" audio session that interrupts them. Game sounds are routed through
// Web Audio with an "ambient" audio session instead, which mixes with background music.
// Existing <audio> elements keep their play/pause/volume/currentTime/loop API, so callers are unchanged.

let ctx = null;
let master = null;
const EFFECTS_VOLUME_KEY = 'effectsVolume';
const DEFAULT_EFFECTS_VOLUME = 0.6;
const LOW_POWER = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
	(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
	localStorage.getItem('mapQuality') === 'low';
let effectsVolume = loadEffectsVolume();
const wrapped = [];

function loadEffectsVolume() {
	const saved = parseFloat(localStorage.getItem(EFFECTS_VOLUME_KEY));
	return Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : DEFAULT_EFFECTS_VOLUME;
}

export function getEffectsVolume() {
	return effectsVolume;
}

// Trim encoder padding/silence and crossfade the tail into the head so a looped buffer has no seam.
export function makeSeamlessLoop(audioCtx, buffer, crossfadeSec = 0.3) {
	const channels = buffer.numberOfChannels;
	const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
	const threshold = 0.003;
	const loud = i => data.some(d => Math.abs(d[i]) > threshold);
	let start = 0;
	let end = buffer.length - 1;
	while (start < end && !loud(start)) start++;
	while (end > start && !loud(end)) end--;
	const length = end - start + 1;
	const fade = Math.min(Math.floor(crossfadeSec * buffer.sampleRate), Math.floor(length / 4));
	if (fade < 32) return buffer;
	const out = audioCtx.createBuffer(channels, length - fade, buffer.sampleRate);
	for (let c = 0; c < channels; c++) {
		const src = data[c];
		const dst = out.getChannelData(c);
		// Equal-power blend of the tail into the head; the loop point then continues the tail.
		for (let i = 0; i < fade; i++) {
			const a = i / fade;
			dst[i] = src[start + i] * Math.sin(a * Math.PI / 2) + src[start + length - fade + i] * Math.cos(a * Math.PI / 2);
		}
		dst.set(src.subarray(start + fade, start + length - fade), fade);
	}
	return out;
}

function context() {
	if (!ctx) {
		const AudioContextClass = window.AudioContext || window.webkitAudioContext;
		if (!AudioContextClass) return null;
		// Mobile: half-rate DSP and larger render quanta keep the audio thread cool on battery.
		if (LOW_POWER) {
			try { ctx = new AudioContextClass({ latencyHint: 'balanced', sampleRate: 24000 }); } catch { ctx = null; }
		}
		ctx ||= new AudioContextClass({ latencyHint: 'interactive' });
		master = ctx.createGain();
		master.gain.value = effectsVolume;
		master.connect(ctx.destination);
		setInterval(suspendWhenIdle, 4000);
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) ctx.suspend().catch(() => {});
			else if (holds.size || playingEls.size) resume();
		});
	}
	return ctx;
}

function resume() {
	lastUse = performance.now();
	const c = context();
	if (c && c.state !== 'running' && !document.hidden) c.resume().catch(() => {});
}

// A running AudioContext keeps the audio thread busy even when silent; park it when nothing plays.
const holds = new Set();
const playingEls = new Set();
let lastUse = 0;
const IDLE_SUSPEND_MS = 10000;

function suspendWhenIdle() {
	if (!ctx || ctx.state !== 'running' || holds.size || playingEls.size) return;
	if (performance.now() - lastUse > IDLE_SUSPEND_MS) ctx.suspend().catch(() => {});
}

/** Keep the audio context awake while a continuous sound source (e.g. the train engine) is live. */
export function holdAudio(key, on) {
	if (on) {
		holds.add(key);
		resume();
	} else {
		holds.delete(key);
		lastUse = performance.now();
	}
}

export function isLowPowerAudio() {
	return LOW_POWER;
}

function wrap(el) {
	if (el.dataset.mixing) return;
	const source = el.querySelector('source');
	const src = source?.getAttribute('src') || el.getAttribute('src');
	if (!src) return;
	const url = new URL(src, location.href).href;
	// Detach the media element from its file so it can never take audio focus.
	source?.remove();
	el.removeAttribute('src');
	el.preload = 'none';
	el.dataset.mixing = 'true';
	el.dataset.src = url;

	let buffer = null;
	let loopBuffer = null;
	let loading = null;
	let node = null;
	let gain = null;
	let volume = 1;
	let offset = 0;
	let startedAt = 0;
	let paused = true;
	let loop = el.hasAttribute('loop');
	let playToken = 0;

	const load = () => loading ??= fetch(url)
		.then(response => {
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.arrayBuffer();
		})
		.then(data => new Promise((resolve, reject) => context().decodeAudioData(data, resolve, reject)))
		.then(decoded => { buffer = decoded; })
		.catch(error => {
			loading = null;
			throw error;
		});
	const output = () => {
		if (!gain) {
			gain = context().createGain();
			gain.gain.value = volume;
			gain.connect(master);
		}
		return gain;
	};
	const stopNode = () => {
		playingEls.delete(el);
		if (!node) return;
		node.onended = null;
		try { node.stop(); } catch { /* already stopped */ }
		node.disconnect();
		node = null;
	};
	const position = () => {
		if (!node || !buffer) return offset;
		const elapsed = offset + context().currentTime - startedAt;
		const length = node.buffer.duration;
		return loop ? elapsed % length : Math.min(elapsed, length);
	};
	const start = () => {
		stopNode();
		const c = context();
		node = c.createBufferSource();
		const playing = loop ? (loopBuffer ??= makeSeamlessLoop(c, buffer)) : buffer;
		node.buffer = playing;
		node.loop = loop;
		node.connect(output());
		offset = offset < playing.duration ? offset : 0;
		startedAt = c.currentTime;
		playingEls.add(el);
		node.onended = () => {
			playingEls.delete(el);
			lastUse = performance.now();
			node = null;
			paused = true;
			offset = 0;
			el.dispatchEvent(new Event('ended'));
		};
		node.start(0, offset);
	};

	Object.defineProperties(el, {
		play: {
			configurable: true,
			value() {
				if (!context()) return Promise.reject(new Error('Web Audio is not supported'));
				resume();
				paused = false;
				const token = ++playToken;
				return load().then(() => {
					if (!paused && token === playToken && !node) start();
				});
			}
		},
		pause: {
			configurable: true,
			value() {
				if (node) offset = position();
				stopNode();
				paused = true;
				playToken++;
			}
		},
		paused: { configurable: true, get: () => paused },
		duration: { configurable: true, get: () => buffer ? buffer.duration : NaN },
		volume: {
			configurable: true,
			get: () => volume,
			set(value) {
				volume = Math.max(0, Math.min(1, Number(value) || 0));
				if (gain) gain.gain.value = volume;
			}
		},
		currentTime: {
			configurable: true,
			get: position,
			set(value) {
				offset = Math.max(0, Number(value) || 0);
				if (node) start();
			}
		},
		loop: {
			configurable: true,
			get: () => loop,
			set(value) {
				loop = Boolean(value);
				if (node) node.loop = loop;
			}
		}
	});
	wrapped.push(load);
}

let ducked = false;
const DUCK_LEVEL = 0.3;

function applyMasterGain(rampSec = 0) {
	if (!master) return;
	const target = effectsVolume * (ducked ? DUCK_LEVEL : 1);
	const now = ctx.currentTime;
	master.gain.cancelScheduledValues(now);
	if (rampSec > 0) {
		master.gain.setValueAtTime(master.gain.value, now);
		master.gain.linearRampToValueAtTime(target, now + rampSec);
	} else {
		master.gain.value = target;
	}
}

export function setEffectsVolume(value) {
	effectsVolume = Math.max(0, Math.min(1, Number(value) || 0));
	localStorage.setItem(EFFECTS_VOLUME_KEY, String(effectsVolume));
	applyMasterGain();
}

// Lowers game sound effects while an announcement is being spoken.
export function duckEffects(active) {
	if (ducked === Boolean(active)) return;
	ducked = Boolean(active);
	applyMasterGain(ducked ? 0.25 : 0.6);
}

// Shared graph for procedural/synth sounds, so they mix with music and follow the effects volume.
export function getAudioGraph() {
	const c = context();
	if (!c) return null;
	resume();
	return { ctx: c, master };
}

const sampleCache = new Map();
export function loadSample(url) {
	const c = context();
	if (!c) return Promise.reject(new Error('Web Audio is not supported'));
	const href = new URL(url, location.href).href;
	if (!sampleCache.has(href)) {
		sampleCache.set(href, fetch(href)
			.then(response => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return response.arrayBuffer();
			})
			.then(data => new Promise((resolve, reject) => c.decodeAudioData(data, resolve, reject)))
			.catch(error => {
				sampleCache.delete(href);
				throw error;
			}));
	}
	return sampleCache.get(href);
}

export function installMixingAudio(root = document) {
	try {
		// Safari 16.4+/iOS 17+: mix with (and respect the silent switch like) other apps' audio.
		if (navigator.audioSession) navigator.audioSession.type = 'ambient';
	} catch { /* unsupported */ }
	root.querySelectorAll('audio').forEach(wrap);

	let prefetched = false;
	const unlock = () => {
		resume();
		if (prefetched || !ctx) return;
		prefetched = true;
		const prefetch = () => wrapped.forEach(load => load().catch(() => {}));
		(window.requestIdleCallback || setTimeout)(prefetch, { timeout: 3000 });
	};
	window.addEventListener('pointerdown', unlock, { capture: true });
	window.addEventListener('keydown', unlock, { capture: true });
	// Mobile browsers suspend/interrupt the context in the background.
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden && ctx) resume();
	});
}
