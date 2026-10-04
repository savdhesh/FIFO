export interface CountryStyle {
  country: string; spelling: "US" | "UK"; dates: "US" | "EU"; salutation: string; closing: string;
  formality: "direct" | "formal"; defaultPages: "1" | "2" | "3" | "4"; locationFormat: "city-state" | "city-country";
  letterDate: (d: Date) => string;
}
const usDate = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const euDate = (d: Date) => d.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
const mk = (country: string, o: Partial<CountryStyle>): CountryStyle => ({
  country, spelling: "UK", dates: "EU", salutation: "Dear Hiring Manager,", closing: "Yours sincerely,", formality: "formal",
  defaultPages: "2", locationFormat: "city-country", letterDate: euDate, ...o,
});
export const COUNTRIES: Record<string, CountryStyle> = {
  USA: mk("USA", { spelling: "US", dates: "US", salutation: "Dear Hiring Team,", closing: "Sincerely,", formality: "direct", defaultPages: "2", locationFormat: "city-state", letterDate: usDate }),
  UK: mk("UK", { defaultPages: "2" }),
  Ireland: mk("Ireland", {}),
  Germany: mk("Germany", { salutation: "Dear Hiring Team,", closing: "Kind regards,", defaultPages: "2" }),
  Netherlands: mk("Netherlands", { salutation: "Dear Hiring Team,", closing: "Kind regards,", formality: "direct" }),
  France: mk("France", { salutation: "Dear Hiring Team,", closing: "Kind regards," }),
  Belgium: mk("Belgium", { salutation: "Dear Hiring Team,", closing: "Kind regards," }),
  Austria: mk("Austria", { salutation: "Dear Hiring Team,", closing: "Kind regards," }),
  Switzerland: mk("Switzerland", { salutation: "Dear Hiring Team,", closing: "Kind regards,", defaultPages: "3" }),
  Sweden: mk("Sweden", { salutation: "Dear Hiring Team,", closing: "Kind regards,", formality: "direct" }),
  Singapore: mk("Singapore", { defaultPages: "3" }),
  Malaysia: mk("Malaysia", { defaultPages: "3" }),
  India: mk("India", { defaultPages: "3" }),
};
export const COUNTRY_NAMES = Object.keys(COUNTRIES);
export const countryStyle = (c: string): CountryStyle => COUNTRIES[c] ?? COUNTRIES.USA;
