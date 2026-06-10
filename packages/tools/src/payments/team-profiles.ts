export type TeamMember = {
  name: string;
  team: string;
  dietary: string[];
  allergens: string[];
  cuisinePreferences: string[];
  dislikes: string[];
};

export type TeamProfile = {
  teamName: string;
  members: TeamMember[];
  combinedDietary: string[];
  combinedAllergens: string[];
  preferredCuisines: string[];
  headcount: number;
};

const TEAM_DATA: Record<string, TeamMember[]> = {
  tech: [
    {
      name: "Maya Krishnan",
      team: "tech",
      dietary: ["vegan", "gluten_free"],
      allergens: ["peanuts", "tree_nuts"],
      cuisinePreferences: ["Healthy", "South Indian"],
      dislikes: ["red meat", "heavy fried food"],
    },
    {
      name: "Omar Hassan",
      team: "tech",
      dietary: ["halal"],
      allergens: [],
      cuisinePreferences: ["Middle Eastern", "Japanese"],
      dislikes: ["very spicy food"],
    },
    {
      name: "Wei Zhang",
      team: "tech",
      dietary: [],
      allergens: ["shellfish"],
      cuisinePreferences: ["Chinese", "Japanese", "Korean"],
      dislikes: [],
    },
    {
      name: "Priya Nair",
      team: "tech",
      dietary: ["vegetarian"],
      allergens: ["dairy"],
      cuisinePreferences: ["Indian", "Thai"],
      dislikes: ["raw fish"],
    },
    {
      name: "Daniel O'Connor",
      team: "tech",
      dietary: [],
      allergens: [],
      cuisinePreferences: ["Italian", "Burgers", "Hawker"],
      dislikes: [],
    },
  ],
  product: [
    {
      name: "Aisha Rahman",
      team: "product",
      dietary: ["halal"],
      allergens: ["sesame"],
      cuisinePreferences: ["Malay", "Korean"],
      dislikes: ["extremely oily food"],
    },
    {
      name: "Marcus Johnson",
      team: "product",
      dietary: [],
      allergens: ["gluten"],
      cuisinePreferences: ["Mexican", "Healthy"],
      dislikes: [],
    },
    {
      name: "Elena Petrova",
      team: "product",
      dietary: ["pescatarian"],
      allergens: [],
      cuisinePreferences: ["Japanese", "Mediterranean"],
      dislikes: ["red meat"],
    },
  ],
  design: [
    {
      name: "Yuki Tanaka",
      team: "design",
      dietary: ["pescatarian"],
      allergens: ["tree_nuts"],
      cuisinePreferences: ["Japanese", "Korean"],
      dislikes: ["heavy cream sauces"],
    },
    {
      name: "Sofia Almeida",
      team: "design",
      dietary: ["vegetarian"],
      allergens: [],
      cuisinePreferences: ["Mediterranean", "Brazilian"],
      dislikes: [],
    },
  ],
};

export function getTeamProfile(teamName: string): TeamProfile | null {
  const members = TEAM_DATA[teamName.toLowerCase()];
  if (!members) return null;

  const allDietary = new Set<string>();
  const allAllergens = new Set<string>();
  const cuisineCounts = new Map<string, number>();

  for (const m of members) {
    m.dietary.forEach((d) => allDietary.add(d));
    m.allergens.forEach((a) => allAllergens.add(a));
    m.cuisinePreferences.forEach((c) => {
      cuisineCounts.set(c, (cuisineCounts.get(c) ?? 0) + 1);
    });
  }

  const preferredCuisines = [...cuisineCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cuisine]) => cuisine);

  return {
    teamName,
    members,
    combinedDietary: [...allDietary],
    combinedAllergens: [...allAllergens],
    preferredCuisines,
    headcount: members.length,
  };
}

export function getAllTeams(): string[] {
  return Object.keys(TEAM_DATA);
}

export function buildSearchQuery(profile: TeamProfile, budgetPerHead?: number, excludeRestaurants?: string[]): string {
  const dietaryStr = profile.combinedDietary.length
    ? `accommodates ${profile.combinedDietary.join(", ")} diets`
    : "";
  const allergenStr = profile.combinedAllergens.length
    ? `avoids ${profile.combinedAllergens.join(", ")}`
    : "";
  const cuisineStr = profile.preferredCuisines.slice(0, 3).join(", ");
  const budgetStr = budgetPerHead ? `under $${(budgetPerHead / 100).toFixed(0)} per person` : "";
  const excludeStr = excludeRestaurants?.length
    ? `NOT ${excludeRestaurants.join(", ")}`
    : "";

  return [
    `restaurant recommendations for team lunch ${profile.headcount} people Singapore`,
    dietaryStr,
    allergenStr,
    cuisineStr ? `cuisine preferences: ${cuisineStr}` : "",
    budgetStr,
    excludeStr,
  ]
    .filter(Boolean)
    .join(", ");
}
