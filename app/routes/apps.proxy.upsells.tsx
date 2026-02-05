import type { LoaderFunctionArgs } from "react-router";
import { prisma } from "../db.server";

/**
 * App Proxy: Get Upsell Offers
 *
 * Accessed via: https://store.myshopify.com/apps/simple-cart-upsell/upsells
 * No CORS needed - requests come through Shopify's domain
 *
 * Query params:
 * - shop: Shop domain (automatically added by Shopify proxy)
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
      { status: 400 }
    );
  }

  if (!productsParam) {
    return Response.json({ offers: [] });
  }

  // Parse product IDs from cart
  const cartProductIds = productsParam.split(",").map(id => id.trim()).filter(Boolean);

  console.log('[PROXY API] Shop:', shop);
  console.log('[PROXY API] Cart Product IDs:', cartProductIds);

  if (cartProductIds.length === 0) {
    return Response.json({ offers: [] });
  }

  try {
    // Get shop record
    const shopRecord = await prisma.shop.findUnique({
      where: { shopifyDomain: shop },
    });

    if (!shopRecord) {
      return Response.json({ offers: [] });
    }

    // Get enabled rules for this shop
    const rules = await prisma.rule.findMany({
      where: {
        shopId: shopRecord.id,
        isEnabled: true,
      },
      orderBy: {
        priority: "asc",
      },
    });

    // Helper function to extract numeric ID from Shopify GID
    const extractProductId = (gid: string | null): string | null => {
      if (!gid) return null;
      const match = gid.match(/gid:\/\/shopify\/Product\/(\d+)/);
      return match ? match[1] : null;
    };

    // Helper to fetch product collections from Shopify
    const getProductCollections = async (productId: string): Promise<string[]> => {
      try {
        console.log('[PROXY GraphQL] Fetching collections for product:', productId);
        const response = await fetch(
          `https://${shop}/admin/api/2024-01/graphql.json`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': shopRecord.accessToken,
            },
            body: JSON.stringify({
              query: `
                query getProductCollections($id: ID!) {
                  product(id: "gid://shopify/Product/${productId}") {
                    collections(first: 250) {
                      edges {
                        node {
                          id
                        }
                      }
                    }
                  }
                }
              `,
              variables: {
                id: `gid://shopify/Product/${productId}`,
              },
            }),
          }
        );

        const data = await response.json();
        console.log('[PROXY GraphQL] Response data:', JSON.stringify(data, null, 2));

        if (data.errors) {
          console.error('[PROXY GraphQL] Errors:', data.errors);
        }

        return data?.data?.product?.collections?.edges.map((edge: any) => edge.node.id) || [];
      } catch (error) {
        console.error('Error fetching product collections:', error);
        return [];
      }
    };

    // Match rules based on cart contents
    const matchedRules = [];

    for (const rule of rules) {
      let matches = false;

      if (rule.triggerType === "PRODUCT") {
        const triggerNumericId = extractProductId(rule.triggerProductId);
        if (triggerNumericId && cartProductIds.includes(triggerNumericId)) {
          matches = true;
        }
      } else if (rule.triggerType === "COLLECTION") {
        // Check if any cart product belongs to the trigger collection
        console.log('[PROXY Collection Debug] Checking rule:', rule.name);
        console.log('[PROXY Collection Debug] Trigger collection ID:', rule.triggerCollectionId);

        for (const productId of cartProductIds) {
          console.log('[PROXY Collection Debug] Checking product:', productId);
          const productCollections = await getProductCollections(productId);
          console.log('[PROXY Collection Debug] Product collections:', productCollections);

          if (productCollections.includes(rule.triggerCollectionId || '')) {
            console.log('[PROXY Collection Debug] MATCH FOUND!');
            matches = true;
            break;
          } else {
            console.log('[PROXY Collection Debug] No match for this product');
          }
        }
      }

      if (matches) {
        // Don't show products already in cart
        const upsellNumericId = extractProductId(rule.upsellProductId);
        if (upsellNumericId && cartProductIds.includes(upsellNumericId)) {
          continue;
        }

        matchedRules.push(rule);
      }
    }

    // Limit to max 3 offers
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
          available: true,
        },
      };
    });

    return Response.json(
      { offers },
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching upsell offers:", error);

    return Response.json(
      { offers: [] },
      { status: 500 }
    );
  }
}
