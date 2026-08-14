/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
    theme: {
      extend: {
        colors: {
          void: '#070B10',
          blueprint: '#0D1926',
          panel: '#111F30',
          graphite: '#8896A6',
          chalk: '#E8EDF2',
          verify: '#35D6A4',
          brass: '#E8B84B',
          halt: '#FF5C4D',
        },
        fontFamily: {
          display: ['Archivo', 'system-ui', 'sans-serif'],
          body: ['"Inter Tight"', 'system-ui', 'sans-serif'],
          mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        },
        letterSpacing: {
          tightest: '-0.04em',
        },
        animation: {
          'drift': 'drift 6s ease-in-out infinite',
          'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        },
        keyframes: {
          drift: {
            '0%, 100%': { transform: 'translateY(0px)' },
            '50%': { transform: 'translateY(-2px)' },
          },
        },
      },
    },
    plugins: [],
  };