import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getActiveConcessionIdForUser } from "./_lib/concession.js";

/**
 * POST /api/stripe-webhook
 *
 * Reçoit les events Stripe signés. Events traités :
 *   - checkout.session.completed       → plan = "pro"
 *   - customer.subscription.deleted    → plan = "gratuit"
 *
 * Nécessite de désactiver le body parser de Vercel pour que la signature
 * soit vérifiable (on a besoin du corps brut).
 */
export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as unknown as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !webhookSecret) {
    return res.status(500).json({
      error: "Stripe non configuré (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET manquant).",
    });
  }

  const stripe = new Stripe(secret, { apiVersion: "2024-06-20" as Stripe.LatestApiVersion });
  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) return res.status(400).send("Missing stripe-signature header");

  const raw = await readRawBody(req);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed", err);
    return res.status(400).send(`Webhook error: ${err instanceof Error ? err.message : "unknown"}`);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  async function resolveConcessionId(
    metaConcession: string | null | undefined,
    metaUser: string | null | undefined,
  ): Promise<string | null> {
    const cid =
      typeof metaConcession === "string" && metaConcession.trim().length > 0
        ? metaConcession.trim()
        : null;
    if (cid) return cid;
    const uid =
      typeof metaUser === "string" && metaUser.trim().length > 0 ? metaUser.trim() : null;
    if (!uid) return null;
    return getActiveConcessionIdForUser(supabaseAdmin, uid);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const concessionId = await resolveConcessionId(
          session.metadata?.concession_id as string | undefined,
          session.metadata?.user_id as string | undefined,
        );
        const legacyUserId = (session.metadata?.user_id as string) || null;
        const customerId = (session.customer as string) || null;
        const subscriptionId = (session.subscription as string) || null;
        if (!concessionId) break;

        let dateRenouvellement: string | null = null;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          if (sub.current_period_end) {
            dateRenouvellement = new Date(sub.current_period_end * 1000).toISOString();
          }
        }

        const row = {
          concession_id: concessionId,
          user_id: legacyUserId ?? undefined,
          stripe_customer_id: customerId ?? undefined,
          stripe_subscription_id: subscriptionId ?? undefined,
          plan: "pro",
          actif: true,
          date_renouvellement: dateRenouvellement,
          updated_at: new Date().toISOString(),
        };

        const { data: existingRow } = await supabaseAdmin
          .from("abonnements")
          .select("id")
          .eq("concession_id", concessionId)
          .maybeSingle();

        if (existingRow?.id) {
          await supabaseAdmin.from("abonnements").update(row).eq("id", existingRow.id);
        } else {
          await supabaseAdmin.from("abonnements").insert(row);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const concessionId = await resolveConcessionId(
          sub.metadata?.concession_id as string | undefined,
          sub.metadata?.user_id as string | undefined,
        );
        const legacyUserId = (sub.metadata?.user_id as string) || null;
        const customerId = (sub.customer as string) || null;

        const patch = {
          plan: "gratuit",
          actif: false,
          stripe_subscription_id: null,
          date_renouvellement: null,
          updated_at: new Date().toISOString(),
        };

        if (concessionId) {
          await supabaseAdmin.from("abonnements").update(patch).eq("concession_id", concessionId);
        } else if (legacyUserId) {
          await supabaseAdmin.from("abonnements").update(patch).eq("user_id", legacyUserId);
        } else if (customerId) {
          await supabaseAdmin.from("abonnements").update(patch).eq("stripe_customer_id", customerId);
        }
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] handler error", err);
    return res.status(500).json({ error: "webhook handler error" });
  }
}
