import type { VercelRequest, VercelResponse } from "@vercel/node";

const TEST_KEYS = ["clientNom", "clientPrenom", "vehiculeModele"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return res.status(200).json({ ok: true, count: TEST_KEYS.length });
}
