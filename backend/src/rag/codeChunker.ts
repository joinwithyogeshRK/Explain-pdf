const MAX_CHUNK_SIZE = 1500
const MIN_CHUNK_SIZE = 50
const OVERLAP_LINES  = 3



function isCodeFile(ext: string): boolean {
  return [
    '.ts', '.tsx', '.js', '.jsx', '.py', '.go',
    '.rs', '.java', '.cpp', '.c', '.cs', '.rb',
    '.php', '.swift', '.kt', '.scala',
  ].includes(ext)
}

function isMarkdown(ext: string): boolean {
  return ['.md', '.mdx', '.txt', '.rst'].includes(ext)
}



// BOUNDARY DETECTION
// isCodeBoundary is a pure pattern match — it does NOT know about nesting.
// "Top level" is decided separately in chunkCodeFile via brace depth +
// indentation, so a `function` keyword found inside another function body
// is never mistaken for a real chunk boundary.


function isCodeBoundary(line: string): boolean {
  const trimmed = line.trim()
  return (
    /^(export\s+)?(default\s+)?(async\s+)?function\s+/.test(trimmed) ||
    /^(export\s+)?(abstract\s+)?class\s+/.test(trimmed)              ||
    /^(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(/.test(trimmed)    ||
    /^(export\s+)?const\s+\w+\s*=\s*(async\s+)?function/.test(trimmed) ||
    /^def\s+\w+/.test(trimmed)                                        ||  // Python
    /^func\s+\w+/.test(trimmed)                                       ||  // Go
    /^fn\s+\w+/.test(trimmed)                                         ||  // Rust
    /^(public|private|protected|static).*\(/.test(trimmed)               // Java/C#
  )
}

// Best-effort net brace count for a line. Doesn't understand strings or
// comments, so a `{` inside a template literal will throw the counter off
// slightly — acceptable for a heuristic chunker, not acceptable for a
// real parser. Use tree-sitter if you need exact accuracy here.
function countNetBraces(line: string): number {
  const opens  = (line.match(/{/g) || []).length
  const closes = (line.match(/}/g) || []).length
  return opens - closes
}



function chunkCodeFile(content: string, filePath: string): string[] {
  const lines      = content.split('\n')
  const rawChunks: string[] = []
  let   current:   string[] = []
  let   currentLen = 0        // running length — avoids re-joining every line (was O(n^2))
  let   braceDepth = 0        // 0 == not nested inside any unclosed { }

  const pushCurrent = () => {
    const text = current.join('\n').trim()
    if (text.length > 0) rawChunks.push(text)
  }

  const resetWithOverlap = (i: number, inclusive: boolean) => {
    const end = inclusive ? i + 1 : i
    current    = lines.slice(Math.max(0, i - OVERLAP_LINES), end)
    currentLen = current.reduce((n, l) => n + l.length + 1, 0)
  }

  for (let i = 0; i < lines.length; i++) {
    const line       = lines[i] ?? ''
    const indentation = line.length - line.trimStart().length

    // Only a real split point if we're not nested inside another
    // block (brace depth 0) AND not indented inside another function
    // (covers Python, which has no braces at all).
    const isTopLevel = braceDepth === 0 && indentation === 0

    if (isCodeBoundary(line) && isTopLevel && current.length > 0) {
      pushCurrent()
      resetWithOverlap(i, false)
    }

    current.push(line)
    currentLen += line.length + 1
    braceDepth += countNetBraces(line)

    if (currentLen > MAX_CHUNK_SIZE) {
      pushCurrent()
      resetWithOverlap(i, true)
    }
  }

  pushCurrent()

  return finalizeChunks(rawChunks, filePath)
}



function chunkMarkdownFile(content: string, filePath: string): string[] {
  const lines       = content.split('\n')
  const rawSections: string[] = []
  let   current:     string[] = []

  // Manual split that keeps the heading line attached to its section
  // (the old regex split discarded every heading).
  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line) && current.length > 0) {
      rawSections.push(current.join('\n'))
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) rawSections.push(current.join('\n'))

  const rawChunks: string[] = []

  for (const section of rawSections) {
    const text = section.trim()
    if (text.length === 0) continue

    if (text.length <= MAX_CHUNK_SIZE) {
      rawChunks.push(text)
      continue
    }

    const paras = text.split(/\n\n+/)
    let   para_acc = ''
    for (const para of paras) {
      if ((para_acc + '\n\n' + para).length <= MAX_CHUNK_SIZE) {
        para_acc = para_acc ? para_acc + '\n\n' + para : para
      } else {
        if (para_acc.length > 0) rawChunks.push(para_acc)
        para_acc = para
      }
    }
    if (para_acc.length > 0) rawChunks.push(para_acc)
  }

  return finalizeChunks(rawChunks, filePath)
}



function chunkConfigFile(content: string, filePath: string): string[] {
  if (content.length <= MAX_CHUNK_SIZE) {
    return finalizeChunks(content.trim().length > 0 ? [content] : [], filePath)
  }

  const lines     = content.split('\n')
  const rawChunks: string[] = []
  let   current   = ''

  for (const line of lines) {
    if ((current + '\n' + line).length <= MAX_CHUNK_SIZE) {
      current = current ? current + '\n' + line : line
    } else {
      if (current.length > 0) rawChunks.push(current)
      current = line
    }
  }
  if (current.length > 0) rawChunks.push(current)

  return finalizeChunks(rawChunks, filePath)
}



// SHARED FINALIZE STEP
// Merges any fragment under MIN_CHUNK_SIZE into a neighbor instead of
// dropping it, then applies the `// File: ...` header once, consistently,
// across all three chunkers.


function finalizeChunks(rawChunks: string[], filePath: string): string[] {
  const cleaned = rawChunks.map(c => c.trim()).filter(c => c.length > 0)
  if (cleaned.length === 0) return []

  const merged: string[] = []
  for (const chunk of cleaned) {
    const prev = merged[merged.length - 1]
    if (
      prev !== undefined &&
      prev.length < MIN_CHUNK_SIZE &&
      prev.length + chunk.length <= MAX_CHUNK_SIZE
    ) {
      merged[merged.length - 1] = `${prev}\n${chunk}`
    } else {
      merged.push(chunk)
    }
  }

  // fold a too-small trailing fragment backward into its neighbor
  if (merged.length > 1) {
    const last = merged[merged.length - 1]!
    if (last.length < MIN_CHUNK_SIZE) {
      merged[merged.length - 2] += '\n' + last
      merged.pop()
    }
  }

  return merged.map(c => `// File: ${filePath}\n${c}`)
}



// PUBLIC API — signatures unchanged so existing callers keep working


export function extractExt(filePath: string): { ext: string; compoundExt: string } {
  const fileName = filePath.split('/').pop() ?? ''
  const dotIdx   = fileName.lastIndexOf('.')
  const ext      = dotIdx > 0 ? fileName.slice(dotIdx).toLowerCase() : ''

  const parts       = fileName.split('.')
  const compoundExt = parts.length > 2
    ? ('.' + parts.slice(1).join('.')).toLowerCase()
    : ''

  return { ext, compoundExt }
}


export function chunkCodeContent(
  content:  string,
  filePath: string,
  ext:      string
): string[] {
  if (isCodeFile(ext))     return chunkCodeFile(content, filePath)
  if (isMarkdown(ext))     return chunkMarkdownFile(content, filePath)
  return                          chunkConfigFile(content, filePath)
}