import { resetTestDb } from "../reset-test-db";

/** Před unit/integračními testy: migrace + prázdná testovací databáze. */
export default async function setup() {
  await resetTestDb();
}
