/**
 * The site writes numbers in Arabic-Indic digits (num() in i18n/ar.ts). Text from the official source (plot
 * numbers, zone names, building rules) comes with Latin ones; these put it in the same style for display.
 */
const AR = "٠١٢٣٤٥٦٧٨٩";

/** «منطقة 145 فدان» → «منطقة ١٤٥ فدان»; «50 %» → «٥٠٪». */
export function arDigits(s: string): string;
export function arDigits(s: string | null): string | null;
export function arDigits(s: string | null): string | null {
  if (s == null) return s;
  return s.replace(/[0-9]/g, (d) => AR[Number(d)]).replace(/\s*%/g, "٪");
}

/** The reverse, for comparing what a person typed (in either style) with the text. */
export const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR.indexOf(d))).replace(/٪/g, "%");

/** Whether `text` contains `query`, whichever digits either uses. */
export const includesDigits = (text: string, query: string) => latinDigits(text).includes(latinDigits(query));
