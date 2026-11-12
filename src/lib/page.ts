import { notFound } from "next/navigation";
import { AppError } from "./errors";

/** Pro stránky: cizí/neexistující záznam → stránka 404. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}
