import fs from "fs";
import path from "path";
import { extractTextFromFile } from "../dist/services/documentParseService.js";

const pdfPath =
  process.argv[2] ??
  "/Users/ashwin/Downloads/1 Mahesh Gunware_Bank Statement_01.04.2025 to 28.02.2026.pdf";

if (!fs.existsSync(pdfPath)) {
  console.error("PDF not found:", pdfPath);
  process.exit(1);
}

const buffer = fs.readFileSync(pdfPath);
const fileName = path.basename(pdfPath);
const sizeMb = (buffer.length / 1024 / 1024).toFixed(2);

console.log("=== PDF parse test ===");
console.log("File:", fileName);
console.log("Size:", `${sizeMb} MB (${buffer.length} bytes)`);
console.log("");

const started = Date.now();
try {
  const result = await extractTextFromFile(buffer, fileName, "application/pdf");
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log("✅ Success");
  console.log("Method:", result.method);
  console.log("Extracted chars:", result.text.length);
  console.log("Elapsed:", `${elapsed}s`);
  console.log("");
  console.log("--- Preview (first 800 chars) ---");
  console.log(result.text.slice(0, 800));
  console.log("");
  console.log("--- Preview (last 400 chars) ---");
  console.log(result.text.slice(-400));
} catch (error) {
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.error("❌ Failed after", `${elapsed}s`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
