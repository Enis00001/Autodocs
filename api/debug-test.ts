import type { VercelRequest, VercelResponse } from "@vercel/node";
import { BON_DRAFT_KEYS } from "./_pdfFieldMapping";
import { PDFDocument, PDFName } from "pdf-lib";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({
    ok: true,
    keysCount: BON_DRAFT_KEYS.length,
    hasPDFDocument: typeof PDFDocument === "function",
    hasPDFName: typeof PDFName === "function",
  });
}
