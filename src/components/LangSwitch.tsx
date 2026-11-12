import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { UI_LOCALES, isLocale } from "@/lib/i18n/core";
import { getLocale } from "@/lib/i18n/server";

async function setLocale(fd: FormData) {
  "use server";
  const l = fd.get("locale");
  if (isLocale(l)) (await cookies()).set("locale", l, { path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function LangSwitch() {
  const current = await getLocale();
  return (
    <form action={setLocale} className="flex gap-1 text-xs">
      {UI_LOCALES.map((l) => (
        <button
          key={l}
          name="locale"
          value={l}
          className={`rounded px-2 py-1 font-semibold uppercase ${l === current ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-200"}`}
          aria-pressed={l === current}
        >
          {l}
        </button>
      ))}
    </form>
  );
}
