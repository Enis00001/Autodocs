import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingLink, setCheckingLink] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let mounted = true;

    const verifyRecoverySession = async () => {
      const hash = window.location.hash || "";
      const hasRecoveryToken = hash.includes("access_token=");

      const { data, error: sessionError } = await supabase.auth.getSession();
      const hasSession = !!data.session;

      if (!mounted) return;

      if (sessionError || (!hasSession && !hasRecoveryToken)) {
        navigate("/login", {
          replace: true,
          state: { flashMessage: "Lien expiré, veuillez recommencer." },
        });
        return;
      }

      setCheckingLink(false);
    };

    void verifyRecoverySession();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message || "Impossible de mettre à jour le mot de passe.");
      return;
    }

    setSuccess(true);
    setTimeout(() => {
      navigate("/login", {
        replace: true,
        state: { flashMessage: "Mot de passe mis à jour !" },
      });
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md card-autodocs">
        <div className="font-display font-extrabold text-2xl mb-6 text-center tracking-tight">
          Auto<span className="gradient-text">Docs</span>
        </div>
        <h1 className="text-lg font-semibold mb-1">Réinitialiser le mot de passe</h1>
        <p className="text-sm text-muted-foreground mb-5">
          Saisissez votre nouveau mot de passe
        </p>

        {checkingLink ? (
          <p className="text-sm text-muted-foreground">Vérification du lien...</p>
        ) : (
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Nouveau mot de passe</label>
              <input
                type="password"
                className="field-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="field-label">Confirmer le mot de passe</label>
              <input
                type="password"
                className="field-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || success}
              className="w-full mt-2 px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? "Mise à jour..."
                : success
                  ? "Mot de passe mis à jour !"
                  : "Mettre à jour le mot de passe"}
            </button>
          </form>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        {success && (
          <p className="mt-3 text-sm text-emerald-400">
            Mot de passe mis à jour ! Redirection vers la connexion...
          </p>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordPage;
