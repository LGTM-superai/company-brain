import { queryNotionKB } from "./notion/query-notion-kb";
import { updateNotionKB } from "./notion/update-notion-kb";
import { queryNotionSprintBoard } from "./notion/query-notion-sprint-board";
import { updateNotionSprintBoard } from "./notion/update-notion-sprint-board";
import { querySlack } from "./slack/query-slack";
import { updateSlack } from "./slack/update-slack";
import { queryGithub } from "./github/query-github";
import { updateGithub } from "./github/update-github";
import { queryExa } from "./exa/query-exa";
import { makePayment } from "./payments/make-payment";
import { buySomething } from "./payments/buy-something";

export const toolRegistry = {
  queryNotionKB,
  updateNotionKB,
  queryNotionSprintBoard,
  updateNotionSprintBoard,
  querySlack,
  updateSlack,
  queryGithub,
  updateGithub,
  queryExa,
  makePayment,
  buySomething,
} as const;
