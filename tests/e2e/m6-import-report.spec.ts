import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { addUser, createCompanyWithUser, createPackaging, createPartnership, db, loginAs, shot } from "./helpers";

test("M6: import CSV s mapováním sloupců, chyby a úspěšný import", async ({ page, context }) => {
  const a = await createCompanyWithUser("M6 Nápoje");
  const b = await createCompanyWithUser("M6 Distribuce");
  await createPackaging(a.company.id, "EUR", { name: "EUR paleta" });
  await createPackaging(a.company.id, "KRT", { name: "Karton", reusable: false, weightKg: 0.5 });
  await createPartnership(a.company.id, b.company.id, { name: "M6 Distribuce", code: "DIST1" });
  await loginAs(context, a.user.id);
  await page.goto("/import");

  const bad = "Datum;Odběratel;Operace;Artikl;Množství;DL\n2026-10-01;DIST1;výdej;EUR;10;DL-1\n2026-10-02;NEZNAMY;výdej;EUR;5;DL-2\n";
  await page.getByLabel("CSV soubor").setInputFiles({ name: "erp.csv", mimeType: "text/csv", buffer: Buffer.from(bad) });
  await expect(page.getByText("V souboru je 2 řádků.")).toBeVisible();
  await page.getByLabel("Kód obalu *").selectOption("Artikl");
  await page.getByLabel("Partner (kód, název nebo e-mail) *").selectOption("Odběratel");
  await page.getByLabel("Druh pohybu *").selectOption("Operace");
  await page.getByRole("button", { name: "Zkontrolovat soubor" }).click();
  await expect(page.getByTestId("import-preview")).toContainText("Řádek 3");
  await expect(page.getByTestId("import-preview")).toContainText("Neznámý partner „NEZNAMY“");

  const good = "Datum;Odběratel;Operace;Artikl;Množství;DL\n1.10.2026;DIST1;výdej;EUR;10;DL-1\n1.10.2026;DIST1;výdej;KRT;200;DL-1\n3.10.2026;DIST1;příjem;EUR;4;DL-2\n";
  await page.getByLabel("CSV soubor").setInputFiles({ name: "erp.csv", mimeType: "text/csv", buffer: Buffer.from(good) });
  await expect(page.getByText("V souboru je 3 řádků.")).toBeVisible();
  await page.getByLabel("Kód obalu *").selectOption("Artikl");
  await page.getByLabel("Partner (kód, název nebo e-mail) *").selectOption("Odběratel");
  await page.getByLabel("Druh pohybu *").selectOption("Operace");
  await page.getByRole("button", { name: "Zkontrolovat soubor" }).click();
  await expect(page.getByText("Bez chyb: 3 řádků → 2 pohybů.")).toBeVisible();
  await shot(page, "08-import-csv");
  await page.getByRole("button", { name: "Importovat 2 pohybů" }).click();
  await expect(page.getByText("Importováno 2 pohybů.")).toBeVisible();
  expect(await db.movement.count({ where: { partnership: { companyAId: a.company.id }, importBatchId: { not: null } } })).toBe(2);
});

test("M6: výkaz PPWR, export CSV, historie změn; skladník k nim nemá přístup", async ({ page, context }) => {
  const a = await createCompanyWithUser("M6R Pivovar");
  const b = await createCompanyWithUser("M6R Hospoda");
  const eur = await createPackaging(a.company.id, "EUR", { name: "EUR paleta", weightKg: 25 });
  const krt = await createPackaging(a.company.id, "KRT", { name: "Karton", reusable: false, weightKg: 1 });
  const p = await createPartnership(a.company.id, b.company.id, { name: "M6R Hospoda" });
  await db.movement.create({
    data: {
      partnershipId: p.id, number: 1, kind: "ISSUE", createdBySide: "A", fromSide: "A", status: "CONFIRMED", date: new Date("2026-03-10"), deliveryNote: "DL-PPWR",
      lines: { create: [
        { packagingTypeId: eur.id, quantity: 60, finalQuantity: 60, weightKg: 25, reusable: true },
        { packagingTypeId: krt.id, quantity: 40, finalQuantity: 40, weightKg: 1, reusable: false },
      ] },
    },
  });
  await loginAs(context, a.user.id);
  await page.goto("/reports/ppwr?from=2026-01-01&to=2026-06-30");
  await expect(page.getByTestId("ppwr-warning")).toContainText("Orientační výpočet");
  await expect(page.getByTestId("share-pieces")).toHaveText("60,0 %");
  await expect(page.getByTestId("share-weight")).toContainText("97,4 %");
  await shot(page, "09-vykaz-ppwr");

  const dl = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export výkazu (CSV)" }).click();
  const csv = readFileSync(await (await dl).path(), "utf8");
  expect(csv).toContain("ORIENTAČNÍ");
  expect(csv).toContain("podil_vratnych_ks_%;60.0");

  await page.goto("/movements");
  const dl2 = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export (CSV)" }).click();
  const mcsv = readFileSync(await (await dl2).path(), "utf8");
  expect(mcsv.charCodeAt(0)).toBe(0xfeff);
  expect(mcsv).toContain("DL-PPWR");

  await page.goto("/balances");
  const dl3 = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export salda (CSV)" }).click();
  const bcsv = readFileSync(await (await dl3).path(), "utf8");
  expect(bcsv).toContain("EUR;EUR paleta;M6R Pivovar;60");
  expect(bcsv).not.toContain("KRT"); // nevratné bez salda

  await page.goto("/audit");
  await expect(page.getByTestId("audit-table")).toBeVisible();

  const sklad = await addUser(a.company.id, "SKLAD");
  await context.clearCookies();
  await loginAs(context, sklad.id);
  for (const url of ["/reports/ppwr", "/import", "/audit"]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Nemáte přístup" })).toBeVisible();
  }
  expect((await context.request.get("/api/v1/export/movements")).status()).toBe(403);
});

test("M6: cron upozornění vyžaduje tajný klíč", async ({ request }) => {
  expect((await request.get("/api/cron/notifications")).status()).toBe(401);
  expect((await request.get("/api/cron/notifications", { headers: { authorization: "Bearer spatne" } })).status()).toBe(401);
  const ok = await request.get("/api/cron/notifications", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(ok.status()).toBe(200);
});
