"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import type { ActionState } from "@/lib/actions";
import { useT } from "@/lib/i18n/client";

const FIELDS = ["date", "partner", "kind", "packaging", "quantity", "deliveryNote", "direction", "note"] as const;
const REQUIRED = new Set(["date", "partner", "kind", "packaging", "quantity"]);
type Mapping = Partial<Record<(typeof FIELDS)[number], string>>;
type Analysis = { headers: string[]; sample: Record<string, string>[]; rowCount: number; mapping: Mapping };
type Preview = { rows: number; movements: number; errors: { row: number; message: string }[]; errorCount: number; summary?: { partnershipId: string; partner: string; movements: number; pieces: number }[] };

export function ImportWizard({
  analyze,
  preview,
  commit,
}: {
  analyze: (text: string) => Promise<ActionState>;
  preview: (text: string, m: Mapping) => Promise<ActionState>;
  commit: (text: string, m: Mapping, name: string) => Promise<ActionState>;
}) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [prev, setPrev] = useState<Preview | null>(null);
  const [done, setDone] = useState<{ movements: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    setPrev(null);
    setDone(null);
    if (f.size > 3_000_000) return setError(t("import.tooBig"));
    const buf = await f.arrayBuffer();
    // UTF-8, se záložním Windows-1250 (export z českých ERP)
    let content = new TextDecoder("utf-8").decode(buf);
    if (content.includes("�")) content = new TextDecoder("windows-1250").decode(buf);
    setText(content);
    setFileName(f.name);
    start(async () => {
      const r = await analyze(content);
      if (r?.error) return setError(r.error);
      const a = r?.data as Analysis;
      setAnalysis(a);
      setMapping(a.mapping);
    });
  }

  function runPreview() {
    setError(null);
    start(async () => {
      const r = await preview(text, mapping);
      if (r?.error) return setError(r.error);
      setPrev(r?.data as Preview);
    });
  }

  function runCommit() {
    setError(null);
    start(async () => {
      const r = await commit(text, mapping, fileName);
      if (r?.error) {
        setError(r.error);
        if (Array.isArray(r.data)) setPrev({ rows: 0, movements: 0, errors: r.data as Preview["errors"], errorCount: (r.data as unknown[]).length });
        return;
      }
      setDone(r?.data as { movements: number });
      // průvodce se vynuluje – stejný soubor nejde omylem importovat podruhé
      setPrev(null);
      setAnalysis(null);
      setText("");
      setMapping({});
    });
  }

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <h2 className="h2">1. {t("import.stepFile")}</h2>
        <input type="file" key={done ? "done" : "file"} accept=".csv,text/csv" aria-label={t("import.file")} onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm" />
        <p className="muted">{t("import.fileHelp")}</p>
        <a className="text-sm text-brand-700 underline" href="/import-vzor.csv" download>{t("import.sample")}</a>
      </section>

      {analysis && (
        <section className="card space-y-3">
          <h2 className="h2">2. {t("import.stepMapping")}</h2>
          <p className="muted">{t("import.rowsFound", { n: analysis.rowCount })}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f}>
                <label className="label" htmlFor={`map-${f}`}>{t(`import.fields.${f}`)}{REQUIRED.has(f) ? " *" : ""}</label>
                <select id={`map-${f}`} className="input" value={mapping[f] ?? ""} onChange={(e) => { setMapping({ ...mapping, [f]: e.target.value || undefined }); setPrev(null); }}>
                  <option value="">{t("import.notMapped")}</option>
                  {analysis.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <p className="muted">{t("import.mappingHelp")}</p>
          <div className="overflow-x-auto">
            <table className="table text-xs">
              <thead><tr>{analysis.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{analysis.sample.map((r, i) => <tr key={i}>{analysis.headers.map((h) => <td key={h}>{r[h]}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <button className="btn-secondary" onClick={runPreview} disabled={pending}>{t("import.check")}</button>
        </section>
      )}

      {prev && (
        <section className="card space-y-3" data-testid="import-preview">
          <h2 className="h2">3. {t("import.stepPreview")}</h2>
          {prev.errorCount === 0 ? (
            <>
              <p className="alert-ok">{t("import.ready", { rows: prev.rows, movements: prev.movements })}</p>
              {prev.summary && (
                <table className="table text-sm">
                  <thead><tr><th>{t("common.partner")}</th><th className="text-right">{t("import.summaryMovements")}</th><th className="text-right">{t("import.summaryPieces")}</th></tr></thead>
                  <tbody>{prev.summary.map((s) => <tr key={s.partnershipId}><td>{s.partner}</td><td className="text-right">{s.movements}</td><td className="text-right">{s.pieces}</td></tr>)}</tbody>
                </table>
              )}
              <p className="muted">{t("import.checkPartners")}</p>
              <button className="btn-primary" onClick={runCommit} disabled={pending}>{t("import.run", { n: prev.movements })}</button>
            </>
          ) : (
            <>
              <p className="alert-error">{t("import.hasErrors", { n: prev.errorCount })}</p>
              <ul className="max-h-64 overflow-y-auto text-sm">
                {prev.errors.map((e, i) => <li key={i}><strong>{t("import.row", { n: e.row })}:</strong> {e.message}</li>)}
              </ul>
            </>
          )}
        </section>
      )}

      {error && <p className="alert-error" role="alert">{error}</p>}
      {done && (
        <p className="alert-ok" role="status">
          {t("import.done", { n: done.movements })} <Link className="underline" href="/movements?awaiting=partner">{t("import.showMovements")}</Link>
        </p>
      )}
      {pending && <p className="muted">{t("import.working")}</p>}
    </div>
  );
}
