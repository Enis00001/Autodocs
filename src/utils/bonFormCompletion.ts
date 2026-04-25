const MANDATORY_STRING_FIELDS = [
  "clientNom",
  "clientPrenom",
  "clientDateNaissance",
  "vehiculePrix",
] as const;

export function countMissingMandatoryFields(form: Record<string, unknown>): number {
  let missing = MANDATORY_STRING_FIELDS.filter(
    (key) => !String(form[key] ?? "").trim(),
  ).length;
  const stockColonnes = form.stockColonnes;
  const hasVehicule = Array.isArray(stockColonnes) && stockColonnes.length > 0;
  if (!hasVehicule) missing += 1;
  return missing;
}

export function isDraftFormComplete(form: Record<string, unknown>): boolean {
  return countMissingMandatoryFields(form) === 0;
}
