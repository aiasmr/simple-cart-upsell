import type { ActionFunctionArgs } from "react-router";
import { prisma } from "../db.server";

/**
 * App Proxy: Track Analytics Events
 *
 * Accessed via: https://store.myshopify.com/apps/simple-cart-upsell/track
 * No CORS needed - requests come through Shopify's domain
 *
 * Body (JSON):
 * - eventType: "IMPRESSION" | "CONVERSION"
 * - ruleId: Rule ID
 * - shopDomain: Shop domain
 * - cartToken: Shopify cart token (optional)
 * - sessionId: Browser session ID
 * - productPrice: Product price (for conversions)
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405 }
    );
  }

  try {
    const body = await request.json();
    const { eventType, ruleId, shopDomain, cartToken, sessionId, productPrice } = body;

    // Validation
    if (!eventType || !ruleId || !shopDomain) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!["IMPRESSION", "CONVERSION"].includes(eventType)) {
      return Response.json(
        { error: "Invalid event type" },
        { status: 400 }
      );
    }

    // Get shop record
    const shopRecord = await prisma.shop.findUnique({
      where: { shopifyDomain: shopDomain },
    });

    if (!shopRecord) {
      return Response.json(
        { error: "Shop not found" },
        { status: 404 }
      );
    }

    // Verify rule belongs to shop
    const rule = await prisma.rule.findUnique({
      where: {
        id: ruleId,
        shopId: shopRecord.id,
      },
    });

    if (!rule) {
      return Response.json(
        { error: "Rule not found" },
        { status: 404 }
      );
    }

    // De-duplicate impressions (max 1 per session per rule)
    if (eventType === "IMPRESSION" && sessionId) {
      const existingImpression = await prisma.analyticsEvent.findFirst({
        where: {
          ruleId,
          eventType: "IMPRESSION",
          sessionId,
        },
      });

      if (existingImpression) {
        return Response.json({
          success: true,
          tracked: false,
          reason: "duplicate"
        });
      }
    }

    // Create analytics event
    await prisma.analyticsEvent.create({
      data: {
        shopId: shopRecord.id,
        ruleId,
        eventType,
        cartToken: cartToken || null,
        sessionId: sessionId || null,
        productPrice: eventType === "CONVERSION" && productPrice
          ? parseFloat(productPrice)
          : null,
      },
    });

    return Response.json({ success: true, tracked: true });
  } catch (error) {
    console.error("Error tracking analytics event:", error);

    return Response.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
