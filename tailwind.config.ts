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
        surface: { DEFAULT: "var(--surface-000)", 50: "var(--surface-050)" },
        ink: {
          DEFAULT: "var(--ink)",
          bright: "var(--ink-bright)",
          90: "var(--ink-90)",
          70: "var(--ink-70)",
          60: "var(--ink-60)",
          50: "var(--ink-50)",
          40: "var(--ink-40)",
        },
        line: { DEFAULT: "var(--line-20)", 20: "var(--line-20)", 10: "var(--line-10)", 8: "var(--line-08)" },
        glyph: "var(--glyph)",
        lime: { DEFAULT: "var(--lime)", hover: "var(--lime-hover)", on: "var(--on-lime)" },
        danger: "var(--danger)",
      },
      fontFamily: {
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [],
};
export default config;
