import { expect, test } from "@playwright/test";
import { createCompanyWithUser, db, loginAs, uniq } from "./helpers";

test("Revize: přihlašovací odkaz má omezený počet pokusů", async ({ page }) => {
  const email = `${uniq("limit")}@example.com`;
  for (let i = 0; i < 5; i++) {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(email);
    await page.getByRole("button", { name: "Poslat přihlašovací odkaz" }).click();
    await expect(page.getByRole("heading", { name: "Zkontrolujte e-mail" })).toBeVisible();
  }
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Poslat přihlašovací odkaz" }).click();
  await expect(page.getByText("Příliš mnoho pokusů o přihlášení")).toBeVisible();
  expect(await db.devEmail.count({ where: { to: email } })).toBe(5);
});

test("Revize: partner vidí jen nabízené nebo už použité obaly druhé firmy", async ({ page, context }) => {
  const a = await createCompanyWithUser("Rev Dodavatel");
  const b = await createCompanyWithUser("Rev Odběratel");
  const p = await db.partnership.create({
    data: {
      companyAId: a.company.id,
      companyBId: b.company.id,
      status: "ACTIVE",
      invitedName: "Rev Odběratel",
      invitedEmail: b.user.email,
      code: "ODB",
      codeB: "DOD",
      activatedAt: new Date(),
    },
  });

  await loginAs(context, a.user.id);
  await page.goto("/packaging");
  await page.getByLabel("Název").fill("Poolová paleta");
  await page.getByLabel("Kód").fill("POOL");
  await page.getByLabel("Hmotnost (kg)").fill("20");
  await page.getByLabel("Nabízet všem partnerům").check();
  await page.getByRole("button", { name: "Přidat", exact: true }).click();
  await expect(page.getByTestId("packaging-table")).toContainText("Nabízeno partnerům");

  await page.getByLabel("Název").fill("Interní box");
  await page.getByLabel("Kód").fill("INTERNAL");
  await page.getByLabel("Hmotnost (kg)").fill("3");
  await page.getByRole("button", { name: "Přidat", exact: true }).click();
  await expect(page.getByTestId("packaging-table")).toContainText("INTERNAL");

  await context.clearCookies();
  await loginAs(context, b.user.id);
  const res = await page.request.get(`/api/v1/partners/${p.id}`);
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("POOL");
  expect(body).not.toContain("INTERNAL");
});
