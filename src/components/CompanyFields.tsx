import type { TFn } from "@/lib/i18n/core";

export function CompanyFields({ t, defaults }: { t: TFn; defaults?: { name?: string; regNumber?: string | null; country?: string; address?: string | null } }) {
  return (
    <>
      <div>
        <label className="label" htmlFor="name">{t("company.name")}</label>
        <input id="name" name="name" required minLength={2} className="input" defaultValue={defaults?.name} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="regNumber">{t("company.regNumber")}</label>
          <input id="regNumber" name="regNumber" className="input" defaultValue={defaults?.regNumber ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="country">{t("company.country")}</label>
          <select id="country" name="country" className="input" defaultValue={defaults?.country ?? "CZ"}>
            {["CZ", "SK", "PL", "DE", "AT", "HU", "OTHER"].map((c) => (
              <option key={c} value={c}>{t(`countries.${c}`)}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="address">{t("company.address")}</label>
        <input id="address" name="address" className="input" defaultValue={defaults?.address ?? ""} />
      </div>
    </>
  );
}
