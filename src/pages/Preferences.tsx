import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, User, Car, Repeat } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { toast } from "@/hooks/use-toast";
import {
  CLIENT_FIELD_LABELS,
  DEFAULT_FORM_PREFS,
  REPRISE_FIELD_LABELS,
  VEHICULE_FIELD_LABELS,
  loadFormPrefs,
  saveFormPrefs,
  type ClientFieldKey,
  type FormFieldPrefs,
  type RepriseFieldKey,
  type VehiculeFieldKey,
} from "@/utils/formPreferences";

type SectionKey = "client" | "vehicule" | "reprise";

const SECTIONS: Array<{
  key: SectionKey;
  title: string;
  icon: typeof User;
  description: string;
}> = [
  {
    key: "client",
    title: "Client",
    icon: User,
    description: "Champs d'identité affichés sur le formulaire client.",
  },
  {
    key: "vehicule",
    title: "Véhicule",
    icon: Car,
    description: "Colonnes stock reconnues à afficher dans la section véhicule.",
  },
  {
    key: "reprise",
    title: "Reprise",
    icon: Repeat,
    description: "Champs visibles dans la sous-section « Reprise véhicule ».",
  },
];

const ToggleRow = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="flex w-full items-center justify-between gap-3 rounded-input border border-border/60 bg-secondary/40 px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-secondary/60 cursor-pointer"
  >
    <span className="text-sm font-medium text-foreground">{label}</span>
    <span
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-[hsl(var(--success))]" : "bg-[hsl(var(--destructive))]/70"
      }`}
      aria-hidden
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </span>
  </button>
);

const Preferences = () => {
  const [prefs, setPrefs] = useState<FormFieldPrefs>(DEFAULT_FORM_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    client: true,
    vehicule: true,
    reprise: true,
  });

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

  const toggleSection = (key: SectionKey) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setClientField = (key: ClientFieldKey, value: boolean) => {
    setPrefs((prev) => ({ ...prev, client: { ...prev.client, [key]: value } }));
  };
  const setVehiculeField = (key: VehiculeFieldKey, value: boolean) => {
    setPrefs((prev) => ({ ...prev, vehicule: { ...prev.vehicule, [key]: value } }));
  };
  const setRepriseField = (key: RepriseFieldKey, value: boolean) => {
    setPrefs((prev) => ({ ...prev, reprise: { ...prev.reprise, [key]: value } }));
  };

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
        title="Personnaliser le formulaire"
        subtitle="Activez ou masquez les champs affichés dans « Nouveau bon »"
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
          {loading ? (
            <div className="card-autodocs text-sm text-muted-foreground">
              Chargement des préférences…
            </div>
          ) : (
            SECTIONS.map(({ key, title, icon: Icon, description }) => {
              const isOpen = openSections[key];
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
                        <p className="text-[11px] text-muted-foreground">{description}</p>
                      </div>
                    </div>
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>

                  {isOpen && (
                    <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
                      {key === "client" &&
                        (Object.keys(CLIENT_FIELD_LABELS) as ClientFieldKey[]).map((fk) => (
                          <ToggleRow
                            key={fk}
                            label={CLIENT_FIELD_LABELS[fk]}
                            checked={prefs.client[fk]}
                            onChange={(v) => setClientField(fk, v)}
                          />
                        ))}
                      {key === "vehicule" &&
                        (Object.keys(VEHICULE_FIELD_LABELS) as VehiculeFieldKey[]).map(
                          (fk) => (
                            <ToggleRow
                              key={fk}
                              label={VEHICULE_FIELD_LABELS[fk]}
                              checked={prefs.vehicule[fk]}
                              onChange={(v) => setVehiculeField(fk, v)}
                            />
                          ),
                        )}
                      {key === "reprise" &&
                        (Object.keys(REPRISE_FIELD_LABELS) as RepriseFieldKey[]).map((fk) => (
                          <ToggleRow
                            key={fk}
                            label={REPRISE_FIELD_LABELS[fk]}
                            checked={prefs.reprise[fk]}
                            onChange={(v) => setRepriseField(fk, v)}
                          />
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
