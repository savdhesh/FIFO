/** Resume themes. Every theme is single-column real text; the ATS risk label is shown wherever a theme is chosen. */
export interface Theme { id: "plain" | "classic" | "accent"; label: string; risk: "Low" | "Low-Medium"; note: string; pdfFont: "helvetica" | "times"; docxFont: string; heading: string /* hex without # */; headingRgb: [number, number, number]; rule: boolean }
export const THEMES: Theme[] = [
  { id: "plain", label: "Plain (default)", risk: "Low", note: "Black on white, sans-serif, thin rules. Safest for every ATS.", pdfFont: "helvetica", docxFont: "Calibri", heading: "111111", headingRgb: [17, 17, 17], rule: true },
  { id: "classic", label: "Classic serif", risk: "Low", note: "Serif body text. Single column, standard headings; parses like Plain.", pdfFont: "times", docxFont: "Cambria", heading: "111111", headingRgb: [17, 17, 17], rule: true },
  { id: "accent", label: "Accent headings", risk: "Low-Medium", note: "Coloured section headings. Still one column and real text; avoid if the company is known to use an old ATS.", pdfFont: "helvetica", docxFont: "Calibri", heading: "0A5C8A", headingRgb: [10, 92, 138], rule: false },
];
export const themeById = (id?: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0];
