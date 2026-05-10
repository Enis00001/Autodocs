import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, Mail, KeyRound, User as UserIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/apiClient";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";

/**
 * Page publique d'acceptation d'invitation. Route : `/invitation/:token`.
 *
 * Flow :
 *   1. Récupère l'invitation côté serveur (API `lookup-invitation`) qui renvoie
 *      l'email cible, le rôle et le nom de la concession (sans exposer
 *      d'autres infos). Si elle est expirée ou déjà acceptée → message d'erreur.
 *   2. Si l'invité est DÉJÀ connecté avec le bon email → action serveur
 *      `accept-invitation` qui INSERT dans membres_concession + marque accepted_at.
 *   3. Si l'invité n'a pas de compte → formulaire (prénom, nom, mot de passe).
 *      L'API serveur `accept-invitation` crée le compte (admin signUp en
 *      forçant l'email), le lie à la concession, marque accepted_at.
 *      Puis on connecte le user côté client avec son mot de passe.
 *   4. Redirige vers `/app`.
 */
type InvitationLookup = {
  ok: true;
  email: string;
  role: "admin" | "commercial";
  concession_id: string;
  concession_nom: string | null;
  status: "pending" | "accepted" | "expired";
  has_account: boolean;
};

type InvitationLookupError = {
  ok: false;
  error: string;
};

export default function AccepterInvitation() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, refreshConcession } = useAuth();

  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<InvitationLookup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Token d'invitation manquant.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await apiFetch("/api/actions", {
          method: "POST",
          body: JSON.stringify({ action: "lookup-invitation", token }),
        });
        const body = (await res.json().catch(() => ({}))) as
          | InvitationLookup
          | InvitationLookupError;
        if (!res.ok || !("ok" in body) || !body.ok) {
          setError(
            "error" in body && body.error
              ? body.error
              : "Cette invitation est invalide ou a expiré.",
          );
          setLoading(false);
          return;
        }
        if (body.status === "accepted") {
          setError("Cette invitation a déjà été acceptée. Connectez-vous directement.");
          setLoading(false);
          return;
        }
        if (body.status === "expired") {
          setError("Cette invitation a expiré (durée de validité : 7 jours).");
          setLoading(false);
          return;
        }
        setInfo(body);
      } catch (err) {
        console.error("[AccepterInvitation] lookup:", err);
        setError("Impossible de vérifier l'invitation. Réessayez.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleAcceptExistingAccount = async () => {
    if (!token || !info) return;
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/actions", {
        method: "POST",
        body: JSON.stringify({ action: "accept-invitation", token }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || "Échec de l'acceptation.");
      }
      toast({ title: "Bienvenue dans l'équipe ✓" });
      await refreshConcession();
      navigate("/app", { replace: true });
    } catch (err) {
      toast({
        title: "Acceptation impossible",
        description: err instanceof Error ? err.message : "Réessayez.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateAccountAndAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !info) return;
    if (password.length < 6) {
      toast({
        title: "Mot de passe trop court",
        description: "6 caractères minimum.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/actions", {
        method: "POST",
        body: JSON.stringify({
          action: "accept-invitation",
          token,
          prenom: prenom.trim(),
          nom: nom.trim(),
          password,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error || "Échec de la création du compte.");
      }
      // Connexion immédiate avec les credentials qu'on vient de créer.
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: info.email,
        password,
      });
      if (signErr) throw signErr;
      toast({ title: "Compte créé et invitation acceptée ✓" });
      await refreshConcession();
      navigate("/app", { replace: true });
    } catch (err) {
      toast({
        title: "Acceptation impossible",
        description: err instanceof Error ? err.message : "Réessayez.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-md card-autodocs text-center">
          <div className="mb-3 flex justify-center">
            <XCircle className="h-10 w-10 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold mb-2">Invitation invalide</h1>
          <p className="text-sm text-muted-foreground mb-5">
            {error ?? "Cette invitation n'existe pas."}
          </p>
          <Link to="/login" className="text-primary hover:underline text-sm">
            Retour à la connexion
          </Link>
        </div>
      </div>
    );
  }

  const isLoggedInWithSameEmail =
    user?.email && user.email.toLowerCase() === info.email.toLowerCase();
  const concessionLabel = info.concession_nom?.trim() || "votre concession";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md card-autodocs">
        <div className="font-display font-extrabold text-2xl mb-2 text-center tracking-tight">
          Auto<span className="gradient-text">Docs</span>
        </div>
        <div className="mb-5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" />
          Invitation à rejoindre <span className="font-semibold text-foreground">{concessionLabel}</span>
        </div>

        <div className="rounded-input border border-border/60 bg-secondary/30 px-3 py-2 text-xs text-muted-foreground mb-5">
          Email d'invitation : <span className="font-medium text-foreground">{info.email}</span>
          <br />
          Rôle attribué : <span className="font-medium text-foreground">{info.role === "admin" ? "Administrateur" : "Commercial"}</span>
        </div>

        {isLoggedInWithSameEmail ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleAcceptExistingAccount()}
            className="w-full mt-2 px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Acceptation…" : "Rejoindre la concession"}
          </button>
        ) : info.has_account ? (
          <div className="text-sm text-muted-foreground space-y-3">
            <p>
              Un compte existe déjà avec cet email. Connectez-vous pour accepter l'invitation.
            </p>
            <Link
              to={`/login?invite=${token ?? ""}`}
              className="block text-center w-full px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground"
            >
              Se connecter
            </Link>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={handleCreateAccountAndAccept}>
            <p className="text-sm text-muted-foreground mb-2">
              Créez votre compte pour rejoindre l'équipe.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Prénom</label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    className="field-input pl-10"
                    value={prenom}
                    onChange={(e) => setPrenom(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Nom</label>
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    className="field-input pl-10"
                    value={nom}
                    onChange={(e) => setNom(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Email</label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  className="field-input pl-10 cursor-not-allowed opacity-70"
                  value={info.email}
                  readOnly
                  disabled
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Mot de passe</label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  className="field-input pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-2 px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Création…" : "Créer mon compte et rejoindre"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
