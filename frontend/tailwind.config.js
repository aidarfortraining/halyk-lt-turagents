/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        halyk: "#00B14F",
        "halyk-dark": "#009644",
        "halyk-light": "#E6F7EE",
        accent: "#00B14F",
        muted: "#eef1f4",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
