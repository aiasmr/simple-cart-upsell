import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";
import { prisma } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get or create shop record
  let shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shop },
    include: {
      rules: {
        where: { isEnabled: true },
      },
    },
  });

  if (!shopRecord) {
    // Create shop record on first install
    shopRecord = await prisma.shop.create({
      data: {
        shopifyDomain: shop,
        accessToken: session.accessToken,
        currentPlan: "FREE",
        billingStatus: "ACTIVE",
      },
      include: {
        rules: {
          where: { isEnabled: true },
        },
      },
    });
  } else {
    // Update access token on each login to keep it fresh
    shopRecord = await prisma.shop.update({
      where: { id: shopRecord.id },
      data: { accessToken: session.accessToken },
      include: {
        rules: {
          where: { isEnabled: true },
        },
      },
    });
  }

  // Get analytics for last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const impressions = await prisma.analyticsEvent.count({
    where: {
      shopId: shopRecord.id,
      eventType: "IMPRESSION",
      createdAt: { gte: sevenDaysAgo },
    },
  });

  const conversions = await prisma.analyticsEvent.count({
    where: {
      shopId: shopRecord.id,
      eventType: "CONVERSION",
      createdAt: { gte: sevenDaysAgo },
    },
  });

  const conversionRate = impressions > 0 ? (conversions / impressions) * 100 : 0;

  return {
    shop: {
      plan: shopRecord.currentPlan,
      activeRulesCount: shopRecord.rules.length,
    },
    stats: {
      impressions,
      conversions,
      conversionRate: conversionRate.toFixed(1),
    },
  };
};

export default function Index() {
  const { shop, stats } = useLoaderData<typeof loader>();
  const hasRules = shop.activeRulesCount > 0;

  return (
    <s-page heading="Dashboard">
      <s-button slot="primary-action" href="/app/rules/new">
        Create Rule
      </s-button>

      {/* Stats Summary Cards */}
      <s-section>
        <s-stack direction="block" gap="base">
          <s-heading>Performance (Last 7 days)</s-heading>
          <s-grid columns="3">
            {/* Upsell Views */}
            <s-card>
              <s-stack direction="block" gap="tight" align="center">
                <s-icon name="eye" size="large" />
                <s-heading level="2" style={{ fontSize: "2rem", margin: 0 }}>
                  {stats.impressions.toLocaleString()}
                </s-heading>
                <s-text variant="muted">Upsell Views</s-text>
              </s-stack>
            </s-card>

            {/* Adds to Cart */}
            <s-card>
              <s-stack direction="block" gap="tight" align="center">
                <s-icon name="cart" size="large" />
                <s-heading level="2" style={{ fontSize: "2rem", margin: 0 }}>
                  {stats.conversions.toLocaleString()}
                </s-heading>
                <s-text variant="muted">Adds to Cart</s-text>
              </s-stack>
            </s-card>

            {/* Conversion Rate */}
            <s-card>
              <s-stack direction="block" gap="tight" align="center">
                <s-icon name="chart-bar" size="large" />
                <s-heading level="2" style={{ fontSize: "2rem", margin: 0 }}>
                  {stats.conversionRate}%
                </s-heading>
                <s-text variant="muted">Conversion Rate</s-text>
              </s-stack>
            </s-card>
          </s-grid>
        </s-stack>
      </s-section>

      {/* Quick Actions */}
      <s-section heading="Quick Actions">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" align="center">
            <s-text>Active Rules: {shop.activeRulesCount}</s-text>
            <s-badge variant={shop.plan === "FREE" ? "default" : "success"}>
              {shop.plan}
            </s-badge>
          </s-stack>

          <s-stack direction="inline" gap="base">
            <s-button href="/app/rules">View All Rules</s-button>
            <s-button href="/app/rules/new" variant="primary">
              Create New Rule
            </s-button>
            {shop.plan === "PRO" && (
              <s-button href="/app/analytics">View Analytics</s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>

      {/* Getting Started Guide (Empty State) */}
      {!hasRules && (
        <s-section heading="Get Started with Simple Cart Upsell">
          <s-stack direction="block" gap="large">
            <s-paragraph>
              Welcome to Simple Cart Upsell! Create your first upsell rule to
              start boosting your Average Order Value.
            </s-paragraph>

            <s-stack direction="inline" gap="extra-large" wrap>
              <s-stack direction="block" gap="tight" style={{ maxWidth: "300px" }}>
                <s-heading level="3">1. Create a Rule</s-heading>
                <s-text>
                  Set up a trigger (product or collection) and choose which
                  product to show as an upsell.
                </s-text>
              </s-stack>

              <s-stack direction="block" gap="tight" style={{ maxWidth: "300px" }}>
                <s-heading level="3">2. Rule Triggers in Cart</s-heading>
                <s-text>
                  When customers add matching products to their cart, they'll
                  see your upsell offer.
                </s-text>
              </s-stack>

              <s-stack direction="block" gap="tight" style={{ maxWidth: "300px" }}>
                <s-heading level="3">3. Track Performance</s-heading>
                <s-text>
                  Monitor views, conversions, and optimize your upsell strategy
                  over time.
                </s-text>
              </s-stack>
            </s-stack>

            <s-button href="/app/rules/new" variant="primary" size="large">
              Create Your First Rule
            </s-button>
          </s-stack>
        </s-section>
      )}

      {/* Plan Information */}
      <s-section slot="aside" heading="Your Plan">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="tight">
            <s-heading level="3">{shop.plan} Plan</s-heading>
            {shop.plan === "FREE" && (
              <>
                <s-text>
                  • {shop.activeRulesCount}/1 active rule
                </s-text>
                <s-button href="/app/billing" variant="primary">
                  Upgrade to Starter ($7.99/mo)
                </s-button>
              </>
            )}
            {shop.plan === "STARTER" && (
              <>
                <s-text>• Unlimited rules</s-text>
                <s-button href="/app/billing" variant="primary">
                  Upgrade to Pro ($14.99/mo)
                </s-button>
              </>
            )}
            {shop.plan === "PRO" && (
              <>
                <s-text>• Unlimited rules</s-text>
                <s-text>• Advanced analytics</s-text>
                <s-text variant="success">✓ All features unlocked</s-text>
              </>
            )}
          </s-stack>
        </s-stack>
      </s-section>

      {/* Help & Resources */}
      <s-section slot="aside" heading="Help & Resources">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-link href="/app/faq" target="_blank">
              View FAQ
            </s-link>
          </s-paragraph>
          <s-paragraph>
            <s-link href="mailto:support@simplecart-upsell.com">
              Contact Support
            </s-link>
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
