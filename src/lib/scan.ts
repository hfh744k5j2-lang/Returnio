/** Rozpozná obsah naskenovaného QR kódu ObalBook: odkaz /scan?partner=ID nebo /scan?type=ID. */
export function parseScanned(text: string): { partner?: string; type?: string } | null {
  const raw = text.trim();
  try {
    const u = new URL(raw);
    if (!u.pathname.endsWith("/scan")) return null;
    const partner = u.searchParams.get("partner") ?? undefined;
    const type = u.searchParams.get("type") ?? undefined;
    if (!partner && !type) return null;
    const ok = (v?: string) => !v || /^[a-z0-9]{10,40}$/i.test(v);
    if (!ok(partner) || !ok(type)) return null;
    return { partner, type };
  } catch {
    return null;
  }
}
