import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: { colors: { ink: "#111827", line: "#e5e7eb", accent: "#1d4ed8" } } },
  plugins: [],
} satisfies Config;
