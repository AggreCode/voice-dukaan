import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.1.0'),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Voice Dukan',
        short_name: 'Voice Dukan',
        description: 'Dictate a bill by voice, review it in a table.',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Never cache API calls; the app handles offline uploads itself.
        navigateFallbackDenylist: [/^\/api/, /^\/docs/],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    host: true,
    // Vite 5.4+ blocks unrecognized Host headers by default (DNS-rebinding protection), which
    // rejects requests through a tunnel (cloudflared/ngrok) since their hostname isn't localhost.
    // true = allow any host - fine for local dev behind a tunnel. A real deploy serves a static
    // build instead (see infra/frontend.Dockerfile's nginx stage), where this setting doesn't apply.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
