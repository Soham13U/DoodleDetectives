/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#6C7DFF",
          50: "#EEF0FF",
          100: "#DDE1FF",
          200: "#BBC3FF",
          300: "#99A5FF",
          400: "#7786FF",
          500: "#6C7DFF",
          600: "#4E5DE0",
          700: "#3B46AA",
          800: "#293074",
          900: "#171A3E"
        }
      },
      borderRadius: {
        lg: "14px",
        xl: "18px"
      }
    }
  },
  plugins: []
};
