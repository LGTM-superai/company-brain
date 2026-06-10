import { resetHarborBeanTickets } from "../lib/notion-runtime";

resetHarborBeanTickets()
  .then(() => {
    console.log("Reset the five Harbor Bean demo tickets in Notion.");
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
