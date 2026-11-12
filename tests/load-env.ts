import { readFileSync } from "fs";

/** Načte proměnné z .env.test (testovací databáze). */
export function loadTestEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.test", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
