import { BILLING_PLANS, type BillingPlan } from "./billing";

/**
 * Billing Server Functions
 *
 * Server-side billing operations that interact with Shopify API
 */

// Re-export client-safe utilities
export * from "./billing";

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

