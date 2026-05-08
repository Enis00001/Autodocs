import { useEffect, useState } from "react";
import { Building2, MapPin, Hash, Phone, Loader2, Save } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { toast } from "@/hooks/use-toast";
import {
  emptyProfilConcession,
  loadProfilConcession,
  saveProfilConcession,
  type ProfilConcession as ProfilConcessionData,
} from "@/utils/profilConcession";

const ProfilConcession = () => {
  const [profil, setProfil] = useState<ProfilConcessionData>(emptyProfilConcession);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void loadProfilConcession().then((data) => {
      if (!active) return;
      if (data) setProfil(data);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const update = <K extends keyof ProfilConcessionData>(
    key: K,
    value: ProfilConcessionData[K],
  ) => setProfil((p) => ({ ...p, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveProfilConcession(profil);
      toast({ title: "Profil sauvegardé ✓" });
    } catch (err) {
      toast({
        title: "Échec de la sauvegarde",
        description:
          err instanceof Error ? err.message : "Une erreur est survenue.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TopBar
        title="Ma concession"
        subtitle="Informations utilisées pour pré-remplir le CERFA et les bons de commande"
      />
      <div className="page-shell">
        <div className="page-content space-y-5 max-w-3xl">
          {loading ? (
            <div className="card-autodocs flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="card-autodocs space-y-4">
                <div className="card-title-autodocs">🏢 Identité concession</div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="field-label">
                      Nom de la concession <span className="text-destructive">*</span>
                    </label>
                    <div className="relative">
                      <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={profil.nomConcession}
                        onChange={(e) => update("nomConcession", e.target.value)}
                        placeholder="SARL Garage Dupont"
                        className="field-input pl-10"
                        autoComplete="organization"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="field-label">
                      Adresse <span className="text-destructive">*</span>
                    </label>
                    <div className="relative">
                      <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={profil.adresse}
                        onChange={(e) => update("adresse", e.target.value)}
                        placeholder="12 rue de la République"
                        className="field-input pl-10"
                        autoComplete="street-address"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">
                      Code postal <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      value={profil.codePostal}
                      onChange={(e) => update("codePostal", e.target.value)}
                      placeholder="69001"
                      className="field-input"
                      inputMode="numeric"
                      maxLength={5}
                      autoComplete="postal-code"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">
                      Ville <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      value={profil.ville}
                      onChange={(e) => update("ville", e.target.value)}
                      placeholder="Lyon"
                      className="field-input"
                      autoComplete="address-level2"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">SIREN</label>
                    <div className="relative">
                      <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={profil.siren}
                        onChange={(e) => update("siren", e.target.value)}
                        placeholder="123 456 789"
                        className="field-input pl-10"
                        inputMode="numeric"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Téléphone</label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="tel"
                        value={profil.telephone}
                        onChange={(e) => update("telephone", e.target.value)}
                        placeholder="04 00 00 00 00"
                        className="field-input pl-10"
                        autoComplete="tel"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 inline-flex items-center gap-2 disabled:opacity-60 disabled:hover:translate-y-0"
                  style={{ boxShadow: "0 0 20px hsla(228,91%,64%,0.25)" }}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {saving ? "Sauvegarde…" : "Sauvegarder"}
                </button>
              </div>

              <div className="card-autodocs text-sm text-muted-foreground">
                Ces informations sont utilisées pour pré-remplir la section
                « Ancien propriétaire » du certificat de cession (CERFA 15776*01).
                Elles restent privées et ne sont visibles que par vous.
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default ProfilConcession;
