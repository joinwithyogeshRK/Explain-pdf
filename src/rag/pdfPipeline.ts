import { extractTextFromFile } from "../services/documentParseService.js"
import { chunkText } from "./chunker.js"
import { hybridSearchText } from "./hybridSearch.js"
import { generateHypotheticalDocument } from "./hyde.js"
import { PDF_INDEX_NAME, storeTextInPinecone } from "./pinecone.js"
import type { BM25Chunk } from "./bm25.js"
import type { HybridChunk } from "./hybridSearch.js"
import type { MetadataFilter } from "./pinecone.js"

const PDF_DEFAULT_TOP_K = Number(process.env.PDF_RETRIEVAL_TOP_K ?? 30)

interface UploadedFile {
  buffer: Buffer
  originalname: string
  mimetype: string
}

export interface PdfIngestResult {
  source: string
  uploadedAt: number
  chunkCount: number
  extractionMethod: string
  bm25Chunks: BM25Chunk[]
}

export const isPdfUpload = (fileName: string, mimeType: string): boolean =>
  mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")

export async function ingestPdfToIndex(
  file: UploadedFile,
  userId: string,
): Promise<PdfIngestResult> {
  if (!isPdfUpload(file.originalname, file.mimetype)) {
    throw new Error("Only PDF uploads are supported for the PDF pipeline.")
  }

  const result = await extractTextFromFile(
    file.buffer,
    file.originalname,
    file.mimetype,
  )
  console.log(`✅ PDF Step 1 — Text extracted via ${result.method} (${result.text.length} chars)`)

  const chunks = chunkText(result.text)
  console.log(`✅ PDF Step 2 — ${chunks.length} chunks created`)

  const ts = Date.now()
  const source = file.originalname
  const bm25Chunks = chunks.map((chunk, i) => ({
    id: `${userId}-${ts}-${i}`,
    text: chunk,
    metadata: {
      source,
      sourceType: "pdf",
      pdfName: source,
      uploadedAt: ts,
      chunkIndex: i,
    },
  }))

  await storeTextInPinecone(
    chunks.map((text) => ({ text })),
    userId,
    ts,
    source,
    PDF_INDEX_NAME,
    {
      sourceType: "pdf",
      pdfName: source,
      extractionMethod: result.method,
    },
  )
  console.log(`✅ PDF Step 3 — Stored in ${PDF_INDEX_NAME}`)

  return {
    source,
    uploadedAt: ts,
    chunkCount: chunks.length,
    extractionMethod: result.method,
    bm25Chunks,
  }
}

export async function searchPdfIndex(
  query: string,
  userId: string,
  bm25Chunks: BM25Chunk[] = [],
  topK = PDF_DEFAULT_TOP_K,
  filter?: MetadataFilter,
): Promise<HybridChunk[]> {
  const retrievalQuery = shouldUseDirectPdfQuery(query)
    ? query
    : await generateHypotheticalDocument(query)

  console.log(
    `✅ PDF Search — ${retrievalQuery === query ? "using direct query" : "HyDE generated"} | topK=${topK}`,
  )

  return hybridSearchText(
    retrievalQuery,
    query,
    bm25Chunks,
    userId,
    topK,
    filter,
    PDF_INDEX_NAME,
  )
}

function shouldUseDirectPdfQuery(query: string): boolean {
  const normalized = query.toLowerCase()
  return [
    "project",
    "projects",
    "experience",
    "skills",
    "education",
    "certifications",
    "achievements",
    "list",
    "which are",
    "what are",
  ].some((signal) => normalized.includes(signal))
}
