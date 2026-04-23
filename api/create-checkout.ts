import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getSupabaseAdmin } from "./_supabaseAdmin";

/**
 * POST /api/create-checkout
 *
 * Body JSON attendu : { userId: string, email?: string }
 * Retourne : { url: string }
 *
 * Crée (ou réutilise) un customer Stripe pour l'utilisateur, démarre une
 * Checkout Session pour l'abonnement « Pro » (mode subscription) et renvoie
 * l'URL hébergée Stripe vers laquelle on redirige le navigateur.
 */

/** URL publique de production (utilisée pour success/cancel). */
const PROD_URL = "https://autodocs-eight.vercel.app";

/** Parse le body même s'il arrive en string (selon runtime Vercel). */
function parseBody(raw: unknown): { userId?: string; email?: string } {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw as { userId?: string; email?: string };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID_PRO;
    if (!secret) {
      return res.status(500).json({
        error: "STRIPE_SECRET_KEY manquant côté serveur.",
      });
    }
    if (!priceId) {
      return res.status(500).json({
        error: "STRIPE_PRICE_ID_PRO manquant côté serveur.",
      });
    }

    const body = parseBody(req.body);
    const userId = body.userId;
    const email = body.email;
    if (!userId) {
      return res.status(400).json({ error: "userId requis" });
    }

    // On fige l'API Stripe à 2023-10-16 (les typings récents ne laissent
    // passer que la version courante — cast nécessaire).
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      apiVersion: "2023-10-16" as any,
    });
    const supabaseAdmin = getSupabaseAdmin();

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
      success_url: `${baseUrl}/abonnement?status=success`,
      cancel_url: `${baseUrl}/abonnement?status=cancel`,
      metadata: { user_id: userId },
      subscription_data: { metadata: { user_id: userId } },
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
