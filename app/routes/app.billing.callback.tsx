import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { getCurrentSubscription, getCurrentPlan } from "../billing.server";

/**
 * Billing Callback
 *
 * Handles redirect after merchant approves/declines billing
 * Updates shop record with new subscription status
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    // Get current subscription status from Shopify
    const subscription = await getCurrentSubscription(admin);
    const currentPlan = getCurrentPlan(subscription);

    // Update shop record with new plan
    await prisma.shop.update({
      where: { shopifyDomain: shop },
      data: {
        currentPlan,
        billingStatus: subscription?.status || "ACTIVE",
      },
    });

    // Redirect back to billing page with success message
    return redirect("/app/billing?upgraded=true");
  } catch (error) {
    console.error("Billing callback error:", error);

    // Redirect to billing page with error
    return redirect("/app/billing?error=callback");
  }
};
