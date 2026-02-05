import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const events = await prisma.analyticsEvent.findMany({
    where: { eventType: 'CONVERSION' },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  console.log('Conversion Events:');
  events.forEach((event, i) => {
    console.log(`${i + 1}. Price: ${event.productPrice}, Created: ${event.createdAt}`);
  });

  const total = events.reduce((sum, e) => sum + (e.productPrice || 0), 0);
  console.log(`\nTotal: ${total}`);
  console.log(`Total / 100: ${total / 100}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
