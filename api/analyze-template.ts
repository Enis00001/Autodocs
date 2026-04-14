import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, PDFName } from "pdf-lib";
import {
  BON_DRAFT_KEYS,
  buildDeterministicFieldMapping,
} from "./pdfFieldMapping";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed",
      v: "imports-test-v2",
      keys: BON_DRAFT_KEYS.length,
      hasPdf: typeof PDFDocument === "function",
      hasSupa: typeof createClient === "function",
    });
  }
  return res.status(200).json({ ok: true });
}
