/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        eplyd: {
          DEFAULT: '#3DDC97',
          dim: '#2AB77B',
          dark: '#173B2C'
        },
        ink: {
          bg: '#0B0F0E',
          panel: '#111716',
          panel2: '#161E1C',
          field: '#0D1312',
          border: '#1F2A27',
          text: '#D9E4DF',
          muted: '#7C8B85'
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
};
