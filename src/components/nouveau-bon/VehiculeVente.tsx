import { useEffect, useMemo, useState } from "react";
import type { BonDraftData, OptionDetail } from "@/utils/drafts";
import { loadVendeurs } from "@/utils/vendeurs";
import type { Vendeur } from "@/utils/vendeurs";
import type { VehicleFieldRow } from "@/utils/vehicleFields";
import { STANDARD_VEHICULE_VENTE_FIELDS } from "@/utils/bonFieldPreferences";

const FINANCEMENT_OPTIONS = ["Comptant", "Crédit classique", "LOA", "LLD"] as const;

function parseNum(s: string): number {
  const n = parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

type VehiculeForm = Omit<BonDraftData, "id" | "createdAt" | "updatedAt"> & { id?: string };

type VehiculeVenteProps = {
  form: VehiculeForm;
  onChange: (patch: Partial<BonDraftData>) => void;
  customVehicleFields?: VehicleFieldRow[];
  hiddenFieldKeys?: string[];
  onToggleStandardField?: (key: string) => void;
  onAddCustomField?: (label: string) => Promise<void> | void;
  onRenameCustomField?: (id: string, label: string) => Promise<void> | void;
  onDeleteCustomField?: (id: string) => Promise<void> | void;
  onReorderCustomFields?: (orderedIds: string[]) => Promise<void> | void;
};

const VehiculeVente = ({
  form,
  onChange,
  customVehicleFields = [],
  hiddenFieldKeys = [],
  onToggleStandardField,
  onAddCustomField,
  onRenameCustomField,
  onDeleteCustomField,
  onReorderCustomFields,
}: VehiculeVenteProps) => {
  const [vendeurs, setVendeurs] = useState<Vendeur[]>([]);
  const [isLoadingVendeurs, setIsLoadingVendeurs] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [dragOverFieldId, setDragOverFieldId] = useState<string | null>(null);
  const hiddenSet = useMemo(() => new Set(hiddenFieldKeys), [hiddenFieldKeys]);
  const isVisible = (key: string) => !hiddenSet.has(key);

  useEffect(() => {
    loadVendeurs()
      .then(setVendeurs)
      .finally(() => setIsLoadingVendeurs(false));
  }, []);

  const isComptant = form.vehiculeFinancement === "Comptant";
  const isCredit = form.vehiculeFinancement === "Crédit classique";
  const isLoaLld = form.vehiculeFinancement === "LOA" || form.vehiculeFinancement === "LLD";

  const optionsMode = form.optionsMode ?? "total";
  const optionsDetailList: OptionDetail[] = useMemo(() => {
    try {
      const parsed = JSON.parse(form.optionsDetailJson || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [form.optionsDetailJson]);

  const optionsTotalValue = useMemo(() => {
    if (optionsMode === "total") return parseNum(form.optionsPrixTotal);
    return optionsDetailList.reduce((sum, o) => sum + parseNum(o.price), 0);
  }, [optionsMode, form.optionsPrixTotal, optionsDetailList]);

  const totalFinal = useMemo(() => {
    const prix = parseNum(form.vehiculePrix);
    const carteGrise = parseNum(form.vehiculeCarteGrise);
    const fraisReprise = parseNum(form.vehiculeFraisReprise);
    const remise = parseNum(form.vehiculeRemise);
    return Math.max(0, prix + optionsTotalValue + carteGrise + fraisReprise - remise);
  }, [form.vehiculePrix, form.vehiculeCarteGrise, form.vehiculeFraisReprise, form.vehiculeRemise, optionsTotalValue]);

  const soldeRestantDu = useMemo(() => {
    if (!isComptant) return 0;
    return Math.max(0, totalFinal - parseNum(form.acompte));
  }, [isComptant, totalFinal, form.acompte]);

  const setOptionsDetailList = (list: OptionDetail[]) => {
    onChange({ optionsDetailJson: JSON.stringify(list) });
  };
  const addOptionDetail = () => setOptionsDetailList([...optionsDetailList, { name: "", price: "" }]);
  const updateOptionDetail = (index: number, field: "name" | "price", value: string) => {
    const next = [...optionsDetailList];
    next[index] = { ...next[index], [field]: value };
    setOptionsDetailList(next);
  };
  const removeOptionDetail = (index: number) => setOptionsDetailList(optionsDetailList.filter((_, i) => i !== index));

  const handleAddCustomField = async () => {
    const label = newFieldLabel.trim();
    if (!label || !onAddCustomField) return;
    await onAddCustomField(label);
    setNewFieldLabel("");
  };

  const handleDropOnField = async (targetId: string) => {
    if (!draggingFieldId || draggingFieldId === targetId || !onReorderCustomFields) return;
    const ids = customVehicleFields.map((f) => f.id);
    const from = ids.indexOf(draggingFieldId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    await onReorderCustomFields(next);
    setDraggingFieldId(null);
    setDragOverFieldId(null);
  };

  /* ---------- small UI pieces ---------- */

  const ToggleBtn = ({ fieldKey }: { fieldKey: string }) => {
    if (!editMode) return null;
    const on = isVisible(fieldKey);
    return (
      <button
        type="button"
        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium border cursor-pointer transition-colors ${
          on ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground line-through"
        }`}
        onClick={() => onToggleStandardField?.(fieldKey)}
        title={on ? "Masquer ce champ" : "Afficher ce champ"}
      >
        {on ? "Affiché" : "Masqué"}
      </button>
    );
  };

  const stdFieldWrapperClass = (key: string, extra = "") => {
    const base = "flex flex-col gap-1.5";
    if (!editMode && !isVisible(key)) return `${base} ${extra} hidden`;
    if (editMode && !isVisible(key)) return `${base} ${extra} opacity-40`;
    return `${base} ${extra}`;
  };

  const StdFieldHeader = ({ fieldKey, label }: { fieldKey: string; label: string }) => (
    <div className="flex items-center justify-between gap-2">
      <label className="field-label">{label}</label>
      <ToggleBtn fieldKey={fieldKey} />
    </div>
  );

  return (
    <div className="card-autodocs">
      {/* --- Card header --- */}
      <div className="flex items-center justify-between mb-4">
        <span className="card-title-autodocs">🚗 Véhicule & vente</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`text-[11px] px-3 py-1 rounded-full font-semibold border cursor-pointer transition-colors ${
              editMode
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setEditMode((p) => !p)}
          >
            {editMode ? "✓ Terminer" : "⚙ Personnaliser"}
          </button>
          <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-primary/15 text-primary">
            Saisie vendeur
          </span>
        </div>
      </div>

      <div className="space-y-6">
        {/* ===================== SECTION 1 — Infos du véhicule ===================== */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Infos du véhicule
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className={stdFieldWrapperClass("vehiculeModele", "col-span-2")}>
              <StdFieldHeader fieldKey="vehiculeModele" label="Modèle du véhicule" />
              <input type="text" placeholder="ex: Peugeot 308 GT Pack" className="field-input" value={form.vehiculeModele} onChange={(e) => onChange({ vehiculeModele: e.target.value })} />
            </div>
            <div className={stdFieldWrapperClass("vehiculeVin", "col-span-2")}>
              <StdFieldHeader fieldKey="vehiculeVin" label="VIN / N° de châssis" />
              <input type="text" placeholder="ex: VF3LCYHZ..." className="field-input" value={form.vehiculeVin} onChange={(e) => onChange({ vehiculeVin: e.target.value })} />
            </div>
            <div className={stdFieldWrapperClass("vehiculePremiereCirculation")}>
              <StdFieldHeader fieldKey="vehiculePremiereCirculation" label="1ère mise en circulation" />
              <input type="text" placeholder="ex: 03/2022" className="field-input" value={form.vehiculePremiereCirculation} onChange={(e) => onChange({ vehiculePremiereCirculation: e.target.value })} />
            </div>
            <div className={stdFieldWrapperClass("vehiculeKilometrage")}>
              <StdFieldHeader fieldKey="vehiculeKilometrage" label="Kilométrage" />
              <input type="text" placeholder="ex: 45 000" className="field-input" value={form.vehiculeKilometrage} onChange={(e) => onChange({ vehiculeKilometrage: e.target.value })} />
            </div>
            <div className={stdFieldWrapperClass("vehiculeCo2")}>
              <StdFieldHeader fieldKey="vehiculeCo2" label="Émission CO2 (g/km)" />
              <input type="text" placeholder="ex: 112" className="field-input" value={form.vehiculeCo2} onChange={(e) => onChange({ vehiculeCo2: e.target.value })} />
            </div>
            <div className={stdFieldWrapperClass("vehiculeChevaux")}>
              <StdFieldHeader fieldKey="vehiculeChevaux" label="Chevaux (CV)" />
              <input type="text" placeholder="ex: 130" className="field-input" value={form.vehiculeChevaux} onChange={(e) => onChange({ vehiculeChevaux: e.target.value })} />
            </div>
            <div className={stdFieldWrapperClass("vehiculeCouleur")}>
              <StdFieldHeader fieldKey="vehiculeCouleur" label="Couleur / finition" />
              <input type="text" placeholder="ex: Blanc Nacré" className="field-input" value={form.vehiculeCouleur} onChange={(e) => onChange({ vehiculeCouleur: e.target.value })} />
            </div>
          </div>

          {/* --- Custom fields (champs concession) --- */}
          <div className="mt-4">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Champs personnalisés
            </h4>

            {customVehicleFields.length === 0 && !editMode && (
              <p className="text-xs text-muted-foreground">Aucun champ personnalisé. Cliquez sur « Personnaliser » pour en ajouter.</p>
            )}

            <div className="flex flex-col gap-2">
              {customVehicleFields.map((f) => (
                <div
                  key={f.id}
                  className={`rounded-lg border p-2.5 transition-colors ${
                    dragOverFieldId === f.id ? "border-primary bg-primary/5" : "border-border/60 bg-background/30"
                  }`}
                  draggable={editMode}
                  onDragStart={() => { if (editMode) setDraggingFieldId(f.id); }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverFieldId(f.id); }}
                  onDragLeave={() => setDragOverFieldId(null)}
                  onDrop={() => void handleDropOnField(f.id)}
                  onDragEnd={() => { setDraggingFieldId(null); setDragOverFieldId(null); }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    {editingFieldId === f.id ? (
                      <div className="flex items-center gap-2 w-full">
                        <input
                          type="text"
                          className="field-input flex-1 text-sm"
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const label = editingLabel.trim();
                              if (label && onRenameCustomField) {
                                void onRenameCustomField(f.id, label);
                              }
                              setEditingFieldId(null);
                              setEditingLabel("");
                            } else if (e.key === "Escape") {
                              setEditingFieldId(null);
                              setEditingLabel("");
                            }
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="rounded border border-border px-2 py-1 text-[10px] cursor-pointer"
                          onClick={() => { setEditingFieldId(null); setEditingLabel(""); }}
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          className="rounded gradient-primary px-2 py-1 text-[10px] text-primary-foreground border-0 cursor-pointer"
                          onClick={() => {
                            const label = editingLabel.trim();
                            if (label && onRenameCustomField) void onRenameCustomField(f.id, label);
                            setEditingFieldId(null);
                            setEditingLabel("");
                          }}
                        >
                          OK
                        </button>
                      </div>
                    ) : (
                      <>
                        <label className="field-label flex items-center gap-1.5">
                          {editMode && <span className="cursor-grab text-muted-foreground" title="Glisser pour réordonner">⠿</span>}
                          {f.label}
                        </label>
                        {editMode && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              className="rounded border border-border px-2 py-0.5 text-[10px] cursor-pointer hover:border-primary"
                              onClick={() => { setEditingFieldId(f.id); setEditingLabel(f.label); }}
                            >
                              Modifier
                            </button>
                            <button
                              type="button"
                              className="rounded border border-destructive/50 px-2 py-0.5 text-[10px] text-destructive cursor-pointer hover:bg-destructive/10"
                              onClick={() => void onDeleteCustomField?.(f.id)}
                            >
                              Supprimer
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <input
                    type="text"
                    className="field-input"
                    value={form.vehicleFieldValues?.[f.field_key] ?? ""}
                    onChange={(e) =>
                      onChange({
                        vehicleFieldValues: {
                          ...(form.vehicleFieldValues ?? {}),
                          [f.field_key]: e.target.value,
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>

            {editMode && (
              <div className="flex gap-2 mt-3">
                <input
                  type="text"
                  className="field-input flex-1"
                  placeholder="Ajouter un champ (ex: Marque du véhicule)"
                  value={newFieldLabel}
                  onChange={(e) => setNewFieldLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleAddCustomField()}
                />
                <button
                  type="button"
                  className="rounded-md gradient-primary px-3 py-2 text-xs font-medium text-primary-foreground border-0 cursor-pointer whitespace-nowrap"
                  onClick={() => void handleAddCustomField()}
                >
                  + Ajouter
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ===================== SECTION 2 — Prix & coûts ===================== */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Prix & coûts
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className={stdFieldWrapperClass("vehiculePrix")}>
              <StdFieldHeader fieldKey="vehiculePrix" label="Prix de vente TTC (€)" />
              <input type="text" placeholder="32 900" className="field-input" value={form.vehiculePrix} onChange={(e) => onChange({ vehiculePrix: e.target.value })} />
            </div>
            <div className={stdFieldWrapperClass("optionsMode", "col-span-2")}>
              <StdFieldHeader fieldKey="optionsMode" label="Options incluses" />
              <div className="flex gap-2 mb-2">
                <button type="button" className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${optionsMode === "total" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`} onClick={() => onChange({ optionsMode: "total" })}>
                  Prix total des options (€)
                </button>
                <button type="button" className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${optionsMode === "detail" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`} onClick={() => onChange({ optionsMode: "detail" })}>
                  Détailler les options
                </button>
              </div>
              {optionsMode === "total" ? (
                <input type="text" placeholder="0" className="field-input" value={form.optionsPrixTotal} onChange={(e) => onChange({ optionsPrixTotal: e.target.value })} />
              ) : (
                <div className="space-y-2">
                  {optionsDetailList.map((opt, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input type="text" placeholder="Nom option" className="field-input flex-1" value={opt.name} onChange={(e) => updateOptionDetail(i, "name", e.target.value)} />
                      <input type="text" placeholder="Prix (€)" className="field-input w-24" value={opt.price} onChange={(e) => updateOptionDetail(i, "price", e.target.value)} />
                      <button type="button" className="text-muted-foreground hover:text-destructive text-sm cursor-pointer" onClick={() => removeOptionDetail(i)} aria-label="Supprimer">×</button>
                    </div>
                  ))}
                  <button type="button" className="text-xs text-primary hover:underline cursor-pointer" onClick={addOptionDetail}>+ Ajouter une option</button>
                </div>
              )}
            </div>
            <div className={stdFieldWrapperClass("vehiculeCarteGrise")}>
              <StdFieldHeader fieldKey="vehiculeCarteGrise" label="Carte grise (€)" />
              <input type="text" placeholder="0" className="field-input" value={form.vehiculeCarteGrise} onChange={(e) => onChange({ vehiculeCarteGrise: e.target.value })} />
            </div>
            <div className={stdFieldWrapperClass("vehiculeFraisReprise")}>
              <StdFieldHeader fieldKey="vehiculeFraisReprise" label="Frais de reprise (€)" />
              <input type="text" placeholder="0" className="field-input" value={form.vehiculeFraisReprise} onChange={(e) => onChange({ vehiculeFraisReprise: e.target.value })} />
            </div>
            <div className={stdFieldWrapperClass("vehiculeRemise")}>
              <StdFieldHeader fieldKey="vehiculeRemise" label="Remise accordée (€)" />
              <input type="text" placeholder="0" className="field-input" value={form.vehiculeRemise} onChange={(e) => onChange({ vehiculeRemise: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Total final à payer TTC (€)</label>
              <div className="field-input bg-muted/50 font-semibold">{totalFinal.toLocaleString("fr-FR")}</div>
            </div>
          </div>
        </div>

        {/* ===================== SECTION 3 — Financement ===================== */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Type de financement</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className={stdFieldWrapperClass("vehiculeFinancement", "col-span-2")}>
              <StdFieldHeader fieldKey="vehiculeFinancement" label="Type de financement" />
              <select className="field-input" value={form.vehiculeFinancement} onChange={(e) => onChange({ vehiculeFinancement: e.target.value })}>
                {FINANCEMENT_OPTIONS.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
              </select>
            </div>
          </div>
        </div>

        {/* ===================== SECTION 4 — Modalités de paiement ===================== */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Modalités de paiement</h3>

          {isComptant && (
            <div className="grid grid-cols-2 gap-3">
              <div className={stdFieldWrapperClass("acompte")}>
                <StdFieldHeader fieldKey="acompte" label="Acompte (€)" />
                <input type="text" placeholder="0" className="field-input" value={form.acompte} onChange={(e) => onChange({ acompte: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Solde restant dû (€)</label>
                <div className="field-input bg-muted/50 font-semibold">{soldeRestantDu.toLocaleString("fr-FR")}</div>
              </div>
              <div className={stdFieldWrapperClass("modePaiement", "col-span-2")}>
                <StdFieldHeader fieldKey="modePaiement" label="Mode de paiement" />
                <div className="flex gap-2">
                  {(["virement", "cheque", "cb"] as const).map((mode) => (
                    <button key={mode} type="button" className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${(form.modePaiement ?? "virement") === mode ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`} onClick={() => onChange({ modePaiement: mode as "virement" | "cheque" | "cb" })}>
                      {mode === "virement" ? "Virement" : mode === "cheque" ? "Chèque de banque" : "CB"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(isCredit || isLoaLld) && (
            <div className="grid grid-cols-2 gap-3">
              <div className={stdFieldWrapperClass("apport")}>
                <StdFieldHeader fieldKey="apport" label="Apport (€)" />
                <input type="text" placeholder="0" className="field-input" value={form.apport} onChange={(e) => onChange({ apport: e.target.value })} />
              </div>
              <div className={stdFieldWrapperClass("organismePreteur")}>
                <StdFieldHeader fieldKey="organismePreteur" label="Organisme prêteur" />
                <input type="text" placeholder="ex: Banque XY" className="field-input" value={form.organismePreteur} onChange={(e) => onChange({ organismePreteur: e.target.value })} />
              </div>
              <div className={stdFieldWrapperClass("montantCredit")}>
                <StdFieldHeader fieldKey="montantCredit" label="Montant crédit (€)" />
                <input type="text" placeholder="0" className="field-input" value={form.montantCredit} onChange={(e) => onChange({ montantCredit: e.target.value })} />
              </div>
              <div className={stdFieldWrapperClass("tauxCredit")}>
                <StdFieldHeader fieldKey="tauxCredit" label="Taux (%)" />
                <input type="text" placeholder="ex: 3.5" className="field-input" value={form.tauxCredit} onChange={(e) => onChange({ tauxCredit: e.target.value })} />
              </div>
              <div className={stdFieldWrapperClass("dureeMois")}>
                <StdFieldHeader fieldKey="dureeMois" label="Durée (mois)" />
                <input type="text" placeholder="ex: 48" className="field-input" value={form.dureeMois} onChange={(e) => onChange({ dureeMois: e.target.value })} />
              </div>
              {isCredit && (
                <div className={stdFieldWrapperClass("clauseSuspensive", "col-span-2")}>
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={form.clauseSuspensive ?? false} onChange={(e) => onChange({ clauseSuspensive: e.target.checked })} className="rounded border-border" />
                      <span className="text-sm">Clause suspensive d'octroi de crédit 14 jours</span>
                    </label>
                    <ToggleBtn fieldKey="clauseSuspensive" />
                  </div>
                </div>
              )}
            </div>
          )}

          {!isComptant && !isCredit && !isLoaLld && (
            <p className="text-sm text-muted-foreground">Sélectionnez un type de financement ci-dessus.</p>
          )}
        </div>

        {/* ===================== SECTION 5 — Livraison & vendeur ===================== */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Livraison & vendeur</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className={stdFieldWrapperClass("vehiculeDateLivraison")}>
              <StdFieldHeader fieldKey="vehiculeDateLivraison" label="Date de livraison" />
              <input type="text" placeholder="jj/mm/aaaa" className="field-input" value={form.vehiculeDateLivraison} onChange={(e) => onChange({ vehiculeDateLivraison: e.target.value })} />
            </div>
            <div className={stdFieldWrapperClass("vehiculeReprise")}>
              <StdFieldHeader fieldKey="vehiculeReprise" label="Reprise véhicule (€)" />
              <input type="text" placeholder="0 (aucune)" className="field-input" value={form.vehiculeReprise} onChange={(e) => onChange({ vehiculeReprise: e.target.value })} />
            </div>
            <div className={stdFieldWrapperClass("vendeurNom")}>
              <StdFieldHeader fieldKey="vendeurNom" label="Vendeur" />
              <select className="field-input" value={form.vendeurNom} onChange={(e) => onChange({ vendeurNom: e.target.value })}>
                <option value="">Sélectionner un vendeur</option>
                {vendeurs.map((v) => {
                  const label = `${v.prenom} ${v.nom}`.trim() || v.id;
                  return (<option key={v.id} value={label}>{label}</option>);
                })}
              </select>
              {!isLoadingVendeurs && vendeurs.length === 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">Aucun vendeur — ajoutez-en dans Paramètres</p>
              )}
            </div>
            <div className={stdFieldWrapperClass("vendeurNotes")}>
              <StdFieldHeader fieldKey="vendeurNotes" label="Notes vendeur" />
              <input type="text" placeholder="Infos complémentaires..." className="field-input" value={form.vendeurNotes} onChange={(e) => onChange({ vendeurNotes: e.target.value })} />
            </div>
          </div>
        </div>
      </div>

      {/* --- Link to Infos véhicule page --- */}
      {editMode && (
        <div className="mt-4 pt-3 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground">
            Ces modifications sont sauvegardées automatiquement et s'appliquent à tous vos prochains bons.
            Configuration complète dans{" "}
            <a href="/infos-vehicule" className="text-primary hover:underline font-medium">Infos véhicule</a>
            {" "}(sidebar).
          </p>
        </div>
      )}
    </div>
  );
};

export default VehiculeVente;
