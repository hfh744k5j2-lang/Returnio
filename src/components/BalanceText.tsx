import type { TFn } from "@/lib/i18n/core";

/** Saldo slovy – srozumitelné i bez znalosti znamének. */
export function balanceText(t: TFn, n: number) {
  if (n > 0) return t("balances.partnerOwes", { n });
  if (n < 0) return t("balances.weOwe", { n: -n });
  return t("balances.settled");
}

export function BalanceCell({ t, n }: { t: TFn; n: number }) {
  const tone = n > 0 ? "text-brand-700" : n < 0 ? "text-red-700" : "text-slate-500";
  return (
    <span className={`font-semibold ${tone}`} data-balance={n}>
      {balanceText(t, n)}
    </span>
  );
}
