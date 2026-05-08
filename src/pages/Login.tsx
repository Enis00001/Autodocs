import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import { getSignupEmailRedirectTo } from "@/lib/auth";

/** Extrait un plan valide depuis les searchParams (sinon null). */
const readPlanParam = (
  params: URLSearchParams,
): "monthly" | "annual" | null => {
  const raw = params.get("plan");
  if (raw === "monthly" || raw === "annual") return raw;
  return null;
};

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailNotConfirmed, setEmailNotConfirmed] = useState(false);
  const [resending, setResending] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  const plan = readPlanParam(searchParams);
  const inscriptionHref = plan ? `/inscription?plan=${plan}` : "/inscription";

  useEffect(() => {
    const state = location.state as { flashMessage?: string } | null;
    if (!state?.flashMessage) return;
    toast({ title: state.flashMessage });
    navigate(location.pathname + location.search, { replace: true });
  }, [location.pathname, location.search, location.state, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailNotConfirmed(false);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      if (error.message.toLowerCase().includes("email not confirmed")) {
        setEmailNotConfirmed(true);
        return;
      }
      toast({ title: "Connexion impossible", description: error.message });
      return;
    }
    // Si l'utilisateur vient de la landing avec un plan choisi, on l'envoie
    // directement sur /abonnement qui déclenchera le checkout Stripe.
    if (plan) {
      navigate(`/abonnement?plan=${plan}`, { replace: true });
    } else {
      navigate("/app", { replace: true });
    }
  };

  const handleResendConfirmation = async () => {
    if (!email.trim()) {
      toast({ title: "Email requis", description: "Saisissez votre email pour renvoyer la confirmation." });
      return;
    }
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: {
        emailRedirectTo: getSignupEmailRedirectTo(plan),
      },
    });
    setResending(false);
    if (error) {
      toast({ title: "Envoi impossible", description: error.message });
      return;
    }
    toast({ title: "Email de confirmation renvoyé ✓" });
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotSuccess(false);
    setForgotLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setForgotLoading(false);
    if (error) {
      setForgotError("Aucun compte trouvé avec cet email.");
      return;
    }
    setForgotSuccess(true);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md card-autodocs">
        <div className="font-display font-extrabold text-2xl mb-6 text-center tracking-tight">
          Auto<span className="gradient-text">Docs</span>
        </div>
        <h1 className="text-lg font-semibold mb-1">Connexion</h1>
        <p className="text-sm text-muted-foreground mb-5">Accédez à votre espace concession</p>

        {emailNotConfirmed && (
          <div className="mb-4 p-3 rounded-lg border border-destructive/40 bg-destructive/10">
            <p className="text-sm text-destructive font-medium">
              Veuillez confirmer votre email avant de vous connecter. Vérifiez votre boîte mail.
            </p>
            <button
              type="button"
              className="mt-2 text-xs px-3 py-1.5 rounded-md border border-destructive/60 text-destructive hover:border-destructive bg-transparent cursor-pointer"
              onClick={handleResendConfirmation}
              disabled={resending}
            >
              {resending ? "Envoi..." : "Renvoyer l'email de confirmation"}
            </button>
          </div>
        )}

        <form className="space-y-3" onSubmit={handleLogin}>
          <div className="flex flex-col gap-1.5">
            <label className="field-label">Email</label>
            <input
              type="email"
              className="field-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="field-label">Mot de passe</label>
            <input
              type="password"
              className="field-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              setShowForgotPassword((prev) => !prev);
              setForgotError(null);
              setForgotSuccess(false);
            }}
            className="text-sm text-primary hover:underline cursor-pointer bg-transparent border-0 p-0"
          >
            Mot de passe oublié ?
          </button>
        </div>

        {showForgotPassword && (
          <div className="mt-3 rounded-lg border border-border/60 p-3">
            <form className="space-y-3" onSubmit={handleResetPassword}>
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Email</label>
                <input
                  type="email"
                  className="field-input"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={forgotLoading}
                className="w-full px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {forgotLoading ? "Envoi..." : "Envoyer le lien de réinitialisation"}
              </button>
            </form>
            {forgotSuccess && (
              <p className="mt-3 text-sm text-emerald-400">
                Lien envoyé ! Vérifiez votre boîte mail.
              </p>
            )}
            {forgotError && <p className="mt-3 text-sm text-destructive">{forgotError}</p>}
          </div>
        )}

        <div className="mt-4 text-sm text-muted-foreground text-center">
          Première connexion ?{" "}
          <Link to={inscriptionHref} className="text-primary hover:underline">
            Créer un compte
          </Link>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

