import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Preload the fonts the first screen uses, so text appears in its real typeface instead of swapping.
const FIRST_SCREEN_FONTS = /^assets\/(inter-latin-(400|500|600|700)|outfit-latin-700)-normal-[\w-]+\.woff2$/;
function preloadFonts(): Plugin {
  return {
    name: 'preload-first-screen-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {}).filter((f) => FIRST_SCREEN_FONTS.test(f)).sort();
        return files.map((f) => ({
          tag: 'link',
          attrs: { rel: 'preload', href: `/${f}`, as: 'font', type: 'font/woff2', crossorigin: '' },
          injectTo: 'head-prepend' as const,
        }));
      },
    },
  };
}

export default defineConfig({
  plugins: [preloadFonts()],
  build: { target: 'es2020' },
  test: { include: ['tests/**/*.test.ts'] },
});
