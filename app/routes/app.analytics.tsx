import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";

/**
 * Analytics Dashboard
 * Shows impressions, conversions, and revenue metrics
 */

interface AnalyticsData {
  summary: {
    totalImpressions: number;
    totalConversions: number;
    conversionRate: number;
    totalRevenue: number;
  };
  rulePerformance: Array<{
    ruleId: string;
    ruleName: string;
    impressions: number;
    conversions: number;
    conversionRate: number;
    revenue: number;
    isEnabled: boolean;
  }>;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Get shop currency from Shopify
  const shopResponse = await admin.graphql(`
    query {
      shop {
        currencyCode
      }
    }
  `);
  const shopData = await shopResponse.json();
  const currencyCode = shopData?.data?.shop?.currencyCode || "USD";

  // Get shop record
  const shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shop },
  });

  if (!shopRecord) {
    return {
      summary: {
        totalImpressions: 0,
        totalConversions: 0,
        conversionRate: 0,
        totalRevenue: 0,
      },
      rulePerformance: [],
      currencyCode,
    };
  }

  // Get all analytics events for this shop
  const events = await prisma.analyticsEvent.findMany({
    where: { shopId: shopRecord.id },
    include: {
      rule: true,
    },
  });

  // Calculate summary metrics
  const impressionEvents = events.filter((e) => e.eventType === "IMPRESSION");
  const conversionEvents = events.filter((e) => e.eventType === "CONVERSION");

  const totalImpressions = impressionEvents.length;
  const totalConversions = conversionEvents.length;
  const conversionRate =
    totalImpressions > 0 ? (totalConversions / totalImpressions) * 100 : 0;

  const totalRevenue = conversionEvents.reduce(
    (sum, event) => sum + Number(event.productPrice || 0),
    0
  );

  // Calculate per-rule performance
  const ruleIds = [...new Set(events.map((e) => e.ruleId))];
  const rulePerformance = await Promise.all(
    ruleIds.map(async (ruleId) => {
      const rule = await prisma.rule.findUnique({
        where: { id: ruleId },
      });

      if (!rule) return null;

      const ruleImpressions = events.filter(
        (e) => e.ruleId === ruleId && e.eventType === "IMPRESSION"
      ).length;

      const ruleConversions = events.filter(
        (e) => e.ruleId === ruleId && e.eventType === "CONVERSION"
      ).length;

      const ruleConversionRate =
        ruleImpressions > 0 ? (ruleConversions / ruleImpressions) * 100 : 0;

      const ruleRevenue = events
        .filter((e) => e.ruleId === ruleId && e.eventType === "CONVERSION")
        .reduce((sum, event) => sum + Number(event.productPrice || 0), 0);

      return {
        ruleId: rule.id,
        ruleName: rule.name,
        impressions: ruleImpressions,
        conversions: ruleConversions,
        conversionRate: ruleConversionRate,
        revenue: ruleRevenue,
        isEnabled: rule.isEnabled,
      };
    })
  );

  const analytics = {
    summary: {
      totalImpressions,
      totalConversions,
      conversionRate,
      totalRevenue,
    },
    rulePerformance: rulePerformance.filter(Boolean) as any,
    currencyCode,
  };

  return analytics;
}

export default function Analytics() {
  const analytics = useLoaderData<typeof loader>();

  // Format currency with shop's currency code
  const formatCurrency = (cents: number) => {
    const amount = cents / 100;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: analytics.currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <s-page heading="Analytics">
      {/* Summary Cards */}
      <s-section>
        <s-stack direction="block" gap="base">
          <s-heading>Performance Overview</s-heading>
          <s-grid columns="4">
            {/* Total Impressions */}
            <s-card>
              <s-stack direction="block" gap="tight" align="center">
                <s-icon name="eye" size="large" />
                <s-heading level="2" style={{ fontSize: "2rem", margin: 0 }}>
                  {analytics.summary.totalImpressions.toLocaleString()}
                </s-heading>
                <s-text variant="muted">Total Impressions</s-text>
                <s-text variant="subdued">Times upsells were shown</s-text>
              </s-stack>
            </s-card>

            {/* Total Conversions */}
            <s-card>
              <s-stack direction="block" gap="tight" align="center">
                <s-icon name="cart" size="large" />
                <s-heading level="2" style={{ fontSize: "2rem", margin: 0 }}>
                  {analytics.summary.totalConversions.toLocaleString()}
                </s-heading>
                <s-text variant="muted">Total Conversions</s-text>
                <s-text variant="subdued">Times added to cart</s-text>
              </s-stack>
            </s-card>

            {/* Conversion Rate */}
            <s-card>
              <s-stack direction="block" gap="tight" align="center">
                <s-icon name="chart-bar" size="large" />
                <s-heading level="2" style={{ fontSize: "2rem", margin: 0 }}>
                  {analytics.summary.conversionRate.toFixed(1)}%
                </s-heading>
                <s-text variant="muted">Conversion Rate</s-text>
                <s-text variant="subdued">Conversions / Impressions</s-text>
              </s-stack>
            </s-card>

            {/* Total Revenue */}
            <s-card>
              <s-stack direction="block" gap="tight" align="center">
                <s-icon name="currency-dollar" size="large" />
                <s-heading level="2" style={{ fontSize: "2rem", margin: 0 }}>
                  {formatCurrency(analytics.summary.totalRevenue)}
                </s-heading>
                <s-text variant="muted">Total Revenue</s-text>
                <s-text variant="subdued">Revenue from upsells</s-text>
              </s-stack>
            </s-card>
          </s-grid>
        </s-stack>
      </s-section>

      {/* Per-Rule Performance Table */}
      <s-section heading="Performance by Rule">
        {analytics.rulePerformance.length > 0 ? (
          <s-table>
            <table>
              <thead>
                <tr>
                  <th>Rule Name</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Impressions</th>
                  <th style={{ textAlign: "right" }}>Conversions</th>
                  <th style={{ textAlign: "right" }}>Conv. Rate</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {analytics.rulePerformance.map((rule) => (
                  <tr key={rule.ruleId}>
                    <td>{rule.ruleName}</td>
                    <td>
                      {rule.isEnabled ? (
                        <s-badge variant="success">Active</s-badge>
                      ) : (
                        <s-badge>Disabled</s-badge>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {rule.impressions.toLocaleString()}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {rule.conversions.toLocaleString()}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {rule.conversionRate.toFixed(1)}%
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {formatCurrency(rule.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </s-table>
        ) : (
          <s-card>
            <s-stack direction="block" gap="base" align="center">
              <s-icon name="chart-bar" size="large" />
              <s-text variant="muted">
                No analytics data yet. Upsells will appear here once they start
                showing to customers.
              </s-text>
              <s-button href="/app/rules/new" variant="primary">
                Create Your First Rule
              </s-button>
            </s-stack>
          </s-card>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
