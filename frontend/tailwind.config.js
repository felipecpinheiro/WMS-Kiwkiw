/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta oficial Kiwkiw
        kiwkiw: {
          purple:         '#7B63E8',
          'purple-light': '#9B87F0',
          'purple-dark':  '#5B47C8',
          teal:           '#3DD9A4',
          'teal-light':   '#60E6B8',
          'teal-dark':    '#28B885',
          bg:             '#0C0B18',
          surface:        '#14122A',
          border:         '#2A2550',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      backgroundImage: {
        'brand-gradient':        'linear-gradient(135deg, #7B63E8 0%, #3DD9A4 100%)',
        'brand-gradient-subtle': 'linear-gradient(135deg, #7B63E8 0%, #5B47C8 100%)',
      },
    },
  },
  plugins: [],
}
