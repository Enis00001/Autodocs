import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Shield,
} from "lucide-react";
import SignaturePad from "@/components/SignaturePad";
import { downloadBase64Pdf } from "@/utils/generatePDF";
import { cn } from "@/lib/utils";

type SignatureRequest = {
  token: string;
  clientEmail: string;
  clientNom: string;
  clientPrenom: string;
  vendeurNom: string;
  vehiculeModele: string;
  pdfBase64: string;
  signedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  alreadySigned: boolean;
};

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; request: SignatureRequest };

const containerClass =
  "min-h-screen w-full bg-[#0F1117] px-4 py-8 text-foreground md:px-6 md:py-12";

const cardClass =
  "mx-auto w-full max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-card md:p-8";

function formatExpires(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SignerDocument = () => {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [signedPdfBase64, setSignedPdfBase64] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ status: "error", message: "Lien de signature invalide." });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/get-signature-request?token=${encodeURIComponent(token)}`,
        );
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            (json as { error?: string }).error ||
              `Erreur ${response.status}`,
          );
        }
        if (cancelled) return;
        setState({ status: "ready", request: json as SignatureRequest });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "Impossible de charger le bon de commande.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const pdfDataUrl = useMemo(() => {
    if (state.status !== "ready") return null;
    const base = signedPdfBase64 ?? state.request.pdfBase64;
    return `data:application/pdf;base64,${base}`;
  }, [state, signedPdfBase64]);

  const handleSign = async (signatureBase64: string) => {
    if (!token) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/complete-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, signatureBase64 }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        pdfBase64?: string;
        signedAt?: string;
      };
      if (!response.ok) {
        throw new Error(json.error || `Erreur ${response.status}`);
      }
      if (!json.pdfBase64) {
        throw new Error("Réponse invalide du serveur.");
      }
      setSignedPdfBase64(json.pdfBase64);
      setCompletedAt(json.signedAt ?? new Date().toISOString());
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : "Échec de l'enregistrement de votre signature.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = () => {
    if (state.status !== "ready") return;
    const base = signedPdfBase64 ?? state.request.pdfBase64;
    const filename = signedPdfBase64
      ? "bon-de-commande-signe.pdf"
      : "bon-de-commande.pdf";
    downloadBase64Pdf(base, filename);
  };

  // ---------------------------------------------------------------------------
  //  Rendu : 4 états (loading / error / déjà signé ou expiré / prêt à signer)
  // ---------------------------------------------------------------------------

  if (state.status === "loading") {
    return (
      <div className={containerClass}>
        <div className={cn(cardClass, "flex flex-col items-center gap-4")}>
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Chargement du bon de commande…
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={containerClass}>
        <div className={cn(cardClass, "flex flex-col items-center gap-4")}>
          <AlertTriangle className="h-12 w-12 text-destructive" aria-hidden />
          <h1 className="text-center font-display text-xl font-bold">
            Lien indisponible
          </h1>
          <p className="text-center text-sm text-muted-foreground">
            {state.message}
          </p>
          <p className="text-center text-xs text-muted-foreground">
            Demandez à votre conseiller de vous renvoyer un nouveau lien de
            signature.
          </p>
        </div>
      </div>
    );
  }

  const { request } = state;

  if (request.expired) {
    return (
      <div className={containerClass}>
        <div className={cn(cardClass, "flex flex-col items-center gap-4")}>
          <AlertTriangle className="h-12 w-12 text-amber-400" aria-hidden />
          <h1 className="text-center font-display text-xl font-bold">
            Lien expiré
          </h1>
          <p className="text-center text-sm text-muted-foreground">
            Ce lien de signature n'est plus valable. Demandez à
            <strong> {request.vendeurNom || "votre conseiller"} </strong>
            un nouveau lien.
          </p>
        </div>
      </div>
    );
  }

  const justSigned = !!signedPdfBase64;
  const previouslySigned = request.alreadySigned && !justSigned;

  if (previouslySigned) {
    return (
      <div className={containerClass}>
        <div className={cn(cardClass, "flex flex-col items-center gap-4")}>
          <CheckCircle2 className="h-12 w-12 text-success" aria-hidden />
          <h1 className="text-center font-display text-xl font-bold">
            Document déjà signé
          </h1>
          <p className="text-center text-sm text-muted-foreground">
            Ce bon de commande a déjà été signé{" "}
            {request.signedAt ? `le ${formatExpires(request.signedAt)}` : ""}.
            Vous pouvez télécharger une copie ci-dessous.
          </p>
          <button
            type="button"
            className="btn-primary cursor-pointer border-0 px-4 py-2.5 text-sm"
            onClick={handleDownload}
          >
            <FileText className="h-4 w-4" />
            Télécharger le PDF
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <div className={cardClass}>
        <header className="mb-6 flex flex-col gap-2 border-b border-border pb-5">
          <span className="inline-flex items-center gap-2 self-start rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
            <Shield className="h-3.5 w-3.5" /> Signature électronique
          </span>
          <h1 className="font-display text-2xl font-bold">
            Bon de commande à signer
          </h1>
          <p className="text-sm text-muted-foreground">
            Bonjour{" "}
            <strong>
              {[request.clientPrenom, request.clientNom].filter(Boolean).join(" ") ||
                request.clientEmail}
            </strong>
            , veuillez relire le document ci-dessous puis apposer votre
            signature pour valider l'achat du véhicule
            <strong> {request.vehiculeModele || "—"}</strong>.
          </p>
          {request.expiresAt && (
            <p className="text-xs text-muted-foreground">
              Lien valable jusqu'au {formatExpires(request.expiresAt)}.
            </p>
          )}
        </header>

        <section className="mb-6">
          <h2 className="mb-2 font-display text-sm font-bold">
            Aperçu du bon de commande
          </h2>
          {pdfDataUrl ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <iframe
                src={pdfDataUrl}
                title="Aperçu du bon de commande"
                className="h-[480px] w-full bg-white md:h-[640px]"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucun aperçu disponible.
            </p>
          )}
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className="btn-secondary cursor-pointer px-3 py-1.5 text-xs"
              onClick={handleDownload}
            >
              <FileText className="h-3.5 w-3.5" />
              Télécharger le PDF
            </button>
          </div>
        </section>

        {justSigned ? (
          <section className="rounded-xl border border-success/30 bg-success/10 p-5 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-success" />
            <h2 className="mb-2 font-display text-lg font-bold text-success">
              Signature enregistrée
            </h2>
            <p className="mb-4 text-sm text-foreground">
              Merci. Votre bon de commande signé vient de vous être envoyé par
              email à <strong>{request.clientEmail}</strong>.
            </p>
            <p className="mb-5 text-xs text-muted-foreground">
              Une copie a également été transmise à
              {" "}
              {request.vendeurNom ? (
                <strong>{request.vendeurNom}</strong>
              ) : (
                "votre conseiller"
              )}
              .
            </p>
            <button
              type="button"
              className="btn-primary cursor-pointer border-0 px-4 py-2.5 text-sm"
              onClick={handleDownload}
            >
              <FileText className="h-4 w-4" />
              Télécharger le PDF signé
            </button>
          </section>
        ) : (
          <section>
            <h2 className="mb-3 font-display text-sm font-bold">Votre signature</h2>
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              {submitting ? (
                <div className="flex flex-col items-center gap-3 py-10">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">
                    Enregistrement de votre signature et envoi du PDF final…
                  </p>
                </div>
              ) : (
                <SignaturePad
                  onValidate={handleSign}
                  validateLabel="Signer le bon de commande"
                />
              )}
              {submitError && (
                <p className="mt-3 text-center text-xs text-destructive">
                  {submitError}
                </p>
              )}
            </div>
            <p className="mt-4 rounded-lg border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground">
              <strong className="text-foreground">Mention légale :</strong> en
              signant, j'accepte les termes du bon de commande ci-dessus.
              Conformément au règlement eIDAS et à l'article 1367 du Code civil
              français, ma signature électronique a la même valeur juridique
              qu'une signature manuscrite.
            </p>
          </section>
        )}
      </div>
    </div>
  );
};

export default SignerDocument;
