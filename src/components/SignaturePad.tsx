import { useEffect, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";
import { Eraser, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";

type SignaturePadProps = {
  /**
   * Callback invoqué quand l'utilisateur clique sur « Valider la signature ».
   * Reçoit la signature au format base64 PNG (data URL).
   */
  onValidate: (signatureBase64: string) => void;
  /** Callback optionnel pour annuler / fermer le pad. */
  onCancel?: () => void;
  /** Texte du bouton de validation (défaut : « Valider la signature »). */
  validateLabel?: string;
  className?: string;
};

/**
 * Pad de signature tactile/souris basé sur la librairie `signature_pad`.
 *
 * - Sur desktop : canvas de 400x200px.
 * - Sur mobile : pleine largeur (responsive).
 * - Le canvas est redimensionné à chaud avec le `devicePixelRatio` pour
 *   éviter le flou Retina ; les traits déjà dessinés sont conservés.
 */
const SignaturePad = ({
  onValidate,
  onCancel,
  validateLabel = "Valider la signature",
  className,
}: SignaturePadProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pad = new SignaturePadLib(canvas, {
      minWidth: 0.6,
      maxWidth: 2.2,
      penColor: "rgb(15, 23, 42)",
      backgroundColor: "rgba(255,255,255,1)",
    });
    padRef.current = pad;

    const refreshEmpty = () => setIsEmpty(pad.isEmpty());
    pad.addEventListener("endStroke", refreshEmpty);
    pad.addEventListener("beginStroke", refreshEmpty);

    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const data = pad.toData();
      const targetWidth = canvas.offsetWidth;
      const targetHeight = canvas.offsetHeight;
      canvas.width = targetWidth * ratio;
      canvas.height = targetHeight * ratio;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(ratio, ratio);
      pad.clear();
      if (data && data.length > 0) {
        pad.fromData(data);
      }
      setIsEmpty(pad.isEmpty());
    };

    resize();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      pad.removeEventListener("endStroke", refreshEmpty);
      pad.removeEventListener("beginStroke", refreshEmpty);
      pad.off();
      padRef.current = null;
    };
  }, []);

  const handleClear = () => {
    padRef.current?.clear();
    setIsEmpty(true);
  };

  const handleValidate = () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) return;
    const dataUrl = pad.toDataURL("image/png");
    onValidate(dataUrl);
  };

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <PenLine className="h-3.5 w-3.5" />
        Signez dans la zone ci-dessous
      </div>
      <div className="rounded-lg border border-border bg-white p-1 shadow-inner">
        <canvas
          ref={canvasRef}
          className="block h-[200px] w-full cursor-crosshair touch-none rounded-md md:h-[200px] md:max-w-[400px]"
          aria-label="Zone de signature"
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <button
          type="button"
          className="btn-secondary cursor-pointer px-3 py-2 text-sm"
          onClick={handleClear}
          disabled={isEmpty}
        >
          <Eraser className="h-4 w-4" />
          Effacer
        </button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {onCancel && (
            <button
              type="button"
              className="btn-secondary cursor-pointer px-3 py-2 text-sm"
              onClick={onCancel}
            >
              Annuler
            </button>
          )}
          <button
            type="button"
            className="btn-primary cursor-pointer border-0 px-4 py-2.5 text-sm"
            onClick={handleValidate}
            disabled={isEmpty}
          >
            {validateLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SignaturePad;
