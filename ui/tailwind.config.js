/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#05080b',
        panel: '#0a1016',
        edge: '#1a2832',
        mint: '#5eead4',
        rose: '#fb7185',
        amber: '#fbbf24',
        sky: '#7dd3fc',
        dim: '#8193a0',
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace',
        ],
      },
      boxShadow: {
        glow: '0 0 42px -16px rgba(94, 234, 212, 0.55)',
        roseglow: '0 0 42px -16px rgba(251, 113, 133, 0.55)',
      },
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '1' },
          '48%': { opacity: '0.82' },
          '52%': { opacity: '0.96' },
        },
        sweep: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(400%)' },
        },
      },
      animation: {
        flicker: 'flicker 4s ease-in-out infinite',
        sweep: 'sweep 5s linear infinite',
      },
    },
  },
  plugins: [],
};
