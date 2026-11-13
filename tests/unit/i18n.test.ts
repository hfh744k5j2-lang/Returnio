import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { DICTS, flattenKeys, makeT } from "@/lib/i18n/core";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|ts)$/.test(f) ? [p] : [];
  });
}

describe("překlady", () => {
  const cs = new Set(flattenKeys(DICTS.cs));
  const en = new Set(flattenKeys(DICTS.en));
  const pl = new Set(flattenKeys(DICTS.pl));

  it("angličtina má stejné klíče jako čeština", () => {
    expect([...cs].filter((k) => !en.has(k))).toEqual([]);
    expect([...en].filter((k) => !cs.has(k))).toEqual([]);
  });

  it("polština má stejné klíče jako čeština (připravená v souborech překladů)", () => {
    expect([...cs].filter((k) => !pl.has(k))).toEqual([]);
    expect([...pl].filter((k) => !cs.has(k))).toEqual([]);
  });

  it("všechny klíče použité v kódu existují", () => {
    const missing: string[] = [];
    for (const file of walk("src")) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) {
        if (!cs.has(m[1])) missing.push(`${file}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("proměnné {x} jsou ve všech jazycích stejné", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    const bad: string[] = [];
    for (const k of cs) {
      const c = vars(makeT("cs")(k));
      if (vars(makeT("en")(k)) !== c || vars(makeT("pl")(k)) !== c) bad.push(k);
    }
    expect(bad).toEqual([]);
  });

  it("dosazuje proměnné a má fallback", () => {
    const t = makeT("en");
    expect(t("onboarding.intro", { email: "a@b.cz" })).toContain("a@b.cz");
    expect(t("neexistuje.klic")).toBe("neexistuje.klic");
  });
});
