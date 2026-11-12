import type { TFn } from "@/lib/i18n/core";

type Defaults = {
  name?: string;
  code?: string;
  material?: string | null;
  weightKg?: string;
  deposit?: string | null;
  currency?: string;
  reusable?: boolean;
  active?: boolean;
};

export function PackagingFields({ t, d, showActive }: { t: TFn; d?: Defaults; showActive?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="pk-name">{t("packaging.name")}</label>
        <input id="pk-name" name="name" required className="input" defaultValue={d?.name} placeholder={t("packaging.namePlaceholder")} />
      </div>
      <div>
        <label className="label" htmlFor="pk-code">{t("packaging.code")}</label>
        <input id="pk-code" name="code" required maxLength={20} className="input font-mono uppercase" defaultValue={d?.code} placeholder="EUR" />
      </div>
      <div>
        <label className="label" htmlFor="pk-material">{t("packaging.material")}</label>
        <input id="pk-material" name="material" className="input" defaultValue={d?.material ?? ""} placeholder={t("packaging.materialPlaceholder")} list="materials" />
        <datalist id="materials">
          {["dřevo", "plast", "kov", "karton", "kompozit"].map((m) => <option key={m} value={m} />)}
        </datalist>
      </div>
      <div>
        <label className="label" htmlFor="pk-weight">{t("packaging.weightKg")}</label>
        <input id="pk-weight" name="weightKg" type="number" step="0.001" min="0" required className="input" defaultValue={d?.weightKg} />
      </div>
      <div>
        <label className="label" htmlFor="pk-deposit">{t("packaging.deposit")}</label>
        <input id="pk-deposit" name="deposit" type="number" step="0.01" min="0" className="input" defaultValue={d?.deposit ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor="pk-currency">{t("packaging.currency")}</label>
        <select id="pk-currency" name="currency" className="input" defaultValue={d?.currency ?? "CZK"}>
          <option value="CZK">Kč (CZK)</option>
          <option value="EUR">EUR</option>
        </select>
      </div>
      <div className="flex flex-col justify-end gap-2 pb-1">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="reusable" defaultChecked={d?.reusable ?? true} className="h-5 w-5" /> {t("packaging.reusable")}
        </label>
        {showActive && (
          <label className="flex items-center gap-2 text-sm">
            <input type="hidden" name="activePresent" value="1" />
            <input type="checkbox" name="active" defaultChecked={d?.active ?? true} className="h-5 w-5" /> {t("packaging.active")}
          </label>
        )}
      </div>
    </div>
  );
}
