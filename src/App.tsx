import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import AppLayout from "./components/layout/AppLayout";
import NouveauBon from "./pages/NouveauBon";
import Dashboard from "./pages/Dashboard";
import Historique from "./pages/Historique";
import TemplatesPage from "./pages/Templates";
import VehicleFieldsPage from "./pages/VehicleFields";
import StockVehicules from "./pages/StockVehicules";
import Parametres from "./pages/Parametres";
import Preferences from "./pages/Preferences";
import Abonnement from "./pages/Abonnement";
import NotFound from "./pages/NotFound";
import LoginPage from "./pages/Login";
import InscriptionPage from "./pages/Inscription";
import ConfirmationEmailPage from "./pages/ConfirmationEmail";
import { supabase } from "./lib/supabase";
import ErrorBoundary from "./components/ErrorBoundary";

const queryClient = new QueryClient();

/**
 * Route "/" non-connectée : on force un reload complet pour que Vercel
 * serve le fichier statique `/landing.html`. Sans ça, React Router resterait
 * sur la route "/" côté SPA et afficherait la page blanche / le 404 du router.
 */
const LandingRedirect = () => {
  useEffect(() => {
    // En prod : `/` est rewrite par Vercel vers /landing.html.
    // En dev Vite : pour éviter une boucle infinie, on va direct au /login.
    if (import.meta.env.DEV) {
      window.location.replace("/login");
    } else {
      window.location.replace("/landing.html");
    }
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0F1117] text-muted-foreground">
      <p className="text-sm">Redirection…</p>
    </div>
  );
};

const App = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (loadingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0F1117] text-muted-foreground">
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-12 w-12 animate-pulse rounded-card bg-primary/20"
            style={{ boxShadow: "0 0 32px rgba(99, 102, 241, 0.3)" }}
          />
          <div className="skeleton h-2 w-36 rounded-full" />
          <p className="text-sm font-medium text-[#94A3B8]">Chargement d&apos;AutoDocs…</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              {/* Route "/" côté React : si un utilisateur connecté atterrit ici
                  via une navigation client, on l'envoie direct à /app. Sinon
                  on le renvoie sur la landing statique (rewrite Vercel). */}
              <Route
                path="/"
                element={
                  session ? <Navigate to="/app" replace /> : <LandingRedirect />
                }
              />

              <Route
                path="/login"
                element={session ? <Navigate to="/app" replace /> : <LoginPage />}
              />
              <Route
                path="/inscription"
                element={session ? <Navigate to="/app" replace /> : <InscriptionPage />}
              />
              <Route
                path="/confirmation-email"
                element={
                  session ? <Navigate to="/app" replace /> : <ConfirmationEmailPage />
                }
              />

              <Route element={session ? <AppLayout /> : <Navigate to="/login" replace />}>
                <Route path="/app" element={<Dashboard />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/nouveau-bon" element={<NouveauBon />} />
                <Route path="/nouveau-bon/:id" element={<NouveauBon />} />
                <Route path="/historique" element={<Historique />} />
                <Route path="/templates" element={<TemplatesPage />} />
                <Route path="/infos-vehicule" element={<VehicleFieldsPage />} />
                <Route path="/stock-vehicules" element={<StockVehicules />} />
                <Route path="/parametres" element={<Parametres />} />
                <Route path="/preferences" element={<Preferences />} />
                <Route path="/abonnement" element={<Abonnement />} />
              </Route>
              <Route
                path="*"
                element={session ? <NotFound /> : <Navigate to="/login" replace />}
              />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
