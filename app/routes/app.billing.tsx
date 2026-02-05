import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Form, useActionData, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";
import { prisma } from "../db.server";
import { BILLING_PLANS, getCurrentPlan, hasActivePaidSubscription } from "../billing";
import {
  createBillingSubscription,
  getCurrentSubscription,
  cancelSubscription,
} from "../billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Get shop record
  const shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shop },
    include: {
      rules: {
        where: { isEnabled: true },
      },
    },
  });

  if (!shopRecord) {
    throw new Error("Shop not found");
  }

  // Get current subscription from Shopify
  const subscription = await getCurrentSubscription(admin);
  const currentPlan = getCurrentPlan(subscription);
  const hasActiveSub = hasActivePaidSubscription(subscription);

  return {
    shop: {
      plan: currentPlan,
      activeRulesCount: shopRecord.rules.length,
    },
    subscription,
    hasActiveSub,
    plans: BILLING_PLANS,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get("action");
  const plan = formData.get("plan") as "FREE" | "PRO";

  try {
    if (action === "upgrade") {
      // Create subscription
      const result = await createBillingSubscription(admin, plan);

      if (result && result.confirmationUrl) {
        // Redirect to Shopify billing confirmation
        return redirect(result.confirmationUrl);
      }

      return { success: true, message: "Upgraded to Pro plan!" };
    } else if (action === "cancel") {
      const subscriptionId = formData.get("subscriptionId") as string;

      if (subscriptionId) {
        await cancelSubscription(admin, subscriptionId);

        // Update shop record
        await prisma.shop.update({
          where: { shopifyDomain: shop },
          data: { currentPlan: "FREE" },
        });

        return { success: true, message: "Subscription cancelled. You're now on the Free plan." };
      }
    }

    return { success: false, error: "Invalid action" };
  } catch (error: any) {
    console.error("Billing action error:", error);
    return { success: false, error: error.message || "Failed to process billing request" };
  }
};

export default function Billing() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const currentPlan = data.shop.plan;
  const hasActiveSub = data.hasActiveSub;

  return (
    <s-page heading="Billing">
      {actionData?.error && (
        <s-section>
          <s-banner status="critical">
            <s-text>{actionData.error}</s-text>
          </s-banner>
        </s-section>
      )}

      {actionData?.success && (
        <s-section>
          <s-banner status="success">
            <s-text>{actionData.message}</s-text>
          </s-banner>
        </s-section>
      )}

      <s-section>
        <s-stack direction="block" gap="large">
          <s-heading>Current Plan: {currentPlan}</s-heading>

          <s-stack direction="inline" gap="large">
            {/* Free Plan Card */}
            <s-card title="Free Plan" sectioned>
              <s-stack direction="block" gap="base">
                <s-heading level={2}>$0/month</s-heading>
                <s-text appearance="subdued">Perfect for getting started</s-text>

                <s-divider />

                <s-stack direction="block" gap="tight">
                  {BILLING_PLANS.FREE.features.map((feature) => (
                    <s-text key={feature}>✓ {feature}</s-text>
                  ))}
                </s-stack>

                {currentPlan === "FREE" && (
                  <s-badge status="info">Current Plan</s-badge>
                )}

                {currentPlan === "PRO" && hasActiveSub && (
                  <Form method="post">
                    <input type="hidden" name="action" value="cancel" />
                    <input
                      type="hidden"
                      name="subscriptionId"
                      value={data.subscription?.id || ""}
                    />
                    <s-button submit kind="secondary" tone="critical">
                      Downgrade to Free
                    </s-button>
                  </Form>
                )}
              </s-stack>
            </s-card>

            {/* Pro Plan Card */}
            <s-card title="Pro Plan" sectioned>
              <s-stack direction="block" gap="base">
                <s-heading level={2}>$9.99/month</s-heading>
                <s-text appearance="subdued">Unlock unlimited upsells</s-text>

                <s-divider />

                <s-stack direction="block" gap="tight">
                  {BILLING_PLANS.PRO.features.map((feature) => (
                    <s-text key={feature}>✓ {feature}</s-text>
                  ))}
                </s-stack>

                {currentPlan === "PRO" && (
                  <s-badge status="success">Current Plan</s-badge>
                )}

                {currentPlan === "FREE" && (
                  <Form method="post">
                    <input type="hidden" name="action" value="upgrade" />
                    <input type="hidden" name="plan" value="PRO" />
                    <s-button submit variant="primary">
                      Upgrade to Pro
                    </s-button>
                  </Form>
                )}
              </s-stack>
            </s-card>
          </s-stack>

          {/* Current Usage */}
          <s-card title="Current Usage" sectioned>
            <s-stack direction="block" gap="base">
              <s-text>
                Active Rules: {data.shop.activeRulesCount} / {BILLING_PLANS[currentPlan].maxRules === 999 ? "Unlimited" : BILLING_PLANS[currentPlan].maxRules}
              </s-text>

              {currentPlan === "FREE" && data.shop.activeRulesCount >= 1 && (
                <s-banner status="warning">
                  <s-text>
                    You've reached your rule limit on the Free plan. Upgrade to Pro for unlimited rules!
                  </s-text>
                </s-banner>
              )}
            </s-stack>
          </s-card>

          {/* Subscription Details */}
          {hasActiveSub && data.subscription && (
            <s-card title="Subscription Details" sectioned>
              <s-stack direction="block" gap="base">
                <s-text>Status: {data.subscription.status}</s-text>
                <s-text>
                  Next billing: {new Date(data.subscription.currentPeriodEnd).toLocaleDateString()}
                </s-text>
                <s-text appearance="subdued" size="small">
                  Subscription ID: {data.subscription.id}
                </s-text>
              </s-stack>
            </s-card>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
