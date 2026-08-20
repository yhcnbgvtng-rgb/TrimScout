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
        primary: {
          50: '#ECFDF5',
          500: '#10B981',
          600: '#059669',
        },
        accent: {
          500: '#6366F1',
          600: '#4F46E5',
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
