import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

function getUrl() {
  return process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
}

function getAnonKey() {
  return (
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function getServiceRole() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ error: "Authentification requise" });
  }

  const url = getUrl();
  const anonKey = getAnonKey();
  if (!url || !anonKey) {
    return res.status(500).json({ error: "Configuration Supabase manquante" });
  }

  const supabaseAuth = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabaseAuth.auth.getUser();
  if (userErr || !user) {
    return res.status(401).json({ error: "Session invalide ou expirée" });
  }

  const userId = user.id;
  const serviceKey = getServiceRole();

  const runSelect = async (client: ReturnType<typeof createClient>) => {
    return client
      .from("pdf_templates")
      .select("id, template_name, created_at")
      .eq("dealer_id", userId)
      .order("created_at", { ascending: false });
  };

  if (serviceKey) {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await runSelect(admin);
    if (error) {
      console.error("[list-pdf-templates]", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ templates: data ?? [] });
  }

  const { data, error } = await runSelect(supabaseAuth);
  if (error) {
    console.error("[list-pdf-templates] client RLS", error);
    return res.status(500).json({ error: error.message });
  }
  return res.status(200).json({ templates: data ?? [] });
}
