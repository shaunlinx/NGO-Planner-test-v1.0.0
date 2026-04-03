/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        'ngo-teal-light': '#00bfb2',
        'ngo-teal-dark': '#1a5e63',
        'ngo-teal': '#028090',
        'ngo-cream': '#f0f3bd',
        'ngo-pink': '#c64191',
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}