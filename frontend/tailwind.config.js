/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Latin stack first (unchanged look); Indic fonts after it so local names in Odia / Devanagari render.
        sans: [
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Noto Sans"',
          '"Noto Sans Oriya"',
          '"Noto Sans Devanagari"',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Noto Color Emoji"',
        ],
      },
      colors: {
        primary: {
          DEFAULT: '#0f766e',
          dark: '#115e59',
          light: '#ccfbf1',
        },
      },
    },
  },
  plugins: [],
};
