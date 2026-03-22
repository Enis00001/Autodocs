import { supabase } from "@/lib/supabase";

export async function getCurrentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error("getCurrentUserId:", error);
    return null;
  }
  return data.user?.id ?? null;
}

