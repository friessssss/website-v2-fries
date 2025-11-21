import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#05070c",
        sand: "#f5f5f1",
        accent: {
          fancy: "var(--accent-fancy)",
          simple: "var(--accent-simple)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        brutal: "1rem 1rem 0 #01040d",
      },
    },
  },
  plugins: [],
};
export default config;
