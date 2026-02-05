import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "../db.server";

/**
 * Storefront API: Get Upsell Offers
 * 
 * Public endpoint - no authentication required
 * Called from theme extension to get product recommendations
 * 
 * Query params:
 * - shop: Shop domain (e.g., "my-store.myshopify.com")
 * - products: Comma-separated product IDs in cart
 * - cartToken: Shopify cart token (optional, for analytics)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const productsParam = url.searchParams.get("products");
  const cartToken = url.searchParams.get("cartToken");

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

  if (!productsParam) {
    return Response.json(
      { offers: [] },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }

  // Parse product IDs from cart
  const cartProductIds = productsParam.split(",").map(id => id.trim()).filter(Boolean);

  if (cartProductIds.length === 0) {
    return Response.json(
      { offers: [] },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }

  try {
    // Get shop record
    const shopRecord = await prisma.shop.findUnique({
      where: { shopifyDomain: shop },
    });

    if (!shopRecord) {
      return Response.json(
        { offers: [] },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Get enabled rules for this shop
    const rules = await prisma.rule.findMany({
      where: {
        shopId: shopRecord.id,
        isEnabled: true,
      },
      orderBy: {
        priority: "asc", // Lower priority number = higher priority
      },
    });

    // Helper function to extract numeric ID from Shopify GID
    const extractProductId = (gid: string | null): string | null => {
      if (!gid) return null;
      const match = gid.match(/gid:\/\/shopify\/Product\/(\d+)/);
      return match ? match[1] : null;
    };

    // Match rules based on cart contents
    const matchedRules = [];

    for (const rule of rules) {
      let matches = false;

      if (rule.triggerType === "PRODUCT") {
        // Check if trigger product is in cart
        const triggerNumericId = extractProductId(rule.triggerProductId);
        if (triggerNumericId && cartProductIds.includes(triggerNumericId)) {
          matches = true;
        }
      } else if (rule.triggerType === "COLLECTION") {
        // For collections, we'd need to check product collections
        // For MVP, we'll implement this in a future iteration
        // For now, skip collection-based triggers in storefront
        continue;
      }

      if (matches) {
        // Check if upsell product is already in cart
        const upsellNumericId = extractProductId(rule.upsellProductId);
        if (upsellNumericId && cartProductIds.includes(upsellNumericId)) {
          continue; // Don't show products already in cart
        }

        matchedRules.push(rule);
      }
    }

    // Limit to max 3 offers (configurable via block settings later)
    const maxOffers = 3;
    const topRules = matchedRules.slice(0, maxOffers);

    // Format response with cached product data
    const offers = topRules.map((rule) => {
      const productData = rule.upsellProductData as any;
      
      return {
        ruleId: rule.id,
        product: {
          id: rule.upsellProductId,
          variantId: productData?.variantId || rule.upsellProductId,
          title: productData?.title || "Product",
          image: productData?.image || null,
          price: productData?.price || "0.00",
          compareAtPrice: productData?.compareAtPrice || null,
          available: true, // Assume available for MVP
        },
      };
    });

    // Return offers with CORS headers
    return Response.json(
      { offers },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching upsell offers:", error);
    
    // Return empty offers on error (graceful degradation)
    return Response.json(
      { offers: [] },
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
