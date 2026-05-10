import type { SupabaseClient } from "@supabase/supabase-js";

/** Concession active du compte (unique membre actif V1). */
export async function getActiveConcessionIdForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("membres_concession")
    .select("concession_id")
    .eq("user_id", userId)
    .eq("actif", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[concession] getActiveConcessionIdForUser:", error);
    return null;
  }
  return (data?.concession_id as string | undefined) ?? null;
}

export async function getMembreRoleForConcession(
  admin: SupabaseClient,
  userId: string,
  concessionId: string,
): Promise<"admin" | "commercial" | null> {
  const { data } = await admin
    .from("membres_concession")
    .select("role")
    .eq("user_id", userId)
    .eq("concession_id", concessionId)
    .eq("actif", true)
    .maybeSingle();
  if (!data?.role) return null;
  return data.role === "admin" ? "admin" : "commercial";
}

export async function assertIsAdminOfConcession(
  admin: SupabaseClient,
  userId: string,
  concessionId: string,
): Promise<boolean> {
  const role = await getMembreRoleForConcession(admin, userId, concessionId);
  return role === "admin";
}
