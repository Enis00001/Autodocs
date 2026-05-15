import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { getCurrentConcessionId } from "@/lib/auth";
import { apiFetch } from "@/lib/apiClient";

export type FactureStatut = "emise" | "payee" | "annulee";

export type FacturePeriodFilter = "month" | "3months" | "6months" | "all";

function formatExportDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR");
}

function formatExportMoney(n: number | null | undefined): string {
  const v = Number(n);
  if (Number.isNaN(v)) return "0.00";
  return v.toFixed(2);
}

export function filterFacturesByPeriod(
  factures: FactureRecord[],
  period: FacturePeriodFilter,
): FactureRecord[] {
  if (period === "all") return factures;
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "month") {
    start.setDate(1);
  } else if (period === "3months") {
    start.setMonth(start.getMonth() - 3);
  } else {
    start.setMonth(start.getMonth() - 6);
  }
  return factures.filter((f) => {
    if (!f.date_facture) return false;
    const d = new Date(f.date_facture);
    if (Number.isNaN(d.getTime())) return false;
    return d >= start && d <= end;
  });
}

export function exportFacturesCSV(factures: FactureRecord[]): void {
  const headers = [
    "N° Facture",
    "Date",
    "Client Nom",
    "Client Prénom",
    "Client Email",
    "Véhicule Marque",
    "Véhicule Modèle",
    "Prix HT (€)",
    "TVA (€)",
    "Prix TTC (€)",
    "Acompte (€)",
    "Reste à payer (€)",
    "Statut",
    "Email envoyé le",
  ];

  const rows = factures.map((f) => [
    f.numero_facture || "",
    formatExportDate(f.date_facture),
    f.client_nom || "",
    f.client_prenom || "",
    f.client_email || "",
    f.vehicule_marque || "",
    f.vehicule_modele || "",
    formatExportMoney(f.prix_ht),
    formatExportMoney(f.tva_montant),
    formatExportMoney(f.prix_ttc),
    formatExportMoney(f.acompte),
    formatExportMoney(f.reste_a_payer),
    f.statut || "",
    f.email_envoye_at ? formatExportDate(f.email_envoye_at) : "Non envoyé",
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
    .join("\n");

  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `factures-autodocs-${new Date().toISOString().split("T")[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportFacturesExcel(factures: FactureRecord[]): void {
  const data = factures.map((f) => ({
    "N° Facture": f.numero_facture || "",
    Date: formatExportDate(f.date_facture),
    "Nom client": f.client_nom || "",
    "Prénom client": f.client_prenom || "",
    "Email client": f.client_email || "",
    Marque: f.vehicule_marque || "",
    Modèle: f.vehicule_modele || "",
    "Prix HT (€)": f.prix_ht ?? 0,
    "TVA (€)": f.tva_montant ?? 0,
    "Prix TTC (€)": f.prix_ttc ?? 0,
    "Acompte (€)": f.acompte ?? 0,
    "Reste à payer (€)": f.reste_a_payer ?? 0,
    Statut: f.statut || "",
    "Email envoyé": f.email_envoye_at
      ? formatExportDate(f.email_envoye_at)
      : "Non envoyé",
  }));

  const ws = XLSX.utils.json_to_sheet(data);

  ws["!cols"] = [
    { wch: 18 },
    { wch: 12 },
    { wch: 15 },
    { wch: 15 },
    { wch: 28 },
    { wch: 12 },
    { wch: 15 },
    { wch: 12 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 15 },
    { wch: 12 },
    { wch: 16 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Factures");

  const totalTTC = factures.reduce((s, f) => s + (f.prix_ttc ?? 0), 0);
  const totalHT = factures.reduce((s, f) => s + (f.prix_ht ?? 0), 0);
  const totalTVA = factures.reduce((s, f) => s + (f.tva_montant ?? 0), 0);

  const recap = [
    { Récapitulatif: "Nombre de factures", Valeur: factures.length },
    { Récapitulatif: "Total HT", Valeur: `${totalHT.toFixed(2)} €` },
    { Récapitulatif: "Total TVA", Valeur: `${totalTVA.toFixed(2)} €` },
    { Récapitulatif: "Total TTC", Valeur: `${totalTTC.toFixed(2)} €` },
    {
      Récapitulatif: "Export généré le",
      Valeur: new Date().toLocaleDateString("fr-FR"),
    },
  ];

  const wsRecap = XLSX.utils.json_to_sheet(recap);
  wsRecap["!cols"] = [{ wch: 25 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsRecap, "Récapitulatif");

  XLSX.writeFile(wb, `factures-autodocs-${new Date().toISOString().split("T")[0]}.xlsx`);
}

export type FactureRecord = {
  id: string;
  concession_id: string;
  brouillon_id: string | null;
  client_id: string | null;
  numero_facture: string;
  date_facture: string;
  date_livraison: string | null;
  concession_nom: string | null;
  concession_siret: string | null;
  concession_adresse: string | null;
  concession_telephone: string | null;
  concession_email: string | null;
  concession_tva_intracommunautaire: string | null;
  client_nom: string | null;
  client_prenom: string | null;
  client_adresse: string | null;
  client_email: string | null;
  client_telephone: string | null;
  vehicule_marque: string | null;
  vehicule_modele: string | null;
  vehicule_version: string | null;
  vehicule_annee: string | null;
  vehicule_kilometrage: string | null;
  vehicule_vin: string | null;
  vehicule_immatriculation: string | null;
  vehicule_couleur: string | null;
  vehicule_energie: string | null;
  prix_ht: number | null;
  tva_taux: number | null;
  tva_montant: number | null;
  prix_ttc: number | null;
  acompte: number | null;
  reste_a_payer: number | null;
  reprise_vehicule_description: string | null;
  reprise_montant: number | null;
  prestations_supplementaires: unknown;
  statut: FactureStatut;
  notes: string | null;
  pdf_base64: string | null;
  /**
   * Date/heure du dernier envoi par email de la facture au client
   * (NULL si jamais envoyée). Renseignée par l'action serveur
   * `send-facture-email` (cf. api/actions.ts).
   */
  email_envoye_at: string | null;
  created_at: string;
};

export type GenerateFacturePayload = {
  brouillon_id: string;
  client_adresse?: string;
  client_email?: string;
  client_telephone?: string;
  notes?: string;
  tva_taux?: number;
};

export type GenerateFactureResult = {
  ok: boolean;
  duplicate?: boolean;
  factureId?: string;
  numero_facture?: string;
  pdfBase64?: string;
  error?: string;
};

function notifyFacturesUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autodocs_factures_updated"));
  }
}

const FACTURE_SELECT_COLS =
  "id, concession_id, brouillon_id, client_id, numero_facture, date_facture, date_livraison, concession_nom, concession_siret, concession_adresse, concession_telephone, concession_email, concession_tva_intracommunautaire, client_nom, client_prenom, client_adresse, client_email, client_telephone, vehicule_marque, vehicule_modele, vehicule_version, vehicule_annee, vehicule_kilometrage, vehicule_vin, vehicule_immatriculation, vehicule_couleur, vehicule_energie, prix_ht, tva_taux, tva_montant, prix_ttc, acompte, reste_a_payer, reprise_vehicule_description, reprise_montant, prestations_supplementaires, statut, notes, pdf_base64, email_envoye_at, created_at";

export async function generateFacture(
  payload: GenerateFacturePayload,
): Promise<GenerateFactureResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  const concessionId = await getCurrentConcessionId();
  console.log("generateFacture — userId:", userId, "concession_id:", concessionId);

  const res = await apiFetch("/api/actions", {
    method: "POST",
    body: JSON.stringify({
      action: "generate-facture",
      concession_id: concessionId ?? undefined,
      ...payload,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error: typeof body.error === "string" ? body.error : "Génération impossible",
    };
  }
  notifyFacturesUpdated();
  return {
    ok: true,
    duplicate: body.duplicate === true,
    factureId: typeof body.factureId === "string" ? body.factureId : undefined,
    numero_facture:
      typeof body.numero_facture === "string" ? body.numero_facture : undefined,
    pdfBase64: typeof body.pdfBase64 === "string" ? body.pdfBase64 : undefined,
  };
}

export async function getFactures(): Promise<FactureRecord[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  console.log("getFactures - userId:", session?.user?.id);

  const concessionId = await getCurrentConcessionId();
  console.log("getFactures - concessionId (filtre):", concessionId);

  if (!concessionId) {
    console.log("getFactures — aucune concession active, retour [].");
    return [];
  }

  const { data, error } = await supabase
    .from("factures")
    .select(FACTURE_SELECT_COLS)
    .eq("concession_id", concessionId)
    .order("created_at", { ascending: false });

  console.log("Factures trouvées:", data);
  console.log("Erreur getFactures:", error);

  if (error) {
    console.error("getFactures:", error);
    throw new Error(error.message || "Impossible de charger les factures.");
  }
  return (data ?? []) as FactureRecord[];
}

export async function getFactureById(id: string): Promise<FactureRecord | null> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return null;
  const { data, error } = await supabase
    .from("factures")
    .select(FACTURE_SELECT_COLS)
    .eq("id", id)
    .eq("concession_id", concessionId)
    .maybeSingle();
  if (error) {
    console.error("getFactureById:", error);
    return null;
  }
  return data ? (data as FactureRecord) : null;
}

export async function getFactureByBrouillonId(
  brouillonId: string,
): Promise<FactureRecord | null> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return null;
  const { data, error } = await supabase
    .from("factures")
    .select(FACTURE_SELECT_COLS)
    .eq("brouillon_id", brouillonId)
    .eq("concession_id", concessionId)
    .maybeSingle();
  if (error) {
    console.error("getFactureByBrouillonId:", error);
    return null;
  }
  return data ? (data as FactureRecord) : null;
}

export async function getFacturesByClient(clientId: string): Promise<FactureRecord[]> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return [];
  const { data, error } = await supabase
    .from("factures")
    .select(FACTURE_SELECT_COLS)
    .eq("client_id", clientId)
    .eq("concession_id", concessionId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getFacturesByClient:", error);
    return [];
  }
  return (data ?? []) as FactureRecord[];
}

export async function updateFactureStatut(
  id: string,
  statut: FactureStatut,
): Promise<void> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) throw new Error("Session expirée.");
  const { error } = await supabase
    .from("factures")
    .update({ statut })
    .eq("id", id)
    .eq("concession_id", concessionId);
  if (error) {
    console.error("updateFactureStatut:", error);
    throw new Error(error.message || "Mise à jour impossible.");
  }
  notifyFacturesUpdated();
}

export type SendFactureEmailPayload = {
  facture_id: string;
  client_email: string;
  client_nom?: string;
  client_prenom?: string;
  numero_facture?: string;
  /** Si fourni, évite une lecture supabase côté serveur. */
  pdf_base64?: string;
};

export type SendFactureEmailResult = {
  ok: boolean;
  email_envoye_at?: string;
  error?: string;
};

/**
 * Envoie la facture PDF par email au client.
 *
 * Le serveur (cf. api/actions.ts → handleSendFactureEmail) :
 *   1. Vérifie l'appartenance de la facture à la concession active.
 *   2. Envoie l'email via Resend avec le PDF en pièce jointe.
 *   3. Persiste `email_envoye_at = now()` sur la ligne `factures`.
 *
 * Notifie ensuite l'app via `autodocs_factures_updated` pour rafraîchir
 * la liste (badge « ✓ Envoyé »).
 */
export async function sendFactureEmail(
  payload: SendFactureEmailPayload,
): Promise<SendFactureEmailResult> {
  const res = await apiFetch("/api/actions", {
    method: "POST",
    body: JSON.stringify({ action: "send-facture-email", ...payload }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error: typeof body.error === "string" ? body.error : "Envoi impossible",
    };
  }
  notifyFacturesUpdated();
  return {
    ok: true,
    email_envoye_at:
      typeof body.email_envoye_at === "string" ? body.email_envoye_at : undefined,
  };
}
