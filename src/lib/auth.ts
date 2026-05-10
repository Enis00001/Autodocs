import { supabase } from "@/lib/supabase";

export type SignupPlan = "monthly" | "annual" | null;

export function getSignupEmailRedirectTo(plan: SignupPlan = null): string {
  const redirectUrl = new URL(plan ? "/abonnement" : "/app", window.location.origin);
  if (plan) redirectUrl.searchParams.set("plan", plan);
  return redirectUrl.toString();
}

export async function getCurrentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error("getCurrentUserId:", error);
    return null;
  }
  return data.user?.id ?? null;
}

/** `is_admin` dans `raw_user_meta_data` / `user_metadata` (compte support / interne). */
export async function getCurrentUserIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return false;
  return data.user.user_metadata?.is_admin === true;
}

