import { expect, test } from "@playwright/test";
import { addUser, createCompanyWithUser, db, lastEmail, linkFrom, loginAs, uniq } from "./helpers";

test("M3: typy obalů – přidání, úprava, validace; skladník je jen vidí", async ({ page, context }) => {
  const a = await createCompanyWithUser("M3 Mlékárna");
  await loginAs(context, a.user.id);
  await page.goto("/packaging");
  await page.getByLabel("Název").fill("EUR paleta");
  await page.getByLabel("Kód").fill("eur");
  await page.getByLabel("Materiál").fill("dřevo");
  await page.getByLabel("Hmotnost (kg)").fill("25");
  await page.getByLabel("Kauce").fill("150");
  await page.getByRole("button", { name: "Přidat", exact: true }).click();
  await expect(page.getByText("Typ obalu přidán.")).toBeVisible();
  await expect(page.getByTestId("packaging-table")).toContainText("EUR");

  // nevratný karton
  await page.getByLabel("Název").fill("Karton");
  await page.getByLabel("Kód").fill("KRT");
  await page.getByLabel("Hmotnost (kg)").fill("0.4");
  await page.getByLabel("Vratný obal").uncheck();
  await page.getByRole("button", { name: "Přidat", exact: true }).click();
  await expect(page.getByTestId("packaging-table")).toContainText("KRT");

  // duplicitní kód
  await page.getByLabel("Název").fill("Jiná paleta");
  await page.getByLabel("Kód").fill("EUR");
  await page.getByLabel("Hmotnost (kg)").fill("20");
  await page.getByRole("button", { name: "Přidat", exact: true }).click();
  await expect(page.getByText("Kód EUR už používáte.")).toBeVisible();

  // úprava
  await page.getByRole("row", { name: /EUR/ }).getByRole("link", { name: "Upravit" }).click();
  await expect(page.getByRole("heading", { name: "Upravit obal EUR" })).toBeVisible();
  await page.getByLabel("Hmotnost (kg)").fill("24.5");
  await page.getByRole("button", { name: "Uložit" }).click();
  await expect(page).toHaveURL(/\/packaging$/);
  await expect(page.getByTestId("packaging-table")).toContainText("24,5");
  const t = await db.packagingType.findFirstOrThrow({ where: { companyId: a.company.id, code: "EUR" } });
  expect(Number(t.weightKg)).toBe(24.5);
  expect(Number(t.deposit)).toBe(150);

  // skladník vidí, ale nemůže přidávat
  const sklad = await addUser(a.company.id, "SKLAD");
  await context.clearCookies();
  await loginAs(context, sklad.id);
  await page.goto("/packaging");
  await expect(page.getByTestId("packaging-table")).toContainText("EUR");
  await expect(page.getByRole("button", { name: "Přidat", exact: true })).toHaveCount(0);
  await page.goto(`/packaging/${t.id}`);
  await expect(page.getByRole("heading", { name: "Nemáte přístup" })).toBeVisible();
});

test("M3: pozvání partnera, registrace partnera zdarma a sdílené partnerství", async ({ page, context }) => {
  const a = await createCompanyWithUser("M3 Pivovar");
  await loginAs(context, a.user.id);
  await page.goto("/partners");
  const partnerEmail = `${uniq("partner")}@example.com`;
  await page.getByLabel("Název partnera").fill("Velkoobchod Jih");
  await page.getByLabel("E-mail partnera").fill(partnerEmail);
  await page.getByRole("button", { name: "Poslat pozvánku" }).click();
  await expect(page.getByText("Pozvánka odeslána.")).toBeVisible();
  await expect(page.getByTestId("partners-table")).toContainText("Velkoobchod Jih");
  await expect(page.getByTestId("partners-table")).toContainText("Neregistrovaný");

  const mail = await lastEmail(partnerEmail);
  const url = linkFrom(mail.text, "/partner-invite/");

  // cizí uživatel s přeposlaným odkazem pozvánku nepřijme
  await context.clearCookies();
  const stranger = await db.user.create({ data: { email: `${uniq("stranger")}@example.com` } });
  await loginAs(context, stranger.id);
  await page.goto(url);
  await expect(page.getByText(`Pozvánka je pro ${partnerEmail}`)).toBeVisible();

  // partner se zaregistruje
  await context.clearCookies();
  const partnerUser = await db.user.create({ data: { email: partnerEmail } });
  await loginAs(context, partnerUser.id);
  await page.goto(url);
  await page.getByLabel("Název firmy").fill("Velkoobchod Jih a.s.");
  await page.getByRole("button", { name: "Zaregistrovat firmu a přijmout" }).click();
  await expect(page).toHaveURL(/\/partners$/);
  await expect(page.getByTestId("partners-table")).toContainText("M3 Pivovar");
  await expect(page.getByTestId("partners-table")).toContainText("Registrovaný");

  // detail partnera má QR kód
  await page.getByRole("link", { name: "Detail" }).click();
  await expect(page.locator("[data-qr]")).toHaveAttribute("data-qr", /\/scan\?partner=/);

  // A teď vidí registrovaný název
  await context.clearCookies();
  await loginAs(context, a.user.id);
  await page.goto("/partners");
  await expect(page.getByTestId("partners-table")).toContainText("Velkoobchod Jih a.s.");
});
