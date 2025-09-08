/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#2CFF8E',
        'primary-dark': '#35D688',
        secondary: '#667EF1',
        'secondary-dark': '#00318C',
        dark: '#111214',
        black: '#000000',
        white: '#FFFFFF',
      },
      fontFamily: {
        display: ['Bitsumishi', 'system-ui', 'sans-serif'],
        mono: ['Classic Console Neue', 'Courier New', 'monospace'],
        sans: ['Helvetica', 'system-ui', 'sans-serif'],
        light: ['Helvetica Light', 'Helvetica', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}