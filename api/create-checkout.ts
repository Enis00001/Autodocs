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
 * Checkout Session pour l'abonnement "Pro" (49€/mois) et renvoie l'URL
 * hébergée Stripe vers laquelle on redirige le navigateur.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID_PRO;
  if (!secret || !priceId) {
    return res.status(500).json({
      error: "Stripe non configuré (STRIPE_SECRET_KEY / STRIPE_PRICE_ID_PRO manquant).",
    });
  }

  const body = (req.body ?? {}) as { userId?: string; email?: string };
  const userId = body.userId;
  const email = body.email;
  if (!userId) {
    return res.status(400).json({ error: "userId requis" });
  }

  const stripe = new Stripe(secret, { apiVersion: "2024-06-20" as Stripe.LatestApiVersion });
  const supabaseAdmin = getSupabaseAdmin();

  // Récupère l'abonnement actuel (customer éventuellement déjà créé)
  const { data: abonnement } = await supabaseAdmin
    .from("abonnements")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  let customerId = abonnement?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { user_id: userId },
    });
    customerId = customer.id;
    // On crée / met à jour la ligne d'abonnement
    await supabaseAdmin
      .from("abonnements")
      .upsert(
        { user_id: userId, stripe_customer_id: customerId, plan: "gratuit" },
        { onConflict: "user_id" },
      );
  }

  const origin =
    (req.headers.origin as string | undefined) ||
    (req.headers.referer as string | undefined)?.split("/").slice(0, 3).join("/") ||
    "";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${origin}/abonnement?status=success`,
    cancel_url: `${origin}/abonnement?status=cancel`,
    metadata: { user_id: userId },
    subscription_data: { metadata: { user_id: userId } },
  });

  return res.status(200).json({ url: session.url });
}
