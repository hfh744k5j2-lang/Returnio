import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { addUser, createCompanyWithUser, createPackaging, createPartnership, loginAs } from "./helpers";

async function as(context: BrowserContext, userId: string) {
  await context.clearCookies();
  await loginAs(context, userId);
}

async function recordIssue(page: Page, partnerId: string, typeName: string, qty: number, dl: string) {
  await page.goto("/movements/new");
  await page.getByLabel("Partner").selectOption(partnerId);
  await page.getByLabel(`Počet ${typeName}`).fill(String(qty));
  await page.getByLabel("Číslo dodacího listu").fill(dl);
  await page.getByRole("button", { name: /Uložit výdej/ }).click();
  await expect(page.getByText(/uložen\. Čeká na potvrzení partnerem/)).toBeVisible();
  return page.url();
}

test("M4: výdej → potvrzení → rozpor → protinávrh → vyřešení → saldo", async ({ page, context }) => {
  const a = await createCompanyWithUser("M4 Výrobce");
  const b = await createCompanyWithUser("M4 Odběratel");
  const bSklad = await addUser(b.company.id, "SKLAD");
  const aSklad = await addUser(a.company.id, "SKLAD");
  await createPackaging(a.company.id, "EUR", { name: "EUR paleta" });
  await createPackaging(b.company.id, "BOX", { name: "Přepravka" });
  const p = await createPartnership(a.company.id, b.company.id, { name: "M4 Odběratel" });

  // 1) skladník A vydá 40 palet
  await as(context, aSklad.id);
  const issueUrl = await recordIssue(page, p.id, "EUR paleta", 40, "DL-4001");
  // saldo zatím jen „čeká na potvrzení“
  await page.goto("/balances");
  await expect(page.getByTestId("balance-partner").locator("tr[data-type=EUR]")).toContainText("Vyrovnáno");
  await expect(page.getByTestId("balance-partner").locator("tr[data-type=EUR]")).toContainText("+40");

  // 2) skladník B potvrdí
  await as(context, bSklad.id);
  await page.goto("/movements?awaiting=me");
  await page.getByRole("link", { name: /P-0000/ }).first().click();
  await expect(page.getByTestId("movement-lines")).toContainText("40");
  await page.getByRole("button", { name: "Ano, počty souhlasí – potvrdit" }).click();
  await expect(page.locator("[data-status=CONFIRMED]")).toBeVisible();

  // 3) druhý výdej – B rozporuje (přišlo 37)
  await as(context, aSklad.id);
  const secondUrl = await recordIssue(page, p.id, "EUR paleta", 40, "DL-4002");
  expect(secondUrl).not.toBe(issueUrl);
  await as(context, bSklad.id);
  await page.goto(secondUrl.replace(/\?.*/, ""));
  await page.getByText("Ne, počty nesouhlasí").click();
  await page.getByLabel("Skutečný počet EUR paleta").fill("37");
  await page.getByLabel("Důvod").fill("Přišlo jen 37 palet");
  await page.getByRole("button", { name: "Odeslat rozpor" }).click();
  await expect(page.locator("[data-status=DISPUTED]")).toBeVisible();
  await expect(page.getByText("Rozpor vyřeší logistik nebo admin", { exact: false }).or(page.getByText("Čekáme, až partner"))).toBeVisible();

  // 4) admin A vidí rozpor, navrhne 38
  await as(context, a.user.id);
  await page.goto("/dashboard");
  await page.getByRole("link", { name: /Rozpory k vyřešení/ }).click();
  await page.getByRole("link", { name: /P-0000/ }).first().click();
  await expect(page.getByText("Přišlo jen 37 palet")).toBeVisible();
  await page.getByText("Navrhnout jiné počty").click();
  await page.getByLabel("Skutečný počet EUR paleta").fill("38");
  await page.getByLabel("Důvod").fill("Podle nakládky 38");
  await page.getByRole("button", { name: "Odeslat návrh" }).click();
  await expect(page.getByText("Čekáme, až partner náš návrh opravy přijme")).toBeVisible();

  // 5) admin B přijme
  await as(context, b.user.id);
  await page.goto(secondUrl.replace(/\?.*/, ""));
  await page.getByRole("button", { name: "Přijmout opravu" }).click();
  await expect(page.locator("[data-status=CONFIRMED]")).toBeVisible();
  await expect(page.getByTestId("movement-history")).toContainText("rozpor vyřešen dohodou");

  // 6) saldo: 40 + 38 = 78 – u A „Partner nám dluží“, u B „Dlužíme partnerovi“
  await page.goto("/balances");
  await expect(page.locator("tr[data-type=EUR]")).toContainText("Dlužíme partnerovi 78 ks");
  await as(context, a.user.id);
  await page.goto("/balances");
  await expect(page.locator("tr[data-type=EUR]")).toContainText("Partner nám dluží 78 ks");
  await page.goto("/dashboard");
  await expect(page.getByText("Partner nám dluží 78 ks")).toBeVisible();
});

test("M4: skladník nevidí zvláštní druhy pohybů; autor může zrušit navržený pohyb", async ({ page, context }) => {
  const a = await createCompanyWithUser("M4b A");
  const b = await createCompanyWithUser("M4b B");
  const aSklad = await addUser(a.company.id, "SKLAD");
  await createPackaging(a.company.id, "EUR", { name: "EUR paleta" });
  const p = await createPartnership(a.company.id, b.company.id, { name: "M4b B" });
  await as(context, aSklad.id);
  await page.goto("/movements/new");
  await expect(page.getByRole("radio", { name: "Ztráta" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Vrácení" })).toBeVisible();
  await recordIssue(page, p.id, "EUR paleta", 5, "DL-X");
  await page.getByRole("button", { name: /Zrušit pohyb/ }).click();
  await expect(page.locator("[data-status=CANCELLED]")).toBeVisible();
});
