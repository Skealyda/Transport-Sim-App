import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../js/modules/gforce.js', () => ({ calculateWaypointAndStopTimes: () => ({}) }));
vi.mock('../js/modules/soundEngine.js', () => ({ duckEffects: vi.fn() }));

describe('announcements', () => {
	let announcer;
	let synth;
	let storage;
	let status;
	let toggle;
	const local = { voiceURI: 'local', name: 'Local English', lang: 'en-US', localService: true };
	const online = { voiceURI: 'online', name: 'Natural Online', lang: 'en-IN', localService: false };

	beforeEach(async () => {
		vi.resetModules();
		vi.useFakeTimers();
		storage = new Map();
		status = { textContent: '' };
		toggle = { checked: false };
		synth = {
			getVoices: () => [online, local],
			addEventListener: vi.fn(),
			speak: vi.fn(),
			cancel: vi.fn()
		};
		vi.stubGlobal('window', { speechSynthesis: synth });
		vi.stubGlobal('speechSynthesis', synth);
		vi.stubGlobal('SpeechSynthesisUtterance', class {
			constructor(text) { this.text = text; }
		});
		vi.stubGlobal('document', { getElementById: id => ({
			voiceAnnouncementsToggle: toggle,
			ttsStatus: status
		})[id] || null });
		vi.stubGlobal('localStorage', {
			getItem: key => storage.get(key) ?? null,
			setItem: (key, value) => storage.set(key, value),
			removeItem: key => storage.delete(key)
		});
		announcer = await import('../js/modules/announcer.js');
		announcer.initAnnouncements();
	});

	afterEach(() => {
		announcer.cancelAnnouncements();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('persists the toggle, cancels ongoing speech, and permits an explicit preview', () => {
		announcer.say('A train is departing.');
		expect(synth.speak).toHaveBeenCalledTimes(1);
		announcer.setVoiceAnnouncements(false);
		expect(toggle.checked).toBe(false);
		expect(storage.get('voiceAnnouncements')).toBe('false');
		expect(synth.cancel).toHaveBeenCalled();
		announcer.say('This should not be spoken.');
		expect(synth.speak).toHaveBeenCalledTimes(1);
		announcer.previewTtsVoice();
		expect(synth.speak).toHaveBeenCalledTimes(2);
		announcer.setVoiceAnnouncements(true);
		expect(toggle.checked).toBe(true);
		expect(storage.get('voiceAnnouncements')).toBe('true');
	});

	it('prefers a local voice automatically and retries a failing selected online voice locally', () => {
		announcer.say('Local test.');
		expect(synth.speak.mock.lastCall[0].voice).toBe(local);
		announcer.cancelAnnouncements();
		announcer.setTtsVoice('online');
		announcer.say('Network test.');
		const failed = synth.speak.mock.lastCall[0];
		expect(failed.voice).toBe(online);
		failed.onerror({ error: 'network' });
		const retried = synth.speak.mock.lastCall[0];
		expect(retried.voice).toBe(local);
		expect(retried.text).toBe(failed.text);
		expect(status.textContent).toContain('local voice');
		failed.onend();
		expect(synth.speak).toHaveBeenCalledTimes(3);
	});

	it('reports browser blocking and cancels stuck speech before the next sentence', () => {
		announcer.say('Blocked.');
		synth.speak.mock.lastCall[0].onerror({ error: 'not-allowed' });
		expect(status.textContent).toContain('blocked');
		announcer.say('First. Second.');
		const first = synth.speak.mock.lastCall[0];
		const callsBeforeTimeout = synth.cancel.mock.calls.length;
		vi.advanceTimersByTime(6000);
		expect(synth.cancel.mock.calls.length).toBe(callsBeforeTimeout + 1);
		expect(first.onend).toBeNull();
		expect(synth.speak.mock.lastCall[0].text).toBe('Second.');
		expect(status.textContent).toContain('timed out');
	});
});
