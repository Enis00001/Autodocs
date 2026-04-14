// api/debug-test.ts
var TEST_KEYS = ["clientNom", "clientPrenom", "vehiculeModele"];
async function handler(req, res) {
  return res.status(200).json({ ok: true, count: TEST_KEYS.length });
}
export {
  handler as default
};
