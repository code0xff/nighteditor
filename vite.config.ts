import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/** GitHub Pages serves from a subpath. Left absolute, every asset 404s. */
const PAGES_BASE = '/nighteditor/';

export default defineConfig(({ command }) => ({
  // The dev server stays at the root — no reason to carry the subpath here too.
  base: command === 'build' ? PAGES_BASE : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
        'favicon.ico',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'apple-touch-icon.png',
      ],
      manifest: {
        name: 'nighteditor',
        short_name: 'nighteditor',
        // User-facing copy, so it follows the app's default UI language rather than
        // the repository's. It says what the tool does without naming artifacts —
        // the document does not have to be one.
        description: 'HTML 문서를 클릭해 고치고, 원본을 최소 diff 로 되돌려준다',
        lang: 'ko',
        display: 'standalone',
        background_color: '#0b0b0c',
        theme_color: '#0b0b0c',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Once installed, the OS can open HTML with this app directly. The handle
        // that arrives that way is what allows overwriting the original.
        file_handlers: [
          {
            action: PAGES_BASE,
            accept: { 'text/html': ['.html', '.htm'] },
          },
        ],
      },
      workbox: {
        // Precache the whole app except the fonts. With no backend, that is all it
        // takes to be fully offline.
        //
        // The fonts stay out because Pretendard ships as 93 unicode-range slices
        // totalling 3.0MB and a session touches a handful of them — precaching all
        // of them would spend 3MB to have the few that get used. They are cached on
        // first use instead, which leaves exactly one case seeing the fallback
        // stack: a first visit made offline.
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              // The slices are content-hashed, so a cached one is never stale.
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Chunks are split by **how often they change**. Shipping a change to app code
    // leaves the react and radix chunk hashes alone, so nobody downloads them again.
    //
    // parse5 is not split here — `store/editor.ts` imports it dynamically when a
    // file is opened, so it is already its own chunk and never rides the first
    // screen (ADR-008).
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: 'radix', test: /node_modules\/@radix-ui\// },
          ],
        },
      },
    },
  },
}));
