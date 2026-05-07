import { useState } from "react";
import { CheckCircle2, Clock, MailPlus, Loader2 } from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import { resendSignatureEmail } from "@/utils/generatePDF";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Props = {
  draft: BonDraftData;
  /** Si `true`, le bouton « Renvoyer le lien » est affiché à côté du badge. */
  showResendButton?: boolean;
  className?: string;
};

/**
 * Affiche l'état de signature d'un brouillon :
 *  - « Signé ✅ » (vert)              → client + vendeur ont signé
 *  - « Vendeur signé »                 → vendeur a signé en interne
 *  - « En attente de signature client » (orange) → email envoyé, pas encore signé
 *  - rien                              → aucun signal de signature
 *
 * Optionnellement, affiche un bouton « Renvoyer le lien » si une demande
 * de signature est en attente.
 */
const SignatureStatusBadge = ({ draft, showResendButton = false, className }: Props) => {
  const [resending, setResending] = useState(false);

  const status = computeStatus(draft);
  if (!status) return null;

  const handleResend = async () => {
    if (!draft.id) return;
    setResending(true);
    try {
      const result = await resendSignatureEmail({ brouillonId: draft.id });
      toast({
        title: "Lien de signature renvoyé",
        description: result.signUrl,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Impossible de renvoyer le lien.";
      toast({ title: "Échec du renvoi", description: message, variant: "destructive" });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
          status.toneClass,
        )}
        title={status.title}
      >
        {status.icon}
        {status.label}
      </span>
      {showResendButton && status.kind === "pending" && draft.id && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-transparent px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
          onClick={handleResend}
          disabled={resending}
          title="Renvoyer le lien de signature au client"
          aria-label="Renvoyer le lien de signature"
        >
          {resending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <MailPlus className="h-3 w-3" />
          )}
          Renvoyer
        </button>
      )}
    </div>
  );
};

type StatusKind = "signed" | "vendor-only" | "pending";

type ComputedStatus = {
  kind: StatusKind;
  label: string;
  title: string;
  toneClass: string;
  icon: React.ReactNode;
};

function computeStatus(d: BonDraftData): ComputedStatus | null {
  const hasClientSignature = !!d.clientSignedAt;
  const hasVendorSignature = !!d.signed;
  const hasPendingRequest = !!d.signatureRequestToken && !hasClientSignature;

  if (hasClientSignature) {
    const detail = d.clientSignedAt
      ? `Signé le ${new Date(d.clientSignedAt).toLocaleDateString("fr-FR")}`
      : "Signé";
    return {
      kind: "signed",
      label: "Signé ✅",
      title: detail,
      toneClass: "bg-success/15 text-success",
      icon: <CheckCircle2 className="h-3 w-3" aria-hidden />,
    };
  }

  if (hasPendingRequest) {
    const sentDate = d.signatureRequestSentAt
      ? new Date(d.signatureRequestSentAt).toLocaleDateString("fr-FR")
      : null;
    return {
      kind: "pending",
      label: "En attente de signature client",
      title: sentDate
        ? `Lien de signature envoyé le ${sentDate}`
        : "Email de signature envoyé",
      toneClass: "bg-amber-500/15 text-amber-400",
      icon: <Clock className="h-3 w-3" aria-hidden />,
    };
  }

  if (hasVendorSignature) {
    const detail = d.signedAt
      ? `Signé par le vendeur le ${new Date(d.signedAt).toLocaleDateString("fr-FR")}`
      : "Signé par le vendeur";
    return {
      kind: "vendor-only",
      label: "Vendeur signé",
      title: detail,
      toneClass: "bg-success/15 text-success",
      icon: <CheckCircle2 className="h-3 w-3" aria-hidden />,
    };
  }

  return null;
}

export default SignatureStatusBadge;
