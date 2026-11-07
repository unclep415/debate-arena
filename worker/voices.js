// Curated ElevenLabs premade voices (ids from docs/research/elevenlabs-voices.md). Ids stay server-side.
// These premade voices retire 2026-12-31; the page falls back to browser speech when TTS fails.
export const JUDGE_KEY = "bill";

export const VOICES = [
  { key: "callum", id: "N2lVS1w4EtoT3dr4eOWO", label: "Callum", description: "husky, sly trickster (middle-aged American man)" },
  { key: "harry", id: "SOYHLrjzK2X1ezoPC6cr", label: "Harry", description: "fierce warrior, loud and intense (young American man)" },
  { key: "charlie", id: "IKne3meq5aSn9XLyUdCD", label: "Charlie", description: "deep, confident, energetic Australian (young man)" },
  { key: "laura", id: "FGY2WhTYpPnrIDTdsKH5", label: "Laura", description: "quirky enthusiast with attitude (young American woman)" },
  { key: "george", id: "JBFqnCBsd6RMkjVDRZzb", label: "George", description: "warm, captivating British storyteller (middle-aged man)" },
  { key: "lily", id: "pFZP5JQG7iQjIQuC4Bku", label: "Lily", description: "velvety British actress (middle-aged woman)" },
  { key: "liam", id: "TX3LPaxmHKxFdv7VOQHJ", label: "Liam", description: "hyper social-media creator (young American man)" },
  { key: "jessica", id: "cgSgspJ2msm6clMCkdW9", label: "Jessica", description: "playful, bright and warm (young American woman)" },
  { key: "adam", id: "pNInz6obpgDQGcFmaJgB", label: "Adam", description: "dominant, firm, commanding (middle-aged American man)" },
  { key: "alice", id: "Xb7hH8MSUJpSbSDYk0k2", label: "Alice", description: "clear, engaging British educator (middle-aged woman)" },
  { key: "roger", id: "CwhRBWXzGAHq8TQ4Fs17", label: "Roger", description: "laid-back, casual and resonant (middle-aged American man)" },
  { key: "bill", id: "pqHfZKP75CvOlQylNhV4", label: "Bill", description: "wise, mature, balanced old man (the judge's voice)" },
];

// Voice id for a client key; "judge" is an alias for the judge's voice. Unknown keys -> null.
export function resolveVoice(key) {
  const k = key === "judge" ? JUDGE_KEY : key;
  const v = typeof k === "string" ? VOICES.find((x) => x.key === k) : undefined;
  return v ? v.id : null;
}

// Public list: no ids. The judge voice is flagged so the page never casts it for a debater.
export function publicVoices() {
  return VOICES.map((v) => ({ key: v.key, label: v.label, description: v.description, judge: v.key === JUDGE_KEY }));
}
