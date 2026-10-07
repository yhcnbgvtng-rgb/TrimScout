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
        // Brand accent: Porsche Amazonas Green Metallic, lifted for use on the dark UI (the logo uses the deeper #2A6B53).
        // 500 (#3D9474) is the button fill: black text on it is ~5.8:1. 400 is one step LIGHTER on purpose:
        // buttons are `bg-brand-500 hover:bg-brand-400`, and 300/400 are the text-on-dark shades.
        brand: {
          50: '#EEF8F4',
          100: '#D9EFE6',
          200: '#B7E2D1',
          300: '#8CCFB3',
          400: '#5DB391',
          500: '#3D9474',
          600: '#2F7A60',
          700: '#266350',
          800: '#1E4F40',
          900: '#173D32',
          950: '#0B201B',
        },
        // Meaning, not brand: good news only (approved, quoted, price drop, factory verified, success toasts). Brighter and more
        // minty than the muted brand green, so a status badge never reads as a brand element.
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
