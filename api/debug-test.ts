import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { PDFDocument } = await import("pdf-lib");
  return res.status(200).json({
    ok: true,
    hasPDFDocument: typeof PDFDocument === "function",
    nodeVersion: process.version,
  });
}
