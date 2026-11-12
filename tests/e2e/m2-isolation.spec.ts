/**
 * M2 – oddělení dat přes HTTP: firma A nesmí přes API ani stránky získat nebo změnit data firem C/D.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createCompanyWithUser, createPackaging, createPartnership, db, loginAs } from "./helpers";

type Fixture = Awaited<ReturnType<typeof setup>>;

async function setup() {
  const a = await createCompanyWithUser("Iso A");
  const b = await createCompanyWithUser("Iso B");
  const c = await createCompanyWithUser("Iso C");
  const d = await createCompanyWithUser("Iso D");
  const pAB = await createPartnership(a.company.id, b.company.id);
  const pCD = await createPartnership(c.company.id, d.company.id);
  const tA = await createPackaging(a.company.id, "ISOA");
  const tC = await createPackaging(c.company.id, "ISOC");
  let seq = 0;
  const mk = (partnershipId: string, typeId: string, status: "PROPOSED" | "CONFIRMED" | "DISPUTED") =>
    db.movement.create({
      data: {
        partnershipId,
        number: ++seq,
        kind: "ISSUE",
        createdBySide: "A",
        fromSide: "A",
        date: new Date(),
        status,
        deliveryNote: partnershipId === pCD.id ? "DL-SECRET-CD" : "DL-AB",
        lines: { create: [{ packagingTypeId: typeId, quantity: 9, weightKg: 25, reusable: true, finalQuantity: status === "CONFIRMED" ? 9 : null }] },
      },
    });
  const mAB = await mk(pAB.id, tA.id, "CONFIRMED");
  const mCD = await mk(pCD.id, tC.id, "PROPOSED");
  const mCD2 = await mk(pCD.id, tC.id, "CONFIRMED");
  await db.auditLog.create({ data: { companyId: c.company.id, partnershipId: pCD.id, action: "secret", entityType: "Movement", entityId: mCD.id } });
  return { a, b, c, d, pAB, pCD, tA, tC, mAB, mCD, mCD2 };
}

let f: Fixture;
test.beforeAll(async () => {
  f = await setup();
});

const forbiddenIds = () => [f.c.company.id, f.d.company.id, f.pCD.id, f.tC.id, f.mCD.id, f.mCD2.id, "DL-SECRET-CD", "Iso C", "Iso D"];

async function expectNoForeign(req: APIRequestContext, url: string) {
  const res = await req.get(url);
  expect(res.status(), url).toBe(200);
  const body = await res.text();
  for (const id of forbiddenIds()) expect(body, `${url} obsahuje ${id}`).not.toContain(id);
}

const JSON_HEADERS = { "content-type": "application/json" };

test("M2: seznamy přes API neobsahují cizí data", async ({ context }) => {
  await loginAs(context, f.a.user.id);
  const req = context.request;
  for (const url of [
    "/api/v1/me",
    "/api/v1/partners",
    "/api/v1/packaging-types?all=1",
    "/api/v1/movements",
    `/api/v1/movements?partner=${f.pCD.id}`,
    "/api/v1/movements?q=DL-SECRET-CD",
    "/api/v1/movements?status=PROPOSED",
    "/api/v1/balances",
    `/api/v1/balances?partner=${f.pCD.id}`,
    "/api/v1/audit",
    `/api/v1/audit?entityId=${f.mCD.id}`,
    `/api/v1/partners/${f.pAB.id}`,
    `/api/v1/movements/${f.mAB.id}`,
  ]) {
    await expectNoForeign(req, url);
  }
  // vlastní data naopak vidět jsou
  const mv = await (await req.get("/api/v1/movements")).json();
  expect(mv.items.map((m: { id: string }) => m.id)).toEqual([f.mAB.id]);
});

test("M2: cizí záznamy přes API vrací 404 a nic se nezmění", async ({ context }) => {
  await loginAs(context, f.a.user.id);
  const req = context.request;
  for (const url of [`/api/v1/partners/${f.pCD.id}`, `/api/v1/packaging-types/${f.tC.id}`, `/api/v1/movements/${f.mCD.id}`]) {
    expect((await req.get(url)).status(), url).toBe(404);
  }
  for (const action of ["confirm", "dispute", "accept", "counter", "cancel"]) {
    const res = await req.post(`/api/v1/movements/${f.mCD.id}/${action}`, {
      headers: JSON_HEADERS,
      data: { reason: "hack", lines: [{ packagingTypeId: f.tC.id, quantity: 0 }] },
    });
    expect(res.status(), action).toBe(404);
  }
  expect((await req.patch(`/api/v1/packaging-types/${f.tC.id}`, { headers: JSON_HEADERS, data: { name: "Hack", code: "ISOC", weightKg: 1, reusable: true } })).status()).toBe(404);
  expect((await req.patch(`/api/v1/partners/${f.pCD.id}`, { headers: JSON_HEADERS, data: { code: "HACK" } })).status()).toBe(404);
  const create = await req.post("/api/v1/movements", {
    headers: JSON_HEADERS,
    data: { partnershipId: f.pCD.id, kind: "ISSUE", date: new Date().toISOString().slice(0, 10), lines: [{ packagingTypeId: f.tA.id, quantity: 1 }] },
  });
  expect(create.status()).toBe(404);
  const foreignType = await req.post("/api/v1/movements", {
    headers: JSON_HEADERS,
    data: { partnershipId: f.pAB.id, kind: "ISSUE", date: new Date().toISOString().slice(0, 10), lines: [{ packagingTypeId: f.tC.id, quantity: 1 }] },
  });
  expect(foreignType.status()).toBe(400);

  const m = await db.movement.findUniqueOrThrow({ where: { id: f.mCD.id } });
  expect(m.status).toBe("PROPOSED");
  expect((await db.packagingType.findUniqueOrThrow({ where: { id: f.tC.id } })).name).not.toBe("Hack");
  expect(await db.movement.count({ where: { partnershipId: f.pCD.id } })).toBe(2);
});

test("M2: bez přihlášení API vrací 401", async ({ request }) => {
  for (const url of ["/api/v1/me", "/api/v1/partners", "/api/v1/packaging-types", "/api/v1/movements", "/api/v1/balances", "/api/v1/audit", `/api/v1/movements/${f.mCD.id}`]) {
    expect((await request.get(url)).status(), url).toBe(401);
  }
  expect((await request.post(`/api/v1/movements/${f.mCD.id}/confirm`, { headers: JSON_HEADERS, data: {} })).status()).toBe(401);
});

test("M2: zápis přes API vyžaduje JSON a stejný původ (CSRF)", async ({ context }) => {
  await loginAs(context, f.b.user.id);
  const req = context.request;
  const form = await req.post(`/api/v1/movements/${f.mAB.id}/confirm`, { form: { a: "1" } });
  expect(form.status()).toBe(400);
  const evil = await req.post(`/api/v1/movements/${f.mAB.id}/confirm`, { headers: { ...JSON_HEADERS, origin: "https://evil.example.com" }, data: {} });
  expect(evil.status()).toBe(403);
});

test("M2: neplatné parametry vrací 400, ne 500", async ({ context }) => {
  await loginAs(context, f.a.user.id);
  expect((await context.request.get("/api/v1/balances?asOf=nesmysl")).status()).toBe(400);
  expect((await context.request.get("/api/v1/movements?status=HACK")).status()).toBe(400);
});

test("M2: stránky s cizím ID vrací 404 a neukážou cizí data", async ({ page, context }) => {
  await loginAs(context, f.a.user.id);
  for (const url of [`/movements/${f.mCD.id}`, `/partners/${f.pCD.id}`, `/packaging/${f.tC.id}`]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(404);
    await expect(page.getByText("Stránka nenalezena")).toBeVisible();
  }
  for (const url of ["/movements", "/balances", "/partners", "/dashboard", `/movements?partner=${f.pCD.id}`, `/balances?partner=${f.pCD.id}`]) {
    await page.goto(url);
    // viditelný obsah + odkazy (ID v URL dotazu je vlastní vstup útočníka, ne únik)
    const text = await page.locator("main").innerText();
    const hrefs = (await page.locator("main a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).pathname))).join(" ");
    for (const id of forbiddenIds()) {
      expect(text, `${url} obsahuje ${id}`).not.toContain(id);
      expect(hrefs, `${url} odkazuje na ${id}`).not.toContain(id);
    }
  }
});
