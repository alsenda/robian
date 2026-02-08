/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      boxShadow: {
        brutal: '10px 10px 0 0 var(--color-black)',
        'brutal-sm': '6px 6px 0 0 var(--color-black)',
      },
    },
  },
  plugins: [],
}
