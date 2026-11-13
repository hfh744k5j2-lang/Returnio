import { describe, expect, it } from "vitest";
import { computePpwr, type PpwrRawLine } from "@/lib/ppwr";

const from = new Date("2026-01-01");
const to = new Date("2026-06-30");
const line = (id: string, reusable: boolean, weightKg: number, quantity: number, extra: Partial<PpwrRawLine> = {}): PpwrRawLine => ({
  kind: "ISSUE", fromUs: true, date: new Date("2026-03-01"), packagingTypeId: id, code: id, name: id, owner: "My", reusable, weightKg, quantity, ...extra,
});
const run = (lines: PpwrRawLine[], start: { packagingTypeId: string; confirmed: number }[] = [], end: { packagingTypeId: string; confirmed: number }[] = [], extraOneWay?: { pieces: number; kg: number }) =>
  computePpwr({ lines, from, to, balancesAtStart: start.map((b) => ({ partnershipId: "p", ...b })), balancesAtEnd: end.map((b) => ({ partnershipId: "p", ...b })), extraOneWay });

describe("výpočet PPWR (orientační)", () => {
  it("podíl vratných v kusech i hmotnosti", () => {
    const r = run([line("EUR", true, 25, 100), line("KRT", false, 0.5, 300), line("EUR", true, 25, 100)]);
    expect(r.totalPieces).toBe(500);
    expect(r.reusablePieces).toBe(200);
    expect(r.reusableSharePieces).toBeCloseTo(0.4);
    expect(r.totalWeightKg).toBe(5150);
    expect(r.reusableShareWeight).toBeCloseTo(5000 / 5150);
  });
  it("započítává jen potvrzené výdeje od nás v období (metodika v modulu)", () => {
    const r = run([
      line("EUR", true, 25, 10),
      line("EUR", true, 25, 99, { kind: "RETURN" }),
      line("EUR", true, 25, 99, { fromUs: false }),
      line("EUR", true, 25, 99, { date: new Date("2025-12-31") }),
    ]);
    expect(r.totalPieces).toBe(10);
  });
  it("obrátky = vydané / průměr v oběhu; bez oběhu nelze určit", () => {
    const r = run(
      [line("EUR", true, 25, 300), line("BOX", true, 2, 50)],
      [{ packagingTypeId: "EUR", confirmed: 80 }],
      [{ packagingTypeId: "EUR", confirmed: 120 }, { packagingTypeId: "BOX", confirmed: -5 }],
    );
    const eur = r.types.find((t) => t.code === "EUR")!;
    expect(eur.avgPool).toBe(100);
    expect(eur.rotations).toBe(3);
    const box = r.types.find((t) => t.code === "BOX")!;
    expect(box.avgPool).toBe(0);
    expect(box.rotations).toBeNull();
  });
  it("typ, který změnil vratnost, se vykáže ve dvou řádcích (deterministicky)", () => {
    const a = run([line("X", true, 1, 10), line("X", false, 1, 30)]);
    const b = run([line("X", false, 1, 30), line("X", true, 1, 10)]);
    expect(a.reusablePieces).toBe(10);
    expect(b.reusablePieces).toBe(10);
    expect(a.types).toHaveLength(2);
  });
  it("ručně doplněné nevratné obaly mimo evidenci snižují podíl", () => {
    const r = run([line("EUR", true, 25, 100)], [], [], { pieces: 100, kg: 2500 });
    expect(r.reusableSharePieces).toBeCloseTo(0.5);
    expect(r.reusableShareWeight).toBeCloseTo(0.5);
  });
  it("bez výdejů je podíl neurčen, ne 0 %", () => {
    expect(run([]).reusableSharePieces).toBeNull();
  });
});
