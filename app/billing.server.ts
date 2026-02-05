import { shopifyApp } from "./shopify.server";

/**
 * Billing Configuration
 *
 * Defines subscription plans and handles billing logic
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
 * Create a billing subscription
 */
export async function createBillingSubscription(
  admin: any,
  plan: BillingPlan
) {
  if (plan === "FREE") {
    return null; // No charge for free plan
  }

  const planConfig = BILLING_PLANS[plan];

  const response = await admin.graphql(
    `#graphql
      mutation CreateAppSubscription($name: String!, $price: Decimal!, $returnUrl: URL!) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  price: { amount: $price, currencyCode: USD }
                  interval: EVERY_30_DAYS
                }
              }
            }
          ]
        ) {
          appSubscription {
            id
            status
          }
          confirmationUrl
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        name: `${planConfig.name} Plan`,
        price: planConfig.price,
        returnUrl: process.env.SHOPIFY_APP_URL + "/app/billing/callback",
      },
    }
  );

  const data = await response.json();

  if (data.data?.appSubscriptionCreate?.userErrors?.length > 0) {
    throw new Error(
      data.data.appSubscriptionCreate.userErrors[0].message
    );
  }

  return {
    subscriptionId: data.data?.appSubscriptionCreate?.appSubscription?.id,
    confirmationUrl: data.data?.appSubscriptionCreate?.confirmationUrl,
  };
}

/**
 * Get current active subscription
 */
export async function getCurrentSubscription(admin: any) {
  const response = await admin.graphql(
    `#graphql
      query GetCurrentSubscription {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            createdAt
            currentPeriodEnd
            lineItems {
              plan {
                pricingDetails {
                  ... on AppRecurringPricing {
                    price {
                      amount
                      currencyCode
                    }
                    interval
                  }
                }
              }
            }
          }
        }
      }`
  );

  const data = await response.json();
  const subscriptions =
    data.data?.currentAppInstallation?.activeSubscriptions || [];

  if (subscriptions.length === 0) {
    return null;
  }

  return subscriptions[0];
}

/**
 * Cancel subscription
 */
export async function cancelSubscription(admin: any, subscriptionId: string) {
  const response = await admin.graphql(
    `#graphql
      mutation CancelSubscription($id: ID!) {
        appSubscriptionCancel(id: $id) {
          appSubscription {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        id: subscriptionId,
      },
    }
  );

  const data = await response.json();

  if (data.data?.appSubscriptionCancel?.userErrors?.length > 0) {
    throw new Error(
      data.data.appSubscriptionCancel.userErrors[0].message
    );
  }

  return data.data?.appSubscriptionCancel?.appSubscription;
}

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
