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
        },
        // Tokens de tema (claro/escuro) — valores em src/index.css,
        // trocam de cor pela cascata de :root / [data-theme="dark"]
        app:         'rgb(var(--app) / <alpha-value>)',
        surface:     'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        sidebar:     'rgb(var(--sidebar) / <alpha-value>)',
        line: {
          soft:    'rgb(var(--line-soft) / <alpha-value>)',
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong:  'rgb(var(--line-strong) / <alpha-value>)',
        },
        t1: 'rgb(var(--t1) / <alpha-value>)',
        t2: 'rgb(var(--t2) / <alpha-value>)',
        t3: 'rgb(var(--t3) / <alpha-value>)',
        t4: 'rgb(var(--t4) / <alpha-value>)',
        t5: 'rgb(var(--t5) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          soft:    'rgb(var(--brand-soft) / <alpha-value>)',
          line:    'rgb(var(--brand-line) / <alpha-value>)',
        },
        ok:   { DEFAULT: 'rgb(var(--ok) / <alpha-value>)',   soft: 'rgb(var(--ok-soft) / <alpha-value>)' },
        warn: { DEFAULT: 'rgb(var(--warn) / <alpha-value>)', soft: 'rgb(var(--warn-soft) / <alpha-value>)' },
        bad:  { DEFAULT: 'rgb(var(--bad) / <alpha-value>)',  soft: 'rgb(var(--bad-soft) / <alpha-value>)' },
        info: { DEFAULT: 'rgb(var(--info) / <alpha-value>)', soft: 'rgb(var(--info-soft) / <alpha-value>)' },
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
