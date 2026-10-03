/** Palette routed through CSS variables so one set of utility classes serves light and dark. */
const v = (n) => `var(--${n})`;
module.exports = {
  content: ["./artifact/**/*.tsx"],
  theme: {
    colors: {
      transparent: "transparent", current: "currentColor", white: v("surface"), ink: v("fg"), line: v("line"), accent: v("accent"),
      gray: { 50: v("g50"), 100: v("g100"), 400: v("g400"), 500: v("g500"), 600: v("g600"), 700: v("g700") },
      red: { 50: v("red-bg"), 100: v("red-bg"), 300: v("red-line"), 600: v("red-solid"), 800: v("red-fg") },
      green: { 50: v("green-bg"), 100: v("green-bg"), 300: v("green-line"), 800: v("green-fg") },
      blue: { 100: v("blue-bg"), 800: v("blue-fg") },
      amber: { 50: v("amber-bg"), 100: v("amber-bg"), 300: v("amber-line"), 800: v("amber-fg") },
    },
    extend: { fontFamily: { sans: ["IBM Plex Sans", "system-ui", "sans-serif"], mono: ["IBM Plex Mono", "ui-monospace", "monospace"] } },
  },
  corePlugins: { preflight: false },
};
