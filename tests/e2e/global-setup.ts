import { resetTestDb } from "../reset-test-db";

/** Čistá testovací databáze před každým během e2e testů. */
export default async function setup() {
  await resetTestDb();
}
