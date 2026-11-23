export function createFramePacer() {
	let nextFrame = null;
	let previousFPS = null;
	function ready(timestamp, fps) {
		const interval = 1000 / fps;
		if (nextFrame === null || previousFPS !== fps) {
			nextFrame = timestamp;
			previousFPS = fps;
		}
		// Browser timestamps are quantized; do not lose a refresh at the deadline.
		if (timestamp + 0.5 < nextFrame) return false;
		nextFrame += Math.max(1, Math.floor((timestamp - nextFrame + 0.5) / interval) + 1) * interval;
		return true;
	}
	ready.reset = () => { nextFrame = null; };
	return ready;
}
