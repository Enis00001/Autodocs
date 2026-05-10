import { supabase } from "@/lib/supabase";
import { getCurrentConcessionId, getCurrentUserId } from "@/lib/auth";

export type Template = {
  id: string;
  name: string;
  date: string;
  /** Contenu du fichier en base64 (pour ouvrir dans un nouvel onglet). */
  contentBase64?: string;
  /** Type MIME du fichier (ex. application/pdf). */
  mimeType?: string;
};

const LOCAL_STORAGE_KEY = "autodocs_templates";
const MIGRATION_FLAG_KEY = "autodocs_migrated_templates_v1";

type TemplateRow = {
  id: string;
  nom: string;
  date_import: string;
  fichier_base64: string | null;
  type: string | null;
};

function rowToTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.nom,
    date: row.date_import,
    contentBase64: row.fichier_base64 ?? undefined,
    mimeType: row.type ?? undefined,
  };
}

function templateToRow(t: Template) {
  return {
    id: t.id,
    nom: t.name,
    date_import: t.date,
    fichier_base64: t.contentBase64 ?? null,
    type: t.mimeType ?? null,
  };
}

function readLocalTemplates(): Template[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // On fait une validation légère : on ne garde que les objets qui ressemblent à Template.
    return parsed.filter(
      (t) =>
        t &&
        typeof t === "object" &&
        typeof (t as any).id === "string" &&
        typeof (t as any).name === "string" &&
        typeof (t as any).date === "string"
    ) as Template[];
  } catch {
    return [];
  }
}

function getMigrationFlag(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(MIGRATION_FLAG_KEY) === "1";
}

function setMigrationFlag(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MIGRATION_FLAG_KEY, "1");
}

export async function loadTemplates(): Promise<Template[]> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return [];
  const { data, error } = await supabase
    .from("templates")
    .select("id, nom, date_import, fichier_base64, type")
    .eq("concession_id", concessionId)
    .order("date_import", { ascending: false });

  if (error) {
    console.error("loadTemplates:", error);
    return [];
  }

  return (data ?? []).map((row) => rowToTemplate(row as TemplateRow));
}

/** Insère (ou met à jour) un template dans Supabase. */
export async function saveTemplate(template: Template): Promise<Template> {
  const [concessionId, userId] = await Promise.all([
    getCurrentConcessionId(),
    getCurrentUserId(),
  ]);
  if (!concessionId) return template;
  const row = templateToRow(template);
  // `user_id` reste écrit pour back-compat (colonne legacy NOT NULL dans
  // certaines bases). `concession_id` est la source de vérité partagée.
  const payload = { ...row, user_id: userId, concession_id: concessionId };
  const result = await supabase
    .from("templates")
    .upsert(payload, { onConflict: "id" });
  if (result.error) console.error("saveTemplate:", result.error);
  return template;
}

export async function createTemplate(
  name: string,
  date: string,
  contentBase64?: string,
  mimeType?: string,
  /** Si fourni, utilise cet ID au lieu d'en générer un nouveau (pour partager l'ID avec pdf_templates). */
  existingId?: string
): Promise<Template> {
  const template: Template = {
    id: existingId ?? crypto.randomUUID(),
    name,
    date,
    contentBase64,
    mimeType,
  };
  await saveTemplate(template);
  return template;
}

export async function deleteTemplate(id: string): Promise<void> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return;
  const { error } = await supabase
    .from("templates")
    .delete()
    .eq("id", id)
    .eq("concession_id", concessionId);
  if (error) console.error("deleteTemplate:", error);
}

/** Crée une blob URL à partir du contenu base64 du template et l'ouvre dans un nouvel onglet. */
export function openTemplateInNewTab(template: Template): void {
  if (!template.contentBase64 || !template.mimeType) return;
  const binary = atob(template.contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: template.mimeType });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

/** Templates par défaut (avec IDs uniques) pour le premier chargement. */
export function getDefaultTemplates(): Template[] {
  return [
    { id: crypto.randomUUID(), name: "Auto Dupont — Standard", date: "12 jan. 2026" },
    { id: crypto.randomUUID(), name: "Auto Dupont — LOA", date: "5 déc. 2025" },
    { id: crypto.randomUUID(), name: "Auto Dupont — LLD", date: "18 nov. 2025" },
  ];
}

export async function seedTemplatesIfEmpty(): Promise<Template[]> {
  const [concessionId, userId] = await Promise.all([
    getCurrentConcessionId(),
    getCurrentUserId(),
  ]);
  if (!concessionId) return [];
  void (await loadTemplates());

  // Migration one-shot depuis localStorage (même si DB pas vide).
  const localTemplates = readLocalTemplates();
  const importedLocalTemplates = localTemplates.filter((t) => !!t.contentBase64);
  if (importedLocalTemplates.length > 0 && !getMigrationFlag()) {
    const rows = importedLocalTemplates.map((t) => ({
      ...templateToRow(t),
      user_id: userId,
      concession_id: concessionId,
    }));
    const result = await supabase.from("templates").upsert(rows, { onConflict: "id" });
    if (result.error) console.error("seedTemplatesIfEmpty (migration):", result.error);
    setMigrationFlag();
  }

  // Reload après migration (éventuelle) ou state initial.
  const after = await loadTemplates();
  if (after.length > 0) return after;

  // Sinon : seed des templates par défaut.
  const defaults = getDefaultTemplates();
  const rows = defaults.map((t) => ({
    ...templateToRow(t),
    user_id: userId,
    concession_id: concessionId,
  }));
  const result = await supabase.from("templates").upsert(rows, { onConflict: "id" });
  if (result.error) console.error("seedTemplatesIfEmpty (defaults):", result.error);
  return loadTemplates();
}
