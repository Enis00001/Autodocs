import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Variables d'environnement Supabase manquantes : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont requises.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "autodocs-auth",
  },
  // On n'utilise jamais le Realtime dans AutoDocs : le client tente sinon
  // d'ouvrir une WebSocket vers `wss://<projet>.supabase.co/realtime/v1`
  // et boucle sur `ping/waitForSuccessfulPing` → "TypeError: Failed to fetch"
  // visible dans la console à chaque action (notamment lors de l'import
  // CSV/Excel depuis StockVehicules). `eventsPerSecond: -1` désactive
  // complètement le canal.
  realtime: {
    params: { eventsPerSecond: -1 },
  },
});

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
