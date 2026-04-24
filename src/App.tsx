import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { toast } from "@/hooks/use-toast";
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

/** Durée max d'inactivité avant déconnexion forcée (7 jours, en ms). */
const SESSION_INACTIVITY_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_ACTIVITY_KEY = "autodocs_last_activity";

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
  const sessionExpiredHandledRef = useRef(false);

  // Auth bootstrap + listener. Gère aussi :
  //   - SIGNED_OUT  → redirige vers /login avec toast "Session expirée"
  //   - inactivité  → après 7 jours sans activité, on force un signOut
  useEffect(() => {
    const checkInactivityAndBoot = async () => {
      const lastActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY) ?? "0");
      const now = Date.now();
      const isExpired = lastActivity > 0 && now - lastActivity > SESSION_INACTIVITY_MS;

      if (isExpired) {
        await supabase.auth.signOut().catch(() => undefined);
        sessionExpiredHandledRef.current = true;
        setSession(null);
        setLoadingSession(false);
        toast({
          title: "Session expirée",
          description: "Vous avez été déconnecté après 7 jours d'inactivité.",
        });
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        return;
      }

      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setLoadingSession(false);
      if (data.session) {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
      }
    };
    void checkInactivityAndBoot();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      setSession(currentSession);
      if (currentSession) {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
        sessionExpiredHandledRef.current = false;
      }
      if (event === "SIGNED_OUT" && !sessionExpiredHandledRef.current) {
        localStorage.removeItem(LAST_ACTIVITY_KEY);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Refresh "last activity" sur interactions utilisateur (bornage 1/min pour
  // éviter d'écrire en localStorage à chaque mouvement de souris).
  useEffect(() => {
    if (!session) return;
    let lastWrite = 0;
    const refresh = () => {
      const now = Date.now();
      if (now - lastWrite < 60_000) return;
      lastWrite = now;
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    };
    window.addEventListener("click", refresh);
    window.addEventListener("keydown", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("click", refresh);
      window.removeEventListener("keydown", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [session]);

  // Une session sans email confirmé ne donne pas accès à l'app. On considère
  // l'utilisateur comme non-authentifié pour le router et on l'envoie sur
  // /confirmation-email avec un message dédié.
  const emailConfirmed = !!session?.user?.email_confirmed_at;
  const effectiveSession = session && emailConfirmed ? session : null;
  const needsEmailConfirmation = !!session && !emailConfirmed;

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
                  needsEmailConfirmation ? (
                    <Navigate to="/confirmation-email" replace />
                  ) : effectiveSession ? (
                    <Navigate to="/app" replace />
                  ) : (
                    <LandingRedirect />
                  )
                }
              />

              <Route
                path="/login"
                element={
                  needsEmailConfirmation ? (
                    <Navigate to="/confirmation-email" replace />
                  ) : effectiveSession ? (
                    <Navigate to="/app" replace />
                  ) : (
                    <LoginPage />
                  )
                }
              />
              <Route
                path="/inscription"
                element={
                  needsEmailConfirmation ? (
                    <Navigate to="/confirmation-email" replace />
                  ) : effectiveSession ? (
                    <Navigate to="/app" replace />
                  ) : (
                    <InscriptionPage />
                  )
                }
              />
              <Route
                path="/confirmation-email"
                element={
                  effectiveSession ? <Navigate to="/app" replace /> : <ConfirmationEmailPage />
                }
              />

              <Route
                element={
                  effectiveSession ? (
                    <AppLayout />
                  ) : needsEmailConfirmation ? (
                    <Navigate to="/confirmation-email" replace />
                  ) : (
                    <Navigate to="/login" replace />
                  )
                }
              >
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
                element={
                  effectiveSession ? (
                    <NotFound />
                  ) : needsEmailConfirmation ? (
                    <Navigate to="/confirmation-email" replace />
                  ) : (
                    <Navigate to="/login" replace />
                  )
                }
              />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
