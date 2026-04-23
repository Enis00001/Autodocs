import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";

/**
 * POST /api/create-checkout
 *
 * Body JSON attendu :
 *   { userId: string, email?: string, interval?: "monthly" | "annual" }
 * Retourne : { url: string }
 *
 * Crée (ou réutilise) un customer Stripe pour l'utilisateur, démarre une
 * Checkout Session pour l'abonnement « Pro » (mode subscription) et renvoie
 * l'URL hébergée Stripe vers laquelle on redirige le navigateur.
 *
 * Selon `interval` on utilise :
 *   - "annual"  → STRIPE_PRICE_ID_PRO_ANNUAL  (399 €/an)
 *   - "monthly" (défaut) → STRIPE_PRICE_ID_PRO (49 €/mois)
 */

/** URL publique de production (utilisée pour success/cancel). */
const PROD_URL = "https://autodocs-eight.vercel.app";

type CheckoutBody = {
  userId?: string;
  email?: string;
  interval?: "monthly" | "annual";
};

/** Parse le body même s'il arrive en string (selon runtime Vercel). */
function parseBody(raw: unknown): CheckoutBody {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as CheckoutBody;
    } catch {
      return {};
    }
  }
  return raw as CheckoutBody;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      return res.status(500).json({
        error: "STRIPE_SECRET_KEY manquant côté serveur.",
      });
    }

    const body = parseBody(req.body);
    const userId = body.userId;
    const email = body.email;
    const interval: "monthly" | "annual" =
      body.interval === "annual" ? "annual" : "monthly";
    if (!userId) {
      return res.status(400).json({ error: "userId requis" });
    }

    // Résolution du price ID en fonction de l'intervalle demandé.
    const priceId =
      interval === "annual"
        ? process.env.STRIPE_PRICE_ID_PRO_ANNUAL
        : process.env.STRIPE_PRICE_ID_PRO;
    if (!priceId) {
      return res.status(500).json({
        error:
          interval === "annual"
            ? "STRIPE_PRICE_ID_PRO_ANNUAL manquant côté serveur."
            : "STRIPE_PRICE_ID_PRO manquant côté serveur.",
      });
    }

    // On fige l'API Stripe à 2023-10-16 (les typings récents ne laissent
    // passer que la version courante — cast nécessaire).
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      apiVersion: "2023-10-16" as any,
    });

    // Client Supabase admin inlined (évite un import local qui n'est pas
    // bundlé dans /var/task/ par Vercel).
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // 1. Récupère l'abonnement existant (customer éventuellement déjà créé).
    const { data: abonnement, error: fetchErr } = await supabaseAdmin
      .from("abonnements")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchErr) {
      return res.status(500).json({
        error: `Supabase (select abonnements) : ${fetchErr.message}`,
      });
    }

    let customerId = abonnement?.stripe_customer_id ?? null;

    // 2. Si aucun customer Stripe, on en crée un et on l'associe à l'user.
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { user_id: userId },
      });
      customerId = customer.id;
      const { error: upsertErr } = await supabaseAdmin
        .from("abonnements")
        .upsert(
          { user_id: userId, stripe_customer_id: customerId, plan: "gratuit" },
          { onConflict: "user_id" },
        );
      if (upsertErr) {
        return res.status(500).json({
          error: `Supabase (upsert abonnement) : ${upsertErr.message}`,
        });
      }
    }

    // 3. URL de base. On privilégie l'URL de prod (forcée) ; en dev local on
    //    retombe sur l'origin des headers pour tester.
    const origin =
      (req.headers.origin as string | undefined) ||
      (req.headers.referer as string | undefined)?.split("/").slice(0, 3).join("/") ||
      "";
    const isLocalhost = origin.includes("localhost") || origin.includes("127.0.0.1");
    const baseUrl = isLocalhost ? origin : PROD_URL;

    // 4. Création de la Checkout Session (abonnement).
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${baseUrl}/abonnement?status=success&interval=${interval}`,
      cancel_url: `${baseUrl}/abonnement?status=cancel`,
      metadata: { user_id: userId, interval },
      subscription_data: { metadata: { user_id: userId, interval } },
    });

    if (!session.url) {
      return res.status(500).json({
        error: "Stripe a renvoyé une session sans URL.",
      });
    }

    return res.status(200).json({ url: session.url });
  } catch (err: unknown) {
    // On renvoie le message exact en JSON pour faciliter le debug côté client
    // (sinon Vercel répond FUNCTION_INVOCATION_FAILED sans détail).
    const message =
      err instanceof Error ? err.message : "Erreur inconnue côté serveur";
    console.error("[create-checkout] Erreur :", err);
    return res.status(500).json({ error: message });
  }
}
