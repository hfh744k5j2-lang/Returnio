/** Povolí jen relativní cestu v rámci aplikace (ochrana proti open redirect). */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!/^\/(?![\/\\])[^\s]*$/.test(next)) return fallback;
  return next;
}
