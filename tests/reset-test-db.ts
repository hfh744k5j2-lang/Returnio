import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { loadTestEnv } from "./load-env";

/**
 * Připraví testovací databázi: aplikuje migrace a vyprázdní tabulky.
 * Pojistka: běží jen nad databází, jejíž název končí na "_test".
 */
export async function resetTestDb() {
  const env = { ...process.env, ...loadTestEnv() };
  const url = env.DATABASE_URL ?? "";
  if (!/\/[^/?]+_test(\?|$)/.test(url)) throw new Error(`Odmítám čistit databázi, která není testovací: ${url}`);
  execSync("npx prisma migrate deploy", { stdio: "pipe", env });
  const db = new PrismaClient({ datasources: { db: { url } } });
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
  await db.$disconnect();
}
