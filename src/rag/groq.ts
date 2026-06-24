import "dotenv/config"
import Groq from "groq-sdk"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export const askGroq = async (
  question: string,
  relevantChunks: string[],
  conversationHistory: { role: "user" | "assistant"; content: string }[] = [],
): Promise<string> => {
  const hasChunks = relevantChunks.length > 0
  const referenceBlock = hasChunks ? relevantChunks.join("\n\n---\n\n") : null

  console.log(`📦 PDF chunks received: ${relevantChunks.length}`)
  console.log(`💬 History messages: ${conversationHistory.length}`)
  if (referenceBlock) {
    console.log(`📄 PDF reference preview: ${referenceBlock.slice(0, 200)}...`)
  }

  const baseVoice =
    "You are Oracle, a warm, knowledgeable assistant. Be concise, clear, and friendly."

  const groundedRules = `You have access to extracted PDF text. Use it to explain, summarize, or answer accurately.

Strict rules:
- Do not mention chunks, passages, retrieval, RAG, embeddings, or "provided material".
- Do not say "according to the information" or "based on the information"; answer directly.
- You may say "the PDF" when the user asks about the uploaded or selected PDF.
- If the current PDF text conflicts with earlier conversation history, trust the current PDF text.
- For list questions such as projects, skills, experience, education, or certifications, list every distinct item present in the PDF text you received.
- Do not say an item is missing unless you have checked all received PDF text for that answer.
- If something is not in the received PDF text, say so clearly rather than guessing.
- Explain in plain language and preserve important numbers, names, dates, obligations, and caveats.`

  const systemPrompt = referenceBlock
    ? `${baseVoice}

${groundedRules}

=== RELEVANT PDF TEXT ===
${referenceBlock}`
    : `${baseVoice}
Answer using conversation history and your general knowledge when needed.`

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: question },
  ]

  console.log(`📨 Sending ${messages.length} PDF messages to Groq`)

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 1024,
    temperature: 0.35,
    messages,
  })

  const answer =
    response.choices[0]?.message.content?.trim() ??
    "I could not generate an answer. Please try again."

  console.log("✅ Groq answered:", answer.slice(0, 100))

  return answer
}
