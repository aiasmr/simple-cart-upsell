import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, Form, useActionData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction } from "react-router";
import { prisma } from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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

  return {
    settings: {
      freeShippingEnabled: shopRecord.freeShippingEnabled,
      freeShippingThreshold: shopRecord.freeShippingThreshold.toString(),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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

    // Update shop settings
    await prisma.shop.update({
      where: { shopifyDomain: shop },
      data: {
        freeShippingEnabled,
        freeShippingThreshold,
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
                <s-checkbox
                  name="freeShippingEnabled"
                  defaultChecked={data.settings.freeShippingEnabled}
                >
                  Enable free shipping progress bar
                </s-checkbox>

                <s-stack direction="block" gap="tight">
                  <s-text weight="semibold">Free Shipping Threshold</s-text>
                  <s-text appearance="subdued" size="small">
                    The minimum cart value needed for free shipping (in your store's currency)
                  </s-text>
                  <s-text-field
                    name="freeShippingThreshold"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={data.settings.freeShippingThreshold}
                    prefix="$"
                  />
                </s-stack>

                <s-banner status="info">
                  <s-stack direction="block" gap="tight">
                    <s-text weight="semibold">Example Messages:</s-text>
                    <s-text>• "Add $15.00 more for free shipping!" (when below threshold)</s-text>
                    <s-text>• "🎉 You've unlocked free shipping!" (when threshold reached)</s-text>
                  </s-stack>
                </s-banner>
              </s-stack>

              <s-divider />

              <s-button submit variant="primary">
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
