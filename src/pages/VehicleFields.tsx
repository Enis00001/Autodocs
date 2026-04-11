import { useEffect, useState } from "react";
import TopBar from "@/components/layout/TopBar";
import { getCurrentUserId } from "@/lib/auth";
import {
  addVehicleField,
  deleteVehicleField,
  loadVehicleFields,
  updateVehicleField,
  type VehicleFieldRow,
} from "@/utils/vehicleFields";

const VehicleFieldsPage = () => {
  const [rows, setRows] = useState<VehicleFieldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = async (concessionId: string) => {
    setLoading(true);
    setError(null);
    const list = await loadVehicleFields(concessionId);
    setRows(list);
    setLoading(false);
  };

  useEffect(() => {
    getCurrentUserId().then((uid) => {
      if (!uid) {
        setLoading(false);
        setError("Utilisateur non connecté.");
        return;
      }
      refresh(uid);
    });
  }, []);

  const handleAdd = async () => {
    const uid = await getCurrentUserId();
    if (!uid) return;
    const label = newLabel.trim();
    if (!label) {
      setError("Saisissez un nom de champ.");
      return;
    }
    const created = await addVehicleField(uid, label);
    if (!created) {
      setError("Impossible d'ajouter le champ.");
      return;
    }
    setNewLabel("");
    setError(null);
    await refresh(uid);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Supprimer ce champ ?")) return;
    const uid = await getCurrentUserId();
    if (!uid) return;
    const ok = await deleteVehicleField(id, uid);
    if (!ok) {
      setError("Suppression impossible.");
      return;
    }
    setError(null);
    await refresh(uid);
  };

  const startEdit = (row: VehicleFieldRow) => {
    setEditingId(row.id);
    setEditLabel(row.label);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditLabel("");
  };

  const saveEdit = async (id: string) => {
    const uid = await getCurrentUserId();
    if (!uid) return;
    const updated = await updateVehicleField(id, uid, editLabel);
    if (!updated) {
      setError("Impossible d'enregistrer les modifications.");
      return;
    }
    setError(null);
    cancelEdit();
    await refresh(uid);
  };

  return (
    <>
      <TopBar title="Infos véhicule" />
      <div className="flex-1 overflow-y-auto p-4 pb-6 md:p-7 md:pb-7">
        <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
          Configurez les champs supplémentaires affichés dans la section véhicule de chaque nouveau bon de
          commande. Chaque champ est identifié par une clé technique dérivée du libellé.
        </p>

        {error && (
          <div
            className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="card-autodocs max-w-3xl">
          <div className="card-title-autodocs mb-4">Champs configurés</div>

          {loading ? (
            <p className="text-sm text-muted-foreground py-6">Chargement…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">Aucun champ personnalisé pour le moment.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-3 md:flex-row md:items-center md:justify-between"
                >
                  {editingId === row.id ? (
                    <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
                      <input
                        type="text"
                        className="field-input flex-1"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-border bg-transparent px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={cancelEdit}
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          className="rounded-md gradient-primary px-3 py-2 text-xs font-medium text-primary-foreground border-0 cursor-pointer"
                          onClick={() => void saveEdit(row.id)}
                        >
                          Enregistrer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">{row.label}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                          {row.field_key}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-border bg-transparent px-3 py-2 text-xs font-medium text-foreground hover:border-primary cursor-pointer"
                          onClick={() => startEdit(row)}
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-destructive/50 bg-transparent px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 cursor-pointer"
                          onClick={() => void handleDelete(row.id)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card-autodocs max-w-3xl mt-5">
          <div className="card-title-autodocs mb-3">Ajouter un champ</div>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex flex-1 flex-col gap-1.5">
              <label className="field-label" htmlFor="new-vehicle-field">
                Nom du champ
              </label>
              <input
                id="new-vehicle-field"
                type="text"
                className="field-input"
                placeholder="Ex. Numéro de série moteur"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
              />
            </div>
            <button
              type="button"
              className="min-h-11 rounded-lg gradient-primary px-4 py-2.5 text-sm font-medium text-primary-foreground border-0 cursor-pointer md:min-h-0"
              onClick={() => void handleAdd()}
            >
              Ajouter
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default VehicleFieldsPage;
