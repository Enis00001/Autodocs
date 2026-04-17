import { useEffect, useRef, useState } from "react";
import TopBar from "@/components/layout/TopBar";
import { Plus, Trash2, Upload } from "lucide-react";
import { loadConcession, saveConcession } from "@/utils/concession";
import type { ConcessionData } from "@/utils/concession";
import { loadVendeurs, addVendeur, deleteVendeur } from "@/utils/vendeurs";
import type { Vendeur } from "@/utils/vendeurs";
import { toast } from "@/hooks/use-toast";

const ACCEPT_LOGO = "image/jpeg,image/png,image/svg+xml,.jpg,.jpeg,.png,.svg";

const Parametres = () => {
  const [concession, setConcession] = useState<ConcessionData>({
    name: "",
    address: "",
  });
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [vendeurs, setVendeurs] = useState<Vendeur[]>([]);
  const [modalVendeurOpen, setModalVendeurOpen] = useState(false);
  const [newVendeurNom, setNewVendeurNom] = useState("");
  const [newVendeurPrenom, setNewVendeurPrenom] = useState("");

  useEffect(() => {
    loadConcession().then(setConcession);
  }, []);

  useEffect(() => {
    loadVendeurs().then(setVendeurs);
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

  const openAddVendeurModal = () => {
    setNewVendeurNom("");
    setNewVendeurPrenom("");
    setModalVendeurOpen(true);
  };

  const handleAddVendeur = async () => {
    await addVendeur(newVendeurNom, newVendeurPrenom);
    setVendeurs(await loadVendeurs());
    setModalVendeurOpen(false);
  };

  const handleDeleteVendeur = async (id: string) => {
    if (!window.confirm("Supprimer ce vendeur ?")) return;
    await deleteVendeur(id);
    setVendeurs(await loadVendeurs());
  };

  return (
    <>
      <TopBar title="Paramètres" />
      <div className="page-shell">
        <div className="page-content space-y-5 max-w-3xl">
        {/* Concession */}
        <div className="card-autodocs space-y-4">
          <div className="card-title-autodocs">🏢 Concession</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Nom de la concession</label>
              <input
                type="text"
                value={concession.name}
                onChange={(e) =>
                  setConcession((prev) => ({ ...prev, name: e.target.value }))
                }
                className="field-input"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Adresse</label>
              <input
                type="text"
                value={concession.address}
                onChange={(e) =>
                  setConcession((prev) => ({ ...prev, address: e.target.value }))
                }
                className="field-input"
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="field-label">Logo</label>
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
                    className="max-h-12 max-w-[180px] object-contain"
                  />
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span className="text-sm">Upload un logo</span>
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

        {/* Vendeurs */}
        <div className="card-autodocs space-y-4">
          <div className="flex items-center justify-between">
            <div className="card-title-autodocs">👥 Vendeurs</div>
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors cursor-pointer bg-transparent border-0"
              onClick={openAddVendeurModal}
            >
              <Plus className="w-3.5 h-3.5" /> Ajouter un vendeur
            </button>
          </div>
          <div className="space-y-2">
            {vendeurs.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between px-3 py-2.5 bg-secondary rounded-lg border border-border row-hover"
              >
                <span className="text-sm">
                  {v.prenom} {v.nom}
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer bg-transparent border-0 p-0"
                  onClick={() => handleDeleteVendeur(v.id)}
                  aria-label="Supprimer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Modale Ajouter un vendeur */}
        {modalVendeurOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in-0 duration-200"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={() => setModalVendeurOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-vendeur-title"
          >
            <div
              className="w-full max-w-[380px] animate-in fade-in-0 slide-in-from-bottom-4 duration-200"
              style={{
                borderRadius: 16,
                background: "#111118",
                border: "1px solid #2a2a35",
                padding: 28,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="modal-vendeur-title"
                className="font-display font-bold text-center mb-5"
                style={{ fontSize: 18 }}
              >
                Ajouter un vendeur
              </h2>
              <div className="space-y-4 mb-6">
                <div className="flex flex-col gap-1.5">
                  <label className="field-label">Nom du vendeur</label>
                  <input
                    type="text"
                    value={newVendeurNom}
                    onChange={(e) => setNewVendeurNom(e.target.value)}
                    className="field-input"
                    placeholder="Dupont"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="field-label">Prénom</label>
                  <input
                    type="text"
                    value={newVendeurPrenom}
                    onChange={(e) => setNewVendeurPrenom(e.target.value)}
                    className="field-input"
                    placeholder="Pierre"
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer bg-transparent border border-border"
                  onClick={() => setModalVendeurOpen(false)}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg text-sm font-medium gradient-primary text-primary-foreground cursor-pointer border-0"
                  onClick={handleAddVendeur}
                >
                  Ajouter
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Abonnement */}
        <div className="card-autodocs space-y-4">
          <div className="card-title-autodocs">💳 Abonnement</div>
          <div className="flex items-center justify-between px-3 py-3 bg-secondary rounded-lg border border-border row-hover">
            <div>
              <div className="text-sm font-medium">Plan Pro</div>
              <div className="text-[11px] text-muted-foreground">Bons illimités · Support prioritaire</div>
            </div>
            <button className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all bg-transparent cursor-pointer interactive-lift">
              Gérer
            </button>
          </div>
        </div>
        </div>
      </div>
    </>
  );
};

export default Parametres;
