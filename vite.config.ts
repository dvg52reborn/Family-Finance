import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './', // relative paths: the built folder works from any host, including a sub-folder
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Family Finance Manager',
        short_name: 'Family Finance',
        description: 'Family expenses, budgets, income, currency exchanges and funds.',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f5f7fb',
        theme_color: '#182a42',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The fonts are part of the app files (woff2), so they are saved for offline use with everything else. Market-rate requests are never cached by the worker.
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}'],
      },
    }),
  ],
});
