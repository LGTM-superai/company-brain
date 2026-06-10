const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const conversationId = `smoke-harbor-bean-${Date.now()}`;

const prompts = [
  "What is overdue or potentially blocked for Harbor Bean?",
  "Is the map issue a real blocker or fixable based on docs?",
  "Record that HB-101 is potentially blocked and needs Carlos follow-up.",
  "Move HB-201 to In review.",
  "Yes, approve the HB-201 move.",
  "Summarize launch readiness after those updates.",
];

for (const prompt of prompts) {
  console.log(`\n> ${prompt}`);
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: conversationId,
      messages: [
        {
          id: `${conversationId}-${Date.now()}`,
          role: "user",
          parts: [{ type: "text", text: prompt }],
        },
      ],
    }),
  });

  if (!response.ok || !response.body) {
    console.log(await response.text());
    process.exitCode = 1;
    break;
  }

  const text = await response.text();
  const assistantText = [...text.matchAll(/"text":"([^"]+)"/g)]
    .map((match) => match[1])
    .join("")
    .replace(/\\n/g, "\n");

  console.log(assistantText || text.slice(-800));
}

export {};
