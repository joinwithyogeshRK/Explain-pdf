import { Router, type Request, type Response } from "express"
import { createClient } from "@supabase/supabase-js"
import { requireClerkSession } from "../middleware/requireClerk.js"
import { getPineconeIndex, RAG_INDEX_NAME } from "../rag/pinecone.js"

const router = Router()
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

router.use(requireClerkSession)

router.get("/list", async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("repo_trees")
      .select("repo_name, indexed_at")
      .eq("user_id", req.supabaseUserId!)
      .order("indexed_at", { ascending: false })

    if (error) throw error

    res.json({
      documents: (data ?? []).map((row: any) => ({
        source: `github:${row.repo_name}`,
        uploadedAt: row.indexed_at,
      })),
    })
  } catch (err) {
    console.error("GET /documents/list repo error:", err)
    res.status(500).json({ error: "Failed to fetch repositories" })
  }
})

router.delete("/delete", async (req: Request, res: Response) => {
  try {
    const userId = req.supabaseUserId!
    const { source } = req.body as { source?: string }

    if (!source?.startsWith("github:")) {
      res.status(400).json({ error: "repository source is required" })
      return
    }

    const repoName = source.replace("github:", "")
    const index = getPineconeIndex(RAG_INDEX_NAME)
    await index.deleteMany({
      filter: {
        $and: [
          { userId: { $eq: userId } },
          { source: { $eq: source } },
        ],
      },
    })

    const { error: treeError } = await supabase
      .from("repo_trees")
      .delete()
      .eq("user_id", userId)
      .eq("repo_name", repoName)
    if (treeError) throw treeError

    const { error: filesError } = await supabase
      .from("repo_files")
      .delete()
      .eq("user_id", userId)
      .eq("repo_name", repoName)
    if (filesError) throw filesError

    res.json({ success: true, source })
  } catch (err) {
    console.error("DELETE /documents/delete repo error:", err)
    res.status(500).json({ error: "Failed to delete repository" })
  }
})

export default router
