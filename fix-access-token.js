import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixAccessToken() {
  try {
    // Get the shop record
    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: 'quickstart-7196cbf8.myshopify.com' },
    });

    if (!shop) {
      console.log('Shop not found');
      return;
    }

    // Get the latest session
    const session = await prisma.session.findFirst({
      where: { shop: 'quickstart-7196cbf8.myshopify.com' },
      orderBy: { expires: 'desc' },
    });

    if (!session) {
      console.log('No session found');
      return;
    }

    console.log('Current shop access token:', shop.accessToken?.substring(0, 20) + '...');
    console.log('Session access token:', session.accessToken?.substring(0, 20) + '...');

    // Update shop with session's access token
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        accessToken: session.accessToken,
      },
    });

    console.log('✅ Access token updated successfully!');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixAccessToken();
