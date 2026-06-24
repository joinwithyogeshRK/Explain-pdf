import { Router, type Request, type Response } from "express"
import { createClient } from "@supabase/supabase-js"
import { requireClerkSession } from "../middleware/requireClerk.js"
import {
  getPineconeIndex,
  PDF_INDEX_NAME,
  PINECONE_VECTOR_DIMENSION,
} from "../rag/pinecone.js"

const router = Router()
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

router.use(requireClerkSession)

router.get("/list", async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("documents")
      .select("source, uploaded_at")
      .eq("user_id", req.supabaseUserId!)
      .order("uploaded_at", { ascending: false })

    if (error) throw error

    const seen = new Set<string>()
    const documents = (data ?? [])
      .filter((row: any) => {
        if (seen.has(row.source)) return false
        seen.add(row.source)
        return true
      })
      .map((row: any) => ({
        source: row.source,
        uploadedAt: typeof row.uploaded_at === "number"
          ? row.uploaded_at
          : new Date(row.uploaded_at).getTime(),
      }))

    res.json({ documents })
  } catch (err) {
    console.error("GET /documents/list pdf error:", err)
    res.status(500).json({ error: "Failed to fetch documents" })
  }
})

router.delete("/delete", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId!
    const { source } = req.body as { source?: string }

    if (!source?.trim()) {
      res.status(400).json({ error: "PDF source is required" })
      return
    }

    const index = getPineconeIndex(PDF_INDEX_NAME)
    const queryRes = await index.query({
      vector: new Array(PINECONE_VECTOR_DIMENSION).fill(0),
      topK: 10000,
      includeMetadata: false,
      filter: {
        $and: [
          { userId: { $eq: userId } },
          { source: { $eq: source } },
        ],
      },
    })

    const ids = (queryRes.matches ?? []).map((match) => match.id)
    if (ids.length > 0) {
      const BATCH = 1000
      for (let i = 0; i < ids.length; i += BATCH) {
        await index.deleteMany({ ids: ids.slice(i, i + BATCH) })
      }
    }

    const { error } = await supabase
      .from("documents")
      .delete()
      .eq("user_id", userId)
      .eq("source", source)
    if (error) throw error

    res.json({ success: true, source, pineconeVectorsDeleted: ids.length })
  } catch (err) {
    console.error("DELETE /documents/delete pdf error:", err)
    res.status(500).json({ error: "Failed to delete document" })
  }
})

export default router
