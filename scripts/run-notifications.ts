/** Ruční spuštění upozornění: npm run notify */
import { runNotifications } from "../src/lib/services/notifications";
import { prisma } from "../src/lib/db";

runNotifications()
  .then((s) => console.log("Upozornění odeslána:", s))
  .finally(() => prisma.$disconnect());
