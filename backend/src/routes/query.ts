import type { Request, Response } from "express"
import { createClient } from "@supabase/supabase-js"
import { hybridSearchText } from "../rag/hybridSearch.js"
import { rerankChunks } from "../rag/reranker.js"
import { generateHypotheticalDocument } from "../rag/hyde.js"
import type { BM25Chunk } from "../rag/bm25.js"
import type { MetadataFilter } from "../rag/pinecone.js"
import { askGroq, isStructuralQuery } from "../rag/groq.js"
import { evalRAG } from "../rag/evaluator.js"
import { ingestPdfToIndex, searchPdfIndex } from "../rag/pdfPipeline.js"
import { routeQueryIntent } from "../agents/intentRouterAgent.js"
import {
  createChat,
  saveMessage,
  getChatMessagesForUser,
} from "../services/historyService.js"

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const query = async (req: Request, res: Response) => {
 
  try {
     // we retrieve the information from the request
    const file   = req.file
    const query  = req.body.query
    const userId = req.supabaseUserId!
    let   chatId = req.body.chatId

    const filterSource = req.body.filterSource as string | undefined
 

    if (!query || !query.trim()) {
      return res.status(400).json({ error: "No query provided." })
    }

    const metadataFilter: MetadataFilter | undefined = (() => {
      if (!filterSource) return undefined
      const filter: MetadataFilter = {}
      if (filterSource) filter.source = filterSource
    
      return filter
    })()

    let bm25Chunks: BM25Chunk[] = []
    let pipeline: "code" | "pdf" = "code"


    if (file && file.buffer) {
      try {
        const pdfResult = await ingestPdfToIndex(file, userId)
        bm25Chunks = pdfResult.bm25Chunks
        pipeline = "pdf"

        const { error: docError } = await supabase
          .from("documents")
          .upsert(
            {
              user_id: userId,
              source: pdfResult.source,
              uploaded_at: pdfResult.uploadedAt,
            },
            { onConflict: "user_id,source" }
          )

        if (docError) {
          console.warn("⚠️  Failed to record PDF in Supabase:", docError.message)
        } else {
          console.log("✅ PDF Step 4b — PDF recorded in Supabase")
        }
      } catch (extractionError: unknown) {
        console.error("PDF extraction failed:", extractionError)
        const msg  = extractionError instanceof Error ? extractionError.message : ""
        const technical =
          !msg ||
          /body\.|field required|LlamaParse request failed|multipart/i.test(msg)
        const safe =
          !technical &&
          !/_KEY|SECRET|TOKEN|password|environment variable/i.test(msg)
        return res.status(422).json({
          error: safe
            ? msg
            : "We couldn't process this PDF. Try a different PDF file.",
        })
      }
    }

    const intentDecision = routeQueryIntent({
      hasFile: Boolean(file && file.buffer),
      filterSource,
      query,
    })
    console.log(
      `🧭 IntentRouterAgent: ${intentDecision.intent} (${intentDecision.confidence}) — ${intentDecision.reason}`,
    )

    const isRepoQuery = filterSource?.startsWith("github:") ?? false
    const isPdfQuery = intentDecision.intent === "pdf"

    pipeline = isPdfQuery ? "pdf" : "code"

    const retrievalTopK = isPdfQuery ? Number(process.env.PDF_RETRIEVAL_TOP_K ?? 30) : 5
    const rerankTopN = isPdfQuery ? Number(process.env.PDF_RERANK_TOP_N ?? 12) : 5

    // Step 5/6 — Pipeline-specific retrieval → Rerank
    const hybridChunks = isPdfQuery
      ? await searchPdfIndex(query, userId, bm25Chunks, retrievalTopK, metadataFilter)
      : await (async () => {
          const hypothetical = await generateHypotheticalDocument(query)
          console.log("✅ Code Search — HyDE generated")
          return hybridSearchText(hypothetical, query, bm25Chunks, userId, retrievalTopK, metadataFilter)
        })()

    const reranked       = await rerankChunks(query, hybridChunks.map(c => c.text), rerankTopN)
    const relevantChunks = reranked.map(c => c.text)
    console.log(`✅ Step 6 — ${relevantChunks.length} chunks reranked and ready`)

    // ── Step 6b — Repo tree injection ──────────────────────
    // If user is querying a specific repo AND query is structural
    // fetch the full tree from Supabase and pass to Groq
    let repoContext: { repoName: string; tree: any[] } | undefined

    const isStructural   = isStructuralQuery(query)

    if (isRepoQuery) {
      const repoName = filterSource!.replace("github:", "")

      if (isStructural) {
        // Structural query — fetch full tree
        console.log(`🌳 Structural query detected — fetching tree for ${repoName}`)

        const { data, error } = await supabase
          .from("repo_trees")
          .select("tree, repo_name")
          .eq("user_id", userId)
          .eq("repo_name", repoName)
          .single()

        if (!error && data) {
          repoContext = {
            repoName: data.repo_name,
            tree:     data.tree ?? [],
          }
          console.log(`✅ Tree loaded: ${repoContext.tree.length} files`)
        } else {
          console.warn("⚠️  Could not fetch repo tree:", error?.message)
        }
      } else {
        // Non-structural repo query — still inject repo name so Groq
        // knows which repo is being discussed
        repoContext = {
          repoName,
          tree: [],   // empty tree — Groq won't show file list
        }
      }
    }

    if (relevantChunks.length === 0 && !repoContext) {
      console.log("⚠️  No chunks found — falling back to Groq general knowledge")
    }

    // Step 7 — Conversation history
    let conversationHistory: { role: "user" | "assistant"; content: string }[] = []
    if (chatId) {
      const previousMessages = await getChatMessagesForUser(chatId, userId)
      if (!previousMessages) {
        return res.status(403).json({ error: "This chat does not belong to your account." })
      }
      conversationHistory = previousMessages.flatMap((m: { query: string; answer: string }) => [
        { role: "user"      as const, content: m.query  },
        { role: "assistant" as const, content: m.answer },
      ])
      console.log(`✅ Step 7 — Loaded ${previousMessages.length} previous messages`)
    }

    // Step 8 — Ask Groq (with optional repo context)
    const answer = await askGroq(query, relevantChunks, conversationHistory, repoContext, pipeline)
    console.log("✅ Step 8 — Answer generated")

    // Step 8b — Evaluate (non-blocking)
    evalRAG(query, relevantChunks, answer).catch(err =>
      console.warn("⚠️  Eval failed silently:", err)
    )

    // Step 9 — Save
    if (!chatId) {
      const newChat = await createChat(userId, query)
      chatId = newChat.id
      console.log("✅ Step 9 — New chat created:", chatId)
    }

    await saveMessage(chatId, userId, query, answer, pipeline === "pdf")
    console.log("✅ Step 10 — Message saved to Supabase")

    res.json({
      text:   answer,
      chatId: chatId ?? null,
      meta: {
        source:          filterSource ?? "all",
        filter:          metadataFilter ?? null,
        pipeline,
        intent:          intentDecision,
        repoTreeInjected: !!repoContext,
        structuralQuery:  isStructural ?? false,
      },
    })

  } catch (error: any) {
    console.error("Unhandled error:", error)
    res.status(500).json({ error: "Something went wrong. Please try again." })
  }
}

export default query
