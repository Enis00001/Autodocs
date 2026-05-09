import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import { getSignupEmailRedirectTo } from "@/lib/auth";

/**
 * Transforme une erreur `supabase.auth.signUp` en message utilisateur
 * actionnable. La cause la plus fréquente en prod est `Error sending
 * confirmation email` : le SMTP custom (Resend) est mal configuré OU
 * Supabase utilise son SMTP gratuit dont la limite (3 emails/heure
 * hors localhost) est atteinte.
 */
function describeSignupError(error: AuthError | { message: string; status?: number }): {
  title: string;
  description: string;
} {
  const raw = (error.message || "").toLowerCase();
  const status = "status" in error ? error.status : undefined;

  if (raw.includes("confirmation") && raw.includes("email")) {
    return {
      title: "Envoi de l'email de confirmation impossible",
      description:
        "Le serveur SMTP n'a pas pu envoyer l'email. Vérifiez la configuration Resend dans Supabase → Authentication → SMTP Settings (host: smtp.resend.com, port: 465, user: resend, password: votre RESEND_API_KEY) et que le domaine d'expédition est validé sur Resend.",
    };
  }
  if (raw.includes("send") && raw.includes("email")) {
    return {
      title: "Envoi d'email impossible",
      description:
        "Supabase n'a pas pu envoyer l'email (SMTP custom non configuré ou quota atteint — limite 3 emails/h sans SMTP custom). Configurez Resend dans Supabase → Authentication → SMTP Settings.",
    };
  }
  if (raw.includes("user already registered") || raw.includes("already exists")) {
    return {
      title: "Adresse déjà utilisée",
      description:
        "Un compte existe déjà avec cet email. Connectez-vous ou utilisez 'Mot de passe oublié'.",
    };
  }
  if (raw.includes("password")) {
    return {
      title: "Mot de passe refusé",
      description: error.message,
    };
  }
  if (raw.includes("rate limit") || status === 429) {
    return {
      title: "Trop de tentatives",
      description:
        "Vous avez dépassé la limite d'inscriptions. Patientez quelques minutes avant de réessayer.",
    };
  }

  return {
    title: "Inscription impossible",
    description: error.message || "Erreur inconnue côté Supabase Auth.",
  };
}

const InscriptionPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [concessionName, setConcessionName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const planRaw = searchParams.get("plan");
  const plan: "monthly" | "annual" | null =
    planRaw === "monthly" || planRaw === "annual" ? planRaw : null;
  const loginHref = plan ? `/login?plan=${plan}` : "/login";

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({
        title: "Erreur",
        description: "Les mots de passe ne correspondent pas.",
        variant: "destructive",
      });
      return;
    }
    if (password.length < 6) {
      toast({
        title: "Mot de passe trop court",
        description: "Le mot de passe doit contenir au moins 6 caractères.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: getSignupEmailRedirectTo(plan),
        data: {
          concession_name: concessionName.trim(),
        },
      },
    });
    setLoading(false);

    if (error) {
      // On loggue toujours l'erreur brute pour aider au debug (status, code, etc.)
      console.error("[Inscription] supabase.auth.signUp error:", {
        message: error.message,
        status: error.status,
        name: error.name,
      });
      const friendly = describeSignupError(error);
      toast({
        title: friendly.title,
        description: friendly.description,
        variant: "destructive",
      });
      return;
    }

    // Cas particulier : signUp peut renvoyer une réponse OK mais sans user
    // (très rare — confirmation déjà existante). On affiche un message sûr.
    if (!data?.user) {
      toast({
        title: "Compte non créé",
        description:
          "Réponse inattendue de Supabase. Réessayez ou contactez le support.",
        variant: "destructive",
      });
      return;
    }

    // Forcer le flux "confirmation email" : pas de connexion directe
    await supabase.auth.signOut();

    toast({
      title: "Compte créé ✓",
      description: "Vérifiez votre email pour confirmer votre compte.",
    });
    // On propage le plan jusqu'à la page de confirmation pour qu'après la
    // validation de l'email + connexion, le checkout Stripe soit déclenché
    // avec le bon intervalle.
    const qs = new URLSearchParams({ email: email.trim() });
    if (plan) qs.set("plan", plan);
    navigate(`/confirmation-email?${qs.toString()}`, { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md card-autodocs">
        <div className="font-display font-extrabold text-2xl mb-6 text-center tracking-tight">
          Auto<span className="gradient-text">Docs</span>
        </div>
        <h1 className="text-lg font-semibold mb-1">Créer un compte</h1>
        <p className="text-sm text-muted-foreground mb-5">Configurez votre concession</p>

        <form className="space-y-3" onSubmit={handleSignup}>
          <div className="flex flex-col gap-1.5">
            <label className="field-label">Nom de la concession</label>
            <input
              type="text"
              className="field-input"
              value={concessionName}
              onChange={(e) => setConcessionName(e.target.value)}
              required
            />
          </div>
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
          <div className="flex flex-col gap-1.5">
            <label className="field-label">Confirmer mot de passe</label>
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
            disabled={loading}
            className="w-full mt-2 px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Création..." : "Créer mon compte"}
          </button>
        </form>

        <div className="mt-4 text-sm text-muted-foreground text-center">
          Déjà un compte ?{" "}
          <Link to={loginHref} className="text-primary hover:underline">
            Se connecter
          </Link>
        </div>
      </div>
    </div>
  );
};

export default InscriptionPage;

