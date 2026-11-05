/** YodSales brand — navy #242A56 + Thai red #ED1C24.
 *  `indigo` and `violet` are remapped to the brand navy so the LeadGen pages
 *  (built with indigo) automatically match the YodSales look. */
const navy = {
  50: '#eef0f8', 100: '#dde1f0', 200: '#bcc3e1', 300: '#929dcc', 400: '#6774b3',
  500: '#47549a', 600: '#343f80', 700: '#2b3468', 800: '#242A56', 900: '#1b2042', 950: '#11142b',
};
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        indigo: navy,
        violet: navy,
        brand: { ...navy, DEFAULT: '#242A56' },
        thai: { red: '#ED1C24', navy: '#242A56', cream: '#FCF9F0' },
      },
      fontFamily: { sans: ['Inter', 'Sarabun', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
