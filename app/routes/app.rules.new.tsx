import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Form, useActionData, useNavigation, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";
import { prisma } from "../db.server";
import { useState } from "react";

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

  // Check plan limits
  const canCreateRule = shopRecord.currentPlan !== "FREE" || shopRecord.rules.length < 1;

  return Response.json({
    shop: {
      plan: shopRecord.currentPlan,
      activeRulesCount: shopRecord.rules.length,
      canCreateRule,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shop },
    include: {
      rules: {
        where: { isEnabled: true },
      },
    },
  });

  if (!shopRecord) {
    return Response.json({ error: "Shop not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const name = formData.get("name") as string;
  const triggerType = formData.get("triggerType") as "PRODUCT" | "COLLECTION";
  const triggerProductId = formData.get("triggerProductId") as string;
  const triggerCollectionId = formData.get("triggerCollectionId") as string;
  const upsellProductId = formData.get("upsellProductId") as string;
  const isEnabled = formData.get("isEnabled") === "true";

  // Validation
  const errors: any = {};

  if (!name || name.trim().length === 0) {
    errors.name = "Rule name is required";
  }

  if (!triggerType) {
    errors.triggerType = "Trigger type is required";
  }

  if (triggerType === "PRODUCT" && !triggerProductId) {
    errors.triggerProductId = "Trigger product is required";
  }

  if (triggerType === "COLLECTION" && !triggerCollectionId) {
    errors.triggerCollectionId = "Trigger collection is required";
  }

  if (!upsellProductId) {
    errors.upsellProductId = "Upsell product is required";
  }

  // Check if trigger and upsell are the same
  if (triggerType === "PRODUCT" && triggerProductId === upsellProductId) {
    errors.upsellProductId = "Trigger and upsell must be different products";
  }

  // Check plan limits
  if (
    shopRecord.currentPlan === "FREE" &&
    shopRecord.rules.length >= 1 &&
    isEnabled
  ) {
    errors.plan = "Free plan allows only 1 active rule. Upgrade to create more.";
  }

  if (Object.keys(errors).length > 0) {
    return Response.json({ errors }, { status: 400 });
  }

  // Fetch trigger product data from Shopify (if trigger is PRODUCT)
  let triggerProductData: any = null;
  if (triggerType === "PRODUCT" && triggerProductId) {
    try {
      const response = await admin.graphql(
        `#graphql
          query getProduct($id: ID!) {
            product(id: $id) {
              id
              title
              featuredImage {
                url
              }
              variants(first: 1) {
                edges {
                  node {
                    price
                  }
                }
              }
            }
          }
        `,
        {
          variables: {
            id: triggerProductId,
          },
        }
      );

      const data = await response.json();
      const product = data.data?.product;

      if (product) {
        const variant = product.variants.edges[0]?.node;
        // Convert price from dollars to cents for consistent storage
        const priceInCents = variant?.price
          ? Math.round(parseFloat(variant.price) * 100).toString()
          : "0";
        triggerProductData = {
          title: product.title,
          image: product.featuredImage?.url || null,
          price: priceInCents,
        };
      }
    } catch (error) {
      console.error("Error fetching trigger product data:", error);
    }
  }

  // Fetch upsell product data from Shopify
  let upsellProductData: any = null;
  try {
    const response = await admin.graphql(
      `#graphql
        query getProduct($id: ID!) {
          product(id: $id) {
            id
            title
            featuredImage {
              url
            }
            variants(first: 1) {
              edges {
                node {
                  id
                  price
                  compareAtPrice
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          id: upsellProductId,
        },
      }
    );

    const data = await response.json();
    const product = data.data?.product;

    if (product) {
      const variant = product.variants.edges[0]?.node;
      // Convert prices from dollars to cents for consistent storage
      const priceInCents = variant?.price
        ? Math.round(parseFloat(variant.price) * 100).toString()
        : "0";
      const compareAtPriceInCents = variant?.compareAtPrice
        ? Math.round(parseFloat(variant.compareAtPrice) * 100).toString()
        : null;
      upsellProductData = {
        title: product.title,
        image: product.featuredImage?.url || null,
        price: priceInCents,
        compareAtPrice: compareAtPriceInCents,
        variantId: variant?.id || null,
      };
    }
  } catch (error) {
    console.error("Error fetching product data:", error);
    return Response.json(
      { errors: { upsellProductId: "Failed to fetch product data" } },
      { status: 400 }
    );
  }

  // Create rule
  await prisma.rule.create({
    data: {
      shopId: shopRecord.id,
      name: name.trim(),
      triggerType,
      triggerProductId: triggerType === "PRODUCT" ? triggerProductId : null,
      triggerCollectionId: triggerType === "COLLECTION" ? triggerCollectionId : null,
      triggerProductData,
      upsellProductId,
      upsellProductData,
      isEnabled,
    },
  });

  return redirect("/app/rules");
};

export default function NewRule() {
  const { shop } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [triggerType, setTriggerType] = useState<"PRODUCT" | "COLLECTION">("PRODUCT");
  const [triggerProductId, setTriggerProductId] = useState("");
  const [triggerCollectionId, setTriggerCollectionId] = useState("");
  const [upsellProductId, setUpsellProductId] = useState("");

  // Show upgrade modal if plan limit reached
  if (!shop.canCreateRule) {
    return <UpgradeModal plan={shop.plan} />;
  }

  return (
    <s-page
      heading="Create Upsell Rule"
      backAction={{ content: "Rules", url: "/app/rules" }}
    >
      <Form method="post">
        <s-section>
          <s-stack direction="block" gap="large">
            {/* Rule Name */}
            <div>
              <s-text weight="semibold">Rule Name</s-text>
              <s-text-field
                name="name"
                placeholder="e.g., Coffee + Mug Bundle"
                maxLength={100}
                required
              />
              {actionData?.errors?.name && (
                <s-text variant="error">{actionData.errors.name}</s-text>
              )}
              <s-text variant="muted" size="small">
                Internal name for your reference (not shown to customers)
              </s-text>
            </div>

            {/* Trigger Type */}
            <div>
              <s-text weight="semibold">Trigger</s-text>
              <s-text variant="muted">When customer adds this to cart</s-text>
              <s-stack direction="block" gap="base" style={{ marginTop: "12px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="radio"
                    name="triggerType"
                    value="PRODUCT"
                    checked={triggerType === "PRODUCT"}
                    onChange={() => setTriggerType("PRODUCT")}
                  />
                  <s-text>Product</s-text>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="radio"
                    name="triggerType"
                    value="COLLECTION"
                    checked={triggerType === "COLLECTION"}
                    onChange={() => setTriggerType("COLLECTION")}
                  />
                  <s-text>Collection</s-text>
                </label>
              </s-stack>
            </div>

            {/* Trigger Product/Collection Picker */}
            {triggerType === "PRODUCT" ? (
              <div>
                <s-text weight="semibold">Select Trigger Product</s-text>
                <s-text variant="muted" size="small">
                  Choose the product that will trigger this upsell
                </s-text>
                <input
                  type="hidden"
                  name="triggerProductId"
                  value={triggerProductId}
                />
                <ProductPickerButton
                  selectedId={triggerProductId}
                  onSelect={setTriggerProductId}
                  label="Select Product"
                />
                {actionData?.errors?.triggerProductId && (
                  <s-text variant="error">
                    {actionData.errors.triggerProductId}
                  </s-text>
                )}
              </div>
            ) : (
              <div>
                <s-text weight="semibold">Select Trigger Collection</s-text>
                <s-text variant="muted" size="small">
                  Choose the collection that will trigger this upsell
                </s-text>
                <input
                  type="hidden"
                  name="triggerCollectionId"
                  value={triggerCollectionId}
                />
                <CollectionPickerButton
                  selectedId={triggerCollectionId}
                  onSelect={setTriggerCollectionId}
                  label="Select Collection"
                />
                {actionData?.errors?.triggerCollectionId && (
                  <s-text variant="error">
                    {actionData.errors.triggerCollectionId}
                  </s-text>
                )}
              </div>
            )}

            {/* Upsell Product Picker */}
            <div>
              <s-text weight="semibold">Upsell Product</s-text>
              <s-text variant="muted" size="small">
                The product to show as the upsell recommendation
              </s-text>
              <input type="hidden" name="upsellProductId" value={upsellProductId} />
              <ProductPickerButton
                selectedId={upsellProductId}
                onSelect={setUpsellProductId}
                label="Select Upsell Product"
              />
              {actionData?.errors?.upsellProductId && (
                <s-text variant="error">
                  {actionData.errors.upsellProductId}
                </s-text>
              )}
            </div>

            {/* Enable Rule */}
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  name="isEnabled"
                  value="true"
                  defaultChecked
                />
                <s-text weight="semibold">Enable this rule immediately</s-text>
              </label>
            </div>

            {/* Plan Limit Warning */}
            {shop.plan === "FREE" && shop.activeRulesCount >= 1 && (
              <s-banner variant="warning">
                <s-text>
                  You're on the Free plan (1 rule limit). This rule will be created
                  as disabled. Upgrade to Starter to enable unlimited rules.
                </s-text>
              </s-banner>
            )}

            {/* Error Messages */}
            {actionData?.errors?.plan && (
              <s-banner variant="critical">
                <s-text>{actionData.errors.plan}</s-text>
              </s-banner>
            )}
          </s-stack>
        </s-section>

        {/* Actions */}
        <s-section>
          <s-stack direction="inline" gap="base">
            <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
              Create Rule
            </s-button>
            <s-button href="/app/rules">Cancel</s-button>
          </s-stack>
        </s-section>
      </Form>
    </s-page>
  );
}

function ProductPickerButton({
  selectedId,
  onSelect,
  label,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  const handleClick = () => {
    // Use Shopify App Bridge to open product picker
    // @ts-ignore
    if (window.shopify?.resourcePicker) {
      // @ts-ignore
      window.shopify.resourcePicker({
        type: "product",
        action: "select",
        filter: {
          variants: false,
        },
      }).then((selection: any) => {
        if (selection && selection.length > 0) {
          onSelect(selection[0].id);
        }
      });
    }
  };

  return (
    <div style={{ marginTop: "8px" }}>
      <s-button onClick={handleClick}>{label}</s-button>
      {selectedId && (
        <s-text variant="muted" size="small" style={{ marginTop: "4px" }}>
          Selected: {selectedId}
        </s-text>
      )}
    </div>
  );
}

function CollectionPickerButton({
  selectedId,
  onSelect,
  label,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  const handleClick = () => {
    // Use Shopify App Bridge to open collection picker
    // @ts-ignore
    if (window.shopify?.resourcePicker) {
      // @ts-ignore
      window.shopify.resourcePicker({
        type: "collection",
        action: "select",
      }).then((selection: any) => {
        if (selection && selection.length > 0) {
          onSelect(selection[0].id);
        }
      });
    }
  };

  return (
    <div style={{ marginTop: "8px" }}>
      <s-button onClick={handleClick}>{label}</s-button>
      {selectedId && (
        <s-text variant="muted" size="small" style={{ marginTop: "4px" }}>
          Selected: {selectedId}
        </s-text>
      )}
    </div>
  );
}

function UpgradeModal({ plan }: { plan: string }) {
  return (
    <s-page heading="Upgrade Required">
      <s-section>
        <s-stack direction="block" gap="large" align="center">
          <s-heading level="2">You've reached the Free plan limit</s-heading>
          <s-text align="center">
            The Free plan allows 1 active rule. Upgrade to create unlimited rules.
          </s-text>
          <s-stack direction="inline" gap="base">
            <s-button href="/app/billing" variant="primary">
              Upgrade to Starter ($7.99/mo)
            </s-button>
            <s-button href="/app/rules">Go Back</s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
