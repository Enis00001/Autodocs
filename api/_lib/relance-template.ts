type BuildRelanceEmailPayload = {
  clientNom: string;
  clientPrenom: string;
  signatureUrl: string;
  expiresAt?: string | null;
  messagePersonnalise?: string | null;
  numeroRelance: 1 | 2;
};

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatExpiresAt(expiresAt?: string | null): string {
  if (!expiresAt) return "bientot";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "bientot";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function buildRelanceEmailHTML(payload: BuildRelanceEmailPayload): string {
  const clientNom = escapeHtml(payload.clientNom || "Client");
  const clientPrenom = escapeHtml(payload.clientPrenom || "");
  const fullName = `${clientPrenom} ${clientNom}`.trim();
  const expiresAtLabel = formatExpiresAt(payload.expiresAt);
  const messagePersonnalise = String(payload.messagePersonnalise ?? "").trim();
  const relanceLabel = payload.numeroRelance === 2 ? "2e rappel" : "1er rappel";

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p style="margin: 0 0 14px;">Bonjour ${fullName || "Client"},</p>
      <p style="margin: 0 0 12px;">
        Nous vous rappelons que votre bon de commande est en attente de votre signature.
      </p>
      <p style="margin: 0 0 12px; color: #59607a; font-size: 13px;">
        ${relanceLabel} de la concession.
      </p>
      ${
        messagePersonnalise
          ? `<div style="margin: 0 0 16px; padding: 12px 14px; background: #f5f7ff; border-left: 4px solid #2c3e8f; border-radius: 6px; color: #23263a;">
               ${escapeHtml(messagePersonnalise).replace(/\n/g, "<br>")}
             </div>`
          : ""
      }
      <div style="margin: 22px 0 18px;">
        <a href="${payload.signatureUrl}"
           style="display: inline-block; background: #2c3e8f; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 700;">
          SIGNER MON BON DE COMMANDE
        </a>
      </div>
      <p style="margin: 0 0 8px; color: #666;">
        Ce lien expire le <strong>${escapeHtml(expiresAtLabel)}</strong>.
      </p>
      <p style="margin: 0; color: #666; font-size: 12px;">
        Si le bouton ne fonctionne pas, copiez-collez ce lien :<br>
        <a href="${payload.signatureUrl}" style="color: #2c3e8f; word-break: break-all;">${payload.signatureUrl}</a>
      </p>
      <p style="margin: 18px 0 0;">
        Cordialement,<br>
        L'équipe AutoDocs
      </p>
    </div>
  `;
}
