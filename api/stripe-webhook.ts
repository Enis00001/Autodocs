import type { VercelRequest, VercelResponse } from "@vercel/node";
import Stripe from "stripe";
import { getSupabaseAdmin } from "./_supabaseAdmin";

/**
 * POST /api/stripe-webhook
 *
 * Reçoit les events Stripe signés. Events traités :
 *   - checkout.session.completed       → plan = "pro"
 *   - customer.subscription.deleted    → plan = "gratuit"
 *   - invoice.payment_succeeded        → bons_ce_mois = 0 (reset mensuel)
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

  const supabaseAdmin = getSupabaseAdmin();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = (session.metadata?.user_id as string) || null;
        const customerId = (session.customer as string) || null;
        const subscriptionId = (session.subscription as string) || null;
        if (!userId) break;

        // On récupère la date de renouvellement depuis la subscription.
        let dateRenouvellement: string | null = null;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          if (sub.current_period_end) {
            dateRenouvellement = new Date(sub.current_period_end * 1000).toISOString();
          }
        }

        await supabaseAdmin.from("abonnements").upsert(
          {
            user_id: userId,
            stripe_customer_id: customerId ?? undefined,
            stripe_subscription_id: subscriptionId ?? undefined,
            plan: "pro",
            actif: true,
            date_renouvellement: dateRenouvellement,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = (sub.metadata?.user_id as string) || null;
        const customerId = (sub.customer as string) || null;
        if (userId) {
          await supabaseAdmin
            .from("abonnements")
            .update({
              plan: "gratuit",
              actif: false,
              stripe_subscription_id: null,
              date_renouvellement: null,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId);
        } else if (customerId) {
          await supabaseAdmin
            .from("abonnements")
            .update({
              plan: "gratuit",
              actif: false,
              stripe_subscription_id: null,
              date_renouvellement: null,
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_customer_id", customerId);
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = (invoice.customer as string) || null;
        if (!customerId) break;

        // Reset mensuel du compteur + prolongation date_renouvellement.
        const subscriptionId = (invoice.subscription as string) || null;
        let dateRenouvellement: string | null = null;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          if (sub.current_period_end) {
            dateRenouvellement = new Date(sub.current_period_end * 1000).toISOString();
          }
        }

        await supabaseAdmin
          .from("abonnements")
          .update({
            bons_ce_mois: 0,
            actif: true,
            date_renouvellement: dateRenouvellement,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);
        break;
      }

      default:
        // Events non gérés : on ignore.
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] handler error", err);
    return res.status(500).json({ error: "webhook handler error" });
  }
}
