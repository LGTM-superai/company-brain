export type PersonId = "edrick" | "laksh" | "darren" | "carlos" | "everyone";

export type CompanyUser = {
  id: Exclude<PersonId, "everyone">;
  name: string;
  email: string;
  role: string;
  responsibilities: string[];
};

export const users: CompanyUser[] = [
  {
    id: "edrick",
    name: "Edrick Kesuma",
    email: "edrickkesuma21@gmail.com",
    role: "Lead Developer",
    responsibilities: ["Sprint board operations", "Slack integration", "GitHub integration"],
  },
  {
    id: "laksh",
    name: "Lakshya Agarwal",
    email: "alakshya2648@gmail.com",
    role: "Design Lead / Payments Manager",
    responsibilities: ["Payments manager agent", "Exa research ownership"],
  },
  {
    id: "darren",
    name: "Darren Prasetya",
    email: "darrenprasetya41@gmail.com",
    role: "Coder Agent Owner",
    responsibilities: ["Coder agent", "GitHub code context", "GitHub updates"],
  },
  {
    id: "carlos",
    name: "Carlos Vincent Frasenda",
    email: "c.frasenda10gmail.com",
    role: "PM/Ops",
    responsibilities: ["Client/project documentation", "Launch coordination"],
  },
];
