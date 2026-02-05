import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useSearchParams, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";
import { prisma } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get shop record
  const shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shop },
  });

  if (!shopRecord) {
    return Response.json({ rules: [], shop: { plan: "FREE" } });
  }

  // Get search params
  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const enabled = url.searchParams.get("enabled");

  // Build query
  const where: any = {
    shopId: shopRecord.id,
  };

  if (search) {
    where.name = {
      contains: search,
      mode: "insensitive",
    };
  }

  if (enabled !== null && enabled !== "") {
    where.isEnabled = enabled === "true";
  }

  // Get rules with analytics
  const rules = await prisma.rule.findMany({
    where,
    include: {
      analytics: {
        select: {
          eventType: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // Calculate stats for each rule
  const rulesWithStats = rules.map((rule) => {
    const impressions = rule.analytics.filter(
      (a) => a.eventType === "IMPRESSION"
    ).length;
    const conversions = rule.analytics.filter(
      (a) => a.eventType === "CONVERSION"
    ).length;
    const conversionRate =
      impressions > 0 ? ((conversions / impressions) * 100).toFixed(1) : "0.0";

    return {
      id: rule.id,
      name: rule.name,
      isEnabled: rule.isEnabled,
      triggerType: rule.triggerType,
      triggerProductId: rule.triggerProductId,
      triggerCollectionId: rule.triggerCollectionId,
      triggerProductData: rule.triggerProductData as any,
      upsellProductData: rule.upsellProductData as any,
      stats: {
        impressions,
        conversions,
        conversionRate,
      },
      createdAt: rule.createdAt.toISOString(),
    };
  });

  return Response.json({
    rules: rulesWithStats,
    shop: {
      plan: shopRecord.currentPlan,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shop },
  });

  if (!shopRecord) {
    return Response.json({ error: "Shop not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  const ruleId = formData.get("ruleId") as string;

  if (intent === "delete") {
    await prisma.rule.delete({
      where: { id: ruleId },
    });
    return Response.json({ success: true });
  }

  if (intent === "toggle") {
    const isEnabled = formData.get("isEnabled") === "true";
    await prisma.rule.update({
      where: { id: ruleId },
      data: { isEnabled },
    });
    return Response.json({ success: true });
  }

  return Response.json({ error: "Invalid intent" }, { status: 400 });
};

export default function RulesIndex() {
  const { rules, shop } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasRules = rules.length > 0;

  const handleSearch = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("search", value);
    } else {
      params.delete("search");
    }
    setSearchParams(params);
  };

  const handleFilterChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value !== "all") {
      params.set("enabled", value);
    } else {
      params.delete("enabled");
    }
    setSearchParams(params);
  };

  return (
    <s-page heading="Upsell Rules">
      <s-button slot="primary-action" href="/app/rules/new" variant="primary">
        Create Rule
      </s-button>

      {/* Search and Filter */}
      {hasRules && (
        <s-section>
          <s-stack direction="inline" gap="base" align="start">
            <div style={{ flex: 1, maxWidth: "400px" }}>
              <s-text-field
                placeholder="Search rules..."
                value={searchParams.get("search") || ""}
                onInput={(e: any) => handleSearch(e.target.value)}
              />
            </div>
            <s-select
              value={searchParams.get("enabled") || "all"}
              onChange={(e: any) => handleFilterChange(e.target.value)}
            >
              <option value="all">All Rules</option>
              <option value="true">Enabled Only</option>
              <option value="false">Disabled Only</option>
            </s-select>
          </s-stack>
        </s-section>
      )}

      {/* Rules List */}
      {hasRules ? (
        <s-section>
          <s-stack direction="block" gap="base">
            {rules.map((rule) => (
              <RuleCard key={rule.id} rule={rule} />
            ))}
          </s-stack>
        </s-section>
      ) : (
        <EmptyState />
      )}
    </s-page>
  );
}

function RuleCard({ rule }: { rule: any }) {
  const fetcher = useFetcher();
  const isDeleting = fetcher.formData?.get("intent") === "delete";
  const isToggling = fetcher.formData?.get("intent") === "toggle";

  const handleToggle = () => {
    fetcher.submit(
      {
        intent: "toggle",
        ruleId: rule.id,
        isEnabled: String(!rule.isEnabled),
      },
      { method: "post" }
    );
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this rule? This cannot be undone.")) {
      fetcher.submit(
        {
          intent: "delete",
          ruleId: rule.id,
        },
        { method: "post" }
      );
    }
  };

  return (
    <s-card>
      <s-stack direction="block" gap="base">
        {/* Header with name and toggle */}
        <s-stack direction="inline" gap="base" align="center" justify="space-between">
          <s-stack direction="block" gap="tight">
            <s-heading level="3">{rule.name}</s-heading>
            <s-text variant="muted" size="small">
              {rule.triggerType === "PRODUCT"
                ? "Triggers when cart contains a specific product"
                : "Triggers when cart contains item from collection"}
            </s-text>
          </s-stack>
          <s-switch
            checked={rule.isEnabled}
            disabled={isToggling}
            onChange={handleToggle}
          />
        </s-stack>

        {/* Rule Flow: Trigger → Upsell */}
        <s-stack direction="inline" gap="large" align="start">
          {/* Left: Trigger */}
          <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
            <s-text size="small" variant="muted" weight="semibold">When customer adds:</s-text>
            {rule.triggerType === "PRODUCT" && rule.triggerProductData ? (
              <s-stack direction="inline" gap="base" align="start" style={{
                padding: "0.75rem",
                background: "#f9fafb",
                borderRadius: "8px",
                border: "1px solid #e5e7eb"
              }}>
                {rule.triggerProductData.image && (
                  <img
                    src={rule.triggerProductData.image}
                    alt={rule.triggerProductData.title}
                    style={{
                      width: "50px",
                      height: "50px",
                      objectFit: "cover",
                      borderRadius: "6px",
                    }}
                  />
                )}
                <s-stack direction="block" gap="none" style={{ flex: 1 }}>
                  <s-text weight="semibold">{rule.triggerProductData.title}</s-text>
                  <s-text variant="muted" size="small">
                    ${(parseFloat(rule.triggerProductData.price) / 100).toFixed(2)}
                  </s-text>
                </s-stack>
              </s-stack>
            ) : (
              <s-stack direction="block" gap="tight" style={{
                padding: "0.75rem",
                background: "#f9fafb",
                borderRadius: "8px",
                border: "1px solid #e5e7eb"
              }}>
                <s-text variant="muted" size="small">
                  {rule.triggerType === "PRODUCT" ? "Product" : "Collection"}
                </s-text>
                <s-text>
                  ID: {rule.triggerType === "PRODUCT"
                    ? rule.triggerProductId?.split('/').pop()
                    : rule.triggerCollectionId?.split('/').pop()}
                </s-text>
              </s-stack>
            )}
          </s-stack>

          {/* Arrow */}
          <s-stack align="center" justify="center" style={{ paddingTop: "1.5rem" }}>
            <s-text style={{ fontSize: "1.5rem" }}>→</s-text>
          </s-stack>

          {/* Right: Upsell */}
          <s-stack direction="block" gap="tight" style={{ flex: 1 }}>
            <s-text size="small" variant="muted" weight="semibold">Then show upsell:</s-text>
            {rule.upsellProductData && (
              <s-stack direction="inline" gap="base" align="start" style={{
                padding: "0.75rem",
                background: "#f0fdf4",
                borderRadius: "8px",
                border: "1px solid #86efac"
              }}>
                {rule.upsellProductData.image && (
                  <img
                    src={rule.upsellProductData.image}
                    alt={rule.upsellProductData.title}
                    style={{
                      width: "50px",
                      height: "50px",
                      objectFit: "cover",
                      borderRadius: "6px",
                    }}
                  />
                )}
                <s-stack direction="block" gap="none" style={{ flex: 1 }}>
                  <s-text weight="semibold">{rule.upsellProductData.title}</s-text>
                  <s-text variant="muted" size="small">
                    ${(parseFloat(rule.upsellProductData.price) / 100).toFixed(2)}
                  </s-text>
                </s-stack>
              </s-stack>
            )}
          </s-stack>
        </s-stack>

        {/* Stats */}
        <s-stack direction="inline" gap="large">
          <s-stack direction="block" gap="none">
            <s-text size="small" variant="muted">Views</s-text>
            <s-text weight="semibold">{rule.stats.impressions}</s-text>
          </s-stack>
          <s-stack direction="block" gap="none">
            <s-text size="small" variant="muted">Conversions</s-text>
            <s-text weight="semibold">{rule.stats.conversions}</s-text>
          </s-stack>
          <s-stack direction="block" gap="none">
            <s-text size="small" variant="muted">Rate</s-text>
            <s-text weight="semibold">{rule.stats.conversionRate}%</s-text>
          </s-stack>
        </s-stack>

        {/* Actions */}
        <s-stack direction="inline" gap="tight">
          <s-button
            href={`/app/rules/${rule.id}/edit`}
            variant="secondary"
          >
            Edit Rule
          </s-button>
          <s-button
            onClick={handleDelete}
            variant="tertiary"
            {...(isDeleting ? { loading: true } : {})}
          >
            Delete
          </s-button>
        </s-stack>
      </s-stack>
    </s-card>
  );
}

function EmptyState() {
  return (
    <s-section>
      <s-stack direction="block" gap="large" align="center">
        <s-stack direction="block" gap="base" align="center">
          <s-heading level="2">No upsell rules yet</s-heading>
          <s-text variant="muted" align="center">
            Create your first rule to start showing product recommendations in
            your cart.
          </s-text>
        </s-stack>
        <s-button href="/app/rules/new" variant="primary" size="large">
          Create Your First Rule
        </s-button>
      </s-stack>
    </s-section>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
