import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";

export type DashboardPeriod = "month" | "3m" | "6m" | "year";

export type MonthlyStatPoint = {
  key: string;
  month: number;
  year: number;
  label: string;
  revenue: number;
  sales: number;
  draftsSigned: number;
  draftsPending: number;
  draftsInProgress: number;
};

export type DraftSignatureState = "signed" | "pending" | "in_progress";

export type DashboardStats = {
  monthly: MonthlyStatPoint[];
  stockAvailableTotal: number;
  stockSoldTotal: number;
  draftsTotal: number;
  draftsSignedTotal: number;
  draftsPendingTotal: number;
  draftsInProgressTotal: number;
  draftStatusById: Record<string, DraftSignatureState>;
};

const MONTHS_FR = [
  "Jan",
  "Fev",
  "Mar",
  "Avr",
  "Mai",
  "Jun",
  "Jul",
  "Aou",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type BrouillonVehicleFields = {
  vehicule_stock_id?: unknown;
};

type StockSoldRow = {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  disponible: boolean | null;
};

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getPeriodStart(period: DashboardPeriod, now = new Date()): Date {
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === "3m") return new Date(now.getFullYear(), now.getMonth() - 2, 1);
  if (period === "6m") return new Date(now.getFullYear(), now.getMonth() - 5, 1);
  return new Date(now.getFullYear(), 0, 1);
}

function getHistoryStart(period: DashboardPeriod, now = new Date()): Date {
  const months = getMonthsForPeriod(period);
  return new Date(now.getFullYear(), now.getMonth() - months * 2 + 1, 1);
}

function buildLastTwelveMonths(now: Date): MonthlyStatPoint[] {
  const points: MonthlyStatPoint[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yy = String(d.getFullYear()).slice(-2);
    points.push({
      key: getMonthKey(d),
      month: d.getMonth(),
      year: d.getFullYear(),
      label: `${MONTHS_FR[d.getMonth()]} ${yy}`,
      revenue: 0,
      sales: 0,
      draftsSigned: 0,
      draftsPending: 0,
      draftsInProgress: 0,
    });
  }
  return points;
}

function getVehiculeStockId(vehicleFieldValues: unknown): string | null {
  if (!vehicleFieldValues || typeof vehicleFieldValues !== "object") return null;
  const fields = vehicleFieldValues as BrouillonVehicleFields;
  if (typeof fields.vehicule_stock_id !== "string") return null;
  const value = fields.vehicule_stock_id.trim();
  return value.length > 0 ? value : null;
}

export function getMonthsForPeriod(period: DashboardPeriod): number {
  if (period === "month") return 1;
  if (period === "3m") return 3;
  if (period === "6m") return 6;
  return 12;
}

export function sliceMonthlyByPeriod(
  monthly: MonthlyStatPoint[],
  period: DashboardPeriod,
): MonthlyStatPoint[] {
  const months = getMonthsForPeriod(period);
  return monthly.slice(-months);
}

export async function loadDashboardStats(period: DashboardPeriod = "month"): Promise<DashboardStats> {
  const uid = await getCurrentUserId();
  const now = new Date();
  void period;
  const historyStart = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();
  const empty: DashboardStats = {
    monthly: buildLastTwelveMonths(now),
    stockAvailableTotal: 0,
    stockSoldTotal: 0,
    draftsTotal: 0,
    draftsSignedTotal: 0,
    draftsPendingTotal: 0,
    draftsInProgressTotal: 0,
    draftStatusById: {},
  };
  if (!uid) return empty;

  const monthly = buildLastTwelveMonths(now);
  const byKey = new Map(monthly.map((item) => [item.key, item]));

  const [facturesRes, stockSoldRes, stockRes, draftsRes] = await Promise.all([
    supabase
      .from("factures")
      .select("id, prix_ttc, created_at, brouillon_id")
      .eq("concession_id", uid)
      .neq("statut", "annulee")
      .gte("created_at", historyStart),
    supabase
      .from("stock_vehicules")
      .select("id, created_at, updated_at, disponible")
      .eq("concession_id", uid)
      .eq("statut", "vendu"),
    supabase
      .from("stock_vehicules")
      .select("statut, disponible")
      .eq("concession_id", uid),
    supabase
      .from("brouillons")
      .select("id, created_at")
      .eq("user_id", uid)
      .gte("created_at", historyStart),
  ]);

  if (facturesRes.error) console.error("loadDashboardStats factures:", facturesRes.error);
  if (stockSoldRes.error) console.error("loadDashboardStats ventes:", stockSoldRes.error);
  if (stockRes.error) console.error("loadDashboardStats stock:", stockRes.error);
  if (draftsRes.error) console.error("loadDashboardStats brouillons:", draftsRes.error);

  const soldRows = (stockSoldRes.data ?? []) as StockSoldRow[];
  const soldVehicleIds = new Set(
    soldRows.map((row) => row.id).filter((id): id is string => typeof id === "string"),
  );

  const factureRows = facturesRes.data ?? [];
  const brouillonIds = Array.from(
    new Set(
      factureRows
        .map((row) =>
          typeof row.brouillon_id === "string" && row.brouillon_id.trim()
            ? row.brouillon_id
            : null,
        )
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const draftById = new Map<string, string>();
  if (brouillonIds.length > 0) {
    const { data: brouillonsForFactures, error: brouillonsForFacturesError } = await supabase
      .from("brouillons")
      .select("id, vehicle_field_values")
      .eq("user_id", uid)
      .in("id", brouillonIds);
    if (brouillonsForFacturesError) {
      console.error(
        "loadDashboardStats brouillons factures:",
        brouillonsForFacturesError,
      );
    }
    for (const row of brouillonsForFactures ?? []) {
      const vehiculeId = getVehiculeStockId(row.vehicle_field_values);
      if (vehiculeId && typeof row.id === "string") {
        draftById.set(row.id, vehiculeId);
      }
    }
  }

  for (const row of factureRows) {
    const brouillonId =
      typeof row.brouillon_id === "string" && row.brouillon_id.trim()
        ? row.brouillon_id
        : null;
    if (!brouillonId) continue;
    const vehiculeId = draftById.get(brouillonId);
    if (!vehiculeId || !soldVehicleIds.has(vehiculeId)) continue;

    const createdAt = typeof row.created_at === "string" ? row.created_at : "";
    if (!createdAt) continue;
    const d = new Date(createdAt);
    const key = getMonthKey(d);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    const amount = typeof row.prix_ttc === "number" ? row.prix_ttc : Number(row.prix_ttc ?? 0);
    bucket.revenue += Number.isFinite(amount) ? amount : 0;
  }

  for (const row of soldRows) {
    const eventDate = row.updated_at || row.created_at || "";
    if (!eventDate) continue;
    const d = new Date(eventDate);
    if (Number.isNaN(d.getTime()) || d < new Date(historyStart)) continue;
    const key = getMonthKey(d);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.sales += 1;
  }

  const draftRows = (draftsRes.data ?? []) as Array<{ id: string; created_at: string | null }>;
  const draftIds = draftRows
    .map((row) => (typeof row.id === "string" ? row.id.trim() : ""))
    .filter(Boolean);
  const signatureByDraft = new Map<string, { hasSigned: boolean; hasPending: boolean }>();
  if (draftIds.length > 0) {
    const { data: signaturesData, error: signaturesError } = await supabase
      .from("signature_requests")
      .select("brouillon_id, signed_at")
      .in("brouillon_id", draftIds);
    if (signaturesError) {
      console.error("loadDashboardStats signatures:", signaturesError);
    }
    for (const row of signaturesData ?? []) {
      const draftId =
        typeof row.brouillon_id === "string" ? row.brouillon_id.trim() : "";
      if (!draftId) continue;
      const current = signatureByDraft.get(draftId) ?? {
        hasSigned: false,
        hasPending: false,
      };
      if (row.signed_at) current.hasSigned = true;
      else current.hasPending = true;
      signatureByDraft.set(draftId, current);
    }
  }

  const draftStatusById: Record<string, DraftSignatureState> = {};
  for (const row of draftRows) {
    const draftId = typeof row.id === "string" ? row.id.trim() : "";
    if (!draftId) continue;
    const signatureState = signatureByDraft.get(draftId);
    const status: DraftSignatureState = signatureState?.hasSigned
      ? "signed"
      : signatureState?.hasPending
        ? "pending"
        : "in_progress";
    draftStatusById[draftId] = status;

    const createdAt = typeof row.created_at === "string" ? row.created_at : "";
    if (!createdAt) continue;
    const d = new Date(createdAt);
    const key = getMonthKey(d);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    if (status === "signed") bucket.draftsSigned += 1;
    else if (status === "pending") bucket.draftsPending += 1;
    else bucket.draftsInProgress += 1;
  }

  const stockRows = stockRes.data ?? [];
  const stockAvailableTotal = stockRows.filter((row) => row.disponible === true).length;
  const stockSoldTotal = stockRows.filter((row) => row.statut === "vendu").length;

  const draftsSignedTotal = monthly.reduce((acc, item) => acc + item.draftsSigned, 0);
  const draftsPendingTotal = monthly.reduce((acc, item) => acc + item.draftsPending, 0);
  const draftsInProgressTotal = monthly.reduce((acc, item) => acc + item.draftsInProgress, 0);

  return {
    monthly,
    stockAvailableTotal,
    stockSoldTotal,
    draftsTotal: draftsSignedTotal + draftsPendingTotal + draftsInProgressTotal,
    draftsSignedTotal,
    draftsPendingTotal,
    draftsInProgressTotal,
    draftStatusById,
  };
}

export type RecentSaleRow = {
  id: string;
  createdAt: string;
  vehicule: string;
  client: string;
  prixTtc: number | null;
  hasFacture: boolean;
};

/**
 * 5 dernières ventes (factures émises) par la concession connectée.
 * On s'appuie sur la table `factures` car elle contient déjà client +
 * véhicule + prix dans le même enregistrement (pas de jointure nécessaire).
 * RLS : `concession_id = auth.uid()`.
 */
export async function loadRecentSales(
  period: DashboardPeriod = "month",
  limit = 5,
): Promise<RecentSaleRow[]> {
  const uid = await getCurrentUserId();
  if (!uid) return [];
  void period;

  const { data: stockData, error: stockError } = await supabase
    .from("stock_vehicules")
    .select("id, donnees, marque, modele, updated_at, created_at")
    .eq("concession_id", uid)
    .eq("statut", "vendu")
    .order("updated_at", { ascending: false })
    .limit(limit * 6);
  if (stockError) {
    console.error("loadRecentSales stock:", stockError);
    throw new Error(stockError.message);
  }

  const soldRows = stockData ?? [];
  const soldIds = soldRows.map((row) => String(row.id));
  const { data: brouillonsData, error: brouillonsError } = await supabase
    .from("brouillons")
    .select("id, vehicle_field_values")
    .eq("user_id", uid);
  if (brouillonsError) {
    console.error("loadRecentSales brouillons:", brouillonsError);
  }
  const brouillonByVehicule = new Map<string, string>();
  for (const row of brouillonsData ?? []) {
    const vehiculeId = getVehiculeStockId(row.vehicle_field_values);
    if (!vehiculeId || !soldIds.includes(vehiculeId)) continue;
    if (typeof row.id === "string" && row.id.trim()) {
      brouillonByVehicule.set(vehiculeId, row.id);
    }
  }
  const brouillonIds = Array.from(new Set(brouillonByVehicule.values()));
  const factureByBrouillon = new Map<
    string,
    { client: string; prixTtc: number; createdAt: string }
  >();
  if (brouillonIds.length > 0) {
    const { data: facturesData, error: facturesError } = await supabase
      .from("factures")
      .select("brouillon_id, client_nom, client_prenom, prix_ttc, created_at")
      .eq("concession_id", uid)
      .neq("statut", "annulee")
      .in("brouillon_id", brouillonIds)
      .order("created_at", { ascending: false });
    if (facturesError) {
      console.error("loadRecentSales factures:", facturesError);
    }
    for (const row of facturesData ?? []) {
      const brouillonId =
        typeof row.brouillon_id === "string" ? row.brouillon_id.trim() : "";
      if (!brouillonId || factureByBrouillon.has(brouillonId)) continue;
      const client = [row.client_prenom, row.client_nom]
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean)
        .join(" ");
      const prix =
        typeof row.prix_ttc === "number" ? row.prix_ttc : Number(row.prix_ttc ?? 0);
      factureByBrouillon.set(brouillonId, {
        client: client || "Facture non générée",
        prixTtc: Number.isFinite(prix) ? prix : 0,
        createdAt: typeof row.created_at === "string" ? row.created_at : "",
      });
    }
  }

  return soldRows
    .map((row) => {
      const d =
        row.donnees && typeof row.donnees === "object"
          ? (row.donnees as Record<string, unknown>)
          : {};
      const vehicule = [row.marque, row.modele, d.modele, d.version]
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean)
        .slice(0, 3)
        .join(" ");
      const soldAt =
        typeof row.updated_at === "string" && row.updated_at
          ? row.updated_at
          : typeof row.created_at === "string"
            ? row.created_at
            : "";
      const brouillonId = brouillonByVehicule.get(String(row.id));
      const facture = brouillonId ? factureByBrouillon.get(brouillonId) : undefined;
      return {
        id: String(row.id),
        createdAt: facture?.createdAt || soldAt,
        vehicule: vehicule || "—",
        client: facture?.client || "Facture non générée",
        prixTtc: facture ? facture.prixTtc : null,
        hasFacture: Boolean(facture),
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}
