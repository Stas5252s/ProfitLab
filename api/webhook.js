// api/webhook.js
// Receives Stripe webhook events and updates user plan in Supabase

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service key — has full access, never expose in frontend
);

// Map Stripe price IDs to plan names
const PRICE_TO_PLAN = {
  "https://buy.stripe.com/test_7sYfZh0wbd4EcrM2ZX1B601": "premium",
  "https://buy.stripe.com/test_3cI28rdiX5Cc9fA7gd1B600": "premium_plus",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).json({ error: "Invalid signature" });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const email = session.customer_details?.email;
    const priceId = session.metadata?.price_id || "";

    // Determine plan from price ID or payment link
    let plan = "premium";
    const url = session.url || "";
    if (url.includes("3cI28r") || priceId.includes("premium_plus")) {
      plan = "premium_plus";
    }

    if (!email) {
      console.warn("No email in session");
      return res.status(200).json({ received: true });
    }

    // Find user by email in Supabase auth, then update their plan
    const { data: users, error: authError } = await supa.auth.admin.listUsers();
    if (authError) {
      console.error("Auth error:", authError);
      return res.status(500).json({ error: "Auth lookup failed" });
    }

    const user = users.users.find((u) => u.email === email);
    if (!user) {
      console.warn("User not found for email:", email);
      return res.status(200).json({ received: true });
    }

    const { error: updateError } = await supa
      .from("user_data")
      .update({ plan })
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Plan update failed:", updateError);
      return res.status(500).json({ error: "Update failed" });
    }

    console.log(`Updated plan for ${email} → ${plan}`);
  }

  if (event.type === "customer.subscription.deleted") {
    // Downgrade to free when subscription is cancelled
    const subscription = event.data.object;
    const customerId = subscription.customer;

    const customer = await stripe.customers.retrieve(customerId);
    const email = customer.email;

    if (email) {
      const { data: users } = await supa.auth.admin.listUsers();
      const user = users.users.find((u) => u.email === email);
      if (user) {
        await supa
          .from("user_data")
          .update({ plan: "free" })
          .eq("user_id", user.id);
        console.log(`Downgraded ${email} → free`);
      }
    }
  }

  return res.status(200).json({ received: true });
}

export const config = {
  api: {
    bodyParser: false, // Stripe needs raw body to verify signature
  },
};
