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
        // Brand accent: Porsche Chalk (#E1DEDE, from data/porsche_color_codes.csv M9A). A neutral, so hierarchy comes from
        // layout and type. 400 is one step LIGHTER than 500 on purpose: buttons are `bg-brand-500 hover:bg-brand-400`.
        brand: {
          50: '#FAF9F9',
          100: '#F5F3F3',
          200: '#EFEDED',
          300: '#EBE8E8',
          400: '#E7E4E4',
          500: '#E1DEDE',
          600: '#C9C5C5',
          700: '#A39F9F',
          800: '#787474',
          900: '#55524F',
          950: '#2A2826',
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
