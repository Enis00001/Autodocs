import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Mail } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import { getSignupEmailRedirectTo } from "@/lib/auth";

const ConfirmationEmailPage = () => {
  const [searchParams] = useSearchParams();
  const planRaw = searchParams.get("plan");
  const plan = planRaw === "monthly" || planRaw === "annual" ? planRaw : null;
  const loginHref = plan ? `/login?plan=${plan}` : "/login";
  const [loading, setLoading] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);
  // Si l'utilisateur a une session active mais que son email n'est pas
  // encore confirmé, on récupère l'email depuis la session.
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (data.user && !data.user.email_confirmed_at) {
        setSessionEmail(data.user.email ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const email = searchParams.get("email") ?? sessionEmail ?? "";

  const handleResend = async () => {
    if (!email) {
      toast({ title: "Email manquant", description: "Retournez à l'inscription et réessayez." });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: getSignupEmailRedirectTo(plan),
      },
    });
    setLoading(false);
    if (error) {
      toast({ title: "Envoi impossible", description: error.message });
      return;
    }
    toast({ title: "Email renvoyé ✓" });
  };

  const handleBackToLogin = async () => {
    if (sessionEmail) {
      setSignOutPending(true);
      await supabase.auth.signOut().catch(() => undefined);
      setSignOutPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-xl card-autodocs text-center">
        <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/30 mx-auto flex items-center justify-center mb-5">
          <Mail className="w-10 h-10 text-primary" />
        </div>
        <h1 className="font-display font-bold text-2xl mb-3">
          {sessionEmail ? "Confirmez votre email pour continuer" : "Vérifiez votre email !"}
        </h1>
        <p className="text-sm text-muted-foreground max-w-lg mx-auto">
          {sessionEmail
            ? "Votre compte est créé, mais vous devez d'abord confirmer votre adresse email pour accéder à AutoDocs."
            : "Un email de confirmation a été envoyé à"}{" "}
          <span className="text-foreground">{email || "votre adresse email"}</span>
          {sessionEmail ? "." : ". Cliquez sur le lien dans l'email pour activer votre compte."}
        </p>

        <button
          type="button"
          onClick={handleResend}
          disabled={loading}
          className="mt-6 px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Envoi..." : "Renvoyer l'email"}
        </button>

        <div className="mt-4 text-sm text-muted-foreground">
          <Link
            to={loginHref}
            onClick={handleBackToLogin}
            className="text-primary hover:underline"
          >
            {signOutPending ? "Déconnexion…" : "Retour à la connexion"}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationEmailPage;

