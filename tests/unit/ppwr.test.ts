import { describe, expect, it } from "vitest";
import { computePpwr } from "@/lib/ppwr";

const line = (id: string, reusable: boolean, weightKg: number, quantity: number) => ({ packagingTypeId: id, code: id, name: id, reusable, weightKg, quantity });

describe("výpočet PPWR (orientační)", () => {
  it("podíl vratných v kusech i hmotnosti", () => {
    const r = computePpwr([line("EUR", true, 25, 100), line("KRT", false, 0.5, 300), line("EUR", true, 25, 100)], [], []);
    expect(r.totalPieces).toBe(500);
    expect(r.reusablePieces).toBe(200);
    expect(r.reusableSharePieces).toBeCloseTo(0.4);
    expect(r.totalWeightKg).toBe(5150);
    expect(r.reusableShareWeight).toBeCloseTo(5000 / 5150);
  });
  it("obrátky = vydané / průměr v oběhu; bez oběhu nelze určit", () => {
    const r = computePpwr(
      [line("EUR", true, 25, 300), line("BOX", true, 2, 50)],
      [{ packagingTypeId: "EUR", piecesAtPartners: 80 }],
      [{ packagingTypeId: "EUR", piecesAtPartners: 120 }, { packagingTypeId: "BOX", piecesAtPartners: -5 }],
    );
    const eur = r.types.find((t) => t.code === "EUR")!;
    expect(eur.avgPool).toBe(100);
    expect(eur.rotations).toBe(3);
    const box = r.types.find((t) => t.code === "BOX")!;
    expect(box.avgPool).toBe(0);
    expect(box.rotations).toBeNull();
  });
  it("bez výdejů je podíl neurčen, ne 0 %", () => {
    const r = computePpwr([], [], []);
    expect(r.reusableSharePieces).toBeNull();
    expect(r.types).toEqual([]);
  });
});
