export function formatDate(d: Date | string, locale = "cs") {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(locale === "en" ? "en-GB" : locale, { timeZone: "UTC" });
}

export function formatDateTime(d: Date | string, locale = "cs") {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString(locale === "en" ? "en-GB" : locale, { timeZone: "Europe/Prague" });
}

export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function formatNumber(n: number, locale = "cs", digits = 0) {
  return n.toLocaleString(locale === "en" ? "en-GB" : locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
