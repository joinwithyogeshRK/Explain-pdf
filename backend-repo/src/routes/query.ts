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
import { casualReply, isCasualMessage } from "../lib/queryGuards.js"

const getStringField = (value: unknown): string | undefined => {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return getStringField(value[0])
  return undefined
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const query = async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const question = getStringField(body.query)?.trim()
    const userId = req.supabaseUserId!
    let chatId = getStringField(body.chatId)
    const filterSource = getStringField(body.filterSource)

    if (!question) {
      return res.status(400).json({ error: "No query provided." })
    }

    const metadataFilter: MetadataFilter | undefined = (() => {
      if (!filterSource) return undefined
      return { source: filterSource }
    })()

    const isRepoQuery = filterSource?.startsWith("github:") ?? false
    const repoName = isRepoQuery ? filterSource!.replace("github:", "") : undefined
    const isStructural = isStructuralQuery(question)

    if (repoName && isCasualMessage(question)) {
      const answer = casualReply(repoName)

      const savedChatId = chatId ?? (await createChat(userId, question)).id
      chatId = savedChatId

      await saveMessage(savedChatId, userId, question, answer, false)

      return res.json({
        text: answer,
        chatId: chatId ?? null,
        meta: {
          source: filterSource,
          filter: metadataFilter ?? null,
          pipeline: "guard",
          repoTreeInjected: false,
          structuralQuery: false,
        },
      })
    }

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

    if (repoName) {
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

    const answer = await askGroq(question, relevantChunks, conversationHistory, repoContext)

    evalRAG(question, relevantChunks, answer).catch((err) =>
      console.warn("⚠️  Eval failed silently:", err),
    )

    const savedChatId = chatId ?? (await createChat(userId, question)).id
    chatId = savedChatId

    await saveMessage(savedChatId, userId, question, answer, false)

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
