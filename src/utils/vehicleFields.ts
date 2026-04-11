import { supabase } from "@/lib/supabase";

export type VehicleFieldRow = {
  id: string;
  concession_id: string;
  label: string;
  field_key: string;
  position: number;
};

type VehicleFieldDbRow = {
  id: string;
  concession_id: string;
  label: string;
  field_key: string;
  position: number;
};

function rowToVehicleField(row: VehicleFieldDbRow): VehicleFieldRow {
  return {
    id: row.id,
    concession_id: row.concession_id,
    label: row.label,
    field_key: row.field_key,
    position: row.position,
  };
}

/** Convertit un libellé affiché en clé snake_case stable pour le formulaire / PDF. */
export function labelToFieldKey(label: string): string {
  const s = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "champ";
}

export async function loadVehicleFields(concessionId: string): Promise<VehicleFieldRow[]> {
  const { data, error } = await supabase
    .from("vehicle_fields")
    .select("id, concession_id, label, field_key, position")
    .eq("concession_id", concessionId)
    .order("position", { ascending: true });
  if (error) {
    console.error("loadVehicleFields:", error);
    return [];
  }
  return (data ?? []).map((r) => rowToVehicleField(r as VehicleFieldDbRow));
}

async function nextUniqueFieldKey(
  concessionId: string,
  baseKey: string,
  excludeRowId?: string
): Promise<string> {
  const { data } = await supabase
    .from("vehicle_fields")
    .select("id, field_key")
    .eq("concession_id", concessionId);
  const used = new Set(
    (data ?? [])
      .filter((r: { id: string }) => r.id !== excludeRowId)
      .map((r: { field_key: string }) => r.field_key)
  );
  if (!used.has(baseKey)) return baseKey;
  let n = 2;
  let candidate = `${baseKey}_${n}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${baseKey}_${n}`;
  }
  return candidate;
}

export async function addVehicleField(concessionId: string, label: string): Promise<VehicleFieldRow | null> {
  const trimmed = label.trim();
  if (!trimmed) return null;

  const list = await loadVehicleFields(concessionId);
  const position = list.length === 0 ? 0 : Math.max(...list.map((f) => f.position)) + 1;
  const baseKey = labelToFieldKey(trimmed);
  const field_key = await nextUniqueFieldKey(concessionId, baseKey);

  const { data, error } = await supabase
    .from("vehicle_fields")
    .insert({
      concession_id: concessionId,
      label: trimmed,
      field_key,
      position,
    })
    .select("id, concession_id, label, field_key, position")
    .single();

  if (error) {
    console.error("addVehicleField:", error);
    return null;
  }
  return rowToVehicleField(data as VehicleFieldDbRow);
}

export async function updateVehicleField(
  id: string,
  concessionId: string,
  label: string
): Promise<VehicleFieldRow | null> {
  const trimmed = label.trim();
  if (!trimmed) return null;

  const baseKey = labelToFieldKey(trimmed);
  const field_key = await nextUniqueFieldKey(concessionId, baseKey, id);

  const { data, error } = await supabase
    .from("vehicle_fields")
    .update({ label: trimmed, field_key })
    .eq("id", id)
    .eq("concession_id", concessionId)
    .select("id, concession_id, label, field_key, position")
    .single();

  if (error) {
    console.error("updateVehicleField:", error);
    return null;
  }
  return rowToVehicleField(data as VehicleFieldDbRow);
}

export async function deleteVehicleField(id: string, concessionId: string): Promise<boolean> {
  const { error } = await supabase
    .from("vehicle_fields")
    .delete()
    .eq("id", id)
    .eq("concession_id", concessionId);
  if (error) {
    console.error("deleteVehicleField:", error);
    return false;
  }
  return true;
}
