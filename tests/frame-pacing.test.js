import { expect, it } from 'vitest';
import { createFramePacer } from '../js/modules/framePacing.js';

it('accepts 120 Hz frames at a 120 FPS limit and caps them at 30 FPS', () => {
	for (const [fps, expected] of [[120, 120], [30, 30]]) {
		const ready = createFramePacer();
		let frames = 0;
		for (let i = 0; i < 120; i++) {
			if (ready(i * 1000 / 120, fps)) frames++;
		}
		expect(frames).toBe(expected);
	}
});
