import { cookies } from "next/headers";
import { isLocale, makeT, type Locale } from "./core";

export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get("locale")?.value;
  return isLocale(c) ? c : "cs";
}

export async function getT() {
  const locale = await getLocale();
  return { t: makeT(locale), locale };
}
