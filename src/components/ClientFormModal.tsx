import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClientData, ClientUpsertData } from "@/utils/clients";

type ClientFormModalProps = {
  open: boolean;
  /** Si fourni, mode édition. Sinon mode création. */
  initial?: ClientData | ClientUpsertData | null;
  /** Titre custom (sinon "Nouveau client" / "Modifier le client"). */
  title?: string;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (data: ClientUpsertData) => Promise<void> | void;
};

const emptyForm: ClientUpsertData = {
  nom: "",
  prenom: "",
  email: "",
  telephone: "",
  dateNaissance: "",
};

function toUpsert(input: ClientData | ClientUpsertData | null | undefined): ClientUpsertData {
  if (!input) return { ...emptyForm };
  return {
    nom: input.nom ?? "",
    prenom: input.prenom ?? "",
    email: input.email ?? "",
    telephone: input.telephone ?? "",
    dateNaissance: input.dateNaissance ?? "",
  };
}

const ClientFormModal = ({
  open,
  initial,
  title,
  submitLabel,
  onClose,
  onSubmit,
}: ClientFormModalProps) => {
  const isEdit = !!(initial && "id" in initial && initial.id);
  const [form, setForm] = useState<ClientUpsertData>(toUpsert(initial));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(toUpsert(initial));
      setError(null);
    }
  }, [open, initial]);

  // ESC ferme la modale
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const update = <K extends keyof ClientUpsertData>(key: K, value: ClientUpsertData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (!form.nom.trim() || !form.prenom.trim()) {
      setError("Le nom et le prénom sont obligatoires.");
      return;
    }
    try {
      setSubmitting(true);
      await onSubmit({
        nom: form.nom.trim(),
        prenom: form.prenom.trim(),
        email: form.email?.trim() ?? "",
        telephone: form.telephone?.trim() ?? "",
        dateNaissance: form.dateNaissance?.trim() ?? "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
    } finally {
      setSubmitting(false);
    }
  };

  const computedTitle = title ?? (isEdit ? "Modifier le client" : "Nouveau client");
  const computedSubmit = submitLabel ?? (isEdit ? "Enregistrer" : "Créer le client");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "modal-mobile-fullscreen w-full md:max-w-lg",
          "border border-white/[0.08] bg-[#1A1D27] p-5 shadow-2xl shadow-black/50 md:p-6",
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="client-modal-title"
              className="font-display text-base font-bold text-foreground md:text-lg"
            >
              {computedTitle}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {isEdit
                ? "Mettez à jour les informations de la fiche client."
                : "Renseignez les coordonnées du client de la concession."}
            </p>
          </div>
          <button
            type="button"
            className="-m-1.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
            onClick={onClose}
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="field-label">Nom *</span>
              <input
                className="field-input mt-1"
                value={form.nom}
                onChange={(e) => update("nom", e.target.value)}
                autoFocus
                required
              />
            </label>
            <label className="block">
              <span className="field-label">Prénom *</span>
              <input
                className="field-input mt-1"
                value={form.prenom}
                onChange={(e) => update("prenom", e.target.value)}
                required
              />
            </label>
          </div>

          <label className="block">
            <span className="field-label">Email</span>
            <input
              type="email"
              className="field-input mt-1"
              value={form.email ?? ""}
              onChange={(e) => update("email", e.target.value)}
              placeholder="ex. client@email.fr"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="field-label">Téléphone</span>
              <input
                type="tel"
                className="field-input mt-1"
                value={form.telephone ?? ""}
                onChange={(e) => update("telephone", e.target.value)}
                placeholder="06 12 34 56 78"
              />
            </label>
            <label className="block">
              <span className="field-label">Date de naissance</span>
              <input
                type="date"
                className="field-input mt-1 cursor-pointer"
                value={form.dateNaissance ?? ""}
                onChange={(e) => update("dateNaissance", e.target.value)}
                onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
              />
            </label>
          </div>

          {error ? (
            <div className="rounded-input border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col-reverse items-stretch gap-2 pt-2 md:flex-row md:justify-end">
            <button
              type="button"
              className="btn-secondary cursor-pointer"
              onClick={onClose}
              disabled={submitting}
            >
              Annuler
            </button>
            <button type="submit" className="btn-primary cursor-pointer" disabled={submitting}>
              {submitting ? "Enregistrement…" : computedSubmit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ClientFormModal;
