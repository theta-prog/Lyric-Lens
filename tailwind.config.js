/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Barlow Condensed"', 'Impact', '"Arial Narrow"', 'sans-serif'],
        sans: ['"Noto Sans JP"', 'system-ui', 'sans-serif'],
      },
      colors: {
        paper: '#f5f2ed',
        ink: '#1a1a1f',
        'ink-light': '#6b6b7a',
        cyan: '#3dd6e8',
        'cyan-light': '#a8eef5',
        yellow: '#f5c842',
        flash: '#ffffff',
      },
      keyframes: {
        afLock: {
          '0%': { opacity: '1', transform: 'scale(1)', borderColor: '#3dd6e8' },
          '30%': { opacity: '0.4', transform: 'scale(0.85)', borderColor: '#3dd6e8' },
          '60%': { opacity: '1', transform: 'scale(0.9)', borderColor: '#4ade80' },
          '100%': { opacity: '1', transform: 'scale(1)', borderColor: '#ffffff' },
        },
        afBracketSnap: {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(0.94)' },
          '100%': { transform: 'scale(1)' },
        },
        floatLine: {
          '0%': { transform: 'translate3d(-8%, 0, 0)' },
          '100%': { transform: 'translate3d(8%, 0, 0)' },
        },
        flashFade: {
          '0%': { opacity: '0' },
          '18%': { opacity: '0.95' },
          '100%': { opacity: '0' },
        },
      },
      animation: {
        afLock: 'afLock 0.42s ease-out',
        afBracketSnap: 'afBracketSnap 0.34s ease-out',
        floatLine: 'floatLine 7s ease-in-out infinite alternate',
        flashFade: 'flashFade 0.28s ease-out both',
      },
    },
  },
  plugins: [],
}
