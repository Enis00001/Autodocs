import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";

const LoginPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailNotConfirmed, setEmailNotConfirmed] = useState(false);
  const [resending, setResending] = useState(false);

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
    navigate("/app", { replace: true });
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
    });
    setResending(false);
    if (error) {
      toast({ title: "Envoi impossible", description: error.message });
      return;
    }
    toast({ title: "Email de confirmation renvoyé ✓" });
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

        <div className="mt-4 text-sm text-muted-foreground text-center">
          Première connexion ?{" "}
          <Link to="/inscription" className="text-primary hover:underline">
            Créer un compte
          </Link>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

