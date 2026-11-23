# Transport Simulator Web App — AI Context

This is the standalone, serverless sibling of the original Transport Simulator. Keep the original repository separate. Do not add Flask, Python, deployment-server, or backend-route dependencies.

## Architecture

- Vanilla ES modules built with Vite
- OpenLayers, Lucide, and three.js are local npm dependencies bundled into `dist/`
- `vite-plugin-pwa` generates the manifest and Workbox service worker
- `state.js` is the shared simulation state source of truth
- Route data is local-first under `transportSimulatorWebApp_routes_v1`; bundled `routes.json` seeds the device once
- Device API settings use `transportSimulator_apiSettings_v1` and are entered through Settings
- Optional public map defaults use `VITE_*` build-time environment values and must be referrer-restricted

## Core files

- `index.html`: UI shell
- `styles.css`: UI and responsive cockpit styles
- `vite.config.js`: PWA and static build configuration
- `js/modules/browserDependencies.js`: browser globals for bundled OpenLayers/Lucide
- `js/modules/routeStore.js`: browser storage, folder mirror, backup import/export
- `js/modules/net/config.js`: build-time public configuration

## Standalone rules

- Do not call `/config/client`, `/routes/*`, `/load_route`, `/save_route`, `/compute/*`, `/classify_route`, or `/ping`.
- Route, physics, smooth-path, and timetable fallbacks must run locally.
- Keep third-party requests inside `js/modules/net/` when adding API access.
- Never expose a secret API key through `VITE_*`.
- Do not read repository secrets from browser code. A weather proxy keeps its provider key on a serverless backend.
- User-entered personal keys remain local to the browser and must not be logged, bundled, committed, or synchronized.
- Preserve route storage compatibility and keep initial `routes.json` seeding one-time.
- The app shell must load from `dist/` without a backend.

## Commands

```bash
npm run check:imports
npm test
npm run build
npm run preview
```

Offline means the cached app and saved routes work without connectivity. New external map/geocoding/routing/scenery data may still require internet.
