"use client";
import { createContext, useContext, useMemo } from "react";
import { makeT, type Locale, type TFn } from "./core";

const Ctx = createContext<{ locale: Locale; t: TFn }>({ locale: "cs", t: makeT("cs") });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT() {
  return useContext(Ctx);
}
