import { PrismaClient } from '@prisma/client';

const p = new PrismaClient({ log: ['error'] });
console.log('PrismaClient constructed OK');
await p.$disconnect();
