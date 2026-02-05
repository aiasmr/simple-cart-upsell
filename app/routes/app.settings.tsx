import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Form, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";
import { prisma } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shop },
    select: {
      freeShippingEnabled: true,
      freeShippingThreshold: true,
    },
  });

  if (!shopRecord) {
    throw new Error("Shop not found");
  }

  // Fetch store currency from Shopify
  let currency = "USD";
  try {
    const response = await admin.graphql(`
      query {
        shop {
          currencyCode
        }
      }
    `);
    const data = await response.json();
    currency = data?.data?.shop?.currencyCode || "USD";
  } catch (error) {
    console.error("Failed to fetch currency:", error);
  }

  return {
    settings: {
      freeShippingEnabled: shopRecord.freeShippingEnabled,
      freeShippingThreshold: shopRecord.freeShippingThreshold.toString(),
    },
    currency,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const freeShippingEnabled = formData.get("freeShippingEnabled") === "on";
  const freeShippingThreshold = parseFloat(formData.get("freeShippingThreshold") as string);

  try {
    // Validate threshold
    if (isNaN(freeShippingThreshold) || freeShippingThreshold < 0) {
      return {
        success: false,
        error: "Please enter a valid shipping threshold amount.",
      };
    }

    // Fetch and save currency code
    let currencyCode = "USD";
    try {
      const response = await admin.graphql(`
        query {
          shop {
            currencyCode
          }
        }
      `);
      const data = await response.json();
      currencyCode = data?.data?.shop?.currencyCode || "USD";
    } catch (error) {
      console.error("Failed to fetch currency:", error);
    }

    // Update shop settings
    await prisma.shop.update({
      where: { shopifyDomain: shop },
      data: {
        freeShippingEnabled,
        freeShippingThreshold,
        currencyCode,
      },
    });

    return {
      success: true,
      message: "Settings saved successfully!",
    };
  } catch (error: any) {
    console.error("Settings update error:", error);
    return {
      success: false,
      error: error.message || "Failed to save settings",
    };
  }
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  // Currency symbol map
  const currencySymbols: Record<string, string> = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    CAD: "CA$",
    AUD: "A$",
    JPY: "¥",
    CNY: "¥",
    INR: "₹",
  };

  const currencySymbol = currencySymbols[data.currency] || data.currency;

  return (
    <s-page heading="Settings">
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
        <Form method="post">
          <s-card title="Free Shipping Progress Bar" sectioned>
            <s-stack direction="block" gap="base">
              <s-text appearance="subdued">
                Show a progress bar in the cart encouraging customers to add more items to reach free shipping.
              </s-text>

              <s-divider />

              <s-stack direction="block" gap="base">
                <label>
                  <input
                    type="checkbox"
                    name="freeShippingEnabled"
                    defaultChecked={data.settings.freeShippingEnabled}
                    style={{ marginRight: '8px' }}
                  />
                  <s-text weight="semibold">Enable free shipping progress bar</s-text>
                </label>

                <s-stack direction="block" gap="tight">
                  <s-text weight="semibold">Free Shipping Threshold ({data.currency})</s-text>
                  <s-text appearance="subdued" size="small">
                    The minimum cart value needed for free shipping
                  </s-text>
                  <s-text-field
                    name="freeShippingThreshold"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={data.settings.freeShippingThreshold}
                    prefix={currencySymbol}
                  />
                </s-stack>

                <s-banner status="info">
                  <s-stack direction="block" gap="tight">
                    <s-text weight="semibold">Example Messages:</s-text>
                    <s-text>• "Add {currencySymbol}15.00 more for free shipping!" (when below threshold)</s-text>
                    <s-text>• "🎉 You've unlocked free shipping!" (when threshold reached)</s-text>
                  </s-stack>
                </s-banner>
              </s-stack>

              <s-divider />

              <s-button type="submit" variant="primary">
                Save Settings
              </s-button>
            </s-stack>
          </s-card>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
