// ====================================
// NETWORK GATE — rate limiting, in-flight de-duplication, failure backoff
// ====================================
// Every third-party request should go through a gate so that a burst of callers
// (60 fps loops, multiple HUD widgets) collapses into a single, policy-compliant request.

export function createGate({ minIntervalMs = 0, baseBackoffMs = 30_000, maxBackoffMs = 10 * 60_000 } = {}) {
	let lastStart = 0;
	let queue = Promise.resolve();
	let failures = 0;
	let blockedUntil = 0;
	const inflight = new Map();

	function isBlocked() {
		return Date.now() < blockedUntil;
	}

	function reportFailure(blockMs) {
		failures++;
		const backoff = blockMs ?? Math.min(maxBackoffMs, baseBackoffMs * 2 ** (failures - 1));
		blockedUntil = Date.now() + backoff;
	}

	function reportSuccess() {
		failures = 0;
		blockedUntil = 0;
	}

	// Runs task() at most once concurrently per key, serialised with minIntervalMs spacing.
	// Resolves undefined without running the task if the gate became blocked while queued.
	function run(key, task) {
		if (inflight.has(key)) return inflight.get(key);
		const scheduled = queue.then(async () => {
			const wait = lastStart + minIntervalMs - Date.now();
			if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
			if (isBlocked()) return undefined;
			lastStart = Date.now();
			return task();
		});
		queue = scheduled.catch(() => {});
		const tracked = scheduled.finally(() => inflight.delete(key));
		inflight.set(key, tracked);
		return tracked;
	}

	return { run, isBlocked, reportFailure, reportSuccess };
}

export function gridKey(lat, lng, precisionDeg) {
	return `${Math.round(lat / precisionDeg)}_${Math.round(lng / precisionDeg)}`;
}
