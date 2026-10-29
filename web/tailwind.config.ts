import type { Config } from 'tailwindcss'

// Design System de Back Office: Spectrum, Poppins + Space Grotesk, tarjetas blancas con borde, radio 2px.
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    borderRadius: { none: '0', sm: '2px', DEFAULT: '2px', md: '2px', lg: '2px', full: '9999px' },
    extend: {
      colors: {
        // Neutrals and soft tints follow the theme (CSS variables in globals.css); the accents are the same in both.
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        blue: { DEFAULT: '#2D6BFF', soft: 'rgb(var(--blue-soft) / <alpha-value>)' },
        orange: { DEFAULT: '#FF7A2F', soft: 'rgb(var(--orange-soft) / <alpha-value>)' },
        purple: { DEFAULT: '#8B5CF6', soft: 'rgb(var(--purple-soft) / <alpha-value>)' },
        teal: { DEFAULT: '#14B8A6', soft: 'rgb(var(--teal-soft) / <alpha-value>)' },
        amber: { DEFAULT: '#F5A524', soft: 'rgb(var(--amber-soft) / <alpha-value>)' },
        red: { DEFAULT: '#E5484D', soft: 'rgb(var(--red-soft) / <alpha-value>)' },
      },
      fontFamily: {
        sans: ['var(--font-poppins)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-grotesk)', 'var(--font-poppins)', 'ui-sans-serif', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
