import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { assertIsAdminOfConcession } from "./_lib/concession.js";

/**
 * POST /api/create-checkout
 *
 * Body JSON attendu :
 *   { concessionId: string, userId: string, email?: string, interval?: "monthly" | "annual" }
 * Retourne : { url: string }
 *
 * Crée (ou réutilise) un customer Stripe pour la concession, démarre une
 * Checkout Session pour l'abonnement « Pro » (mode subscription) et renvoie
 * l'URL hébergée Stripe vers laquelle on redirige le navigateur.
 */

/** URL publique de production (utilisée pour success/cancel). */
const PROD_URL = "https://autodocs-eight.vercel.app";

type CheckoutBody = {
  concessionId?: string;
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
    const rawUserId = body.userId;
    const concessionId =
      typeof body.concessionId === "string" && body.concessionId.trim().length > 0
        ? body.concessionId.trim()
        : null;
    const email = body.email;
    const interval: "monthly" | "annual" =
      body.interval === "annual" ? "annual" : "monthly";
    if (!rawUserId) {
      return res.status(400).json({ error: "userId requis" });
    }
    if (!concessionId) {
      return res.status(400).json({ error: "concessionId requis" });
    }

    const authHeader = req.headers.authorization;
    const token =
      typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "").trim() : "";
    if (!token) {
      return res.status(401).json({ error: "Authorization Bearer requis" });
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: jwtUser, error: jwtErr } = await supabaseAdmin.auth.getUser(token);
    if (jwtErr || !jwtUser?.user?.id) {
      return res.status(401).json({ error: "Session invalide" });
    }
    if (jwtUser.user.id !== rawUserId) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    const okAdmin = await assertIsAdminOfConcession(supabaseAdmin, rawUserId, concessionId);
    if (!okAdmin) {
      return res.status(403).json({
        error: "Seul l'administrateur de la concession peut souscrire un abonnement.",
      });
    }

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

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      apiVersion: "2023-10-16" as any,
    });

    const { data: abonnement, error: fetchErr } = await supabaseAdmin
      .from("abonnements")
      .select("stripe_customer_id")
      .eq("concession_id", concessionId)
      .maybeSingle();

    if (fetchErr) {
      return res.status(500).json({
        error: `Supabase (select abonnements) : ${fetchErr.message}`,
      });
    }

    let customerId = abonnement?.stripe_customer_id ?? null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { concession_id: concessionId, user_id: rawUserId },
      });
      customerId = customer.id;

      const { data: existingLegacy } = await supabaseAdmin
        .from("abonnements")
        .select("id")
        .eq("user_id", rawUserId)
        .maybeSingle();

      const row = {
        concession_id: concessionId,
        user_id: rawUserId,
        stripe_customer_id: customerId,
        plan: "gratuit",
        updated_at: new Date().toISOString(),
      };

      if (existingLegacy?.id) {
        await supabaseAdmin.from("abonnements").update(row).eq("id", existingLegacy.id);
      } else {
        await supabaseAdmin.from("abonnements").insert(row);
      }
    }

    const origin =
      (req.headers.origin as string | undefined) ||
      (req.headers.referer as string | undefined)?.split("/").slice(0, 3).join("/") ||
      "";
    const isLocalhost = origin.includes("localhost") || origin.includes("127.0.0.1");
    const baseUrl = isLocalhost ? origin : PROD_URL;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${baseUrl}/abonnement?status=success&interval=${interval}`,
      cancel_url: `${baseUrl}/abonnement?status=cancel`,
      metadata: {
        concession_id: concessionId,
        user_id: rawUserId,
        interval,
      },
      subscription_data: {
        metadata: {
          concession_id: concessionId,
          user_id: rawUserId,
          interval,
        },
      },
    });

    if (!session.url) {
      return res.status(500).json({
        error: "Stripe a renvoyé une session sans URL.",
      });
    }

    return res.status(200).json({ url: session.url });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Erreur inconnue côté serveur";
    console.error("[create-checkout] Erreur :", err);
    return res.status(500).json({ error: message });
  }
}
