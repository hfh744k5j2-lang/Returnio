/**
 * Načte .env pro CLI skripty spouštěné přes tsx (npm run db:seed, npm run notify).
 * Next.js a Prisma CLI si .env načítají samy, tsx ne. Proměnné, které už v prostředí jsou, mají přednost;
 * chybějící .env (Vercel, CI, proměnné zadané na příkazové řádce) nevadí.
 */
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
