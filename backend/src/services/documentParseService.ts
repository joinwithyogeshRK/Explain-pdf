import axios from "axios";
import FormData from "form-data";

const LLAMA_PARSE_BASE_URL = "https://api.cloud.llamaindex.ai";
const LLAMA_PARSE_TIER = process.env.LLAMA_PARSE_TIER ?? "agentic";
const LLAMA_PARSE_VERSION = process.env.LLAMA_PARSE_VERSION ?? "latest";
const LLAMA_PARSE_TIMEOUT_MS = Number(process.env.LLAMA_PARSE_TIMEOUT_MS ?? 300000);
const LLAMA_PARSE_POLL_INTERVAL_MS = Number(
  process.env.LLAMA_PARSE_POLL_INTERVAL_MS ?? 2500,
);
const PDF2JSON_MAX_SIZE_BYTES = Number(
  process.env.PDF2JSON_MAX_SIZE_BYTES ?? 5 * 1024 * 1024,
);
const PDF_PARSE_MAX_SIZE_BYTES = Number(
  process.env.PDF_PARSE_MAX_SIZE_BYTES ?? 20 * 1024 * 1024,
);
const LLAMA_PARSE_FILES_URL = `${LLAMA_PARSE_BASE_URL}/api/v1/beta/files`;

export type ExtractionMethod = "pdf2json" | "pdf-parse" | "llamaparse";

interface LlamaParseResultResponse {
  job?: {
    id?: string;
    status?: string;
    error_message?: string | null;
  };
  text?: string | { pages?: { text?: string }[] };
  markdown?: string | { pages?: { markdown?: string }[] };
  text_full?: string;
  markdown_full?: string;
}

function isPdf(mimeType: string, fileName: string): boolean {
  return mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
}

function getLlamaCloudApiKey(): string {
  const apiKey = process.env.LLAMA_CLOUD_API_KEY;
  if (!apiKey) {
    console.error("LlamaParse misconfiguration: API key is not set");
    throw new Error(
      "Document parsing is temporarily unavailable. Please try again later.",
    );
  }
  return apiKey;
}

function extractMarkdownOrText(data: LlamaParseResultResponse): string {
  if (typeof data.markdown_full === "string") return data.markdown_full.trim();
  if (typeof data.text_full === "string") return data.text_full.trim();
  if (typeof data.markdown === "string") return data.markdown.trim();

  const markdownPages = data.markdown?.pages
    ?.map((page) => page.markdown?.trim())
    .filter(Boolean);
  if (markdownPages?.length) return markdownPages.join("\n\n").trim();

  if (typeof data.text === "string") return data.text.trim();

  const textPages = data.text?.pages
    ?.map((page) => page.text?.trim())
    .filter(Boolean);
  if (textPages?.length) return textPages.join("\n\n").trim();

  return "";
}

function describeLlamaParseError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : "Unknown LlamaParse error";
  }

  const detail = error.response?.data?.detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item: any) => {
        const msg = item?.msg;
        if (typeof msg !== "string") return null;
        const field = Array.isArray(item?.loc)
          ? item.loc.filter((part: unknown) => typeof part === "string").join(".")
          : "";
        return field ? `${field}: ${msg}` : msg;
      })
      .filter((message: unknown): message is string => typeof message === "string");
    if (messages.length) return messages.join("; ");
  }

  return `LlamaParse request failed with status ${error.response?.status ?? "unknown"}`;
}

async function uploadFileToLlamaCloud(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  apiKey: string,
): Promise<string> {
  const formData = new FormData();
  formData.append("file", fileBuffer, {
    filename: fileName,
    contentType: mimeType || "application/octet-stream",
  });
  formData.append("purpose", "parse");

  try {
    const response = await axios.post(
      LLAMA_PARSE_FILES_URL,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        maxBodyLength: Infinity,
        timeout: LLAMA_PARSE_TIMEOUT_MS,
      },
    );
    const fileId: string = response.data.id;
    if (!fileId) {
      console.error("[LlamaParse] File upload response missing id:", JSON.stringify(response.data).slice(0, 500));
      throw new Error("LlamaParse file upload did not return a file id.");
    }
    return fileId;
  } catch (error) {
    console.error("[LlamaParse] File upload failed:", JSON.stringify(error instanceof Error ? error.message : error).slice(0, 500));
    throw new Error(describeLlamaParseError(error));
  }
}

async function createParseJob(
  fileId: string,
  apiKey: string,
): Promise<string> {
  try {
    const response = await axios.post(
      `${LLAMA_PARSE_BASE_URL}/api/v2/parse`,
      {
        file_id: fileId,
        tier: LLAMA_PARSE_TIER,
        version: LLAMA_PARSE_VERSION,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: LLAMA_PARSE_TIMEOUT_MS,
      },
    );
    const jobId: string =
      response.data.job?.id ?? response.data.id ?? response.data.job_id;
    if (!jobId) {
      console.error("[LlamaParse] Parse job creation response missing job id:", JSON.stringify(response.data).slice(0, 500));
      throw new Error("LlamaParse did not return a job id.");
    }
    return jobId;
  } catch (error) {
    console.error("[LlamaParse] Parse job creation failed:", JSON.stringify(error instanceof Error ? error.message : error).slice(0, 500));
    throw new Error(describeLlamaParseError(error));
  }
}

async function pollParseJob(jobId: string, apiKey: string): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < LLAMA_PARSE_TIMEOUT_MS) {
    let result;
    try {
      result = await axios.get(
        `${LLAMA_PARSE_BASE_URL}/api/v2/parse/${jobId}?expand=markdown_full,text_full,markdown,text`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: LLAMA_PARSE_TIMEOUT_MS,
        },
      );
    } catch (error) {
      throw new Error(describeLlamaParseError(error));
    }

    const status = (
      result.data.job?.status ?? result.data.status ?? ""
    ).toUpperCase();
    if (status === "COMPLETED" || status === "SUCCESS") {
      const text = extractMarkdownOrText(result.data);
      if (!text || text.length < 20) {
        console.error("[LlamaParse] Response had insufficient text:", JSON.stringify(result.data).slice(0, 800));
        throw new Error("LlamaParse returned no readable text.");
      }
      return text;
    }

    if (status === "FAILED" || status === "ERROR" || status === "CANCELLED") {
      throw new Error(
        result.data.job?.error_message ?? "LlamaParse failed to parse this file.",
      );
    }

    await new Promise((resolve) =>
      setTimeout(resolve, LLAMA_PARSE_POLL_INTERVAL_MS),
    );
  }

  throw new Error("LlamaParse timed out while parsing this file.");
}

async function parseWithLlamaParse(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const apiKey = getLlamaCloudApiKey();

  const fileId = await uploadFileToLlamaCloud(fileBuffer, fileName, mimeType, apiKey);
  console.log(`[LlamaParse] File uploaded: ${fileId}`);

  const jobId = await createParseJob(fileId, apiKey);
  console.log(`[LlamaParse] Parse job created: ${jobId}`);

  return pollParseJob(jobId, apiKey);
}

const tryPdfParse = async (buffer: Buffer): Promise<string> => {
  const { default: pdfParse } = await import("pdf-parse-fork");
  const result = await pdfParse(buffer);
  return result.text ?? "";
};

const tryPdf2Json = (buffer: Buffer): Promise<string> => {
  return new Promise((resolve, reject) => {
    import("pdf2json")
      .then(({ default: PDFParser }) => {
        const pdfParser = new PDFParser();

        pdfParser.on("pdfParser_dataReady", (data: any) => {
          const rawText = data.Pages.map((page: any) =>
            page.Texts.map((t: any) =>
              decodeURIComponent(t.R.map((r: any) => r.T).join("")),
            ).join(" "),
          ).join("\n");
          resolve(rawText);
        });

        pdfParser.on("pdfParser_dataError", reject);
        pdfParser.parseBuffer(buffer);
      })
      .catch(reject);
  });
};

const hasUsableText = (text: string, minLength = 50): boolean =>
  Boolean(text && text.trim().length >= minLength);

const tryLocalPdfExtraction = async (
  fileBuffer: Buffer,
): Promise<{ text: string; method: ExtractionMethod } | null> => {
  const sizeMb = Math.ceil(fileBuffer.length / 1024 / 1024);

  if (fileBuffer.length <= PDF2JSON_MAX_SIZE_BYTES) {
    try {
      const text = await tryPdf2Json(fileBuffer);
      if (hasUsableText(text)) {
        return { text, method: "pdf2json" };
      }
      console.log("⚠️  pdf2json returned insufficient text — trying pdf-parse...");
    } catch {
      console.log("⚠️  pdf2json failed — trying pdf-parse...");
    }
  } else {
    console.log(
      `ℹ️  PDF is ${sizeMb}MB; skipping pdf2json to protect server memory.`,
    );
  }

  if (fileBuffer.length <= PDF_PARSE_MAX_SIZE_BYTES) {
    try {
      const text = await tryPdfParse(fileBuffer);
      if (hasUsableText(text)) {
        return { text, method: "pdf-parse" };
      }
      console.log("⚠️  pdf-parse returned insufficient text.");
    } catch {
      console.log("⚠️  pdf-parse failed.");
    }
  } else {
    console.log(
      `ℹ️  PDF is ${sizeMb}MB; skipping pdf-parse to protect server memory.`,
    );
  }

  return null;
};

export const extractTextFromFile = async (
  fileBuffer: Buffer,
  fileName: string = "upload",
  mimeType: string = "application/octet-stream",
): Promise<{ text: string; method: ExtractionMethod }> => {
  if (isPdf(mimeType, fileName)) {
    try {
      const text = await parseWithLlamaParse(fileBuffer, fileName, mimeType);
      return { text, method: "llamaparse" };
    } catch (llamaError) {
      console.error(
        "[LlamaParse] Primary PDF parse failed — falling back to local parsers:",
        llamaError instanceof Error ? llamaError.message : llamaError,
      );

      const localResult = await tryLocalPdfExtraction(fileBuffer);
      if (localResult) {
        return localResult;
      }

      throw llamaError;
    }
  }

  const text = await parseWithLlamaParse(fileBuffer, fileName, mimeType);
  return { text, method: "llamaparse" };
};
