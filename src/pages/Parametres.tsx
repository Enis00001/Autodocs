import { useEffect, useRef, useState } from "react";
import TopBar from "@/components/layout/TopBar";
import { Upload, Building2, MapPin } from "lucide-react";
import { loadConcession, saveConcession } from "@/utils/concession";
import type { ConcessionData } from "@/utils/concession";
import { toast } from "@/hooks/use-toast";

const ACCEPT_LOGO = "image/jpeg,image/png,image/svg+xml,.jpg,.jpeg,.png,.svg";

const Parametres = () => {
  const [concession, setConcession] = useState<ConcessionData>({
    name: "",
    address: "",
  });
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadConcession().then(setConcession);
  }, []);

  const handleLogoClick = () => logoInputRef.current?.click();

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setConcession((prev) => ({ ...prev, logoBase64: dataUrl }));
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSave = async () => {
    await saveConcession(concession);
    toast({ title: "Paramètres sauvegardés ✓" });
  };

  return (
    <>
      <TopBar title="Profil concession" subtitle="Informations essentielles de votre concession" />
      <div className="page-shell">
        <div className="page-content space-y-5 max-w-3xl">
          <div className="card-autodocs space-y-4">
            <div className="card-title-autodocs">🏢 Concession</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Nom de la concession</label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={concession.name}
                    onChange={(e) =>
                      setConcession((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="field-input pl-10"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Adresse</label>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={concession.address}
                    onChange={(e) =>
                      setConcession((prev) => ({ ...prev, address: e.target.value }))
                    }
                    className="field-input pl-10"
                  />
                </div>
              </div>
              <div className="col-span-1 flex flex-col gap-1.5 md:col-span-2">
                <label className="field-label">Photo de profil / logo</label>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept={ACCEPT_LOGO}
                  className="hidden"
                  onChange={handleLogoChange}
                />
                <button
                  type="button"
                  onClick={handleLogoClick}
                  className="border-2 border-dashed border-border rounded-lg p-6 flex items-center justify-center gap-2 text-muted-foreground cursor-pointer hover:border-primary transition-colors bg-transparent w-full interactive-lift"
                >
                  {concession.logoBase64 ? (
                    <img
                      src={concession.logoBase64}
                      alt="Logo concession"
                      className="max-h-14 max-w-[200px] object-contain"
                    />
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      <span className="text-sm">Uploader une photo</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0"
              style={{ boxShadow: "0 0 20px hsla(228,91%,64%,0.25)" }}
            >
              Sauvegarder
            </button>
          </div>
          <div className="card-autodocs text-sm text-muted-foreground">
            Ces informations apparaissent sur vos documents et votre espace de travail.
          </div>
        </div>
      </div>
    </>
  );
};

export default Parametres;
