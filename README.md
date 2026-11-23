# Transport Simulator Web App

An installable, offline-capable transport simulator for desktop and mobile. It is an independent, serverless clone of Transport Simulator: the app, dependencies, audio, icons, and initial routes are bundled into a static PWA.

## Features

- Trains, cars, aircraft, ships, hyperloop vehicles, rockets, submarines, and helicopters
- Automatic, semi-auto, and manual simulation
- OpenLayers 2D maps and a procedural three.js train world
- G-force-limited acceleration and braking, timetable/ETA calculations, HUD themes, sound, weather effects, and career mode
- Local-first routes with browser storage, JSON import/export, and optional `Downloads/routes/routes.json` mirroring in supported desktop browsers
- Installable PWA with a precached application shell and runtime map-tile caching

## Requirements

- Node.js 20 or newer
- A modern browser
- Internet access for new map tiles, geocoding, road routing, and external scenery data

No Python or Flask server is required.

## Develop

```bash
npm install
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`.

## Build and run the PWA

```bash
npm run build
npm run preview
```

The production application is in `dist/`. Deploy that directory to any static HTTPS host. Service workers and installation require HTTPS, except on localhost.

On a supported desktop or mobile browser, use **Install app** or **Add to Home Screen** after the first successful load. The app shell remains available offline. Routes and settings stay on the device.

## Offline behavior

- Core simulation, saved routes, HUD, audio, and 3D rendering work after the app has been installed/cached.
- Previously viewed OpenStreetMap, CARTO, and Esri tiles may be available from the service-worker cache.
- New map tiles, Nominatim reverse geocoding, OSRM road routing, Overpass/scenery data, and satellite providers require connectivity when their cache is empty.
- Live OpenWeather data is optional. Configure a secure weather proxy in Settings; a personal key can be used as a local-device fallback but is not suitable as a shared app secret.

## Routes

The routes in [`routes.json`](./routes.json) are copied into browser storage once on first launch. After that, browser storage is authoritative. Deleting a bundled route does not re-add it until site data is cleared.

Use **Settings > Route Storage** to:

- mirror routes to a user-selected Downloads folder where the File System Access API is supported
- download a portable `routes.json`
- import an exported route collection

## API configuration

Open **Settings > Local API Settings** in the installed app to configure:

- a referrer-restricted Google Maps browser key
- an optional restricted Cesium ion token
- a secure OpenWeather-compatible proxy URL
- a personal OpenWeather key as a device-local fallback

These values are stored in this browser's local storage and are not committed, built into the app, or synchronized to other devices. Clear them from the same Settings section.

For maintainers who intentionally distribute a public browser-only map key, `.env.example` documents optional `VITE_*` defaults. Vite embeds those values in the client bundle, so they must be provider-restricted and must never be server secrets.

## Scripts

```bash
npm run check:imports
npm test
npm run build
npm run preview
```

Browser regression scripts use a running Vite development server and can be pointed at it with `WORLD_TEST_URL`.

## Structure

```text
public/icons/          PWA icons
js/main.js             Browser bootstrap and global UI exports
js/modules/            Simulation, UI, map, audio, and storage modules
js/modules/net/        Rate-limited third-party network access
assets/                Bundled vehicle images and audio
routes.json            Initial built-in route collection
vite.config.js         Static build and PWA/service-worker configuration
```

All third-party data remains subject to its provider's terms and attribution requirements.
