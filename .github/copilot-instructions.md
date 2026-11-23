# Copilot Instructions

Use the same standalone architecture documented in [README.md](../../README.md) and [claude.md](../../claude.md).

- This project is a static Vite PWA and has no Flask/Python backend.
- Bundle browser dependencies from npm; do not restore CDN, `/vendor`, or backend-served asset paths.
- Preserve local-first route storage and one-time seeding from root `routes.json`.
- Do not add calls to the original Flask endpoints.
- Keep external API calls in `js/modules/net/`.
- `VITE_*` values are public build-time values, never secret keys.
- Device API values belong in the Settings UI/localStorage key, never in source or service-worker precache data.
- OpenWeather shared deployments should use a secure proxy; direct personal keys are a local-device fallback.
- Run `npm run check:imports`, `npm test`, and `npm run build` after code changes.
- Validate offline app-shell behavior and distinguish cached map data from new online map requests.
