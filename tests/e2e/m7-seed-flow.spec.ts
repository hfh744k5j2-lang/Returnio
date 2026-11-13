/**
 * M7 – „Hotovo znamená“: ze seed dat přihlášení za každou ze 3 firem a hlavní tok
 * výdej → potvrzení → rozpor → vyřešení → saldo → výkaz PPWR → export CSV.
 * Zároveň pořizuje snímky (docs/screenshots) a video (docs/video).
 */
import { expect, test, type BrowserContext } from "@playwright/test";
import { readFileSync } from "fs";
import { db, lastEmail, linkFrom, loginAs, shot } from "./helpers";
import { seed, SEED_USERS } from "../../prisma/seed";

test.use({ video: { mode: "on", size: { width: 1280, height: 800 } }, viewport: { width: 1280, height: 800 } });
test.setTimeout(240_000);

async function userId(email: string) {
  return (await db.user.findUniqueOrThrow({ where: { email } })).id;
}
async function as(context: BrowserContext, email: string) {
  await context.clearCookies();
  await loginAs(context, await userId(email));
}

test("M7: seed + přihlášení za 3 firmy + hlavní tok až po export", async ({ page, context }) => {
  const r = await seed();
  expect(r?.stats.created).toBe(300);
  expect(await db.company.count({ where: { name: { in: r!.companies } } })).toBe(3);
  expect(await db.packagingType.count({ where: { company: { name: { in: r!.companies } } } })).toBe(5);
  expect(await db.movementCorrection.count()).toBeGreaterThan(5);

  // 1) skutečné přihlášení magic linkem jako pivovar
  await page.goto("/login");
  await shot(page, "01-prihlaseni");
  await page.getByLabel("E-mail").fill(SEED_USERS.pivovar.admin);
  await page.getByRole("button", { name: "Poslat přihlašovací odkaz" }).click();
  await page.goto(linkFrom((await lastEmail(SEED_USERS.pivovar.admin)).text, "/api/auth/callback/email"));
  await expect(page.getByTestId("current-company")).toContainText("Pivovar Zlatý Ječmen");
  await shot(page, "02-prehled");

  // přihlášení za všechny 3 firmy
  for (const [email, name] of [
    [SEED_USERS.velkoobchod.admin, "Nápojový velkoobchod Morava"],
    [SEED_USERS.hurtownia.admin, "Hurtownia Napojów Wisła"],
  ] as const) {
    await as(context, email);
    await page.goto("/dashboard");
    await expect(page.getByTestId("current-company")).toContainText(name);
  }

  // 2) výdej – skladník pivovaru vydá velkoobchodu 24 EUR palet a 6 sudů
  await as(context, SEED_USERS.pivovar.sklad);
  const morava = await db.partnership.findFirstOrThrow({ where: { code: "MORAVA", companyA: { name: { startsWith: "Pivovar" } } } });
  await page.goto("/movements/new");
  await page.getByLabel("Partner", { exact: true }).selectOption(morava.id);
  await page.getByLabel("Počet EUR paleta").fill("24");
  await page.getByLabel("Počet Sud KEG 50 l").fill("6");
  await page.getByLabel("Číslo dodacího listu").fill("DL-DEMO-1");
  await shot(page, "03-novy-vydej");
  await page.getByRole("button", { name: /Uložit výdej/ }).click();
  await expect(page.getByText(/uložen\. Čeká na potvrzení partnerem/)).toBeVisible();
  const firstUrl = page.url().replace(/\?.*/, "");

  // 3) potvrzení – skladník velkoobchodu
  await as(context, SEED_USERS.velkoobchod.sklad);
  await page.goto(firstUrl);
  await shot(page, "04-potvrzeni");
  await page.getByRole("button", { name: "Ano, počty souhlasí – potvrdit" }).click();
  await expect(page.locator("[data-status=CONFIRMED]")).toBeVisible();

  // 4) rozpor – druhý výdej, velkoobchod napočítá méně
  await as(context, SEED_USERS.pivovar.sklad);
  await page.goto("/movements/new");
  await page.getByLabel("Partner", { exact: true }).selectOption(morava.id);
  await page.getByLabel("Počet EUR paleta").fill("30");
  await page.getByLabel("Číslo dodacího listu").fill("DL-DEMO-2");
  await page.getByRole("button", { name: /Uložit výdej/ }).click();
  await expect(page.getByText(/uložen\./)).toBeVisible();
  const secondUrl = page.url().replace(/\?.*/, "");

  await as(context, SEED_USERS.velkoobchod.sklad);
  await page.goto(secondUrl);
  await page.getByText("Ne, počty nesouhlasí").click();
  await page.getByLabel("Skutečný počet EUR paleta").fill("27");
  await page.getByLabel("Důvod").fill("Tři palety zůstaly na návěsu");
  await shot(page, "07-rozpor");
  await page.getByRole("button", { name: "Odeslat rozpor" }).click();
  await expect(page.locator("[data-status=DISPUTED]")).toBeVisible();

  // 5) vyřešení – logistik pivovaru přijme opravu
  await as(context, SEED_USERS.pivovar.logistik);
  await page.goto("/movements?awaiting=dispute");
  await expect(page.getByTestId("movements-table")).toContainText("DL-DEMO-2");
  await page.goto(secondUrl);
  await expect(page.getByText("Tři palety zůstaly na návěsu")).toBeVisible();
  await page.getByRole("button", { name: "Přijmout opravu" }).click();
  await expect(page.locator("[data-status=CONFIRMED]")).toBeVisible();
  await shot(page, "08-rozpor-vyresen");

  // 6) saldo – obě strany vidí totéž (zrcadlově)
  const balanceRow = async () => (await page.locator("section[data-testid=balance-partner]", { hasText: "Nápojový velkoobchod Morava" }).locator("tr[data-type=EUR]").getAttribute("data-type")) && page.locator("section[data-testid=balance-partner]", { hasText: "Nápojový velkoobchod Morava" }).locator("tr[data-type=EUR] [data-balance]").getAttribute("data-balance");
  await page.goto("/balances");
  const pivEur = Number(await balanceRow());
  await shot(page, "10-saldo");
  await as(context, SEED_USERS.velkoobchod.logistik);
  await page.goto("/balances");
  const velEur = Number(await page.locator("section[data-testid=balance-partner]", { hasText: "Pivovar Zlatý Ječmen" }).locator("tr[data-type=EUR] [data-balance]").getAttribute("data-balance"));
  expect(velEur).toBe(-pivEur);

  // 7) výkaz PPWR za posledních 6 měsíců
  await as(context, SEED_USERS.pivovar.logistik);
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 10);
  await page.goto(`/reports/ppwr?from=${from}&to=${to}`);
  await expect(page.getByTestId("ppwr-warning")).toBeVisible();
  await expect(page.getByTestId("ppwr-table")).toContainText("KRT6");
  await expect(page.getByTestId("share-pieces")).toHaveText(/\d+,\d %/);
  await shot(page, "09-vykaz-ppwr");

  // 8) export CSV salda a pohybů
  await page.goto("/balances");
  const d1 = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export salda (CSV)" }).click();
  const saldo = readFileSync(await (await d1).path(), "utf8");
  expect(saldo).toContain("Nápojový velkoobchod Morava");
  await page.goto("/movements");
  const d2 = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export (CSV)" }).click();
  const pohyby = readFileSync(await (await d2).path(), "utf8");
  expect(pohyby).toContain("DL-DEMO-2");
  expect(pohyby).toMatch(/EUR;EUR paleta;30;27;potvrzen;DL-DEMO-2/);
  await shot(page, "11-pohyby");

  // hurtownia: anglické rozhraní a historie změn
  await as(context, SEED_USERS.hurtownia.logistik);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "en" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await shot(page, "12-prehled-en");
  await page.getByRole("button", { name: "cs" }).click();
  await page.goto("/audit");
  await shot(page, "13-historie-zmen");

  await page.close();
  await page.video()?.saveAs("docs/video/hlavni-tok.webm");
});
