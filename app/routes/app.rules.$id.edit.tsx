import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Form, useActionData, useNavigation, useParams, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";
import { prisma } from "../db.server";
import { useState, useEffect } from "react";

// Step 1: Load existing rule data
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const ruleId = params.id;

  if (!ruleId) {
    throw new Response("Rule ID is required", { status: 400 });
  }

  // Get shop record
  const shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shop },
  });

  if (!shopRecord) {
    throw new Response("Shop not found", { status: 404 });
  }

  // Get the rule
  const rule = await prisma.rule.findUnique({
    where: {
      id: ruleId,
      shopId: shopRecord.id,
    },
  });

  if (!rule) {
    throw new Response("Rule not found", { status: 404 });
  }

  return Response.json({
    rule: {
      id: rule.id,
      name: rule.name,
      triggerType: rule.triggerType,
      triggerProductId: rule.triggerProductId,
      triggerCollectionId: rule.triggerCollectionId,
      upsellProductId: rule.upsellProductId,
      isEnabled: rule.isEnabled,
    },
    shop: {
      plan: shopRecord.currentPlan,
    },
  });
};

// Step 3: Update instead of create
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const ruleId = params.id;

  if (!ruleId) {
    return Response.json({ error: "Rule ID is required" }, { status: 400 });
  }

  const shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shop },
  });

  if (!shopRecord) {
    return Response.json({ error: "Shop not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Handle delete from edit page
  if (intent === "delete") {
    await prisma.rule.delete({
      where: { id: ruleId },
    });
    return redirect("/app/rules");
  }

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

  if (Object.keys(errors).length > 0) {
    return Response.json({ errors }, { status: 400 });
  }

  // Fetch updated product data if products changed
  const currentRule = await prisma.rule.findUnique({
    where: { id: ruleId },
  });

  // Fetch trigger product data (if trigger is PRODUCT and changed or missing)
  let triggerProductData = currentRule?.triggerProductData;

  if (triggerType === "PRODUCT" && triggerProductId &&
      (triggerProductId !== currentRule?.triggerProductId || !currentRule?.triggerProductData)) {
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

  // Fetch upsell product data
  let upsellProductData = currentRule?.upsellProductData;

  if (upsellProductId !== currentRule?.upsellProductId) {
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
  }

  // Update rule
  await prisma.rule.update({
    where: { id: ruleId },
    data: {
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

// Step 2: Pre-populate the form
export default function EditRule() {
  const { rule, shop } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [triggerType, setTriggerType] = useState<"PRODUCT" | "COLLECTION">(rule.triggerType);
  const [triggerProductId, setTriggerProductId] = useState(rule.triggerProductId || "");
  const [triggerCollectionId, setTriggerCollectionId] = useState(rule.triggerCollectionId || "");
  const [upsellProductId, setUpsellProductId] = useState(rule.upsellProductId);

  return (
    <s-page
      heading={`Edit Rule: ${rule.name}`}
      backAction={{ content: "Rules", url: "/app/rules" }}
    >
      <Form method="post">
        <s-section>
          <s-stack direction="block" gap="large">
            {/* Rule Name - Pre-populated */}
            <div>
              <s-text weight="semibold">Rule Name</s-text>
              <s-text-field
                name="name"
                defaultValue={rule.name}
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

            {/* Trigger Type - Pre-selected */}
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

            {/* Trigger Product/Collection Picker - Pre-selected */}
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
                  label={triggerProductId ? "Change Product" : "Select Product"}
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
                  label={triggerCollectionId ? "Change Collection" : "Select Collection"}
                />
                {actionData?.errors?.triggerCollectionId && (
                  <s-text variant="error">
                    {actionData.errors.triggerCollectionId}
                  </s-text>
                )}
              </div>
            )}

            {/* Upsell Product Picker - Pre-selected */}
            <div>
              <s-text weight="semibold">Upsell Product</s-text>
              <s-text variant="muted" size="small">
                The product to show as the upsell recommendation
              </s-text>
              <input type="hidden" name="upsellProductId" value={upsellProductId} />
              <ProductPickerButton
                selectedId={upsellProductId}
                onSelect={setUpsellProductId}
                label={upsellProductId ? "Change Upsell Product" : "Select Upsell Product"}
              />
              {actionData?.errors?.upsellProductId && (
                <s-text variant="error">
                  {actionData.errors.upsellProductId}
                </s-text>
              )}
            </div>

            {/* Enable Rule - Pre-checked */}
            <div>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  name="isEnabled"
                  value="true"
                  defaultChecked={rule.isEnabled}
                />
                <s-text weight="semibold">Enable this rule</s-text>
              </label>
            </div>

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
          <s-stack direction="inline" gap="base" align="center">
            <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
              Save Changes
            </s-button>
            <s-button href="/app/rules">Cancel</s-button>
            <div style={{ flex: 1 }} />
            <s-button
              type="submit"
              name="intent"
              value="delete"
              variant="tertiary"
              {...(isSubmitting ? { loading: true } : {})}
            >
              Delete Rule
            </s-button>
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

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
