import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Mail } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";

const ConfirmationEmailPage = () => {
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const [loading, setLoading] = useState(false);

  const handleResend = async () => {
    if (!email) {
      toast({ title: "Email manquant", description: "Retournez à l'inscription et réessayez." });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Envoi impossible", description: error.message });
      return;
    }
    toast({ title: "Email renvoyé ✓" });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-xl card-autodocs text-center">
        <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/30 mx-auto flex items-center justify-center mb-5">
          <Mail className="w-10 h-10 text-primary" />
        </div>
        <h1 className="font-display font-bold text-2xl mb-3">Vérifiez votre email !</h1>
        <p className="text-sm text-muted-foreground max-w-lg mx-auto">
          Un email de confirmation a été envoyé à <span className="text-foreground">{email || "votre adresse email"}</span>.
          Cliquez sur le lien dans l'email pour activer votre compte.
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
          <Link to="/login" className="text-primary hover:underline">
            Retour à la connexion
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationEmailPage;

