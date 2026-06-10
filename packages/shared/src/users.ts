export type PersonId = "edrick" | "laksh" | "darren" | "carlos" | "everyone";

export type CompanyUser = {
  id: Exclude<PersonId, "everyone">;
  name: string;
  email: string;
  slackHandle: string;
  slackId: string;
  role: string;
  responsibilities: string[];
};

export const users: CompanyUser[] = [
  {
    id: "edrick",
    name: "Edrick Kesuma",
    email: "edrickkesuma21@gmail.com",
    slackHandle: "edrick",
    slackId: "U0B8Z5CNVD0",
    role: "Lead Developer",
    responsibilities: ["Sprint board operations", "Slack integration", "GitHub integration"],
  },
  {
    id: "laksh",
    name: "Lakshya Agarwal",
    email: "alakshya2648@gmail.com",
    slackHandle: "laksh",
    slackId: "U0B8ZKU6Z2N",
    role: "Design Lead / Payments Manager",
    responsibilities: ["Payments manager agent", "Exa research ownership"],
  },
  {
    id: "darren",
    name: "Darren Prasetya",
    email: "darrenprasetya41@gmail.com",
    slackHandle: "darren",
    slackId: "U0B938G6SDS",
    role: "Coder Agent Owner",
    responsibilities: ["Coder agent", "GitHub code context", "GitHub updates"],
  },
  {
    id: "carlos",
    name: "Carlos Vincent Frasenda",
    email: "c.frasenda10@gmail.com",
    slackHandle: "carlos",
    slackId: "U0B938E4KE0",
    role: "PM/Ops",
    responsibilities: ["Client/project documentation", "Launch coordination"],
  },
];
