/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#181511',
        espresso: '#231d18',
        champagne: '#cda75c',
        sand: '#eadcc2',
        cream: '#faf8f3',
        warm: '#f3eee4',
        sage: '#718071',
        rose: '#b96f72'
      },
      fontFamily: {
        display: ['Cormorant Garamond', 'serif'],
        sans: ['Manrope', 'sans-serif']
      },
      boxShadow: {
        premium: '0 22px 70px rgba(58, 43, 24, .10)',
        card: '0 10px 35px rgba(51, 42, 29, .07)'
      },
      animation: {
        'fade-up': 'fadeUp .5s ease-out both',
        'soft-pulse': 'softPulse 2.2s ease-in-out infinite'
      },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        softPulse: { '0%, 100%': { opacity: '.65' }, '50%': { opacity: '1' } }
      }
    }
  },
  plugins: []
}
