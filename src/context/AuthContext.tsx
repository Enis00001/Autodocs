import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Modèle multi-utilisateurs par concession.
 *
 * Le contexte expose :
 *   - `user`         : compte Supabase Auth connecté (ou null)
 *   - `concession`   : entité métier (table `concessions`) à laquelle le user
 *                      appartient via `membres_concession`
 *   - `concessionId` : raccourci pratique (= concession.id ou null)
 *   - `membreRole`   : 'admin' | 'commercial' (du user dans la concession)
 *
 * Au login, le provider :
 *   1. Récupère la session Supabase
 *   2. Cherche dans `membres_concession` la ligne où user_id = auth.uid()
 *   3. Joint la concession associée pour la stocker dans le state
 *   4. Si aucune ligne trouvée mais que l'user a un `concession_name` dans
 *      ses metadata Auth (= post-inscription), le provider bootstrappe
 *      une nouvelle concession + ajoute le user comme admin (idempotent
 *      grâce à la contrainte UNIQUE(concession_id, user_id)).
 */
export type Concession = {
  id: string;
  nom: string | null;
  siret: string | null;
  adresse: string | null;
  telephone: string | null;
  email: string | null;
  tva_intracommunautaire: string | null;
  logo_url: string | null;
  owner_id: string;
  created_at: string | null;
};

export type MembreRole = "admin" | "commercial";

export type AuthContextType = {
  user: User | null;
  session: Session | null;
  concession: Concession | null;
  concessionId: string | null;
  membreRole: MembreRole;
  loading: boolean;
  /** Vrai pendant la phase de bootstrap (création de concession initiale). */
  bootstrapping: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Force un re-fetch de la concession (après une mise à jour côté UI). */
  refreshConcession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

type MembreRow = {
  role: MembreRole;
  actif: boolean;
  concession: Concession | null;
};

/**
 * Charge la concession associée à un user via `membres_concession`.
 * Retourne `{ concession, role }` ou null si l'user n'est membre actif
 * d'aucune concession.
 */
async function fetchMembership(
  userId: string,
): Promise<{ concession: Concession; role: MembreRole } | null> {
  const { data, error } = await supabase
    .from("membres_concession")
    .select(
      `role, actif, concession:concessions (
        id, nom, siret, adresse, telephone, email,
        tva_intracommunautaire, logo_url, owner_id, created_at
      )`,
    )
    .eq("user_id", userId)
    .eq("actif", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    // PGRST116 = "Results contain 0 rows" → user pas encore rattaché à
    // une concession. C'est attendu en post-signup avant le bootstrap.
    if (error.code !== "PGRST116") {
      console.error("[AuthContext] fetchMembership:", error);
    }
    return null;
  }
  if (!data) return null;

  const row = data as unknown as MembreRow;
  if (!row.concession) return null;
  return { concession: row.concession, role: row.role };
}

/**
 * Crée une concession pour un user qui vient de confirmer son inscription
 * et n'a pas encore de membership. Idempotent : si la concession existe
 * déjà (re-confirmation, double appel), on retombe juste sur la lecture.
 */
async function bootstrapConcessionForUser(
  user: User,
): Promise<{ concession: Concession; role: MembreRole } | null> {
  const concessionName =
    (user.user_metadata?.concession_name as string | undefined)?.trim() ||
    "Ma concession";
  const gerantPrenom =
    (user.user_metadata?.gerant_prenom as string | undefined)?.trim() || null;
  const gerantNom =
    (user.user_metadata?.gerant_nom as string | undefined)?.trim() || null;

  // Cas anti-doublon : si la table a déjà une concession owned par cet
  // user (re-confirmation, ou ligne créée par la migration SQL), on la
  // récupère plutôt que d'en créer une seconde.
  const existingOwn = await supabase
    .from("concessions")
    .select(
      "id, nom, siret, adresse, telephone, email, tva_intracommunautaire, logo_url, owner_id, created_at",
    )
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let concession: Concession | null = null;

  if (!existingOwn.error && existingOwn.data) {
    concession = existingOwn.data as Concession;
  } else {
    const { data, error } = await supabase
      .from("concessions")
      .insert({
        owner_id: user.id,
        nom: concessionName,
        email: user.email ?? null,
      })
      .select(
        "id, nom, siret, adresse, telephone, email, tva_intracommunautaire, logo_url, owner_id, created_at",
      )
      .single();
    if (error || !data) {
      console.error("[AuthContext] bootstrap concessions insert:", error);
      return null;
    }
    concession = data as Concession;
  }

  if (!concession) return null;

  // Insert idempotent grâce à UNIQUE(concession_id, user_id).
  const { error: memErr } = await supabase
    .from("membres_concession")
    .upsert(
      {
        concession_id: concession.id,
        user_id: user.id,
        role: "admin",
        prenom: gerantPrenom,
        nom: gerantNom,
        email: user.email ?? null,
        actif: true,
      },
      { onConflict: "concession_id,user_id" },
    );

  if (memErr) {
    console.error("[AuthContext] bootstrap membres_concession upsert:", memErr);
    return null;
  }

  return { concession, role: "admin" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [concession, setConcession] = useState<Concession | null>(null);
  const [membreRole, setMembreRole] = useState<MembreRole>("commercial");
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);

  // Anti-double-bootstrap pendant un même cycle de session (par ex. quand
  // onAuthStateChange émet plusieurs SIGNED_IN consécutifs).
  const bootstrappedForUserRef = useRef<string | null>(null);

  const loadConcessionForUser = useCallback(
    async (user: User | null): Promise<void> => {
      if (!user) {
        setConcession(null);
        setMembreRole("commercial");
        bootstrappedForUserRef.current = null;
        return;
      }
      // Si l'email n'est pas confirmé, on ne tente pas le bootstrap : la
      // route /confirmation-email s'affichera de toute façon.
      if (!user.email_confirmed_at) {
        setConcession(null);
        setMembreRole("commercial");
        return;
      }

      let membership = await fetchMembership(user.id);

      if (!membership && bootstrappedForUserRef.current !== user.id) {
        bootstrappedForUserRef.current = user.id;
        setBootstrapping(true);
        membership = await bootstrapConcessionForUser(user);
        setBootstrapping(false);
      }

      if (membership) {
        setConcession(membership.concession);
        setMembreRole(membership.role);
      } else {
        setConcession(null);
        setMembreRole("commercial");
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      await loadConcessionForUser(data.session?.user ?? null);
      setLoading(false);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      // Décharge la concession en synchrone (UI réactive) puis recharge.
      if (!currentSession?.user) {
        setConcession(null);
        setMembreRole("commercial");
        bootstrappedForUserRef.current = null;
        return;
      }
      void loadConcessionForUser(currentSession.user);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [loadConcessionForUser]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setConcession(null);
    setMembreRole("commercial");
    bootstrappedForUserRef.current = null;
  }, []);

  const refreshConcession = useCallback(async () => {
    if (!session?.user) return;
    const membership = await fetchMembership(session.user.id);
    if (membership) {
      setConcession(membership.concession);
      setMembreRole(membership.role);
    }
  }, [session]);

  const value = useMemo<AuthContextType>(
    () => ({
      user: session?.user ?? null,
      session,
      concession,
      concessionId: concession?.id ?? null,
      membreRole,
      loading,
      bootstrapping,
      signIn,
      signOut,
      refreshConcession,
    }),
    [session, concession, membreRole, loading, bootstrapping, signIn, signOut, refreshConcession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() doit être utilisé à l'intérieur de <AuthProvider>.");
  }
  return ctx;
}

/**
 * Variante non-throwing pour les composants publics (pages d'invitation,
 * /signer/:token) qui peuvent être rendues hors AuthProvider en théorie.
 */
export function useAuthOptional(): AuthContextType | null {
  return useContext(AuthContext);
}
