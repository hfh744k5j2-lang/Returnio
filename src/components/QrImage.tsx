import QRCode from "qrcode";

/** QR kód jako inline SVG (generuje se na serveru, žádná externí služba). */
export async function QrImage({ value, size = 160, label }: { value: string; size?: number; label?: string }) {
  const svg = await QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return (
    <figure className="inline-flex flex-col items-center">
      <div style={{ width: size, height: size }} className="[&>svg]:h-full [&>svg]:w-full" data-qr={value} dangerouslySetInnerHTML={{ __html: svg }} />
      {label && <figcaption className="mt-1 text-xs font-medium text-slate-700">{label}</figcaption>}
    </figure>
  );
}
