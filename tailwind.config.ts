import type { Config } from "tailwindcss";

export default {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [
    require('daisyui'),
  ],
  daisyui: {
    themes: [
      {
        custom: {
          "primary": "#10b981",
          "primary-content": "#010d09",
          "secondary": "#0369a1",
          "secondary-content": "#00080d",
          "accent": "#fb7185",
          "neutral": "#a8a29e",
          "base-100": "#1a1a1a",
          "info": "#7dd3fc",
          "success": "#a3e635",
          "warning": "#fb923c",
          "error": "#dc2626",
        },
      },
      "corporate"],
  }
} satisfies Config;
