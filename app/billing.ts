/**
 * Billing Configuration (Client-safe)
 *
 * Constants and types that can be used in both client and server code
 */

export const BILLING_PLANS = {
  FREE: {
    name: "Free",
    price: 0,
    maxRules: 1,
    features: [
      "1 active upsell rule",
      "Basic analytics",
      "Cart page upsells",
      "Email support",
    ],
  },
  PRO: {
    name: "Pro",
    price: 9.99,
    maxRules: 999, // Unlimited
    features: [
      "Unlimited upsell rules",
      "Advanced analytics",
      "Cart page upsells",
      "Discount badges",
      "Priority support",
    ],
  },
} as const;

export type BillingPlan = keyof typeof BILLING_PLANS;

/**
 * Check if shop has active paid subscription
 */
export function hasActivePaidSubscription(subscription: any): boolean {
  if (!subscription) return false;

  return (
    subscription.status === "ACTIVE" &&
    subscription.lineItems?.some((item: any) => {
      const price = item.plan?.pricingDetails?.price?.amount;
      return price && parseFloat(price) > 0;
    })
  );
}

/**
 * Determine current plan from subscription
 */
export function getCurrentPlan(subscription: any): BillingPlan {
  if (hasActivePaidSubscription(subscription)) {
    return "PRO";
  }
  return "FREE";
}

/**
 * Check if shop can perform action based on plan limits
 */
export function canPerformAction(
  currentPlan: BillingPlan,
  action: "createRule",
  currentCount?: number
): { allowed: boolean; reason?: string } {
  const plan = BILLING_PLANS[currentPlan];

  if (action === "createRule") {
    if (currentCount !== undefined && currentCount >= plan.maxRules) {
      return {
        allowed: false,
        reason: `You've reached the maximum of ${plan.maxRules} rule(s) on the ${plan.name} plan. Upgrade to Pro for unlimited rules.`,
      };
    }
  }

  return { allowed: true };
}
