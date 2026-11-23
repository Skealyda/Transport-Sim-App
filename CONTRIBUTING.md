# Contributing

This repository is the standalone Vite PWA clone of Transport Simulator. Keep changes independent from the original server-backed project.

## Setup

```bash
npm install
npm run dev
```

No Python or Flask setup is needed. Use the Vite URL printed in the terminal.

## Project guidelines

- Preserve local-first routes and the browser storage model.
- Keep shared runtime state in `js/modules/state.js`.
- Bundle browser dependencies through Vite rather than CDN or backend paths.
- Put third-party requests behind the rate-limited adapters in `js/modules/net/`.
- Do not expose secrets through `VITE_*`; those values are public client configuration.
- Keep `README.md`, `claude.md`, and `.github/copilot-instructions.md` aligned when architecture changes.
- Maintain stop/waypoint behavior and avoid independent ETA or route-progress math.

## Verification

```bash
npm run check:imports
npm test
npm run build
```

To run Playwright regressions, start `npm run dev` first and use its URL as `WORLD_TEST_URL` if it differs from `http://127.0.0.1:5173`.

Before merging, confirm:

- the production output opens from a static host
- the service worker precaches the application shell
- the app reloads offline after its first online load
- route saves/imports/exports remain local and work without backend requests
- new external map requests degrade gracefully when offline
