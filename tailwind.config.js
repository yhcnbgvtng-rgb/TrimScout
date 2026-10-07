/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#090A0F',
        surface: '#11141C',
        'surface-elevated': '#181C26',
        border: '#232836',
        'border-strong': '#31374A',
        // Brand accent: copper. Buttons, links, selection, focus, the quote flow's primary actions.
        brand: {
          50: '#FDF6EE',
          100: '#FAE9D3',
          200: '#F4D0A3',
          300: '#ECB06C',
          400: '#E48F43',
          500: '#D9722A',
          600: '#BF591F',
          700: '#9C441C',
          800: '#7E381E',
          900: '#67301D',
          950: '#38160D',
        },
        // Meaning, not brand: good news only (approved, quoted, price drop, factory verified, success toasts).
        // Keep this out of buttons and chrome.
        positive: {
          50: '#ECFDF5',
          100: '#D1FAE5',
          200: '#A7F3D0',
          300: '#6EE7B7',
          400: '#34D399',
          500: '#10B981',
          600: '#059669',
          700: '#047857',
          800: '#065F46',
          900: '#064E3B',
          950: '#022C22',
        },
        ink: {
          light: '#F3F4F6',
          muted: '#9CA3AF',
          faint: '#6B7280',
        }
      },
    },
  },
  plugins: [],
}
