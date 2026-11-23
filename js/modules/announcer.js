// ====================================
// ANNOUNCER — captain/driver-style voice announcements
// ====================================
// Owns all speech output. Messages are queued by priority so stale "approaching" lines never
// pile up behind each other and safety messages interrupt everything else.

import state from './state.js';
import { calculateWaypointAndStopTimes } from './gforce.js';
import { calculateDistance } from './utils.js';
import { duckEffects } from './soundEngine.js';

const STORAGE_KEY = 'voiceAnnouncements';
const VOICE_KEY = 'ttsVoiceURI';
export const PRIORITY = { info: 0, normal: 1, safety: 2 };
const MAX_QUEUE = 3;
const KM_TO_MILES = 0.621371;

const ROLES = {
	train: { role: 'driver', vehicle: 'train', service: 'service', departCrew: 'Crew, doors to automatic and cross-check.', arriveCrew: 'Crew, doors to manual.' },
	hyperloop: { role: 'pod operator', vehicle: 'pod', service: 'hyperloop service', departCrew: 'Crew, seal the pod and cross-check.', arriveCrew: 'Crew, prepare to release the pod doors.' },
	flight: { role: 'captain', vehicle: 'aircraft', service: 'flight', departCrew: 'Cabin crew, arm doors and cross-check.', arriveCrew: 'Cabin crew, disarm doors and cross-check.' },
	helicopter: { role: 'pilot', vehicle: 'helicopter', service: 'flight', departCrew: 'Crew, doors secured and cross-check.', arriveCrew: 'Crew, prepare for landing.' },
	ship: { role: 'captain', vehicle: 'vessel', service: 'voyage', departCrew: 'Deck crew, stand by to cast off.', arriveCrew: 'Deck crew, stand by to moor.' },
	submarine: { role: 'captain', vehicle: 'submarine', service: 'voyage', departCrew: 'Crew, secure all hatches.', arriveCrew: 'Crew, prepare to surface and dock.' },
	rocket: { role: 'mission commander', vehicle: 'spacecraft', service: 'mission', departCrew: 'Crew, final systems check.', arriveCrew: 'Crew, prepare for docking.' }
};

let enabled = true;
let queue = [];
let current = null;
let token = 0;
let watchdog = null;
let voice = null;
let journey = { mode: 'train', topSpeed: 0, cruiseAnnounced: false, startedAt: 0 };

// ---------- Settings ----------

function speechStatus(message) {
	const status = document.getElementById('ttsStatus');
	if (status) status.textContent = message;
}

export function initAnnouncements() {
	enabled = localStorage.getItem(STORAGE_KEY) !== 'false';
	const toggle = document.getElementById('voiceAnnouncementsToggle');
	if (toggle) toggle.checked = enabled;
	if ('speechSynthesis' in window) {
		speechSynthesis.addEventListener?.('voiceschanged', () => {
			voice = null;
			populateVoiceSelect();
		});
		populateVoiceSelect();
	} else {
		const hint = document.getElementById('ttsVoiceHint');
		if (hint) hint.textContent = 'Speech synthesis is not supported in this browser.';
		speechStatus('Announcements are unavailable in this browser.');
	}
}

// ---------- Voice picker ----------

function populateVoiceSelect() {
	const select = document.getElementById('ttsVoiceSelect');
	if (!select || !('speechSynthesis' in window)) return;
	const voices = speechSynthesis.getVoices();
	const saved = localStorage.getItem(VOICE_KEY) || '';
	const sorted = [...voices].sort((a, b) => {
		const ea = /^en/i.test(a.lang) ? 0 : 1;
		const eb = /^en/i.test(b.lang) ? 0 : 1;
		return ea - eb || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name);
	});
	select.replaceChildren(new Option('Automatic (best English voice)', ''));
	for (const v of sorted) {
		const label = `${v.name} — ${v.lang}${v.localService ? '' : ' (online)'}${v.default ? ' ★' : ''}`;
		select.add(new Option(label, v.voiceURI));
	}
	select.value = voices.some(v => v.voiceURI === saved) ? saved : '';
	const hint = document.getElementById('ttsVoiceHint');
	if (hint) {
		hint.textContent = voices.length
			? `${voices.length} voice${voices.length === 1 ? '' : 's'} available on this device. Online voices need an internet connection.`
			: 'Loading device voices…';
	}
}

export function setTtsVoice(uri) {
	if (uri) localStorage.setItem(VOICE_KEY, uri);
	else localStorage.removeItem(VOICE_KEY);
	voice = null;
}

export function previewTtsVoice() {
	if (!('speechSynthesis' in window)) {
		speechStatus('Announcements are unavailable in this browser.');
		return;
	}
	interruptCurrent();
	queue = [];
	const role = (ROLES[journey.mode] || ROLES.train).role;
	speechStatus(state.voiceVolume === 0
		? 'Voice volume is muted. Raise it in Audio controls to hear the preview.'
		: 'Playing voice preview.');
	enqueue(`Good evening, this is your ${role} speaking. Welcome aboard, and thank you for travelling with us.`, { ttlMs: 45000 });
}

export function setVoiceAnnouncements(value) {
	enabled = Boolean(value);
	localStorage.setItem(STORAGE_KEY, String(enabled));
	const toggle = document.getElementById('voiceAnnouncementsToggle');
	if (toggle) toggle.checked = enabled;
	if (!enabled) {
		cancelAnnouncements();
		speechStatus('Announcements are off. Voice preview is still available.');
	} else {
		speechStatus('Announcements are on. Use Preview to test your voice and volume.');
	}
}

export function isAnnouncementsEnabled() {
	return enabled;
}

// ---------- Speech queue ----------

function pickVoice() {
	const voices = speechSynthesis.getVoices();
	if (!voices.length) return null;
	const saved = localStorage.getItem(VOICE_KEY);
	const chosen = saved && voices.find(v => v.voiceURI === saved);
	if (chosen) return chosen;
	const english = voices.filter(v => /^en([-_]|$)/i.test(v.lang));
	const score = v => (v.localService ? 10 : 0)
		+ (/en[-_]IN/i.test(v.lang) ? 3 : 0)
		+ (/natural|neural/i.test(v.name) ? 2 : 0)
		+ (/female|zira|aria|heera|neerja|google/i.test(v.name) ? 1 : 0);
	return english.sort((a, b) => score(b) - score(a))[0] || voices[0];
}

function splitSentences(text) {
	// Chrome stops long utterances after ~15 s; speaking sentence by sentence avoids that.
	return String(text).replace(/\s+/g, ' ').match(/[^.!?]+[.!?]*/g)?.map(s => s.trim()).filter(Boolean) || [];
}

function finishCurrent() {
	clearTimeout(watchdog);
	current = null;
	pump();
}

function speakPart(item, i, myToken, triedVoices = new Set()) {
	if (myToken !== token) return;
	if (i >= item.parts.length) {
		finishCurrent();
		return;
	}
	const utterance = new SpeechSynthesisUtterance(item.parts[i]);
	voice ||= pickVoice();
	if (voice) {
		utterance.voice = voice;
		utterance.lang = voice.lang;
		triedVoices.add(voice.voiceURI);
	}
	const base = state.voiceVolume ?? 1;
	utterance.volume = Math.min(1, item.priority >= PRIORITY.safety ? base * 1.3 : base);
	utterance.rate = item.priority >= PRIORITY.safety ? 0.92 : 0.98;
	let advanced = false;
	const next = () => {
		if (advanced) return;
		advanced = true;
		clearTimeout(watchdog);
		speakPart(item, i + 1, myToken);
	};
	utterance.onend = next;
	utterance.onerror = event => {
		if (myToken !== token || advanced) return;
		const error = event.error || 'unknown error';
		console.warn(`Announcement speech failed: ${error}`);
		if (['network', 'voice-unavailable', 'language-unavailable', 'synthesis-failed'].includes(error)) {
			const fallback = speechSynthesis.getVoices().find(v =>
				v.localService && /^en([-_]|$)/i.test(v.lang) && !triedVoices.has(v.voiceURI));
			if (fallback) {
				clearTimeout(watchdog);
				advanced = true;
				voice = fallback;
				speechStatus('Selected voice failed; using an available local voice.');
				speakPart(item, i, myToken, triedVoices);
				return;
			}
		}
		speechStatus(error === 'not-allowed'
			? 'Speech was blocked by the browser. Use Preview after interacting with the page.'
			: `Speech failed (${error}). Try another voice and check the voice volume.`);
		next();
	};
	// Some engines never fire onend; never let one lost event block the queue.
	clearTimeout(watchdog);
	watchdog = setTimeout(() => {
		if (myToken !== token || advanced) return;
		console.warn('Announcement speech timed out');
		speechStatus('Speech timed out. Try another voice and use Preview.');
		utterance.onend = null;
		utterance.onerror = null;
		speechSynthesis.cancel();
		next();
	}, 4000 + item.parts[i].length * 110);
	speechSynthesis.speak(utterance);
}

function pump() {
	if (current) return;
	const now = Date.now();
	queue = queue.filter(item => item.expires > now);
	if (!queue.length) {
		duckEffects(false);
		return;
	}
	current = queue.shift();
	duckEffects(true);
	console.log(`🗣️ ${current.text}`);
	speakPart(current, 0, ++token);
}

function interruptCurrent() {
	token++;
	clearTimeout(watchdog);
	current = null;
	speechSynthesis.cancel();
}

export function cancelAnnouncements() {
	queue = [];
	if ('speechSynthesis' in window) interruptCurrent();
	duckEffects(false);
}

/**
 * Speak `text` through the announcement queue.
 * Higher-priority items pre-empt lower ones; low-value items expire if they wait too long.
 */
export function say(text, { priority = PRIORITY.normal, interrupt = false, ttlMs = 45000 } = {}) {
	if (!enabled || !text) return;
	if (!('speechSynthesis' in window)) {
		speechStatus('Announcements are unavailable in this browser.');
		return;
	}
	enqueue(text, { priority, interrupt, ttlMs });
}

function enqueue(text, { priority = PRIORITY.normal, interrupt = false, ttlMs = 45000 } = {}) {
	const parts = splitSentences(text);
	if (!parts.length) return;
	const item = { text: parts.join(' '), parts, priority, expires: Date.now() + ttlMs };

	if (interrupt || (current && priority > current.priority)) {
		queue = queue.filter(q => q.priority >= priority);
		queue.unshift(item);
		if (current) interruptCurrent();
	} else {
		const at = queue.findIndex(q => q.priority < priority);
		if (at === -1) queue.push(item);
		else queue.splice(at, 0, item);
		while (queue.length > MAX_QUEUE) {
			let drop = queue.length - 1;
			for (let i = queue.length - 1; i >= 0; i--) {
				if (queue[i].priority < queue[drop].priority) drop = i;
			}
			queue.splice(drop, 1);
		}
	}
	pump();
}

export function announceSafety(text, { interrupt = true } = {}) {
	say(text, { priority: PRIORITY.safety, interrupt, ttlMs: 20000 });
}

// ---------- Spoken formatting ----------

const imperial = () => Boolean(state.useImperialUnits);

function spokenDistance(km) {
	const value = imperial() ? km * KM_TO_MILES : km;
	const unit = imperial() ? 'mile' : 'kilometre';
	if (value < 1) {
		if (imperial()) return 'less than a mile';
		const metres = Math.max(100, Math.round(km * 10) * 100);
		return `${metres} metres`;
	}
	const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
	return `${rounded} ${unit}${rounded === 1 ? '' : 's'}`;
}

function spokenSpeed(kmh) {
	const value = Math.round(imperial() ? kmh * KM_TO_MILES : kmh);
	return `${value} ${imperial() ? 'miles' : 'kilometres'} per hour`;
}

function spokenDuration(sec) {
	if (!Number.isFinite(sec) || sec <= 0) return '';
	if (sec < 60) return 'less than a minute';
	const totalMin = Math.round(sec / 60);
	const hrs = Math.floor(totalMin / 60);
	const mins = totalMin % 60;
	const h = hrs ? `${hrs} hour${hrs === 1 ? '' : 's'}` : '';
	const m = mins ? `${mins} minute${mins === 1 ? '' : 's'}` : '';
	return `about ${[h, m].filter(Boolean).join(' and ')}`;
}

function clockIn(sec = 0) {
	return new Date(Date.now() + sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function greeting() {
	const hour = new Date().getHours();
	if (hour < 12) return 'Good morning';
	if (hour < 17) return 'Good afternoon';
	return 'Good evening';
}

function joinList(items) {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function weatherPhrase(data, placeName) {
	if (!data || data.unavailable || !Number.isFinite(Number(data.temperature))) return '';
	if (placeName && data.location && data.location !== placeName) return '';
	const condition = String(data.condition || '').toLowerCase();
	return `${Math.round(data.temperature)} degrees${condition ? ` and ${condition}` : ''}`;
}

// ---------- Route helpers ----------

const route = () => state.route || [];
const nameAt = i => route()[i]?.placeName || 'the next station';
const isStop = i => {
	const type = route()[i]?.type || 'stop';
	return type !== 'waypoint' && type !== 'dummy';
};
const lastIndex = () => route().length - 1;

function nextStopIndex(after) {
	for (let i = after + 1; i < route().length; i++) {
		if (isStop(i)) return i;
	}
	return -1;
}

function distanceBetween(from, to) {
	let km = 0;
	const r = route();
	for (let i = Math.max(0, from); i < to && i < r.length - 1; i++) {
		km += calculateDistance(r[i].latlng, r[i + 1].latlng) || 0;
	}
	return km;
}

function roleFor(mode = journey.mode) {
	return ROLES[mode] || null;
}

// ---------- Journey announcements ----------

export function beginJourney({ mode, topSpeed }) {
	journey = { mode: mode || 'train', topSpeed: Number(topSpeed) || 0, cruiseAnnounced: false, startedAt: Date.now() };
	cancelAnnouncements();
	const r = route();
	if (r.length < 2) return;

	const origin = nameAt(0);
	const looping = state.isLooping || origin === nameAt(lastIndex());
	const destination = looping ? nameAt(1) : nameAt(lastIndex());
	const intermediate = r.slice(1, -1).map((p, i) => (isStop(i + 1) ? p.placeName : null)).filter(Boolean);
	const totalKm = distanceBetween(0, lastIndex());
	const times = calculateWaypointAndStopTimes(0, 0, 0);
	const totalSec = times?.timeToFinalDestination || 0;
	const weather = weatherPhrase(state.weatherCardState?.currentWeatherData);
	const role = roleFor();

	if (!role) {
		const via = intermediate.length && intermediate.length <= 3 ? ` via ${joinList(intermediate)}` : '';
		say(`Starting route to ${nameAt(lastIndex())}${via}. ${spokenDistance(totalKm)}, arriving around ${clockIn(totalSec)}.`);
		return;
	}

	const lines = [`${greeting()}, ladies and gentlemen, this is your ${role.role} speaking.`];
	if (looping) {
		lines.push(`Welcome aboard this circular ${role.service} from ${origin}${intermediate.length ? `, calling at ${joinList(intermediate.slice(0, 4))}` : ''}, and returning to ${origin}.`);
	} else {
		lines.push(`Welcome aboard this ${role.service} from ${origin} to ${destination}.`);
		if (!intermediate.length) lines.push(`This is a non-stop ${role.service}.`);
		else if (intermediate.length <= 4) lines.push(`We will be calling at ${joinList(intermediate)}.`);
		else lines.push(`We will be calling at ${intermediate.length} stops along the way, the first being ${intermediate[0]}.`);
	}
	if (totalKm > 0) {
		const duration = spokenDuration(totalSec);
		lines.push(looping || !duration
			? `The full journey covers ${spokenDistance(totalKm)}.`
			: `Our journey covers ${spokenDistance(totalKm)}, and we expect to arrive in ${destination} at around ${clockIn(totalSec)}, a journey time of ${duration}.`);
	}
	if (journey.topSpeed >= 30) lines.push(`Our top speed today will be ${spokenSpeed(journey.topSpeed)}.`);
	if (weather) lines.push(`The weather here in ${origin} is ${weather}.`);
	lines.push(role.departCrew, 'Please sit back, relax, and enjoy the journey.');
	say(lines.join(' '), { ttlMs: 90000 });
}

export function announceDeparture(fromIndex) {
	const role = roleFor();
	const target = nextStopIndex(fromIndex);
	if (target < 0) return;
	const km = distanceBetween(fromIndex, target);
	const isFinal = target === lastIndex() && !state.isLooping;
	if (!role) {
		say(`Continuing to ${nameAt(target)}, ${spokenDistance(km)} ahead.`);
		return;
	}
	const times = calculateWaypointAndStopTimes(fromIndex, 0, 0);
	const duration = spokenDuration(times?.timeToNextStop);
	say([
		role.departCrew,
		`We are now departing ${nameAt(fromIndex)}.`,
		`Our ${isFinal ? 'next and final' : 'next'} stop is ${nameAt(target)}, ${spokenDistance(km)} away${duration ? `, arriving in ${duration}` : ''}.`
	].join(' '));
}

export function announceApproach(targetIndex) {
	if (targetIndex < 0 || targetIndex >= route().length) return;
	const name = nameAt(targetIndex);
	const role = roleFor();
	if (!isStop(targetIndex)) {
		if (route()[targetIndex]?.type === 'waypoint' && route()[targetIndex]?.placeName) {
			say(`We will be passing through ${name} shortly.`, { priority: PRIORITY.info, ttlMs: 20000 });
		}
		return;
	}
	const isFinal = targetIndex === lastIndex() && !state.isLooping;
	if (!role) {
		say(`Approaching ${name}${isFinal ? ', your destination' : ''}.`, { ttlMs: 30000 });
		return;
	}
	const weather = weatherPhrase(state.weatherCardState?.nextWeatherData, name);
	const lines = [
		`Ladies and gentlemen, we will shortly be arriving at ${name}${isFinal ? ', our final destination' : ''}.`,
		weather ? `The current weather in ${name} is ${weather}.` : '',
		isFinal ? 'Please make sure you have all your belongings with you.' : 'If you are leaving us here, please make sure you have all your belongings with you.',
		`${role.arriveCrew.split(',')[0]}, prepare for arrival.`
	];
	say(lines.filter(Boolean).join(' '), { ttlMs: 40000 });
}

export function announcePassing(index) {
	if (!route()[index]?.placeName) return;
	say(`We are now passing through ${nameAt(index)}.`, { priority: PRIORITY.info, ttlMs: 8000 });
}

export function announceArrival(index, { dwellSec = 0, semiAuto = false, loopReturn = false } = {}) {
	const name = nameAt(index);
	const role = roleFor();
	const isFinal = index >= lastIndex() && !state.isLooping;
	const next = nextStopIndex(index);

	if (!role) {
		say(isFinal ? `You have arrived at your destination, ${name}.` : `Arrived at ${name}.`);
		return;
	}

	if (isFinal) {
		const weather = weatherPhrase(state.weatherCardState?.currentWeatherData, name);
		const covered = state.totalDistanceCovered || distanceBetween(0, lastIndex());
		say([
			`Ladies and gentlemen, welcome to ${name}, our final destination.`,
			role.arriveCrew,
			`The local time is ${clockIn()}${weather ? `, and it is ${weather}` : ''}.`,
			covered > 0 ? `We covered ${spokenDistance(covered)} together today.` : '',
			`On behalf of the entire crew, thank you for travelling with us. We hope to see you again soon.`
		].filter(Boolean).join(' '), { ttlMs: 90000 });
		return;
	}

	const lines = [
		loopReturn ? `Ladies and gentlemen, we have completed the circuit and are back at ${name}.` : `Ladies and gentlemen, welcome to ${name}.`,
		role.arriveCrew
	];
	if (next > 0) {
		const continuing = `For passengers continuing with us, our next stop is ${nameAt(next)}${next === lastIndex() && !state.isLooping ? ', our final destination' : ''}`;
		lines.push(semiAuto || !dwellSec
			? `${continuing}. We will depart shortly.`
			: `${continuing}, and we will depart in about ${Math.round(dwellSec)} seconds.`);
	}
	say(lines.join(' '));
}

export function announceCruise(speedKmh, remainingKm) {
	const role = roleFor();
	const top = journey.topSpeed;
	if (!role || journey.cruiseAnnounced || top < 60 || remainingKm < 5) return;
	if (speedKmh < top * 0.97) return;
	journey.cruiseAnnounced = true;
	say(`Ladies and gentlemen, we have now reached our cruising speed of ${spokenSpeed(top)}.`, { priority: PRIORITY.info, ttlMs: 15000 });
}

export function setJourneyContext({ mode, topSpeed } = {}) {
	if (mode) journey.mode = mode;
	if (topSpeed) journey.topSpeed = Number(topSpeed) || journey.topSpeed;
}
