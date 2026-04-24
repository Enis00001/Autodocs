import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, User, Car, Repeat, Wallet, Plus, Trash2 } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { toast } from "@/hooks/use-toast";
import {
  DEFAULT_FORM_PREFS,
  SECTIONS,
  getFieldsBySection,
  loadFormPrefs,
  saveFormPrefs,
  type FieldSection,
  type FieldType,
  type FormFieldDefinition,
  type FormFieldPrefs,
} from "@/utils/formPreferences";
const SECTION_ICONS: Record<FieldSection, typeof User> = {
  client: User,
  vehicule: Car,
  reprise: Repeat,
  reglement: Wallet,
};
const TYPE_OPTIONS: Array<{ id: FieldType; label: string }> = [
  { id: "text", label: "Texte" },
  { id: "number", label: "Nombre" },
  { id: "date", label: "Date" },
];
const SECTION_OPTIONS: Array<{ id: FieldSection; label: string }> = [
  { id: "client", label: "Client" },
  { id: "vehicule", label: "Véhicule" },
  { id: "reprise", label: "Reprise" },
  { id: "reglement", label: "Règlement" },
];

const Preferences = () => {
  const [prefs, setPrefs] = useState<FormFieldPrefs>(DEFAULT_FORM_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<Record<FieldSection, boolean>>({
    client: true,
    vehicule: true,
    reprise: true,
    reglement: true,
  });
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldSection, setNewFieldSection] = useState<FieldSection>("client");
  const [newFieldType, setNewFieldType] = useState<FieldType>("text");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadFormPrefs();
      if (cancelled) return;
      setPrefs(loaded);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSection = (key: FieldSection) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const updateField = (id: string, patch: Partial<FormFieldDefinition>) => {
    setPrefs((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  };
  const deleteField = (id: string) => {
    setPrefs((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.id !== id) }));
  };
  const slugify = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const handleAddField = () => {
    const label = newFieldName.trim();
    if (!label) return;
    const base = slugify(label) || `champ_${Date.now()}`;
    const key = `custom_${newFieldSection}_${base}_${Math.random().toString(36).slice(2, 6)}`;
    const next: FormFieldDefinition = {
      id: crypto.randomUUID?.() ?? `${Date.now()}`,
      key,
      label,
      section: newFieldSection,
      type: newFieldType,
      enabled: true,
      isCustom: true,
    };
    setPrefs((prev) => ({ ...prev, fields: [...prev.fields, next] }));
    setNewFieldName("");
  };
  const sectionDescription = useMemo<Record<FieldSection, string>>(
    () => ({
      client: "Champs d'identité et coordonnées client.",
      vehicule: "Champs véhicule (stock + personnalisés).",
      reprise: "Champs de la section reprise véhicule.",
      reglement: "Champs financiers et de paiement.",
    }),
    [],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveFormPrefs(prefs);
      toast({ title: "Préférences sauvegardées ✓" });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("autodocs_form_prefs_updated"));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de sauvegarder.";
      toast({
        title: "Échec de sauvegarde",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TopBar
        title="Modification des champs"
        subtitle="Ajoutez, modifiez, supprimez et activez les champs du formulaire"
        actions={
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="btn-primary cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Sauvegarde…" : "Sauvegarder"}
          </button>
        }
      />
      <div className="page-shell">
        <div className="page-content space-y-5 max-w-3xl">
          <div className="card-autodocs space-y-3">
            <div className="card-title-autodocs">Ajouter un champ personnalisé</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <input
                type="text"
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                className="field-input md:col-span-2"
                placeholder="Nom du champ"
              />
              <select
                value={newFieldSection}
                onChange={(e) => setNewFieldSection(e.target.value as FieldSection)}
                className="field-input"
              >
                {SECTION_OPTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                value={newFieldType}
                onChange={(e) => setNewFieldType(e.target.value as FieldType)}
                className="field-input"
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn-secondary cursor-pointer" onClick={handleAddField}>
              <Plus className="h-4 w-4" />
              Ajouter
            </button>
          </div>
          {loading ? (
            <div className="card-autodocs text-sm text-muted-foreground">
              Chargement des préférences…
            </div>
          ) : (
            SECTIONS.map(({ key, title }) => {
              const isOpen = openSections[key];
              const Icon = SECTION_ICONS[key];
              const fields = getFieldsBySection(prefs, key);
              return (
                <div key={key} className="card-autodocs">
                  <button
                    type="button"
                    onClick={() => toggleSection(key)}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 bg-transparent text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-input bg-primary/15 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="card-title-autodocs">{title}</div>
                        <p className="text-[11px] text-muted-foreground">{sectionDescription[key]}</p>
                      </div>
                    </div>
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>

                  {isOpen && (
                    <div className="mt-4 space-y-2">
                      {fields.map((field) => (
                        <div
                          key={field.id}
                          className="flex flex-col gap-2 rounded-input border border-border/60 bg-secondary/40 p-3"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={field.label}
                              onChange={(e) => updateField(field.id, { label: e.target.value })}
                              className="field-input h-9"
                            />
                            <span className="rounded-full bg-secondary px-2 py-1 text-[10px] text-muted-foreground">
                              {field.type}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateField(field.id, { enabled: !field.enabled })}
                              className="ml-auto"
                            >
                              <span
                                className={`relative block h-6 w-11 rounded-full ${
                                  field.enabled ? "bg-[hsl(var(--success))]" : "bg-[hsl(var(--destructive))]/70"
                                }`}
                              >
                                <span
                                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                                    field.enabled ? "left-[22px]" : "left-0.5"
                                  }`}
                                />
                              </span>
                            </button>
                            {field.isCustom && (
                              <button
                                type="button"
                                className="text-muted-foreground transition-colors hover:text-destructive"
                                onClick={() => deleteField(field.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                          {!field.isCustom && (
                            <p className="text-[11px] text-muted-foreground">
                              Champ standard (non supprimable).
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
};

export default Preferences;
