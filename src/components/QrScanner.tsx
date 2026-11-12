"use client";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { useT } from "@/lib/i18n/client";

/** Čtečka QR kódů z kamery telefonu (getUserMedia + jsQR, bez externích služeb). */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const tick = () => {
          if (stopped) return;
          const canvas = canvasRef.current!;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (code?.data) {
              if (navigator.vibrate) navigator.vibrate(80);
              onResult(code.data);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setError(t("scan.cameraError"));
      }
    }
    start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [onResult, t]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-label={t("scan.cameraTitle")}>
      <div className="flex items-center justify-between p-3 text-white">
        <span className="font-semibold">{t("scan.pointCamera")}</span>
        <button className="btn-secondary btn-sm" onClick={onClose}>{t("common.cancel")}</button>
      </div>
      {error ? (
        <p className="m-4 rounded-lg bg-white p-4 text-sm">{error}</p>
      ) : (
        <div className="relative flex-1">
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-0 m-auto h-64 w-64 rounded-2xl border-4 border-white/80" />
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
