"""Generate the Obsidian vault: 10 people, each with a Resume + a Personal note.

This stands in for the "file arrives -> AI converts to Markdown -> save into the
vault" pipeline. Run once to materialise `vault/People/*.md`; the agents then
search and read those notes via the ObsidianVault (see brain_agents/vault.py).

    python seed_vault.py
"""

from __future__ import annotations

from pathlib import Path

import yaml

VAULT_DIR = Path(__file__).parent / "vault"
PEOPLE_DIR = VAULT_DIR / "People"


# --------------------------------------------------------------------------- #
# People data. `dietary`, `allergens`, `cuisine_preferences` use the same
# vocabulary as merchant.models so the purchasing flow can consume them directly.
# --------------------------------------------------------------------------- #
PEOPLE: list[dict] = [
    # ---- Tech team (4) — deliberately varied so each gets a different meal ----
    {
        "name": "Maya Krishnan", "email": "maya@company.com", "team": "tech",
        "role": "Senior Backend Engineer", "location": "Singapore",
        "hometown": "Bangalore, India",
        "dietary": ["vegan", "gluten_free"], "allergens": ["peanuts", "tree_nuts"],
        "cuisine_preferences": ["Healthy", "South Indian"], "dislikes": ["red meat", "heavy fried food"],
        "personality": ["introverted", "detail-oriented", "calm", "methodical"],
        "summary": "Backend engineer focused on distributed systems and data pipelines. "
                   "Quietly reliable; prefers writing design docs over meetings.",
        "experience": [
            ("Senior Backend Engineer", "Company Brain", "2023–present",
             ["Owns the ingestion + indexing pipeline.",
              "Cut p99 query latency 40% via caching redesign."]),
            ("Backend Engineer", "Flipkart", "2019–2023",
             ["Built order-service APIs handling 50k rps.",
              "Led migration from monolith to gRPC services."]),
        ],
        "skills": ["Python", "Go", "PostgreSQL", "Kafka", "Kubernetes"],
        "education": [("B.Tech, Computer Science", "IIT Madras", "2019")],
        "upbringing": "Grew up in a vegetarian Tamil household in Bangalore, surrounded by "
                      "Carnatic music and competitive maths olympiads. Became vegan in "
                      "university. A serious nut allergy means she reads every label.",
    },
    {
        "name": "Omar Hassan", "email": "omar@company.com", "team": "tech",
        "role": "Platform / DevOps Engineer", "location": "Singapore",
        "hometown": "Cairo, Egypt",
        "dietary": ["halal"], "allergens": [],
        "cuisine_preferences": ["Indian", "Middle Eastern"], "dislikes": ["bland food"],
        "personality": ["outgoing", "energetic", "argumentative-in-a-good-way", "generous"],
        "summary": "Platform engineer who loves infra, incident response, and a good debate. "
                   "The team's unofficial morale officer.",
        "experience": [
            ("Platform Engineer", "Company Brain", "2022–present",
             ["Runs the Terraform + CI/CD platform.",
              "On-call lead; halved MTTR with better runbooks."]),
            ("SRE", "Vodafone", "2018–2022",
             ["Managed multi-region Kubernetes clusters."]),
        ],
        "skills": ["Terraform", "AWS", "Kubernetes", "Bash", "Prometheus"],
        "education": [("B.Sc, Computer Engineering", "Cairo University", "2018")],
        "upbringing": "Raised in a big, loud family in Cairo where dinner was the main event "
                      "of the day and everything was negotiable. Keeps halal and loves rich, "
                      "spiced food — the spicier the better.",
    },
    {
        "name": "Sofia Almeida", "email": "sofia@company.com", "team": "tech",
        "role": "Frontend Engineer", "location": "Singapore",
        "hometown": "Lisbon, Portugal",
        "dietary": ["pescatarian"], "allergens": [],
        "cuisine_preferences": ["Japanese", "Mediterranean"], "dislikes": ["very spicy food"],
        "personality": ["creative", "easygoing", "aesthetic", "collaborative"],
        "summary": "Frontend engineer with a designer's eye; obsessed with typography, motion, "
                   "and accessible UI.",
        "experience": [
            ("Frontend Engineer", "Company Brain", "2023–present",
             ["Built the design system and the search UI.",
              "Drove the WCAG AA accessibility pass."]),
            ("UI Engineer", "Farfetch", "2020–2023",
             ["Shipped the product-detail redesign."]),
        ],
        "skills": ["TypeScript", "React", "CSS", "Figma", "Accessibility"],
        "education": [("B.A, Design + Computation", "Universidade de Lisboa", "2020")],
        "upbringing": "Grew up by the sea in Lisbon on a diet of grilled fish and pastéis de "
                      "nata. Pescatarian by habit more than rule. Calm, sun-and-coffee energy.",
    },
    {
        "name": "Wei Zhang", "email": "wei@company.com", "team": "tech",
        "role": "ML Engineer & Tech Lead", "location": "Singapore",
        "hometown": "Singapore",
        "dietary": [], "allergens": [],
        "cuisine_preferences": ["Hawker", "Chinese"], "dislikes": ["very spicy food", "cheese-heavy dishes"],
        "personality": ["pragmatic", "reserved", "decisive", "comfort-food-lover"],
        "summary": "ML engineer and tech lead. Pragmatic to a fault; ships, measures, iterates. "
                   "Mentors the juniors patiently.",
        "experience": [
            ("ML Engineer & Tech Lead", "Company Brain", "2021–present",
             ["Leads the retrieval + ranking stack.",
              "Set the team's eval-driven dev culture."]),
            ("Data Scientist", "Grab", "2017–2021",
             ["Built ETA and demand-forecasting models."]),
        ],
        "skills": ["Python", "PyTorch", "SQL", "Ranking", "Evals"],
        "education": [("M.Sc, Statistics", "NUS", "2017")],
        "upbringing": "Born and raised in Singapore, a true hawker-centre kid — chicken rice is "
                      "his comfort food and benchmark for everything. No dietary restrictions, "
                      "but quietly avoids anything too spicy or too cheesy.",
    },

    # ---- Non-tech (6) ----
    {
        "name": "Aisha Rahman", "email": "aisha@company.com", "team": "design",
        "role": "Head of Design", "location": "Singapore",
        "hometown": "Kuala Lumpur, Malaysia",
        "dietary": ["vegetarian", "dairy_free"], "allergens": [],
        "cuisine_preferences": ["Malay", "Healthy"], "dislikes": [],
        "personality": ["visionary", "warm", "persuasive"],
        "summary": "Design leader building a calm, opinionated product aesthetic.",
        "experience": [
            ("Head of Design", "Company Brain", "2022–present",
             ["Built the design org from 1 to 6.",
              "Owns brand + product design."]),
            ("Design Lead", "Grab", "2016–2022", ["Led the consumer app redesign."]),
        ],
        "skills": ["Product Design", "Design Systems", "Research", "Figma"],
        "education": [("B.A, Visual Communication", "LASALLE", "2015")],
        "upbringing": "Raised in KL between two grandmothers' kitchens; vegetarian and "
                      "dairy-free by choice. Brings a host's warmth to every review.",
    },
    {
        "name": "Daniel O'Connor", "email": "daniel@company.com", "team": "sales",
        "role": "Head of Sales", "location": "Singapore",
        "hometown": "Dublin, Ireland",
        "dietary": [], "allergens": ["shellfish"],
        "cuisine_preferences": ["Western", "BBQ"], "dislikes": ["overly fussy plating"],
        "personality": ["extroverted", "persuasive", "competitive", "charming"],
        "summary": "Enterprise sales leader who closes by listening first.",
        "experience": [
            ("Head of Sales", "Company Brain", "2023–present",
             ["Built the APAC enterprise pipeline from zero."]),
            ("Enterprise AE", "Salesforce", "2017–2023", ["President's Club x3."]),
        ],
        "skills": ["Enterprise Sales", "Negotiation", "Forecasting"],
        "education": [("B.Comm", "University College Dublin", "2016")],
        "upbringing": "Grew up in Dublin in a family of storytellers and publicans. Eats "
                      "anything except shellfish (a childhood allergy). Loves a steak.",
    },
    {
        "name": "Priya Nair", "email": "priya@company.com", "team": "product",
        "role": "Senior Product Manager", "location": "Singapore",
        "hometown": "Kochi, India",
        "dietary": ["vegetarian"], "allergens": ["tree_nuts"],
        "cuisine_preferences": ["South Indian", "Healthy"], "dislikes": ["red meat"],
        "personality": ["organized", "empathetic", "data-driven"],
        "summary": "PM who turns fuzzy problems into crisp, shippable roadmaps.",
        "experience": [
            ("Senior PM", "Company Brain", "2022–present",
             ["Owns the knowledge-base and search roadmap."]),
            ("PM", "Zomato", "2018–2022", ["Launched the dietary-filter feature."]),
        ],
        "skills": ["Product Strategy", "Roadmapping", "SQL", "User Research"],
        "education": [("MBA", "ISB Hyderabad", "2018"), ("B.E", "NIT Calicut", "2014")],
        "upbringing": "From a coastal Kerala family; vegetarian with a tree-nut allergy. "
                      "Keeps a spreadsheet for everything, including lunch orders.",
    },
    {
        "name": "Marcus Johnson", "email": "marcus@company.com", "team": "leadership",
        "role": "Chief Financial Officer", "location": "Singapore",
        "hometown": "Atlanta, USA",
        "dietary": ["pescatarian"], "allergens": [],
        "cuisine_preferences": ["Japanese", "Mediterranean"], "dislikes": ["sugary food"],
        "personality": ["analytical", "measured", "dry-humoured"],
        "summary": "CFO keeping an ambitious company financially honest.",
        "experience": [
            ("CFO", "Company Brain", "2023–present", ["Built finance + the agent-spend controls."]),
            ("VP Finance", "Stripe", "2016–2023", ["Scaled finance ops across APAC."]),
        ],
        "skills": ["Financial Planning", "Controls", "Fundraising"],
        "education": [("MBA", "Wharton", "2012"), ("B.S, Economics", "Emory", "2008")],
        "upbringing": "Atlanta-raised, turned pescatarian in his 30s for health. Cuts sugar, "
                      "counts everything, trusts the spreadsheet over the vibe.",
    },
    {
        "name": "Yuki Tanaka", "email": "yuki@company.com", "team": "operations",
        "role": "Customer Success Manager", "location": "Singapore",
        "hometown": "Osaka, Japan",
        "dietary": [], "allergens": [],
        "cuisine_preferences": ["Japanese", "Hawker"], "dislikes": ["very cheesy food"],
        "personality": ["meticulous", "polite", "service-minded"],
        "summary": "CSM who makes customers feel personally looked after.",
        "experience": [
            ("Customer Success Manager", "Company Brain", "2023–present",
             ["Owns the top-20 accounts; 98% retention."]),
            ("Support Lead", "Rakuten", "2019–2023", ["Built the APAC support playbook."]),
        ],
        "skills": ["Customer Success", "Onboarding", "Bilingual JP/EN"],
        "education": [("B.A, Business", "Osaka University", "2019")],
        "upbringing": "Osaka native who grew up in the family takoyaki stall — hospitality is "
                      "in the bones. Eats everything, just not too much cheese.",
    },
    {
        "name": "Elena Petrova", "email": "ceo@company.com", "team": "leadership",
        "role": "Chief Executive Officer", "location": "Singapore",
        "hometown": "Sofia, Bulgaria",
        "dietary": ["gluten_free"], "allergens": [],
        "cuisine_preferences": ["Mediterranean", "Healthy"], "dislikes": [],
        "personality": ["decisive", "big-picture", "high-energy", "direct"],
        "summary": "Founder/CEO. Sets a fast pace and an even higher bar.",
        "experience": [
            ("CEO & Co-founder", "Company Brain", "2021–present",
             ["Founded the company; raised Series A.",
              "Sets product vision and culture."]),
            ("Director of Product", "Palantir", "2014–2021", ["Led forward-deployed product teams."]),
        ],
        "skills": ["Leadership", "Product Vision", "Fundraising"],
        "education": [("M.S, Computer Science", "ETH Zurich", "2014")],
        "upbringing": "Grew up in Sofia, the first in her family to leave for tech abroad. "
                      "Gluten-free since a diagnosis in her 20s. Decides fast, moves faster.",
    },
]


# --------------------------------------------------------------------------- #
# Rendering
# --------------------------------------------------------------------------- #
def _frontmatter(d: dict) -> str:
    return "---\n" + yaml.safe_dump(d, sort_keys=False, allow_unicode=True).strip() + "\n---\n"


def render_resume(p: dict) -> str:
    fm = _frontmatter({
        "type": "resume", "person": p["name"], "email": p["email"],
        "team": p["team"], "role": p["role"],
        "tags": ["resume", f"team/{p['team']}"],
    })
    out = [fm, f"# {p['name']} — {p['role']}", "", f"> {p['summary']}", "",
           f"*Based in {p['location']}. See [[{p['name']} - Personal]] for personal details.*",
           "", "## Experience"]
    for title, company, period, bullets in p["experience"]:
        out.append(f"\n### {title} — {company}  *({period})*")
        out += [f"- {b}" for b in bullets]
    out += ["", "## Skills", ", ".join(p["skills"]), "", "## Education"]
    out += [f"- {deg}, {school} ({year})" for deg, school, year in p["education"]]
    return "\n".join(out) + "\n"


def render_personal(p: dict) -> str:
    fm = _frontmatter({
        "type": "personal", "person": p["name"], "email": p["email"],
        "team": p["team"], "role": p["role"], "hometown": p["hometown"],
        "dietary": p["dietary"], "allergens": p["allergens"],
        "cuisine_preferences": p["cuisine_preferences"], "dislikes": p["dislikes"],
        "personality": p["personality"],
        "tags": ["personal", f"team/{p['team']}"],
    })
    diet = ", ".join(p["dietary"]) or "no restrictions"
    allerg = ", ".join(p["allergens"]) or "none"
    prefs = ", ".join(p["cuisine_preferences"]) or "open to anything"
    dislikes = ", ".join(p["dislikes"]) or "none noted"
    out = [
        fm, f"# {p['name']} — Personal", "",
        f"*See [[{p['name']} - Resume]] for professional background.*", "",
        "## Dietary restrictions & food preferences",
        f"- **Dietary:** {diet}",
        f"- **Allergens to avoid:** {allerg}",
        f"- **Cuisine preferences:** {prefs}",
        f"- **Dislikes:** {dislikes}", "",
        "## Personality",
        ", ".join(p["personality"]).capitalize() + ".", "",
        "## Upbringing & history",
        f"**Hometown:** {p['hometown']}", "",
        p["upbringing"],
    ]
    return "\n".join(out) + "\n"


def main() -> None:
    PEOPLE_DIR.mkdir(parents=True, exist_ok=True)
    for p in PEOPLE:
        (PEOPLE_DIR / f"{p['name']} - Resume.md").write_text(render_resume(p), encoding="utf-8")
        (PEOPLE_DIR / f"{p['name']} - Personal.md").write_text(render_personal(p), encoding="utf-8")
    n = len(PEOPLE)
    print(f"Wrote {n} resumes + {n} personal notes ({2 * n} files) to {PEOPLE_DIR}")
    tech = [p["name"] for p in PEOPLE if p["team"] == "tech"]
    print(f"Tech team ({len(tech)}): {', '.join(tech)}")


if __name__ == "__main__":
    main()
