import { queryNotion } from "./notion/query-notion";
import { updateNotion } from "./notion/update-notion";
import { querySlack } from "./slack/query-slack";
import { updateSlack } from "./slack/update-slack";
import { queryGithub } from "./github/query-github";
import { updateGithub } from "./github/update-github";
import { queryExa } from "./exa/query-exa";
import { makePayment } from "./payments/make-payment";
import { buySomething } from "./payments/buy-something";

export const toolRegistry = {
  queryNotion,
  updateNotion,
  querySlack,
  updateSlack,
  queryGithub,
  updateGithub,
  queryExa,
  makePayment,
  buySomething,
} as const;
