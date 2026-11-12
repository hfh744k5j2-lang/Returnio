import { NextResponse, type NextRequest } from "next/server";
import { AppError, httpStatus } from "./errors";
import { requireApiCtx, type Ctx } from "./context";

type Handler<P> = (ctx: Ctx, req: NextRequest, params: P) => Promise<unknown>;

/**
 * Obal API endpointu: ověří přihlášení, u zápisů ochranu proti CSRF (JSON + stejný původ),
 * a převede chyby služeb na HTTP kódy.
 */
export function api<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") assertSameOrigin(req);
      const ctx = await requireApiCtx();
      const result = await handler(ctx, req, (await context.params) ?? ({} as P));
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: e.message, code: e.code }, { status: httpStatus(e) });
      console.error(e);
      return NextResponse.json({ error: "Interní chyba." }, { status: 500 });
    }
  };
}

function assertSameOrigin(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json") && !ct.includes("multipart/form-data") && !ct.includes("text/csv"))
    throw new AppError("VALIDATION", "Očekávám JSON.");
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!host || new URL(origin).host !== host) throw new AppError("FORBIDDEN", "Neplatný původ požadavku.");
  }
}

export async function jsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION", "Neplatný JSON.");
  }
}

export function searchParam(req: NextRequest, name: string): string | undefined {
  return req.nextUrl.searchParams.get(name) || undefined;
}

export function dateParam(req: NextRequest, name: string): Date | undefined {
  const v = searchParam(req, name);
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new AppError("VALIDATION", `Neplatné datum v parametru ${name}.`);
  return d;
}

export function enumParam<T extends string>(req: NextRequest, name: string, allowed: readonly T[]): T | undefined {
  const v = searchParam(req, name);
  if (!v) return undefined;
  if (!(allowed as readonly string[]).includes(v)) throw new AppError("VALIDATION", `Neplatná hodnota parametru ${name}.`);
  return v as T;
}
