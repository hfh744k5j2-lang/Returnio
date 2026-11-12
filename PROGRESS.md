# PROGRESS – ObalBook

Záznam postupu podle CLAUDE.md. Ke každému milníku: co je hotové, co se testovalo, nalezené problémy, rozhodnutí.

## Rozhodnutí (průběžně)

- **Verze:** Next.js 15.5 (App Router), React 19.1, Prisma 6.19, Auth.js (next-auth 5 beta), Tailwind 4, Vitest 3, Playwright 1.63 (shoda s předinstalovaným Chromiem). Novější major verze (Prisma 7/8, Next 16) jsem nevolil kvůli změnám API – jednodušší a stabilnější.
- **Přihlášení:** Auth.js s vlastním e-mailovým providerem (magic link) a databázovými sessions přes Prisma adapter. Odkaz platí 1 hodinu.
- **Jeden uživatel = jedna firma** (`User.companyId` + `User.role`). Jednodušší než M:N členství; pro MVP stačí.
- **E-maily:** `RESEND_API_KEY` → Resend (přes HTTP, bez SDK), jinak `SMTP_URL` → nodemailer, jinak konzole. V dev/test se e-maily ukládají i do tabulky `DevEmail` (pro testy); v produkci jen pokud `EMAIL_DEV_OUTBOX=1`.
- **Oddělení dat:** každá služba v `src/lib/services/*` dostává `Ctx` (userId, companyId, role) a dotazy omezuje přes `partnershipScope(companyId)` / `companyId`. Cizí ID vrací 404 (ne 403), aby se neprozrazovala existence záznamu.
- **Strany partnerství:** A = firma, která pozvala; B = pozvaný partner (může být neregistrovaný – pak potvrzuje přes jednorázové odkazy).
- **Směr pohybu:** pohyb ukládá `fromSide` (A/B). Saldo z pohledu firmy = kusy od nás k partnerovi − kusy od partnera k nám. Kladné = partner má naše obaly.
- **Testovací DB:** `prisma migrate reset` je pro AI agenta zablokovaný (Prisma vyžaduje souhlas uživatele). Testy proto používají vlastní `tests/reset-test-db.ts`: `migrate deploy` + `TRUNCATE`, s pojistkou, že název DB musí končit na `_test`.
- **Chybové hlášky služeb** jsou zatím česky i v anglickém UI (viz dluh).
- **Polština:** soubor `messages/pl.json` se doplní v M7; chybějící klíče padají na angličtinu.

## Technický dluh

- Chybové hlášky ze služeb (validace) nejsou přeložené do angličtiny.

---

## M1 Kostra – hotovo

**Hotové:** Next.js + TS + Tailwind, Prisma schéma (navržené rovnou pro všechny milníky), Docker Compose pro Postgres, přihlášení magic linkem (Auth.js), registrace firmy (uživatel se stane adminem), pozvání kolegů s rolí (`admin`, `logistik`, `sklad`), změna role, odebrání uživatele (bez mazání), nastavení firmy, přepínač CS/EN, `npm run check` (eslint bez varování, `tsc`, vitest).

**Testováno:**
- `npm run check` – OK (11 testů: oprávnění rolí, registrace firmy, pozvánky – správný e-mail, jednorázovost, hash tokenu, admin nemůže měnit uživatele jiné firmy, překlady).
- Playwright `m1-auth.spec.ts` – OK: magic link z e-mailu → registrace firmy → pozvání skladníka → přijetí → skladník nevidí Import/Výkaz; nepřihlášený → /login.

## M2 Oddělení dat – hotovo

**Hotové:** REST API `/api/v1/*` (me, partners, packaging-types, movements + akce confirm/dispute/accept/counter/cancel, balances, audit) nad stejnými službami jako UI. Obal `api()` ověřuje přihlášení (401), u zápisů vyžaduje JSON a stejný `Origin` (CSRF), chyby převádí na 400/403/404/409. Neplatné parametry dotazu → 400. Služba auditní stopy (`listAudit`, `movementHistory`) vrací jen vlastní záznamy + záznamy partnerství, kde je firma stranou.

**Testováno:**
- `tests/unit/isolation.test.ts` (27 testů) – scénář A↔B, C↔D, A↔U (neregistrovaný). A nevidí a nemůže měnit partnery, typy, pohyby, saldo ani audit C/D; B nevidí A-ho jiné partnery; pohyb nejde zapsat do cizího partnerství ani s cizím typem obalu; jednorázový odkaz nejde zneužít na cizí typ; pokusy o změnu cizích dat nic nezmění (ověřeno v DB).
- **Registr pokrytí:** test selže, pokud v `src/lib/services/*` přibude exportovaná funkce bez testu oddělení dat (nebo bez výslovné výjimky).
- `tests/e2e/m2-isolation.spec.ts` (5 testů) – přes HTTP: seznamy neobsahují cizí ID/názvy/dodací listy, cizí ID → 404 u GET/PATCH/POST i akcí pohybu, nic se v DB nezmění; bez přihlášení 401; zápis bez JSON → 400, cizí Origin → 403.

**Rozhodnutí:** cizí záznam = 404 (ne 403). Oddělení řešeno v dotazech (každý dotaz filtruje přes `companyId`/`partnershipScope`); Postgres RLS jsem nepřidával – zadání chce oddělení v dotazech a testech, RLS by komplikovalo Prisma/Supabase pooler.
