import fs from "fs"
import path from "path"

const root = path.resolve(import.meta.dirname, "..")
const mdPath = path.join(root, "lyncr_architecture_report.md")
const outPath = path.join(root, "lyncr_architecture_report_gemini.txt")

const md = fs.readFileSync(mdPath, "utf8")

const preamble = `LYNCR PLATFORM ARCHITECTURE REPORT
Upload this file to Google Gemini for architectural review.
Format: plain text export of the full technical report.
Generated from: lyncr_architecture_report.md

INSTRUCTIONS FOR GEMINI:
- Treat this as the authoritative codebase architecture summary for Lyncr (lyncr.app).
- Answer questions about tech stack, data model, call routing, features, and UI state using this document.
- The product is a Next.js 16 + Telnyx VoIP app for small business call routing and field dispatch.

================================================================================

`

let body = md
  // Drop mermaid blocks (Gemini reads text better without diagram syntax)
  .replace(/```mermaid[\s\S]*?```/g, "\n[See section above for flow description in prose.]\n")
  // Keep fenced code blocks but label them
  .replace(/```(\w*)\n/g, "\n--- CODE ($1) ---\n")
  .replace(/```/g, "\n--- END CODE ---\n")
  // Markdown links → label only
  .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
  // Bold/italic
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/\*([^*]+)\*/g, "$1")
  // Horizontal rules
  .replace(/^---+\s*$/gm, "\n" + "-".repeat(80) + "\n")

fs.writeFileSync(outPath, preamble + body.trim() + "\n")
console.log("Wrote", outPath, "(" + fs.statSync(outPath).size + " bytes)")
