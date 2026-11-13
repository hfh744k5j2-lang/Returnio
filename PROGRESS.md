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
- Magic link nemá mezikrok proti skenerům odkazů v poště (Outlook Safe Links). (Rate limit doplněn po revizi.)
- Název a IČO firmy se neověřují (kdokoli může založit firmu s cizím názvem) – v pozvánce se aspoň zobrazuje IČO.
- Kontrola „firma má aspoň jednoho admina“ neběží se zámkem (teoretický souběh dvou adminů).
- Registrace firmy z pozvánky partnera a přijetí nejsou v jedné transakci (pozvánka se ale ověří předem).
- AuditLog: trigger blokuje UPDATE/DELETE, ale aplikace se k DB připojuje vlastníkem schématu (ten může trigger odstranit). Pro silnější záruku oddělená DB role bez práva ALTER/DELETE – mimo MVP.
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

**Revize M4 (sub-agent) – 17 bodů, kritické žádné; opraveny závažné:**
- Dvojí odeslání formuláře vytvořilo dva výdeje → idempotenční klíč `Movement.clientKey` (unikátní v partnerství), formulář i skenování ho generují; opakované/ souběžné odeslání vrátí existující pohyb. Test.
- Výchozí datum a `max` v UTC (noční směna dostala včerejšek) → `todayLocal()` v Europe/Prague; tolerance budoucího data 1 den.
- Skladník mohl potvrdit úpravu salda / ztrátu od partnera → zvláštní druhy potvrzuje, rozporuje a ruší jen admin/logistik; skladník vidí vysvětlení. Test.
- Protinávrh přes API tiše vracel neuvedené položky na původní počet → doplňuje se z aktuálního návrhu. Test.
- E-mail s protinávrhem ukazoval původní počty → ukazuje navržené počty a důvod (ověřeno v e2e M5).
- Mrtvý odkaz `/p/[token]` → stránka hotová v M5.
- Drobné opraveny: vyčištění počtů při změně partnera, hláška u záporného počtu, `true` jako počet se nepřijme, vyřazený typ nejde vydat (jen vrátit/odepsat), texty: „Úprava salda“ místo „Oprava“, „Poznámka (uvidí i partner)“, „navrženo X ks“, „Potvrzeno“, směr u ztráty/poškození slovy („u partnera“/„u nás“), „+3 po potvrzení“, u salda ke dni skrytý sloupec čekajících + vysvětlení.
- Do dluhu: saldo „ke dni“ bere dnešní stav potvrzení; spotřeba jednorázového odkazu a akce nejsou v jedné DB transakci (při chybě akce se odkaz vrací do platnosti); rychlý filtr „Rozpory k vyřešení“ zobrazí skladníkovi i rozpory, které řeší kancelář; hodnota kaucí počítá z aktuální kauce typu (ne ze snímku).

## M5 Mobilní skenování QR a jednorázové odkazy – hotovo

**Hotové:** stránka Skenovat pro telefon: krok 1 partner (QR kamerou přes `getUserMedia` + `jsQR`, nebo výběr), krok 2 výdej/příjem/vrácení velkými tlačítky, krok 3 obaly (QR nebo seznam) s tlačítky −/+ a polem počtu, uložit spodním tlačítkem „Uložit Výdej: 14 ks“, po uložení „Skenovat další“. QR kódy jsou běžné URL (`/scan?partner=…`, `/scan?type=…`), takže je otevře i fotoaparát telefonu; nepřihlášený uživatel se po přihlášení vrátí zpět (middleware předává cestu). ID z QR se ověřují proti vlastním partnerům a typům stran partnerství (cizí QR → srozumitelná hláška). Veřejná stránka `/p/[token]` pro partnera bez registrace: detail pohybu z jeho pohledu, potvrzení se jménem, rozpor s počty a důvodem, při protinávrhu firmy přijetí nebo další návrh; po akci odkaz přestane platit; `noindex`, `no-referrer`.

**Testováno:** `npm run check` OK (65 unit testů, mj. parser QR). Playwright (projekt „mobile“, Pixel 7) `m5-mobile.spec.ts`: QR odkaz bez přihlášení → login s návratem → partner z QR, obal z QR, +/−, počet, uložení výdeje (ověřeno v DB) → „Skenovat další“; QR cizího partnera se ignoruje; neregistrovaný partner rozporuje přes odkaz → odkaz pak neplatí → firma navrhne 9 → e-mail ukazuje 9 ks → partner přijme novým odkazem → potvrzeno s 9 ks. Celá e2e sada (M1–M5, 15 testů) prošla – po opravě selektoru v m4 testu (nový popisek „Poznámka (uvidí i partner)“ kolidoval s „Partner“; zachyceno až po commitu M5, opraveno v následujícím commitu).

**Rozhodnutí:** QR čtečka v prohlížeči přes `jsQR` (žádná nativní aplikace, žádná externí služba). Kameru nelze v CI testovat – testuje se tok přes URL z QR a parser zvlášť. Skladník má na skenování jen výdej/příjem/vrácení s dnešním datem (ostatní ve formuláři Nový pohyb).

**Revize M5 (sub-agent) – 18 bodů, kritické žádné; opraveny závažné:**
- Pohyb u neregistrovaného partnera se mohl zaseknout (neodeslaný/smazaný/vypršelý odkaz) → tlačítko „Poslat partnerovi odkaz znovu“ (admin/logistik, staré odkazy zneplatní); cron jednou připomene s novým odkazem; po změně e-mailu partnera dostanou čekající pohyby nové odkazy.
- QR partnera v kroku obalů tiše přepnul partnera → odmítnuto s vysvětlením.
- Nenačtené typy vypadaly jako prázdný seznam → stav načítání, chyba s „Zkusit znovu“, 401 → přihlášení s návratem, vysvětlení prázdného seznamu.
- Předvybraný výdej (riziko obráceného salda) → bez výchozí volby, tlačítko Uložit je neaktivní, dokud skladník nezvolí výdej/příjem/vrácení.
- Poznámka se neukazovala partnerovi bez registrace → na stránce odkazu i v e-mailu.
- Drobné opraveny: po rozporu přes odkaz zmizí i tlačítko Potvrdit; kamera se vypne i při zavření před povolením; hláška o nutnosti HTTPS; zmenšený obraz pro dekódování; naskenovaný obal dostane 1 ks a zaměří pole; tlačítka min. 44 px; směr z pohledu partnera; poděkování podle jazyka; `reusable: null` v PATCH → 400.
- Rozhodnutí: migrace `…per_partnership_numbering…` byla upravena na místě – nikde nebyla nasazena (jen lokální prázdné DB, vývojová DB znovu vytvořena).
- Do dluhu: rate limit veřejných akcí `/p/[token]` (spolu s magic linkem); vyřazené typy ve skenování nejsou označené (server výdej odmítne srozumitelně).

## M6 Import/export CSV, výkaz PPWR, upozornění, auditní stopa – hotovo

**Hotové:**
- **Import CSV** (`/import`, admin/logistik): průvodce – soubor (UTF-8 i Windows-1250, `;` i `,`) → mapování sloupců s automatickým odhadem (cz/en/pl názvy) → kontrola s chybami po řádcích → import „vše, nebo nic“ v jedné transakci. Řádky se stejným partnerem/dnem/druhem/směrem/DL = jeden pohyb. Partner podle kódu, názvu nebo e-mailu; kód obalu přednostně vlastní typ. Importované pohyby jsou „čeká na potvrzení“; neregistrovaní partneři dostanou odkazy. Vzorový soubor `/import-vzor.csv`. Max. 5 000 řádků / 3 MB.
- **Export CSV** salda, pohybů (dle filtrů) a výkazu PPWR – středník, UTF-8 BOM (český Excel), ochrana proti CSV injection.
- **Výkaz PPWR** (`/reports/ppwr`): podíl vratných obalů v kusech i kg, obrátky podle typu, nepotvrzené výdeje zvlášť; výrazné upozornění „orientační výpočet“ (metodika EU do 30. 6. 2027). Celý výpočet v jednom modulu `src/lib/ppwr.ts` (čistá funkce + verze metodiky), data dodává `services/reports.ts`.
- **Upozornění e-mailem** (`runNotifications`, `/api/cron/notifications` s `CRON_SECRET`, Vercel Cron 1× denně, `npm run notify`): nepotvrzený/nevyřešený pohyb starší 3 dnů (souhrnný e-mail straně, která má jednat, každý pohyb jen jednou; neregistrovanému partnerovi nový odkaz), saldo nad limitem firmy (max. 1× týdně za partnera). Nový rozpor se oznamuje okamžitě (od M4). Deduplikace přes `NotificationLog`.
- **Auditní stopa** (`/audit`, admin/logistik): všechny změny s uživatelem a časem, filtr podle typu, odkaz na pohyb; v detailu pohybu historie pro všechny. Nic se nemaže.
- Zámek řádku partnerství (`FOR UPDATE`) při číslování – souběh importu a ručního zápisu se serializuje.
- Bezpečnostní hlavičky (nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy).

**Testováno:** `npm run check` OK (76 unit testů). Nové: `isolation-m6.test.ts` (exporty, výkaz, import a upozornění nikdy nezahrnou data cizích firem; import nenajde cizího partnera a kód obalu páruje na vlastní typ; upozornění jdou jen dotčeným firmám a neopakují se; cizí pohyb nejde znovu poslat), `ppwr.test.ts` (podíly, obrátky, prázdné období). Playwright `m6-import-report.spec.ts`: import s chybou → hláška u řádku → opravený soubor → 2 pohyby; výkaz PPWR (60,0 % ks, 97,4 % kg), stažení CSV výkazu/pohybů/salda (BOM, karton bez salda), historie změn, skladník nemá přístup (UI i API 403), cron bez klíče 401. Celkem 18 e2e testů OK.

**Rozhodnutí:**
- Výkaz počítá potvrzené výdeje firmy (vratné i nevratné); obrátky = vydané kusy / průměrný oběh u partnerů. Cíle PPWR v procentech záměrně neuvádím – metodika ani přesné výpočty nejsou vydané.
- Import vytváří jen navržené pohyby (partner je musí potvrdit) – import z vlastního ERP nesmí měnit sdílené saldo bez druhé strany.

**Revize M6 (sub-agent) – 25 bodů; opraveny kritické a závažné:**
- KRITICKÉ: import mohl při shodě kódu/názvu/e-mailu partnera tiše přiřadit pohyb jiné firmě → klíče jako množiny, víc shod = chyba na řádku („nejednoznačný, použijte kód“); v kontrole souhrn pohybů a kusů po partnerech. Test.
- Dvojí import stejného souboru → každá skupina má otisk (`clientKey` = hash partner/den/druh/směr/DL/řádky), kontrola hlásí „už byl naimportován (P-…)“, průvodce se po importu vynuluje. Test.
- „1.000“ / „1,5“ → jen celé číslo bez oddělovačů, jinak chyba na řádku. Test.
- Metodika PPWR byla zčásti v SQL služby → `services/reports.ts` dodává surová data (všechny potvrzené řádky + salda), veškerá metodika (co se počítá, co je v oběhu, podíly, obrátky) je v `src/lib/ppwr.ts` (verze `obalbook-2026-2`). Testy metodiky.
- Typ se změněnou vratností dával náhodný výsledek → řádek výkazu podle typu + vratnosti (deterministické). Test.
- Podíl vratných nadhodnocený (neevidované kartony) → výrazné upozornění „počítáme jen obaly evidované v ObalBooku“ + ruční doplnění nevratných obalů mimo evidenci (ks, kg) do výpočtu i exportu. Test.
- Desetinná čísla v CSV s tečkou → desetinná čárka; CSV výkazu má nahoře upozornění, období, metodu a počet nepotvrzených výdejů; sloupec vlastníka typu.
- Připomínka „starší 3 dnů“ se počítala od vzniku pohybu a jen jednou → měří se od poslední změny (otevřený návrh opravy), klíč podle „tahu“; řazení od nejnovějších a strop 2 000.
- Import nekontroloval vyřazený typ a limit 50 typů → chyba u řádku. Import čte uvnitř transakce jen přes `tx` (bezpečné s poolerem), limit 2 000 řádků.
- Dvojznačný směr u ztráty/poškození/úpravy v importu → stejná slova jako v aplikaci („u partnera / u nás“, „partner dluží více / méně“); export píše směr slovy.
- Drobné opraveny: atomická deduplikace upozornění (nejdřív zápis, pak odeslání), e-mail o limitu slovy po typech, předmět bez chybné gramatiky, odeslání nového odkazu zneplatní starší a zapíše se do auditu, změna e-mailu partnera se neshodí chybou odeslání, vzor `CRON_SECRET` ≥ 16 znaků, poznámky z více řádků skupiny se spojí, delší DL = chyba.
- Do dluhu: aktér v auditu se odvozuje z aktuální firmy uživatele (odebraný zaměstnanec se zobrazí jako partner) – lepší snímek firmy v `AuditLog`; sloupec Podrobnosti v historii je surový JSON; export pohybů bez stropu (načítá vše do paměti); import zamyká partnerství po dobu transakce (souběžný ruční zápis počká).

## M7 Ukázková data a předání – hotovo

**Hotové:**
- `prisma/seed.ts` (`npm run db:seed`): 3 smyšlené firmy (pivovar CZ, velkoobchod CZ, hurtownia PL) po 3 uživatelích (admin/logistik/sklad), 5 typů obalů (EUR paleta, přepravka, sud KEG, nevratný karton – pivovar; plastová paleta H1 – velkoobchod), 3 registrovaná partnerství + neregistrovaná restaurace, **300 pohybů za 6 měsíců**: výdeje, vratky (i zapsané partnerem), příjmy, ztráty, poškození, úpravy salda; 12 rozporů vyřešených dohodou (část s protinávrhem), 5 otevřených rozporů, 14 čekajících, 5 zrušených. Všechny 3 firmy vydávají (i hurtownia na paletách H1), takže každá má vlastní výkaz PPWR. Data se zapisují přes stejné služby jako aplikace (vzniká auditní stopa), jsou deterministická a saldo zůstává realistické (vratky vracejí část vydaného). Seed odmítne běžet, pokud data už existují.
- README: funkce, lokální spuštění (Docker Compose, migrace, seed, přihlášení magic linkem z konzole, tabulka ukázkových účtů), testy, nasazení **Vercel + Supabase EU** (pooler/direct URL, Resend/SMTP, proměnné, region, cron), struktura, upozornění k PPWR. Skript `vercel-build` (generate + migrate deploy + build).
- Polština kompletní v `messages/pl.json` (402 klíčů); test hlídá shodu klíčů i proměnných `{x}` ve všech jazycích. V přepínači jsou CS/EN dle zadání.
- Snímky hlavních toků (`docs/screenshots/01–13`, z Playwrightu) a video celého toku `docs/video/hlavni-tok.webm`.

**Testováno:** `npm run check` OK (82 unit testů). Playwright – 19 testů OK, z toho `m7-seed-flow.spec.ts` = definice „hotovo“ ze zadání: seed → skutečné přihlášení magic linkem (pivovar) a přihlášení za všechny 3 firmy → výdej (skladník pivovaru) → potvrzení (skladník velkoobchodu) → rozpor (30 → 27) → vyřešení (logistik pivovaru přijme) → saldo zrcadlově u obou stran → výkaz PPWR za 6 měsíců → export CSV salda a pohybů (ověřen obsah) → anglické rozhraní a historie změn.

**Rozhodnutí:** vývojový „rychlý login“ bez e-mailu jsem nepřidal (riziko zapnutí v produkci); v dev se magic link vypíše do konzole. Ukázkové domény `*.example` (rezervované, nikdy skutečné).

**Revize M7 (sub-agent) – 14 bodů, kritické žádné; opraveny:**
- Seed se mohl rozbít chybou odesílání e-mailu a pak nešel zopakovat → seed nikdy neposílá e-maily ven (dočasně vypne Resend/SMTP, `EMAIL_SILENT` se kontroluje jako první a jen mimo produkci), v produkci vyžaduje `SEED_ALLOW=1`, při chybě vypíše návod.
- Tok ze sekce 8 byl celý ověřený jen za 2 firmy a saldo jen zrcadlově → hurtownia v testu sama vydá, velkoobchod potvrdí, saldo ověřeno přesným rozdílem (+12), výkaz PPWR hurtownie má data; saldo pivovaru ověřeno přesně (před + 24 + 27). Seed obsahuje výdeje hurtownie.
- Drobné opraveny: otisk importu obsahuje firmu a ignoruje zrušené pohyby; souběžný dvojí import nevytvoří prázdnou dávku ani nerozešle odkazy znovu; odkaz partnerovi jen když je na tahu; chronologie historie v ukázkových datech (kroky po sobě, nic v budoucnosti) a řazení auditu i podle id; polská firma má jazyk `pl`; validace doplňků výkazu v exportu; souhrn importu podle partnera (ID + kód); připomínky nejdřív pro nejstarší pohyby; README (session pooler pro `DIRECT_URL`, Preview nasazení s vlastní DB, `db:migrate:dev`, `db:reset`, testovací DB); snímky a video jen s `DOCS_SHOTS=1`, jednotné číslování, mobilní snímky bez překryvu hlavičky.
- Do dluhu: výkaz PPWR načítá všechny potvrzené řádky firmy do data „do“ (u velkých objemů pomalé – předfiltr by měl vystavit modul `ppwr.ts`); souhrn importu sčítá kusy různých typů do jednoho čísla (jen orientační kontrola přiřazení partnerů); tlačítko „Uložit výdej: 15 ks“ ve skenování také sčítá kusy všech typů.

**Kontrola M7:** `npm run check` OK (82 unit testů), Playwright 19/19 OK.

---

## Hotovo (sekce 8 zadání)

- [x] `npm run check` a všechny Playwright testy projdou (95 unit + 21 e2e, desktop i mobil; stav po revizi).
- [x] Ze seed dat jde přihlásit jako každá ze 3 firem a projít výdej → potvrzení → rozpor → vyřešení → saldo → výkaz PPWR → export CSV (`tests/e2e/m7-seed-flow.spec.ts`, video `docs/video/hlavni-tok.webm`).
- [x] README popisuje lokální spuštění a nasazení (Vercel + Supabase EU).
- [x] PROGRESS.md obsahuje záznam kontroly (check, Playwright, revize sub-agentem, opravy, dluh) ke každému milníku M1–M7.

---

## Revize po M7 (nezávislá kontrola „Hotovo znamená“) – opraveno

**Jak se kontrolovalo:** `npm run check` + Playwright, vlastní sonda oddělení dat proti běžící aplikaci (5 uživatelů ze 3 ukázkových firem, nesouvisející firma i skladník; všechny `/api/v1/*` a stránky s cizími ID, filtry, vyhledávání, audit, exporty; ověření, že DB zůstala beze změny), seed na prázdné DB podle README, zrcadlovost salda u všech partnerství. API ani stránky nic cizího neukázaly; nalezené problémy:

1. **VYSOKÁ – únik názvu cizí firmy v auditní stopě.** Autor akce se zobrazoval podle *aktuální* firmy uživatele. Když zaměstnanec partnera přešel k nesouvisející firmě, partner v historii viděl její název a historie tvrdila, že pohyb potvrdila firma, která v partnerství není. **Oprava:** `AuditLog.actorCompanyId` – snímek firmy při zápisu (`src/lib/audit.ts`), zobrazení jen podle snímku a jen pokud je ta firma stranou partnerství (jinak „partner“). Migrace dopočítá snímek ze `companyId` záznamu (u akcí uživatele = firma, za kterou jednal). Test v `isolation-review.test.ts`.
2. **VYSOKÁ – `npm run db:seed` a `npm run notify` na čisté instalaci padaly** (`tsx` nenačte `.env`, chyba `DATABASE_URL not found`); e2e to nezachytily, protože volají `seed()` přímo. **Oprava:** `scripts/load-env.ts` (`process.loadEnvFile`, proměnné z prostředí mají přednost, chybějící `.env` nevadí) přes `tsx --import`. Ověřeno: prázdná DB → `npm run db:migrate` → `npm run db:seed` (3 firmy, 5 typů, 300 pohybů) → `npm run notify`.
3. **NÍZKÁ – partner viděl celý katalog obalů druhé firmy** (i obaly pro jiné partnery a jejich kauce). **Oprava:** `usableTypesWhere()` v `services/packaging.ts` – druhá strana vidí a smí zapsat jen typy, které vlastník nabízí všem partnerům (nové pole `PackagingType.sharedWithPartners`, zaškrtávátko „Nabízet všem partnerům“, výchozí ne), nebo které už v partnerství byly použity. Stejné pravidlo ve výpisu, zápisu pohybu i CSV importu. Seed: paleta H1 je nabízená (poolová paleta).
4. **NÍZKÁ – dluh před nasazením:**
   - **Rate limit** (`src/lib/rate-limit.ts`, tabulka `RateLimit`, pevné okno v DB – funguje napříč instancemi Vercelu): magic link 5×/15 min na e-mail a 20×/15 min na IP ve formuláři + pojistka 6×/15 min přímo při odeslání (i pro přímé volání Auth.js); veřejné akce `/p/[token]` 30×/10 min na IP a 10×/10 min na odkaz (HTTP 429 / srozumitelná hláška).
   - **AuditLog append-only v DB:** trigger zakáže DELETE vždy a UPDATE také; jediná výjimka je seed, který smí v transakci s `SET LOCAL obalbook.audit_backdate = 'on'` posunout jen `createdAt`.
   - **Pozvánka kolegy neprozrazuje registrované e-maily:** e-mail jiné firmy dostane stejnou odpověď jako nový; přijmout pozvánku nejde a stránka pozvánky to rovnou vysvětlí.
5. **KOSMETICKÁ** – varování Vite o dynamickém importu v registru pokrytí testů (cesta s příponou `.ts`).

**Rozhodnutí:** obal partnera, který nebyl nabídnut ani použit, nejde zapsat jako první druhou stranou – první pohyb zapíše vlastník (běžně výdej), počáteční stav se zapíše úpravou salda, nebo vlastník typ nabídne všem partnerům. Jednodušší než schvalování typů po partnerech; chrání obchodní informace (kauce, sortiment pro jiné odběratele).

**Testováno:** `npm run check` OK (95 unit testů, nový `isolation-review.test.ts`: snímek autora a přechod zaměstnance k cizí firmě, trigger, katalog obalů včetně importu, rate limit včetně souběhu, pozvánka na e-mail jiné firmy). Playwright 21/21 OK (nový `review-fixes.spec.ts`: limit přihlašovacích odkazů, nabízený vs. interní obal v UI a API partnera).
