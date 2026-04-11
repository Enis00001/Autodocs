import { supabase } from "@/lib/supabase";
import { loadTemplates } from "@/utils/templates";

export type PdfTemplateRow = {
  id: string;
  template_name: string;
  created_at: string;
};

async function loadPdfTemplatesViaApi(): Promise<PdfTemplateRow[] | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;

  const res = await fetch("/api/list-pdf-templates", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.warn("loadPdfTemplates API:", res.status, err);
    return null;
  }

  const json = (await res.json()) as { templates?: PdfTemplateRow[] };
  return json.templates ?? [];
}

/** Fallback : lecture directe Supabase (soumis aux RLS). */
async function loadPdfTemplatesDirect(userId: string): Promise<PdfTemplateRow[]> {
  const { data, error } = await supabase
    .from("pdf_templates")
    .select("id, template_name, created_at")
    .eq("dealer_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("loadPdfTemplates direct:", error);
    return [];
  }

  return (data ?? []) as PdfTemplateRow[];
}

/**
 * Templates analysés (table `pdf_templates`).
 * Préfère l’API serveur (JWT + service role) pour éviter les listes vides si les RLS client bloquent.
 */
export async function loadPdfTemplates(userId: string): Promise<PdfTemplateRow[]> {
  const viaApi = await loadPdfTemplatesViaApi();
  if (viaApi !== null) {
    return viaApi;
  }
  return loadPdfTemplatesDirect(userId);
}

/** Indique si la bibliothèque `templates` contient au moins une entrée (affiche un message plus précis si `pdf_templates` est vide). */
export async function hasEntriesInTemplatesTable(): Promise<boolean> {
  const list = await loadTemplates();
  return list.length > 0;
}

/** Choisit un id valide dans la liste, ou "" si aucune liste. */
export function pickPdfTemplateId(
  list: Pick<PdfTemplateRow, "id">[],
  current: string | undefined
): string {
  if (list.length === 0) return "";
  const ids = new Set(list.map((t) => t.id));
  if (current && current !== "1" && ids.has(current)) return current;
  return list[0].id;
}
