import { supabase } from "../lib/supabase.js"
import type { RepoFetchedFile } from "../agents/repoTreeAgent.js"

const BATCH_SIZE = 100

export async function saveRepoFiles(
  userId: string,
  repoUrl: string,
  repoName: string,
  files: RepoFetchedFile[],
  indexedAt: number = Date.now(),
): Promise<number> {
  let saved = 0

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE)
    const rows = batch.map(({ file, content }) => ({
      user_id: userId,
      repo_url: repoUrl,
      repo_name: repoName,
      path: file.path,
      sha: file.sha ?? null,
      size: file.size ?? content.length,
      content,
      indexed_at: indexedAt,
    }))

    const { error } = await supabase
      .from("repo_files")
      .upsert(rows, { onConflict: "user_id,repo_name,path" })

    if (error) {
      throw new Error(`Failed to save repo files: ${error.message}`)
    }

    saved += rows.length
    console.log(`  💾 Supabase repo_files batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(files.length / BATCH_SIZE)} saved`)
  }

  return saved
}
