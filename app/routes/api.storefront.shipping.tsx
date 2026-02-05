import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "../db.server";

/**
 * Storefront API: Get Free Shipping Settings
 *
 * Public endpoint - no authentication required
 * Called from theme extension to display free shipping progress bar
 *
 * Query params:
 * - shop: Shop domain (e.g., "my-store.myshopify.com")
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  // Validation
  if (!shop) {
    return Response.json(
      { error: "Missing shop parameter" },
      {
        status: 400,
        headers: { "Access-Control-Allow-Origin": "*" }
      }
    );
  }

  try {
    // Get shop record
    const shopRecord = await prisma.shop.findUnique({
      where: { shopifyDomain: shop },
      select: {
        freeShippingEnabled: true,
        freeShippingThreshold: true,
        currencyCode: true,
      },
    });

    if (!shopRecord) {
      return Response.json(
        {
          enabled: false,
          threshold: 0,
          currency: "USD",
        },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Return settings with CORS headers
    return Response.json(
      {
        enabled: shopRecord.freeShippingEnabled,
        threshold: parseFloat(shopRecord.freeShippingThreshold.toString()),
        currency: shopRecord.currencyCode,
      },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300", // Cache for 5 minutes
        },
      }
    );
  } catch (error) {
    console.error("Error fetching shipping settings:", error);

    // Return disabled on error
    return Response.json(
      {
        enabled: false,
        threshold: 0,
      },
      {
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
      }
    );
  }
}

// Handle CORS preflight requests
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
