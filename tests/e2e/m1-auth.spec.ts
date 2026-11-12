import { expect, test } from "@playwright/test";
import { db, lastEmail, linkFrom, loginAs, uniq } from "./helpers";

test("M1: přihlášení magic linkem, registrace firmy a pozvání kolegy", async ({ page, context }) => {
  const email = `${uniq("admin")}@example.com`;
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Poslat přihlašovací odkaz" }).click();
  await expect(page.getByRole("heading", { name: "Zkontrolujte e-mail" })).toBeVisible();

  const mail = await lastEmail(email);
  await page.goto(linkFrom(mail.text, "/api/auth/callback/email"));
  await expect(page).toHaveURL(/\/onboarding/);

  await page.getByLabel("Název firmy").fill("Testovací Pivovar s.r.o.");
  await page.getByLabel("IČO / DIČ").fill("12345678");
  await page.getByRole("button", { name: "Zaregistrovat firmu" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("current-company")).toContainText("Testovací Pivovar s.r.o.");

  // pozvání skladníka
  await page.getByRole("link", { name: "Nastavení" }).click();
  const colleague = `${uniq("sklad")}@example.com`;
  await page.getByLabel("E-mail").fill(colleague);
  await page.getByRole("combobox", { name: "Role" }).last().selectOption("SKLAD");
  await page.getByRole("button", { name: "Poslat pozvánku" }).click();
  await expect(page.getByText("Pozvánka odeslána.")).toBeVisible();

  const invMail = await lastEmail(colleague);
  const inviteUrl = linkFrom(invMail.text, "/invite/");

  // kolega se přihlásí a přijme pozvánku
  await context.clearCookies();
  const user = await db.user.create({ data: { email: colleague } });
  await loginAs(context, user.id);
  await page.goto(inviteUrl);
  await page.getByRole("button", { name: "Přijmout pozvánku" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("current-company")).toContainText("Sklad");
  // skladník nevidí import ani výkaz
  await expect(page.getByRole("link", { name: "Import" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Výkaz PPWR" })).toHaveCount(0);
});

test("M1: nepřihlášený uživatel je přesměrován na přihlášení", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login/);
});
