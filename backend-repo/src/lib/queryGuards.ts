export const REPO_NOT_SELECTED_MESSAGE =
  "Please select a specific repository from the filter bar above before asking a question. I can only answer questions about indexed GitHub repos.";

export function getSelectedRepoName(filterSource?: string): string | null {
  if (!filterSource || filterSource === "all") return null;
  if (!filterSource.startsWith("github:")) return null;
  const repoName = filterSource.replace("github:", "").trim();
  return repoName || null;
}

export function casualReply(repoName: string): string {
  return (
    `I'm doing well, thanks for asking! I'm here to help you explore **${repoName}**. ` +
    "Ask me about the project structure, how a feature works, specific files, dependencies, or any other technical questions about this repository."
  );
}

const CASUAL_PHRASES = [
  "hi",
  "hello",
  "hey",
  "hola",
  "yo",
  "sup",
  "how are you",
  "how r u",
  "how are u",
  "what's up",
  "whats up",
  "good morning",
  "good afternoon",
  "good evening",
  "how do you do",
  "howdy",
];

export function isCasualMessage(question: string): boolean {
  const normalized = question
    .trim()
    .toLowerCase()
    .replace(/[!?.,"']+$/g, "")
    .replace(/\s+/g, " ");

  if (!normalized || normalized.length > 80) return false;

  return CASUAL_PHRASES.some(
    (phrase) =>
      normalized === phrase ||
      normalized.startsWith(`${phrase} `) ||
      normalized.endsWith(` ${phrase}`) ||
      normalized.includes(` ${phrase} `),
  );
}
