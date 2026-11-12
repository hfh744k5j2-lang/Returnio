import { expect, test } from "@playwright/test";
import { addUser, createCompanyWithUser, createPackaging, createPartnership, db, lastEmail, linkFrom, loginAs, shot } from "./helpers";

test("M5: skladník na telefonu otevře QR partnera, přidá obal z QR a uloží výdej", async ({ page, context }) => {
  const a = await createCompanyWithUser("M5 Sklad A");
  const b = await createCompanyWithUser("M5 Partner B");
  const sklad = await addUser(a.company.id, "SKLAD");
  const eur = await createPackaging(a.company.id, "EUR", { name: "EUR paleta" });
  await createPackaging(a.company.id, "H1", { name: "Plastová paleta H1" });
  const p = await createPartnership(a.company.id, b.company.id, { name: "M5 Partner B" });

  // nepřihlášený skladník naskenuje QR fotoaparátem → přihlášení → zpět na skenování
  await page.goto(`/scan?partner=${p.id}`);
  await expect(page).toHaveURL(/\/login\?next=%2Fscan%3Fpartner%3D/);

  await loginAs(context, sklad.id);
  await page.goto(`/scan?partner=${p.id}&type=${eur.id}`);
  await expect(page.getByTestId("scan-partner")).toHaveText("M5 Partner B");
  await expect(page.getByRole("button", { name: "Zvolte výdej, příjem nebo vrácení" })).toBeDisabled();
  await page.getByRole("button", { name: "Výdej", exact: true }).click();
  await page.getByRole("button", { name: "Přidat EUR paleta" }).click();
  await page.getByRole("button", { name: "Přidat EUR paleta" }).click();
  await page.getByLabel("Počet Plastová paleta H1").fill("12");
  await page.getByLabel("Číslo dodacího listu").fill("DL-M5");
  await shot(page, "05-skenovani-mobil");
  await page.getByRole("button", { name: "Uložit výdej: 15 ks" }).click();
  await expect(page.getByText(/uložen\. Čeká na potvrzení partnerem/)).toBeVisible();
  await page.getByRole("link", { name: "Skenovat další" }).click();
  await expect(page).toHaveURL(/\/scan$/);

  const m = await db.movement.findFirstOrThrow({ where: { partnershipId: p.id }, include: { lines: true } });
  expect(m.kind).toBe("ISSUE");
  expect(m.deliveryNote).toBe("DL-M5");
  expect(m.lines.map((l) => l.quantity).sort((x, y) => x - y)).toEqual([3, 12]);
});

test("M5: QR cizího partnera se ignoruje", async ({ page, context }) => {
  const a = await createCompanyWithUser("M5c A");
  const c = await createCompanyWithUser("M5c C");
  const d = await createCompanyWithUser("M5c D");
  const pCD = await createPartnership(c.company.id, d.company.id, { name: "Tajný" });
  await createPartnership(a.company.id, d.company.id, { name: "Můj" });
  await loginAs(context, a.user.id);
  await page.goto(`/scan?partner=${pCD.id}`);
  await expect(page.getByText("Tento QR kód patří partnerovi, kterého vaše firma nemá.")).toBeVisible();
  await expect(page.getByText("Tajný")).toHaveCount(0);
});

test("M5: partner bez registrace rozporuje přes odkaz, firma navrhne opravu, partner přijme", async ({ page, context }) => {
  const a = await createCompanyWithUser("M5 Pekárna");
  const eur = await createPackaging(a.company.id, "EUR", { name: "EUR paleta" });
  const partnerEmail = "neregistrovany-m5@example.com";
  const p = await createPartnership(a.company.id, null, { name: "Bistro U", email: partnerEmail });
  await loginAs(context, a.user.id);
  await page.goto(`/scan?partner=${p.id}&type=${eur.id}`);
  await page.getByRole("button", { name: "Výdej", exact: true }).click();
  await page.getByLabel("Počet EUR paleta").fill("10");
  await page.getByRole("button", { name: "Uložit výdej: 10 ks" }).click();
  await expect(page.getByText("Partner dostal e-mail s odkazem na potvrzení.")).toBeVisible();
  const movementUrl = page.url().replace(/\?.*/, "");

  // partner (bez přihlášení) otevře odkaz z e-mailu
  await context.clearCookies();
  const link = linkFrom((await lastEmail(partnerEmail)).text, "/p/");
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "M5 Pekárna žádá o potvrzení pohybu obalů" })).toBeVisible();
  await page.getByText("Ne, počty nesouhlasí").click();
  await page.getByLabel("Skutečný počet EUR paleta").fill("8");
  await page.getByLabel("Důvod").fill("Dvě palety chyběly");
  await page.getByTestId("correction-form").getByLabel("Vaše jméno").fill("Jana Bistrová");
  await shot(page, "06-odkaz-partner-rozpor");
  await page.getByRole("button", { name: "Odeslat rozpor" }).click();
  await expect(page.getByText("Rozpor jsme odeslali")).toBeVisible();
  // odkaz už neplatí
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Odkaz už neplatí" })).toBeVisible();

  // firma navrhne 9
  await loginAs(context, a.user.id);
  await page.goto(movementUrl);
  await expect(page.getByText("Dvě palety chyběly")).toBeVisible();
  await page.getByText("Navrhnout jiné počty").click();
  await page.getByLabel("Skutečný počet EUR paleta").fill("9");
  await page.getByLabel("Důvod").fill("Dohoda po telefonu");
  await page.getByRole("button", { name: "Odeslat návrh" }).click();
  await expect(page.getByText("Čekáme, až partner náš návrh opravy přijme")).toBeVisible();

  // partner dostane nový odkaz s navrženými počty a přijme
  await context.clearCookies();
  const mail2 = await lastEmail(partnerEmail);
  expect(mail2.text).toContain("EUR paleta (EUR): 9 ks");
  await page.goto(linkFrom(mail2.text, "/p/"));
  await expect(page.getByRole("heading", { name: "M5 Pekárna navrhuje opravu počtů" })).toBeVisible();
  await page.getByLabel("Vaše jméno").first().fill("Jana Bistrová");
  await page.getByRole("button", { name: "Přijmout opravu" }).click();
  await expect(page.getByText("oprava je přijata")).toBeVisible();

  const m = await db.movement.findFirstOrThrow({ where: { partnershipId: p.id }, include: { lines: true } });
  expect(m.status).toBe("CONFIRMED");
  expect(m.lines[0].finalQuantity).toBe(9);
});
