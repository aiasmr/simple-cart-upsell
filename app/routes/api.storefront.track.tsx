import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { prisma } from "../db.server";

/**
 * Storefront API: Track Analytics Events
 *
 * Public endpoint - no authentication required
 * Called from theme extension to track impressions and conversions
 *
 * Body (JSON):
 * - eventType: "IMPRESSION" | "CONVERSION"
 * - ruleId: Rule ID
 * - shopDomain: Shop domain
 * - cartToken: Shopify cart token (optional)
 * - sessionId: Browser session ID
 * - productPrice: Product price (for conversions)
 */

// Handle CORS preflight (OPTIONS) requests via loader
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // If not OPTIONS, return method not allowed
  return Response.json(
    { error: "Method not allowed" },
    {
      status: 405,
      headers: { "Access-Control-Allow-Origin": "*" }
    }
  );
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { 
        status: 405,
        headers: { "Access-Control-Allow-Origin": "*" }
      }
    );
  }

  try {
    const body = await request.json();
    const { eventType, ruleId, shopDomain, cartToken, sessionId, productPrice } = body;

    // Validation
    if (!eventType || !ruleId || !shopDomain) {
      return Response.json(
        { error: "Missing required fields" },
        { 
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" }
        }
      );
    }

    if (!["IMPRESSION", "CONVERSION"].includes(eventType)) {
      return Response.json(
        { error: "Invalid event type" },
        { 
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" }
        }
      );
    }

    // Get shop record
    const shopRecord = await prisma.shop.findUnique({
      where: { shopifyDomain: shopDomain },
    });

    if (!shopRecord) {
      return Response.json(
        { error: "Shop not found" },
        { 
          status: 404,
          headers: { "Access-Control-Allow-Origin": "*" }
        }
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
        { 
          status: 404,
          headers: { "Access-Control-Allow-Origin": "*" }
        }
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
        // Already tracked this impression
        return Response.json(
          { success: true, tracked: false, reason: "duplicate" },
          { headers: { "Access-Control-Allow-Origin": "*" } }
        );
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

    return Response.json(
      { success: true, tracked: true },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (error) {
    console.error("Error tracking analytics event:", error);
    
    return Response.json(
      { error: "Internal server error" },
      {
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
      }
    );
  }
}

