import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import { loadTestEnv } from "./load-env";

/**
 * Připraví čistou testovací databázi: zahodí schéma `public` a aplikuje všechny migrace.
 * Pojistka: běží jen nad databází, jejíž název končí na "_test".
 */
export async function resetTestDb() {
  const env = { ...process.env, ...loadTestEnv() };
  const url = env.DATABASE_URL ?? "";
  if (!/\/[^/?]+_test(\?|$)/.test(url)) throw new Error(`Odmítám čistit databázi, která není testovací: ${url}`);
  const db = new PrismaClient({ datasources: { db: { url } } });
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.$executeRawUnsafe(`CREATE SCHEMA public`);
  await db.$disconnect();
  try {
    execSync("npx prisma migrate deploy", { stdio: "pipe", env });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`migrate deploy selhal:\n${err.stdout?.toString()}\n${err.stderr?.toString()}`);
  }
}
