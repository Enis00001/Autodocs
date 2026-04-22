import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, Compass } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.warn(`[404] Route inconnue : ${location.pathname}`);
    }
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#0F1117] p-4 text-[#F1F5F9]">
      <div className="w-full max-w-md rounded-card border border-white/[0.08] bg-[#1A1D27] p-8 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Compass className="h-7 w-7" aria-hidden />
        </div>
        <div className="mb-2 font-display text-5xl font-extrabold gradient-text">404</div>
        <h1 className="font-display text-lg font-bold text-foreground">Page introuvable</h1>
        <p className="mt-2 text-sm text-[#94A3B8]">
          La page que vous cherchez n'existe pas ou a été déplacée.
        </p>
        <Link
          to="/"
          className="btn-primary mt-6 inline-flex w-full cursor-pointer sm:w-auto"
        >
          <Home className="h-4 w-4" />
          Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
