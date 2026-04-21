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
import NotFound from "./pages/NotFound";
import LoginPage from "./pages/Login";
import InscriptionPage from "./pages/Inscription";
import ConfirmationEmailPage from "./pages/ConfirmationEmail";
import { supabase } from "./lib/supabase";

const queryClient = new QueryClient();

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
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        Chargement...
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route
              path="/login"
              element={session ? <Navigate to="/" replace /> : <LoginPage />}
            />
            <Route
              path="/inscription"
              element={session ? <Navigate to="/" replace /> : <InscriptionPage />}
            />
            <Route
              path="/confirmation-email"
              element={session ? <Navigate to="/" replace /> : <ConfirmationEmailPage />}
            />
            <Route element={session ? <AppLayout /> : <Navigate to="/login" replace />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/nouveau-bon" element={<NouveauBon />} />
              <Route path="/nouveau-bon/:id" element={<NouveauBon />} />
              <Route path="/historique" element={<Historique />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/infos-vehicule" element={<VehicleFieldsPage />} />
              <Route path="/stock-vehicules" element={<StockVehicules />} />
              <Route path="/parametres" element={<Parametres />} />
            </Route>
            <Route path="*" element={session ? <NotFound /> : <Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
