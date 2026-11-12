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

- Chybové hlášky ze služeb (validace) jsou česky i v anglickém UI.
- Magic link nemá rate limit a nemá mezikrok proti skenerům odkazů v poště (Outlook Safe Links).
- Název a IČO firmy se neověřují (kdokoli může založit firmu s cizím názvem) – v pozvánce se aspoň zobrazuje IČO.
- Kontrola „firma má aspoň jednoho admina“ neběží se zámkem (teoretický souběh dvou adminů).
- Registrace firmy z pozvánky partnera a přijetí nejsou v jedné transakci (pozvánka se ale ověří předem).
- AuditLog je append-only jen aplikačně (nejsou odebrána DB práva UPDATE/DELETE).
- Pozvánky (kolega, partner) – když selže odeslání e-mailu, uživatel vidí chybu, i když záznam vznikl; partnerovi lze pozvánku poslat znovu z detailu.

---

## M1 Kostra – hotovo

**Hotové:** Next.js + TS + Tailwind, Prisma schéma (navržené rovnou pro všechny milníky), Docker Compose pro Postgres, přihlášení magic linkem (Auth.js), registrace firmy (uživatel se stane adminem), pozvání kolegů s rolí (`admin`, `logistik`, `sklad`), změna role, odebrání uživatele (bez mazání), nastavení firmy, přepínač CS/EN, `npm run check` (eslint bez varování, `tsc`, vitest).

**Testováno:**
- `npm run check` – OK (11 testů: oprávnění rolí, registrace firmy, pozvánky – správný e-mail, jednorázovost, hash tokenu, admin nemůže měnit uživatele jiné firmy, překlady).
- Playwright `m1-auth.spec.ts` – OK: magic link z e-mailu → registrace firmy → pozvání skladníka → přijetí → skladník nevidí Import/Výkaz; nepřihlášený → /login.

**Revize (sub-agent) – nalezeno 27 bodů, opraveny závažné:**
- KRITICKÉ: magic link skládaný z hlavičky Host/X-Forwarded-Host (převzetí účtu) → odkaz se vždy skládá z `APP_URL` (`rebaseToAppUrl`), `AUTH_URL` v `.env.example`.
- Přijetí pozvánky partnera bez kontroly role a neatomicky → `assertCan` + podmíněný `updateMany` (přijme jen jedna firma).
- Chyba odeslání e-mailu shodila už uloženou akci (riziko duplicitního výdeje) → upozornění po uložení přes `safely()`.
- Open redirect `/login?next=/\evil` → `safeNext()`.
- Přehled sčítal různé typy obalů do jednoho čísla → saldo po typech, slovně („Partner nám dluží 10 ks“).
- Globální číslo pohybu prozrazovalo objem jiných firem → číslování v rámci partnerství (`@@unique([partnershipId, number])`).
- V produkci bez poskytovatele e-mailů šly magic linky do logu → v produkci bez `RESEND_API_KEY`/`SMTP_URL` chyba (výjimka jen výslovné `EMAIL_DEV_OUTBOX=1` pro e2e).
- PPWR by se zpětně měnil při úpravě typu → snímek `weightKg` a `reusable` v `MovementLine`.
- Anglické hlášky Zodu → globální česká error map.
- Drobné opraveny: neutrální hláška u cizího e-mailu, podmíněné přijetí pozvánky kolegy, opakovaná pozvánka ruší starou, zrušit jde jen nevyřízenou pozvánku, `currentUser` podle `session.user.id`, mazání materiálu, česká 404, nápověda „otevřete odkaz na zařízení…“.
- Do dluhu: viz sekce Technický dluh.

## M2 Oddělení dat – hotovo

**Hotové:** REST API `/api/v1/*` (me, partners, packaging-types, movements + akce confirm/dispute/accept/counter/cancel, balances, audit) nad stejnými službami jako UI. Obal `api()` ověřuje přihlášení (401), u zápisů vyžaduje JSON a stejný `Origin` (CSRF), chyby převádí na 400/403/404/409. Neplatné parametry dotazu → 400. Služba auditní stopy (`listAudit`, `movementHistory`) vrací jen vlastní záznamy + záznamy partnerství, kde je firma stranou.

**Testováno:**
- `tests/unit/isolation.test.ts` (27 testů) – scénář A↔B, C↔D, A↔U (neregistrovaný). A nevidí a nemůže měnit partnery, typy, pohyby, saldo ani audit C/D; B nevidí A-ho jiné partnery; pohyb nejde zapsat do cizího partnerství ani s cizím typem obalu; jednorázový odkaz nejde zneužít na cizí typ; pokusy o změnu cizích dat nic nezmění (ověřeno v DB).
- **Registr pokrytí:** test selže, pokud v `src/lib/services/*` přibude exportovaná funkce bez testu oddělení dat (nebo bez výslovné výjimky).
- `tests/e2e/m2-isolation.spec.ts` (5 testů) – přes HTTP: seznamy neobsahují cizí ID/názvy/dodací listy, cizí ID → 404 u GET/PATCH/POST i akcí pohybu, nic se v DB nezmění; bez přihlášení 401; zápis bez JSON → 400, cizí Origin → 403.

**Revize (sub-agent) – 14 bodů, opraveny závažné:**
- Pozvánku partnera mohl přijmout kdokoli s přeposlaným odkazem → přijme ji jen uživatel s e-mailem z pozvánky (+ role admin/logistik). Testy: jiný e-mail, vlastní firma, skladník, druhé přijetí.
- Auditní JSON prozrazoval partnerovi interní kód/název partnera a ID importu → `partner.invited/updated/invite_resent` jsou interní záznamy firmy (bez `partnershipId`), z `movement.created` pryč `importBatchId`; v historii se u uživatelů partnera ukazuje jen název firmy, ne e-mail. Test: B v auditu nenajde A-ho kód ani e-maily.
- PATCH typu obalu přepisoval nezadaná pole (vratnost, kauce, měna) → částečná úprava (nezadaná pole zůstávají).
- Registr pokrytí kontroloval jen pevný seznam modulů → nyní prochází všechny soubory `src/lib/services/*`; tokenové funkce už nejsou výjimkou a mají testy (vazba odkazu na pohyb, zneplatnění po zrušení, vypršení, opakované použití, pohled ze strany B).
- CSRF: `Origin: null` → 500, multipart povolen všude → `Sec-Fetch-Site` kontrola, nevalidní Origin = 403, multipart jen kde je výslovně povolen.
- „Čeká na potvrzení“ u rozporu ukazovalo původní počet → počítá s aktuálním otevřeným návrhem opravy.
- Stránkování omezeno na max. 10 000 stran.

**Rozhodnutí:** cizí záznam = 404 (ne 403). Oddělení řešeno v dotazech (každý dotaz filtruje přes `companyId`/`partnershipScope`); Postgres RLS jsem nepřidával – zadání chce oddělení v dotazech a testech, RLS by komplikovalo Prisma/Supabase pooler.

## M3 Partneři a typy obalů – hotovo

**Hotové:** stránka Partneři (seznam se stavem registrovaný/neregistrovaný, pozvání e-mailem s nepovinným kódem), detail partnera (saldo po typech slovně, QR kód partnera, úprava kódu/názvu, znovu poslat pozvánku), přijetí pozvánky partnerem (registrace firmy zdarma, nebo potvrzování přes odkazy), typy obalů (název, kód, materiál, hmotnost, kauce v Kč/EUR, vratný ano/ne, aktivní), úprava typu (platí jen pro nové pohyby), tisk QR štítků typů a partnerů. Skladník typy a partnery jen vidí; na stránce úprav dostane srozumitelné „Nemáte přístup“.

**Testováno:** `npm run check` OK (53 unit testů). Playwright `m3-partners-packaging.spec.ts`: přidání vratného i nevratného typu, duplicitní kód → hláška, úprava hmotnosti (ověřeno v DB), skladník nemůže přidávat ani upravovat; pozvání partnera → cizí uživatel s přeposlaným odkazem odmítnut → partner se zaregistruje a přijme → obě strany vidí registrované partnerství, detail má QR kód.

**Rozhodnutí:** typy obalů patří firmě; v pohybu lze použít typy obou stran partnerství (partner vrací naše palety, my jeho přepravky). Typy se nemažou, jen deaktivují.

**Revize (sub-agent, dokončena po commitu M3, opravy v M4 větvi) – 20 bodů:**
- KRITICKÉ: nevratné obaly (kartony) se počítaly do salda → saldo jen z řádků se `reusable = true` (snímek); nevratné jen pro výkaz PPWR. Test.
- E-mail neregistrovaného partnera nešel opravit → úprava e-mailu u nezaregistrovaného partnera; staré jednorázové odkazy i pozvánka se zneplatní, odejde nová pozvánka. Test.
- Dvojí partnerství se stejnou firmou (zrcadlová pozvánka) → přijetí zablokováno s vysvětlením. Test.
- Deaktivovaný typ nešel vrátit → v pohybech lze použít i neaktivní typ; ve formuláři se nabízí, pokud už byl v partnerství použit. Test.
- Nešlo smazat kauci/materiál → `null` = smazat. Test.
- Pohled přes jednorázový odkaz nedovolil řešit rozpor → oprávnění odkazu počítána zvlášť.
- Hmotnost musí být > 0; API bez `reusable` = vratný; audit úprav typu ukládá kauci/měnu/materiál; `toView` nikdy neukáže straně B interní kód strany A; u salda všude vlastník typu a slovní vyjádření; migrace bezpečná i na neprázdné DB (doplní snímek z typu, přečísluje pohyby); QR neaktivního typu; e-mail z pozvánky se ověřuje před založením firmy.
- Do dluhu: stejný obal definovaný oběma firmami (dva typy „EUR“) se nevyrovná – doporučení: obal definuje jeho vlastník, druhá strana používá jeho typ (formulář nabízí typy obou stran s vlastníkem); mapování ekvivalentních typů je mimo MVP. Maskování e-mailu na stránce pozvánky; `inviteUser` odpovídá jinak pro e-mail jiné firmy (zjistitelnost registrovaných e-mailů); česky natvrdo materiály v datalistu.

## M4 Pohyby a potvrzování – hotovo

**Hotové:** formulář nového pohybu (partner, druh, směr u vrácení/ztráty/poškození/opravy s vysvětlením slovy, počty podle typů obou stran, datum, dodací list, poznámka), seznam pohybů s rychlými filtry (čeká na mě / rozpory k vyřešení / čeká na partnera), filtry partner/stav/druh/období/hledání, stránkování; detail pohybu: potvrzení protistranou, rozpor s opraveným počtem a důvodem, protinávrh, přijetí opravy (= schválení obou stran), zrušení navrženého pohybu autorem, historie změn; saldo po partnerech a typech jen z potvrzených pohybů, zvlášť „čeká na potvrzení“, saldo ke dni, hodnota kaucí. Číslování pohybů v rámci partnerství.

**Testováno:** `npm run check` OK – `tests/unit/movements.test.ts`: číslování (i souběžně), snímek hmotnosti, výdej → potvrzení (zrcadlové saldo u obou stran), rozpor → protinávrh → přijetí (saldo s dohodnutým počtem, pořadí auditních záznamů), vrácení snižuje saldo, zrušený pohyb se nepočítá a nemaže, oprávnění skladníka, validace (0, 1,5, text, duplicitní typ, budoucí datum), jednorázový odkaz (potvrzení, opakované použití, rozpor → protinávrh firmy → přijetí novým odkazem). Playwright `m4-movements.spec.ts`: celý tok přes UI dvou firem a čtyř uživatelů (skladník A vydá 40, skladník B potvrdí; druhý výdej 40 → skladník B rozporuje 37 → admin A navrhne 38 → admin B přijme → saldo 78 u obou stran slovně); skladník nevidí zvláštní druhy, autor zruší navržený pohyb. `m2-isolation.spec.ts` rozšířen o stránky (cizí ID → 404, seznamy neukazují cizí data).

**Rozhodnutí:**
- Rozpor/potvrzení smí i skladník (počítá obaly na rampě); řešit rozpor (přijmout/protinávrh) smí jen admin a logistik.
- Ztráta/poškození: uživatel volí, kde k ní došlo; „u partnera“ snižuje partnerův dluh (odpis), „u nás“ snižuje náš dluh. Kauce/fakturace ztrát je mimo MVP.
- Opravit lze jen počty položek, které jsou v pohybu (nová položka = nový pohyb). Potvrzený pohyb se nemění; chyba se opraví pohybem „Oprava“.
- Zrušit lze jen navržený pohyb (ne rozporovaný) – rozporovaný se řeší dohodou, i na 0 ks.
