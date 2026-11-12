import type { TFn } from "@/lib/i18n/core";

const COLORS: Record<string, string> = {
  PROPOSED: "bg-amber-100 text-amber-900",
  CONFIRMED: "bg-green-100 text-green-800",
  DISPUTED: "bg-red-100 text-red-800",
  CANCELLED: "bg-slate-200 text-slate-600",
};

export function StatusBadge({ status, t }: { status: string; t: TFn }) {
  return <span className={`badge ${COLORS[status] ?? ""}`} data-status={status}>{t(`status.${status}`)}</span>;
}
