export type QueryIntent = "code" | "pdf" | "mixed"

export interface IntentInput {
  hasFile: boolean
  filterSource?: string | undefined
  query: string
}

export interface IntentDecision {
  intent: QueryIntent
  confidence: number
  reason: string
}

export function routeQueryIntent(input: IntentInput): IntentDecision {
  const source = input.filterSource?.trim()

  if (input.hasFile) {
    return {
      intent: "pdf",
      confidence: 0.98,
      reason: "A file upload should be handled by the PDF pipeline.",
    }
  }

  if (source?.startsWith("github:")) {
    return {
      intent: "code",
      confidence: 0.95,
      reason: "The selected source is a GitHub repository.",
    }
  }

  if (source && source !== "all") {
    return {
      intent: "pdf",
      confidence: 0.95,
      reason: "The selected source is an uploaded PDF document.",
    }
  }

  const query = input.query.toLowerCase()
  const mixedSignals = [
    "compare",
    "implementation",
    "paper",
    "pdf",
    "repo",
    "repository",
    "code",
  ].filter((word) => query.includes(word))

  if (
    mixedSignals.includes("compare") &&
    (mixedSignals.includes("paper") || mixedSignals.includes("pdf")) &&
    (mixedSignals.includes("repo") || mixedSignals.includes("repository") || mixedSignals.includes("code"))
  ) {
    return {
      intent: "mixed",
      confidence: 0.72,
      reason: "The query asks to compare PDF/paper content with code.",
    }
  }

  return {
    intent: "code",
    confidence: 0.6,
    reason: "No explicit PDF source was selected, so defaulting to code RAG.",
  }
}
