import { supabase } from "@/lib/supabase";

export type PdfTemplateRow = {
  id: string;
  template_name: string;
  created_at: string;
};

/** Templates PDF analysés (table pdf_templates), filtrés par concession (dealer_id = user). */
export async function loadPdfTemplates(userId: string): Promise<PdfTemplateRow[]> {
  const { data, error } = await supabase
    .from("pdf_templates")
    .select("id, template_name, created_at")
    .eq("dealer_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("loadPdfTemplates:", error);
    return [];
  }

  return (data ?? []) as PdfTemplateRow[];
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
