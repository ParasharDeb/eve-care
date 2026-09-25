import { prisma } from "./src/client";

const users = await prisma.user.findMany();
console.log(users);

await prisma.$disconnect();
