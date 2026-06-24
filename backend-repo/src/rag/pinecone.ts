import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";

if (!process.env.PINECONE_API_KEY) {
  throw new Error("PINECONE_API_KEY is required");
}

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

export const RAG_INDEX_NAME =
  process.env.PINECONE_RAG_INDEX_NAME ??
  process.env.PINECONE_INDEX_NAME ??
  "rag-index";

export const PINECONE_VECTOR_DIMENSION = Number(
  process.env.PINECONE_VECTOR_DIMENSION ?? 1024,
);

export const PINECONE_TEXT_FIELD =
  process.env.PINECONE_TEXT_FIELD ??
  "text";

const pineconeIndexHost =
  process.env.PINECONE_INDEX_HOST ??
  process.env.PINECONE_RAG_INDEX_HOST;

export const getPineconeIndex = (indexName: string = RAG_INDEX_NAME) =>
  pineconeIndexHost
    ? pinecone.index({ name: indexName, host: pineconeIndexHost })
    : pinecone.index({ name: indexName });

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

export interface PineconeResult {
  id: string
  text: string
  metadata?: Record<string, any>
}

export interface MetadataFilter {
  source?:     string
  uploadedAt?: {
    after?:  number
    before?: number
  }
}

// ─────────────────────────────────────────────────────────────
// STORE — now accepts rich metadata
// ─────────────────────────────────────────────────────────────

export const storeInPinecone = async (
  embeddedChunks: { text: string; vector: number[] }[],
  userId:         string,
  ts:             number = Date.now(),
  source:         string = 'unknown',   // ← filename
  indexName:      string = RAG_INDEX_NAME,
  extraMetadata:  Record<string, any> = {},
) => {
  if (embeddedChunks.length === 0) {
    console.log(`ℹ️  No vectors to store | index: ${indexName} | source: ${source}`);
    return;
  }

  const vectors = embeddedChunks.map((chunk, i) => ({
    id:     `${userId}-${ts}-${i}`,
    values: chunk.vector,
    metadata: {
      text:        chunk.text,
      userId,
      source,                           // ← filename stored here
      uploadedAt:  ts,                  // ← timestamp stored here
      chunkIndex:  i,                   // ← position in document
      totalChunks: embeddedChunks.length,
      ...extraMetadata,
    },
  }));

  const index = getPineconeIndex(indexName);
  await index.upsert({ records: vectors });
  console.log(`✅ Stored ${vectors.length} vectors | index: ${indexName} | source: ${source}`);
};

export const storeTextInPinecone = async (
  chunks:         { text: string; metadata?: Record<string, any> }[],
  userId:         string,
  ts:             number = Date.now(),
  source:         string = 'unknown',
  indexName:      string = RAG_INDEX_NAME,
  extraMetadata:  Record<string, any> = {},
) => {
  if (chunks.length === 0) {
    console.log(`ℹ️  No text records to store | index: ${indexName} | source: ${source}`);
    return;
  }

  const index = getPineconeIndex(indexName);
  const BATCH = 96;

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const records = batch.map((chunk, j) => ({
      id: `${userId}-${ts}-${i + j}`,
      [PINECONE_TEXT_FIELD]: chunk.text,
      userId,
      source,
      uploadedAt: ts,
      chunkIndex: i + j,
      totalChunks: chunks.length,
      ...extraMetadata,
      ...(chunk.metadata ?? {}),
    }));

    try {
      await index.upsertRecords({ records });
    } catch (err) {
      console.error(
        `Pinecone upsertRecords failed | index: ${indexName} | source: ${source} | ` +
          `batch: ${Math.floor(i / BATCH) + 1}/${Math.ceil(chunks.length / BATCH)} | ` +
          `textField: ${PINECONE_TEXT_FIELD}`,
        err,
      );
      throw err;
    }
    console.log(
      `✅ Stored text batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(chunks.length / BATCH)} | index: ${indexName} | source: ${source}`,
    );
  }
};

// ─────────────────────────────────────────────────────────────
// BUILD PINECONE FILTER — translates our MetadataFilter to
// Pinecone's filter syntax
// ─────────────────────────────────────────────────────────────

function buildFilter(userId: string, filter?: MetadataFilter) {
  const must: Record<string, any>[] = [
    { userId: { $eq: userId } }         // always filter by user
  ]

  if (filter?.source) {
    must.push({ source: { $eq: filter.source } })
  }

  if (filter?.uploadedAt?.after) {
    must.push({ uploadedAt: { $gte: filter.uploadedAt.after } })
  }

  if (filter?.uploadedAt?.before) {
    must.push({ uploadedAt: { $lte: filter.uploadedAt.before } })
  }

  // If only userId filter → return simple object (your current behavior)
  if (must.length === 1) {
    return { userId: { $eq: userId } }
  }

  // Multiple filters → use $and
  return { $and: must }
}

// ─────────────────────────────────────────────────────────────
// SEARCH — now accepts optional metadata filter
// ─────────────────────────────────────────────────────────────

export const searchPinecone = async (
  queryVector: number[],
  userId:      string,
  topK:        number = 5,
  filter?:     MetadataFilter,        // ← optional, backward compatible
  indexName:   string = RAG_INDEX_NAME,
): Promise<PineconeResult[]> => {

  const pineconeFilter = buildFilter(userId, filter)

  console.log(`🔎 Pinecone index: ${indexName}`)
  console.log('🔎 Pinecone filter:', JSON.stringify(pineconeFilter))

  const index = getPineconeIndex(indexName);
  let results;
  try {
    results = await index.query({
      vector:          queryVector,
      topK,
      includeMetadata: true,
      filter:          pineconeFilter,
    });
  } catch (err) {
    console.error(
      `Pinecone vector query failed | index: ${indexName} | vectorDim: ${queryVector.length}`,
      err,
    );
    throw err;
  }

  results.matches?.forEach((m) => {
    console.log(
      `  Score: ${m.score?.toFixed(4)} | source: ${m.metadata?.source} — "${(m.metadata?.text as string)?.slice(0, 50)}..."`,
    );
  });

  const chunks: PineconeResult[] =
    results.matches
      ?.filter((m) => m.metadata?.text)
      .map((m) => ({
        id:       m.id,
        text:     m.metadata!.text as string,
        metadata: m.metadata as Record<string, any>,
      })) ?? [];

  console.log(`✅ Found ${chunks.length} chunks`);
  return chunks;
};

export const searchPineconeText = async (
  queryText: string,
  userId:    string,
  topK:      number = 5,
  filter?:   MetadataFilter,
  indexName: string = RAG_INDEX_NAME,
): Promise<PineconeResult[]> => {

  const pineconeFilter = buildFilter(userId, filter)

  console.log(`🔎 Pinecone integrated index: ${indexName}`)
  console.log('🔎 Pinecone filter:', JSON.stringify(pineconeFilter))

  const index = getPineconeIndex(indexName);
  let results;
  try {
    results = await index.searchRecords({
      query: {
        inputs: { text: queryText },
        topK,
        filter: pineconeFilter,
      },
      fields: [
        PINECONE_TEXT_FIELD,
        "source",
        "filePath",
        "repoName",
        "uploadedAt",
        "chunkIndex",
        "totalChunks",
      ],
    });
  } catch (err) {
    console.error(
      `Pinecone integrated search failed | index: ${indexName} | textField: ${PINECONE_TEXT_FIELD}`,
      err,
    );
    throw err;
  }

  const chunks: PineconeResult[] =
    results.result?.hits
      ?.filter((hit: any) => hit.fields?.[PINECONE_TEXT_FIELD])
      .map((hit: any) => ({
        id: hit.id,
        text: hit.fields[PINECONE_TEXT_FIELD] as string,
        metadata: hit.fields as Record<string, any>,
      })) ?? [];

  chunks.forEach((chunk) => {
    console.log(
      `  Hit: ${chunk.id} | source: ${chunk.metadata?.source} — "${chunk.text.slice(0, 50)}..."`,
    )
  })

  console.log(`✅ Found ${chunks.length} integrated chunks`);
  return chunks;
};
