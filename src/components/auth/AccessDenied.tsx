import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import TopBar from "@/components/layout/TopBar";

type Props = {
  /** Titre principal affiché dans la carte. */
  title?: string;
  /** Description sous le titre (1-2 phrases). */
  description?: string;
  /** Texte du lien retour (défaut "Retour au tableau de bord"). */
  backLabel?: string;
  /** Cible du lien retour (défaut /app). */
  backTo?: string;
};

/**
 * Garde-fou affiché à un commercial qui tente d'accéder à une section
 * réservée à l'administrateur de la concession (équipe, abonnement,
 * paramètres avancés, champs personnalisés…).
 */
export default function AccessDenied({
  title = "Accès réservé",
  description = "Cette section est uniquement accessible à l'administrateur de la concession.",
  backLabel = "Retour au tableau de bord",
  backTo = "/app",
}: Props) {
  return (
    <>
      <TopBar title="Accès refusé" />
      <div className="page-shell">
        <div className="page-content">
          <div className="card-autodocs max-w-xl mx-auto text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary/40 text-muted-foreground">
              <Lock className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-semibold mb-1">{title}</h2>
            <p className="text-sm text-muted-foreground mb-5">{description}</p>
            <Link
              to={backTo}
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg gradient-primary text-primary-foreground text-[13px] font-medium"
            >
              {backLabel}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
