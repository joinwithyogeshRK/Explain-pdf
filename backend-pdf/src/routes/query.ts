import type { Request, Response } from "express"
import { createClient } from "@supabase/supabase-js"
import { rerankChunks } from "../rag/reranker.js"
import type { BM25Chunk } from "../rag/bm25.js"
import type { MetadataFilter } from "../rag/pinecone.js"
import { askGroq } from "../rag/groq.js"
import { evalRAG } from "../rag/evaluator.js"
import { ingestPdfToIndex, searchPdfIndex } from "../rag/pdfPipeline.js"
import {
  createChat,
  getChatMessagesForUser,
  saveMessage,
} from "../services/historyService.js"

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const query = async (req: Request, res: Response) => {
  try {
    const file = req.file
    const question = req.body.query
    const userId = req.supabaseUserId!
    let chatId = req.body.chatId
    const filterSource = req.body.filterSource as string | undefined

    if (!question || !question.trim()) {
      return res.status(400).json({ error: "No query provided." })
    }

    const metadataFilter: MetadataFilter | undefined = filterSource
      ? { source: filterSource }
      : undefined

    let bm25Chunks: BM25Chunk[] = []

    if (file && file.buffer) {
      try {
        const pdfResult = await ingestPdfToIndex(file, userId)
        bm25Chunks = pdfResult.bm25Chunks

        const { error: docError } = await supabase
          .from("documents")
          .upsert(
            {
              user_id: userId,
              source: pdfResult.source,
              uploaded_at: pdfResult.uploadedAt,
            },
            { onConflict: "user_id,source" },
          )

        if (docError) {
          console.warn("⚠️  Failed to record PDF in Supabase:", docError.message)
        }
      } catch (extractionError: unknown) {
        console.error("PDF extraction failed:", extractionError)
        const msg = extractionError instanceof Error ? extractionError.message : ""
        const technical =
          !msg ||
          /body\.|field required|LlamaParse request failed|multipart/i.test(msg)
        const safe =
          !technical &&
          !/_KEY|SECRET|TOKEN|password|environment variable/i.test(msg)
        return res.status(422).json({
          error: safe ? msg : "We couldn't process this PDF. Try a different PDF file.",
        })
      }
    }

    const retrievalTopK = Number(process.env.PDF_RETRIEVAL_TOP_K ?? 30)
    const rerankTopN = Number(process.env.PDF_RERANK_TOP_N ?? 12)

    const hybridChunks = await searchPdfIndex(
      question,
      userId,
      bm25Chunks,
      retrievalTopK,
      metadataFilter,
    )
    const reranked = await rerankChunks(question, hybridChunks.map((c) => c.text), rerankTopN)
    const relevantChunks = reranked.map((c) => c.text)

    let conversationHistory: { role: "user" | "assistant"; content: string }[] = []
    if (chatId) {
      const previousMessages = await getChatMessagesForUser(chatId, userId)
      if (!previousMessages) {
        return res.status(403).json({ error: "This chat does not belong to your account." })
      }
      conversationHistory = previousMessages.flatMap((m: { query: string; answer: string }) => [
        { role: "user" as const, content: m.query },
        { role: "assistant" as const, content: m.answer },
      ])
    }

    const answer = await askGroq(question, relevantChunks, conversationHistory, undefined, "pdf")

    evalRAG(question, relevantChunks, answer).catch((err) =>
      console.warn("⚠️  Eval failed silently:", err),
    )

    if (!chatId) {
      const newChat = await createChat(userId, question)
      chatId = newChat.id
    }

    await saveMessage(chatId, userId, question, answer, true)

    res.json({
      text: answer,
      chatId: chatId ?? null,
      meta: {
        source: filterSource ?? "all",
        filter: metadataFilter ?? null,
        pipeline: "pdf",
      },
    })
  } catch (error) {
    console.error("PDF query error:", error)
    res.status(500).json({ error: "Something went wrong. Please try again." })
  }
}

export default query
