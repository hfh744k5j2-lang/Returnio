# Zadání: platforma pro vratné obaly mezi firmami (pracovní název ObalBook)

Tento soubor je zadání pro Claude Code. Ulož ho do prázdné složky projektu jako `CLAUDE.md`
a v Claude Code napiš: **„Přečti CLAUDE.md a postav projekt podle něj. Pracuj samostatně až do konce
milníku M7. Ptej se mě jen u věcí v sekci ‚Kdy se zeptat‘.“**

## 1. Co stavíme a proč

Firmy si posílají vratné obaly (palety, přepravky, boxy, IBC kontejnery). Každá firma vede saldo
obalů ve svém ERP nebo Excelu a čísla se mezi partnery nikdy neshodují. Od 1. 1. 2030 navíc
nařízení EU o obalech (PPWR, čl. 29–31) vyžaduje, aby firmy používaly vratné obaly v systému
opětovného použití a uměly vykázat jejich podíl.

ObalBook **nenahrazuje ERP**. Je to sdílená evidence mezi firmami: odesílatel zapíše výdej,
příjemce ho potvrdí nebo rozporuje, obě strany vidí stejné saldo a z dat vznikne výkaz.

Cílový zákazník: střední výrobci a distributoři v ČR, SK a PL (potraviny, nápoje, automotive,
chemie). Uživatelé: skladník (telefon), logistik (počítač), partnerská firma (portál).

## 2. Funkce MVP

1. **Firmy a uživatelé:** registrace firmy, pozvání kolegů, role `admin`, `logistik`, `sklad`.
2. **Partneři:** firma pozve partnera e-mailem. Partner se zaregistruje zdarma, nebo potvrzuje
   pohyby přes jednorázový odkaz bez registrace.
3. **Typy obalů:** název, kód, materiál, hmotnost, kauce v Kč/EUR, vratný ano/ne.
4. **Pohyby:** výdej, příjem, vrácení, ztráta, poškození, oprava. Každý pohyb má počty podle
   typu obalu, datum, číslo dodacího listu a stav `navržen → potvrzen / rozporován`.
5. **Potvrzení protistranou:** příjemce potvrdí, nebo rozporuje s opraveným počtem a důvodem.
   Rozpor se ukáže oběma stranám a lze ho vyřešit dohodou (obě strany schválí opravu).
6. **Saldo:** po partnerech a typech obalů, jen z potvrzených pohybů. Zvlášť „čeká na potvrzení“.
7. **Skenování v telefonu:** každý typ obalu a každý partner má QR kód. Skladník naskenuje,
   zadá počet a uloží výdej nebo příjem. Mobilní web, žádná aplikace z obchodu.
8. **Import a export:** CSV import pohybů z ERP (mapování sloupců), export salda a pohybů do CSV.
9. **Výkaz PPWR (orientační):** za zvolené období podíl vratných obalů na všech přepravních
   obalech (počet kusů i hmotnost) a počet obrátek podle typu. Výrazně označit, že jde
   o orientační výpočet, protože EU metodiku zatím nevydala (má ji vydat do 30. 6. 2027).
   Výpočet drž v jednom modulu, aby šel snadno vyměnit.
10. **Upozornění e-mailem:** nepotvrzený pohyb starší 3 dnů, nový rozpor, saldo nad limitem.
11. **Auditní stopa:** každá změna zapsaná s uživatelem a časem, nic se nemaže, jen opravuje.
12. **Čeština a angličtina** v rozhraní, polština připravená v souborech překladů.

Mimo MVP: RFID a IoT, fakturace kaucí, přímé napojení na konkrétní ERP, platby.

## 3. Technologie

- Next.js (App Router) + TypeScript, Tailwind.
- PostgreSQL přes Prisma. Lokálně Docker Compose, v produkci Supabase (region EU) nebo Neon EU.
- Přihlášení: e-mail a magic link (Auth.js nebo Supabase Auth).
- E-maily: Resend nebo SMTP přes proměnné prostředí, v dev režimu jen do konzole.
- Testy: Vitest (logika), Playwright (hlavní toky v prohlížeči).
- Každá firma vidí jen svá data a pohyby, kde je stranou. Oddělení dat řeš na úrovni dotazů
  i testů (viz M2).

## 4. Milníky

Po každém milníku proveď **kontrolu** (sekce 5) a výsledek zapiš do `PROGRESS.md`.

- **M1 Kostra:** projekt, databáze, přihlášení, firmy, role, CI skript `npm run check`
  (lint, typy, testy).
- **M2 Oddělení dat:** testy, že firma A nikdy nevidí data firmy B ani přes API. Tohle je
  nejdůležitější test celého projektu.
- **M3 Partneři a typy obalů.**
- **M4 Pohyby a potvrzování,** včetně rozporu a jeho vyřešení, saldo.
- **M5 Mobilní skenování QR** a jednorázové odkazy pro partnery bez registrace.
- **M6 Import/export CSV, výkaz PPWR, upozornění, auditní stopa.**
- **M7 Ukázková data a předání:** seed se 3 firmami, 5 typy obalů a 300 pohyby za 6 měsíců
  včetně rozporů. README s návodem na spuštění a nasazení. Krátké video nebo snímky hlavních
  toků z Playwrightu.

## 5. Kontrola po každém milníku (povinná)

1. Spusť `npm run check`. Dokud neprojde, nepokračuj.
2. Spusť Playwright test toků daného milníku.
3. Spusť samostatného revizního sub-agenta s pokynem: „Jsi přísný reviewer. Projdi změny
   od posledního milníku proti CLAUDE.md. Hledej: únik dat mezi firmami, chybějící validace,
   chyby v saldu a výkazu, nedokončené funkce, texty v UI, které nejsou srozumitelné pro skladníka.
   Vrať seznam problémů seřazený podle závažnosti.“
4. Oprav všechny závažné problémy, ostatní zapiš do `PROGRESS.md` jako dluh.
5. Do `PROGRESS.md` zapiš: co je hotové, co se testovalo, nalezené problémy, rozhodnutí.

Každých zhruba 10 větších změn si znovu přečti tento soubor, ať se neodchýlíš od zadání.

## 6. Pravidla

- Nepoužívej žádná skutečná data firem. Ukázková data jsou smyšlená.
- Nepřidávej placené služby ani nevytvářej účty třetích stran. Vše přes proměnné prostředí
  s příkladem v `.env.example`.
- Žádná tajemství v kódu ani v gitu.
- Malé commity s jasným popisem po každé ucelené změně.
- Při nejasnosti zvol jednodušší řešení a zapiš ho do `PROGRESS.md` jako rozhodnutí.

## 7. Kdy se zeptat

Zeptej se mě pouze, když:
- je potřeba vytvořit účet, zadat platební údaje nebo API klíč,
- by změna šla proti tomuto zadání,
- test oddělení dat (M2) nejde opravit.

Jinak pracuj samostatně a rozhoduj sám podle tohoto zadání.

## 8. Hotovo znamená

- `npm run check` a všechny Playwright testy projdou.
- Ze seed dat jde přihlásit jako každá ze 3 firem a projít: výdej → potvrzení → rozpor →
  vyřešení → saldo → výkaz PPWR → export CSV.
- README popisuje spuštění lokálně a nasazení (Vercel + Supabase EU).
- `PROGRESS.md` obsahuje záznam kontroly ke každému milníku.
