/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.ts'],
  theme: {
    extend: {
      screens: {
        // Device frame only on real desktops (wide + mouse). Phones in "desktop site" mode stay full-screen.
        desk: { raw: '(min-width: 640px) and (hover: hover) and (pointer: fine)' },
      },
    },
  },
  plugins: [],
};
