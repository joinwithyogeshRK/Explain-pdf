import type { Request, Response } from "express"
import { createClient } from "@supabase/supabase-js"
import { hybridSearchText } from "../rag/hybridSearch.js"
import { rerankChunks } from "../rag/reranker.js"
import { generateHypotheticalDocument } from "../rag/hyde.js"
import type { MetadataFilter } from "../rag/pinecone.js"
import { askGroq, isStructuralQuery } from "../rag/groq.js"
import { evalRAG } from "../rag/evaluator.js"
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
    const question = req.body.query
    const userId = req.supabaseUserId!
    let chatId = req.body.chatId
    const filterSource = req.body.filterSource as string | undefined

    if (!question || !question.trim()) {
      return res.status(400).json({ error: "No query provided." })
    }

    const metadataFilter: MetadataFilter | undefined = (() => {
      if (!filterSource) return undefined
      return { source: filterSource }
    })()

    const retrievalTopK = Number(process.env.CODE_RETRIEVAL_TOP_K ?? 8)
    const rerankTopN = Number(process.env.CODE_RERANK_TOP_N ?? 5)

    const hypothetical = await generateHypotheticalDocument(question)
    console.log("✅ Repo Search — HyDE generated")

    const hybridChunks = await hybridSearchText(
      hypothetical,
      question,
      [],
      userId,
      retrievalTopK,
      metadataFilter,
    )
    const reranked = await rerankChunks(question, hybridChunks.map((c) => c.text), rerankTopN)
    const relevantChunks = reranked.map((c) => c.text)

    let repoContext: { repoName: string; tree: any[] } | undefined
    const isRepoQuery = filterSource?.startsWith("github:") ?? false
    const isStructural = isStructuralQuery(question)

    if (isRepoQuery) {
      const repoName = filterSource!.replace("github:", "")

      if (isStructural) {
        const { data, error } = await supabase
          .from("repo_trees")
          .select("tree, repo_name")
          .eq("user_id", userId)
          .eq("repo_name", repoName)
          .single()

        if (!error && data) {
          repoContext = {
            repoName: data.repo_name,
            tree: data.tree ?? [],
          }
        }
      } else {
        repoContext = { repoName, tree: [] }
      }
    }

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

    const answer = await askGroq(question, relevantChunks, conversationHistory, repoContext, "code")

    evalRAG(question, relevantChunks, answer).catch((err) =>
      console.warn("⚠️  Eval failed silently:", err),
    )

    if (!chatId) {
      const newChat = await createChat(userId, question)
      chatId = newChat.id
    }

    await saveMessage(chatId, userId, question, answer, false)

    res.json({
      text: answer,
      chatId: chatId ?? null,
      meta: {
        source: filterSource ?? "all",
        filter: metadataFilter ?? null,
        pipeline: "code",
        repoTreeInjected: !!repoContext,
        structuralQuery: isStructural,
      },
    })
  } catch (error) {
    console.error("Repo query error:", error)
    res.status(500).json({ error: "Something went wrong. Please try again." })
  }
}

export default query
