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
};

export type DashboardStats = {
  monthly: MonthlyStatPoint[];
  stockAvailableTotal: number;
  stockSoldTotal: number;
  draftsTotal: number;
  draftsSignedTotal: number;
  draftsPendingTotal: number;
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

type DraftVehicleFields = {
  client_signed_at?: unknown;
};

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildLastTwelveMonths(now: Date): MonthlyStatPoint[] {
  const points: MonthlyStatPoint[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    points.push({
      key: getMonthKey(d),
      month: d.getMonth(),
      year: d.getFullYear(),
      label: MONTHS_FR[d.getMonth()],
      revenue: 0,
      sales: 0,
      draftsSigned: 0,
      draftsPending: 0,
    });
  }
  return points;
}

function hasClientSignature(vehicleFieldValues: unknown): boolean {
  if (!vehicleFieldValues || typeof vehicleFieldValues !== "object") return false;
  const fields = vehicleFieldValues as DraftVehicleFields;
  return typeof fields.client_signed_at === "string" && fields.client_signed_at.trim().length > 0;
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

export async function loadDashboardStats(): Promise<DashboardStats> {
  const uid = await getCurrentUserId();
  const empty: DashboardStats = {
    monthly: buildLastTwelveMonths(new Date()),
    stockAvailableTotal: 0,
    stockSoldTotal: 0,
    draftsTotal: 0,
    draftsSignedTotal: 0,
    draftsPendingTotal: 0,
  };
  if (!uid) return empty;

  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();
  const monthly = buildLastTwelveMonths(now);
  const byKey = new Map(monthly.map((item) => [item.key, item]));

  const [facturesRes, ventesRes, stockRes, draftsRes] = await Promise.all([
    supabase
      .from("factures")
      .select("prix_ttc, created_at")
      .eq("concession_id", uid)
      .gte("created_at", since),
    supabase
      .from("stock_vehicules")
      .select("statut, created_at")
      .eq("concession_id", uid)
      .eq("statut", "vendu")
      .gte("created_at", since),
    supabase
      .from("stock_vehicules")
      .select("statut, disponible")
      .eq("concession_id", uid),
    supabase
      .from("brouillons")
      .select("created_at, vehicle_field_values")
      .eq("user_id", uid)
      .gte("created_at", since),
  ]);

  if (facturesRes.error) console.error("loadDashboardStats factures:", facturesRes.error);
  if (ventesRes.error) console.error("loadDashboardStats ventes:", ventesRes.error);
  if (stockRes.error) console.error("loadDashboardStats stock:", stockRes.error);
  if (draftsRes.error) console.error("loadDashboardStats brouillons:", draftsRes.error);

  for (const row of facturesRes.data ?? []) {
    const createdAt = typeof row.created_at === "string" ? row.created_at : "";
    if (!createdAt) continue;
    const d = new Date(createdAt);
    const key = getMonthKey(d);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    const amount = typeof row.prix_ttc === "number" ? row.prix_ttc : Number(row.prix_ttc ?? 0);
    bucket.revenue += Number.isFinite(amount) ? amount : 0;
  }

  for (const row of ventesRes.data ?? []) {
    const createdAt = typeof row.created_at === "string" ? row.created_at : "";
    if (!createdAt) continue;
    const d = new Date(createdAt);
    const key = getMonthKey(d);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.sales += 1;
  }

  for (const row of draftsRes.data ?? []) {
    const createdAt = typeof row.created_at === "string" ? row.created_at : "";
    if (!createdAt) continue;
    const d = new Date(createdAt);
    const key = getMonthKey(d);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    if (hasClientSignature(row.vehicle_field_values)) {
      bucket.draftsSigned += 1;
    } else {
      bucket.draftsPending += 1;
    }
  }

  const stockRows = stockRes.data ?? [];
  const stockAvailableTotal = stockRows.filter((row) => row.disponible === true).length;
  const stockSoldTotal = stockRows.filter((row) => row.statut === "vendu").length;

  const draftsSignedTotal = monthly.reduce((acc, item) => acc + item.draftsSigned, 0);
  const draftsPendingTotal = monthly.reduce((acc, item) => acc + item.draftsPending, 0);

  return {
    monthly,
    stockAvailableTotal,
    stockSoldTotal,
    draftsTotal: draftsSignedTotal + draftsPendingTotal,
    draftsSignedTotal,
    draftsPendingTotal,
  };
}
