import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const externalMapCache = [
	'https://*.tile.openstreetmap.org/**',
	'https://tile.openstreetmap.fr/**',
	'https://*.basemaps.cartocdn.com/**',
	'https://server.arcgisonline.com/**'
];

export default defineConfig({
	base: './',
	plugins: [
		VitePWA({
			registerType: 'autoUpdate',
			injectRegister: 'auto',
			includeAssets: ['icons/*.svg', 'icons/*.png'],
			manifest: {
				name: 'Transport Simulator Web App',
				short_name: 'Transport Sim',
				description: 'Offline-capable transport simulation with 2D and 3D driving modes.',
				theme_color: '#07111f',
				background_color: '#07111f',
				display: 'standalone',
				orientation: 'any',
				start_url: './',
				scope: './',
				icons: [
					{
						src: 'icons/app-192.png',
						sizes: '192x192',
						type: 'image/png',
						purpose: 'any maskable'
					},
					{
						src: 'icons/app-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'any maskable'
					}
				]
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,json,svg,png,mp3,woff2}'],
				navigateFallback: 'index.html',
				cleanupOutdatedCaches: true,
				maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
				runtimeCaching: externalMapCache.map(urlPattern => ({
					urlPattern,
					handler: 'CacheFirst',
					options: {
						cacheName: 'transport-map-tiles',
						expiration: {
							maxEntries: 750,
							maxAgeSeconds: 30 * 24 * 60 * 60
						},
						cacheableResponse: {
							statuses: [0, 200]
						}
					}
				}))
			}
		})
	],
	build: {
		target: 'es2022'
	}
});
