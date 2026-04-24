import { getAccessToken, supabase } from "@/lib/supabase";

/**
 * Wrapper autour de `fetch` qui attache automatiquement le JWT Supabase
 * dans l'en-tête `Authorization: Bearer <token>`.
 *
 * À utiliser pour tous les appels vers `/api/*` qui exigent une session
 * authentifiée. Si le serveur répond `401`, on déclenche un signOut
 * (la session est invalide) — le listener global dans `App.tsx` fera la
 * redirection vers /login avec un toast.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers ?? {});
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    await supabase.auth.signOut().catch(() => undefined);
  }
  return response;
}
