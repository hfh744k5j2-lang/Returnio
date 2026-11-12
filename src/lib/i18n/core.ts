import cs from "../../../messages/cs.json";
import en from "../../../messages/en.json";
import pl from "../../../messages/pl.json";

/** Jazyky dostupné v přepínači. Polština je připravená v souborech, ale zatím ne v UI. */
export const UI_LOCALES = ["cs", "en"] as const;
export const ALL_LOCALES = ["cs", "en", "pl"] as const;
export type Locale = (typeof ALL_LOCALES)[number];

type Dict = { [k: string]: string | Dict };
export const DICTS: Record<Locale, Dict> = { cs, en, pl };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (ALL_LOCALES as readonly string[]).includes(v);
}

function lookup(dict: Dict, key: string): string | undefined {
  let cur: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    if (cur === undefined || typeof cur === "string") return undefined;
    cur = cur[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Překlad s náhradou {proměnných}. Chybějící klíč: jazyk → angličtina → čeština → klíč. */
export function makeT(locale: Locale): TFn {
  return (key, vars) => {
    const raw = lookup(DICTS[locale], key) ?? lookup(DICTS.en, key) ?? lookup(DICTS.cs, key) ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
  };
}

export function flattenKeys(dict: Dict, prefix = ""): string[] {
  return Object.entries(dict).flatMap(([k, v]) =>
    typeof v === "string" ? [prefix + k] : flattenKeys(v, `${prefix}${k}.`),
  );
}
