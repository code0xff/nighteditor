import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/** GitHub Pages 는 하위 경로로 서빙된다. 절대 경로로 두면 에셋이 전부 404 다. */
const PAGES_BASE = '/nighteditor/';

export default defineConfig(({ command }) => ({
  // dev 서버는 루트로 둔다. 여기까지 하위 경로로 만들 이유가 없다.
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
        description: '아티팩트 HTML 을 클릭해 고치고 원본을 최소 diff 로 되돌려준다',
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
        // 설치하면 OS 에서 HTML 을 이 앱으로 바로 열 수 있다.
        // 이때 넘어오는 핸들로 원본 덮어쓰기까지 된다.
        file_handlers: [
          {
            action: PAGES_BASE,
            accept: { 'text/html': ['.html', '.htm'] },
          },
        ],
      },
      workbox: {
        // 앱 전체를 미리 캐시한다. 백엔드가 없어 이걸로 완전한 오프라인이 된다.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // 청크는 **바뀌는 주기**로 나눈다. 앱 코드를 고쳐 배포해도 react·radix 청크의
    // 해시는 그대로라 사용자는 그 부분을 다시 받지 않는다.
    //
    // parse5 는 여기서 나누지 않는다 — `store/editor.ts` 가 파일을 열 때 동적으로
    // 불러오므로 이미 별도 청크이고, 초기 화면에는 실리지 않는다 (ADR-008).
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
