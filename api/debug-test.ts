import type { VercelRequest, VercelResponse } from "@vercel/node";
import { BON_DRAFT_KEYS } from "./_pdfFieldMapping";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({ ok: true, count: BON_DRAFT_KEYS.length });
}
