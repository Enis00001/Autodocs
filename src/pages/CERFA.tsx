import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Download,
  FileText,
  Loader2,
  Trash2,
  Sparkles,
} from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { getCurrentConcessionId, getCurrentUserId } from "@/lib/auth";
import { loadDrafts, type BonDraftData } from "@/utils/drafts";
import {
  loadProfilConcession,
  isProfilCessionComplet,
  type ProfilConcession,
} from "@/utils/profilConcession";
import {
  downloadCerfaPdf,
  generateCERFA,
  type CerfaData,
} from "@/utils/generateCERFA";

/* -------------------------------------------------------------------------- */
/*  Types & constantes                                                        */
/* -------------------------------------------------------------------------- */

const GENRES = [
  { value: "", label: "—" },
  { value: "VP", label: "VP — Voiture particulière" },
  { value: "CTTE", label: "CTTE — Camionnette" },
  { value: "MOTO", label: "MOTO — Motocyclette" },
  { value: "CYCL", label: "CYCL — Cyclomoteur" },
  { value: "VASP", label: "VASP — Véhicule automoteur spécialisé" },
  { value: "CAM", label: "CAM — Camion" },
  { value: "REM", label: "REM — Remorque" },
  { value: "SREM", label: "SREM — Semi-remorque" },
] as const;

type Sexe = "M" | "F" | "";

type CerfaFormState = {
  brouillonId: string;

  // ---- Acheteur ----
  acheteurNom: string;
  acheteurPrenom: string;
  acheteurDateNaissance: string;
  acheteurLieuNaissance: string;
  acheteurAdresse: string;
  acheteurCodePostal: string;
  acheteurVille: string;
  acheteurSexe: Sexe;

  // ---- Véhicule ----
  immatriculation: string;
  vin: string;
  marque: string;
  modele: string;
  typeVariante: string;
  dateMec: string;
  kilometrage: string;
  genre: string;
  certificatPresent: "oui" | "non";
  numeroFormule: string;
  motifAbsenceCi: string;

  // ---- Cession ----
  cessionLieu: string;
  cessionDate: string;
  cessionHeure: string;
  certifSituationAdmin: boolean;
  certifPasTransformation: boolean;
};

type CerfaRow = {
  id: string;
  user_id: string;
  brouillon_id: string | null;
  cerfa_data: Record<string, unknown>;
  pdf_base64: string | null;
  created_at: string;
};

/* -------------------------------------------------------------------------- */
/*  Heuristiques de mapping véhicule                                          */
/* -------------------------------------------------------------------------- */

const FIELD_PATTERNS: Record<string, RegExp[]> = {
  marque: [/^marque$/i, /\bmarque\b/i, /\bbrand\b/i, /\bmake\b/i],
  modele: [/^mod[eè]le$/i, /\bmod[eè]le\b/i, /\bmodel\b/i, /\bd[eé]nomination\b/i],
  type: [/^type$/i, /\btype\b/i, /\bvariante\b/i, /\bversion\b/i],
  immatriculation: [
    /immatriculation/i,
    /\bimmat\b/i,
    /\bimmatriculation\b/i,
    /\bplaque\b/i,
    /\bplate\b/i,
  ],
  vin: [/\bvin\b/i, /ch[âa]ssis/i, /serial/i, /num[ée]ro de s[ée]rie/i],
  dateMec: [
    /1[èe]?re? ?(?:mise )?(?:en )?circulation/i,
    /1 ?ere? ?m[\s.]?e[\s.]?c\b/i,
    /premiere? ?m\.?e\.?c\.?/i,
    /premiere? ?m[\s.]?e[\s.]?c\b/i,
    /\bmec\b/i,
    /\bmise en circulation\b/i,
  ],
  kilometrage: [/kilom[ée]trage/i, /\bkilom[ée]tres?\b/i, /\bkm\b/i, /\bmileage\b/i],
};

function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function findInDonnees(donnees: Record<string, string>, patterns: RegExp[]): string {
  for (const [rawKey, value] of Object.entries(donnees)) {
    if (!value || !value.trim()) continue;
    if (patterns.some((re) => re.test(normalizeKey(rawKey)))) {
      return value.trim();
    }
  }
  return "";
}

function todayFr(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(
    2,
    "0",
  )}/${d.getFullYear()}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function sanitizeFileName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/* -------------------------------------------------------------------------- */
/*  Construction du payload CerfaData attendu par l'API                       */
/* -------------------------------------------------------------------------- */

function buildCerfaData(
  state: CerfaFormState,
  profil: ProfilConcession | null,
): CerfaData {
  return {
    // Véhicule
    immatriculation: state.immatriculation.trim(),
    vin: state.vin.trim(),
    date_mise_en_circulation: state.dateMec.trim(),
    marque: state.marque.trim(),
    type_variante: state.typeVariante.trim(),
    genre: state.genre,
    denomination: state.modele.trim(),
    kilometrage: state.kilometrage.trim(),
    numero_formule:
      state.certificatPresent === "oui" ? state.numeroFormule.trim() : "",
    motif_absence_ci:
      state.certificatPresent === "non" ? state.motifAbsenceCi.trim() : "",

    // Vendeur (concession ⇒ personne morale)
    vendeur_type: "morale",
    vendeur_nom: (profil?.nomConcession ?? "").trim() || "Concession",
    vendeur_siren: (profil?.siren ?? "").trim(),
    vendeur_adresse: (profil?.adresse ?? "").trim(),
    vendeur_code_postal: (profil?.codePostal ?? "").trim(),
    vendeur_ville: (profil?.ville ?? "").trim(),
    cession_date: state.cessionDate.trim(),
    cession_heure: state.cessionHeure.trim(),
    cession_lieu: state.cessionLieu.trim() || (profil?.ville ?? "").trim(),
    cession_motif: "",
    certif_situation_admin: state.certifSituationAdmin,
    certif_pas_transformation: state.certifPasTransformation,
    certif_vhu: false,
    vendeur_agrement_vhu: "",

    // Acheteur (par défaut personne physique)
    acheteur_type: "physique",
    acheteur_sexe: state.acheteurSexe || undefined,
    acheteur_nom: state.acheteurNom.trim(),
    acheteur_prenom: state.acheteurPrenom.trim(),
    acheteur_date_naissance: state.acheteurDateNaissance.trim(),
    acheteur_lieu_naissance: state.acheteurLieuNaissance.trim(),
    acheteur_adresse: state.acheteurAdresse.trim(),
    acheteur_code_postal: state.acheteurCodePostal.trim(),
    acheteur_ville: state.acheteurVille.trim(),
    acheteur_cert_acquerir: true,
    acheteur_cert_informe: true,
  };
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

const emptyState: CerfaFormState = {
  brouillonId: "",
  acheteurNom: "",
  acheteurPrenom: "",
  acheteurDateNaissance: "",
  acheteurLieuNaissance: "",
  acheteurAdresse: "",
  acheteurCodePostal: "",
  acheteurVille: "",
  acheteurSexe: "",
  immatriculation: "",
  vin: "",
  marque: "",
  modele: "",
  typeVariante: "",
  dateMec: "",
  kilometrage: "",
  genre: "",
  certificatPresent: "oui",
  numeroFormule: "",
  motifAbsenceCi: "",
  cessionLieu: "",
  cessionDate: todayFr(),
  cessionHeure: nowHHMM(),
  certifSituationAdmin: false,
  certifPasTransformation: false,
};

const CERFA = () => {
  const [drafts, setDrafts] = useState<BonDraftData[]>([]);
  const [profil, setProfil] = useState<ProfilConcession | null>(null);
  const [profilLoaded, setProfilLoaded] = useState(false);
  const [state, setState] = useState<CerfaFormState>(emptyState);
  const [errors, setErrors] = useState<Set<keyof CerfaFormState>>(new Set());
  const [generating, setGenerating] = useState(false);

  const [history, setHistory] = useState<CerfaRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    void loadDrafts().then(setDrafts);
    void loadProfilConcession().then((p) => {
      setProfil(p);
      setProfilLoaded(true);
      if (p?.ville) {
        setState((s) => (s.cessionLieu ? s : { ...s, cessionLieu: p.ville }));
      }
    });
    void refreshHistory();
  }, []);

  const refreshHistory = async () => {
    setHistoryLoading(true);
    try {
      const concessionId = await getCurrentConcessionId();
      if (!concessionId) {
        setHistory([]);
        return;
      }
      const { data, error } = await supabase
        .from("cerfas")
        .select("*")
        .eq("concession_id", concessionId)
        .order("created_at", { ascending: false });
      if (error) {
        console.error("[cerfa] loadHistory:", error);
        setHistory([]);
        return;
      }
      setHistory((data ?? []) as CerfaRow[]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const draftLookup = useMemo(() => {
    const m = new Map<string, BonDraftData>();
    for (const d of drafts) m.set(d.id, d);
    return m;
  }, [drafts]);

  /* ------------------------ Sélection d'un brouillon ---------------------- */

  const handleSelectDraft = (draftId: string) => {
    const draft = draftLookup.get(draftId);
    if (!draft) {
      setState((s) => ({ ...emptyState, ...s, brouillonId: "" }));
      return;
    }
    const donnees = draft.stockDonnees ?? {};
    const marque = findInDonnees(donnees, FIELD_PATTERNS.marque);
    const modele = findInDonnees(donnees, FIELD_PATTERNS.modele);
    const typeVariante = findInDonnees(donnees, FIELD_PATTERNS.type);
    const immat = findInDonnees(donnees, FIELD_PATTERNS.immatriculation);
    const vin = findInDonnees(donnees, FIELD_PATTERNS.vin);
    const dateMec = findInDonnees(donnees, FIELD_PATTERNS.dateMec);
    const km = findInDonnees(donnees, FIELD_PATTERNS.kilometrage);

    setState((s) => ({
      ...s,
      brouillonId: draft.id,
      acheteurNom: draft.clientNom ?? "",
      acheteurPrenom: draft.clientPrenom ?? "",
      acheteurDateNaissance: draft.clientDateNaissance ?? "",
      acheteurAdresse: draft.clientAdresse ?? "",
      immatriculation: immat,
      vin,
      marque,
      modele,
      typeVariante,
      dateMec,
      kilometrage: km,
    }));
    setErrors(new Set());
  };

  /* ------------------------------ Validation ------------------------------ */

  const validate = (): boolean => {
    const next = new Set<keyof CerfaFormState>();
    if (!state.immatriculation.trim()) next.add("immatriculation");
    if (!state.acheteurNom.trim()) next.add("acheteurNom");
    if (!state.acheteurAdresse.trim()) next.add("acheteurAdresse");
    if (!state.marque.trim()) next.add("marque");
    if (!state.kilometrage.trim()) next.add("kilometrage");
    if (!state.cessionDate.trim()) next.add("cessionDate");
    if (!state.cessionLieu.trim()) next.add("cessionLieu");
    setErrors(next);
    return next.size === 0;
  };

  /* ------------------------------ Génération ------------------------------ */

  const handleGenerate = async () => {
    if (!validate()) {
      toast({
        title: "Champs manquants",
        description:
          "Vérifiez les champs marqués en rouge avant de générer le CERFA.",
        variant: "destructive",
      });
      return;
    }

    setGenerating(true);
    try {
      const cerfaData = buildCerfaData(state, profil);
      const pdfBase64 = await generateCERFA(cerfaData);

      const concessionId = await getCurrentConcessionId();
      const userId = await getCurrentUserId();
      if (concessionId && userId) {
        const { error: insertError } = await supabase.from("cerfas").insert({
          concession_id: concessionId,
          user_id: userId,
          created_by: userId,
          brouillon_id: state.brouillonId || null,
          cerfa_data: cerfaData,
          pdf_base64: pdfBase64,
        });
        if (insertError) {
          console.warn("[cerfa] persist failed:", insertError);
        }
      }

      const fileName = `cerfa-cession-${
        sanitizeFileName(state.immatriculation) || "vehicule"
      }.pdf`;
      downloadCerfaPdf(pdfBase64, fileName);

      toast({ title: "CERFA généré — 2 exemplaires ✓" });
      void refreshHistory();
    } catch (err) {
      console.error("[cerfa] generate:", err);
      toast({
        title: "Échec de la génération",
        description: err instanceof Error ? err.message : "Erreur inconnue.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  /* ------------------------------ Historique ------------------------------ */

  const handleDownloadHistory = (row: CerfaRow) => {
    if (!row.pdf_base64) {
      toast({
        title: "PDF indisponible",
        description: "Ce CERFA n'a pas été persisté en base. Régénérez-le.",
        variant: "destructive",
      });
      return;
    }
    setDownloadingId(row.id);
    try {
      const data = (row.cerfa_data ?? {}) as Partial<CerfaData>;
      const immat = String(data.immatriculation ?? "").trim();
      const fileName = `cerfa-cession-${sanitizeFileName(immat) || "vehicule"}.pdf`;
      downloadCerfaPdf(row.pdf_base64, fileName);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteHistory = async (row: CerfaRow) => {
    if (!window.confirm("Supprimer ce CERFA de l'historique ?")) return;
    setDeletingId(row.id);
    try {
      const { error } = await supabase.from("cerfas").delete().eq("id", row.id);
      if (error) throw error;
      setHistory((h) => h.filter((x) => x.id !== row.id));
      toast({ title: "CERFA supprimé" });
    } catch (err) {
      toast({
        title: "Échec de la suppression",
        description: err instanceof Error ? err.message : "Erreur inconnue.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  /* --------------------------------- UI ---------------------------------- */

  const draftLabel = (d: BonDraftData) => {
    const nom = `${d.clientPrenom ?? ""} ${d.clientNom ?? ""}`.trim();
    const immat = findInDonnees(d.stockDonnees ?? {}, FIELD_PATTERNS.immatriculation);
    if (nom && immat) return `${nom} — ${immat}`;
    if (nom) return nom;
    if (immat) return immat;
    return `Bon du ${new Date(d.createdAt).toLocaleDateString("fr-FR")}`;
  };

  const profilManquant = profilLoaded && !isProfilCessionComplet(profil);

  const errClass = (field: keyof CerfaFormState) =>
    errors.has(field)
      ? "field-input border-destructive ring-1 ring-destructive"
      : "field-input";

  return (
    <>
      <TopBar
        title="CERFA de cession"
        subtitle="Remplit le PDF officiel CERFA 15776*01 (2 exemplaires)"
      />
      <div className="page-shell">
        <div className="page-content space-y-5 max-w-5xl">
          <Tabs defaultValue="nouveau">
            <TabsList className="bg-card">
              <TabsTrigger value="nouveau" className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                Nouveau CERFA
              </TabsTrigger>
              <TabsTrigger value="historique" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Historique
              </TabsTrigger>
            </TabsList>

            {/* ============================================================ */}
            {/*  ONGLET NOUVEAU CERFA                                        */}
            {/* ============================================================ */}
            <TabsContent value="nouveau" className="space-y-5">
              {profilManquant && (
                <div className="card-autodocs flex items-start gap-3 border-amber-500/40 bg-amber-500/5 text-sm">
                  <AlertTriangle
                    className="h-5 w-5 flex-shrink-0 text-amber-400"
                    aria-hidden
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-amber-400">
                      Complétez votre profil concession
                    </div>
                    <p className="text-muted-foreground">
                      Sans nom, adresse, code postal et ville, la section
                      vendeur du CERFA ne sera pas pré-remplie.
                    </p>
                  </div>
                  <Link
                    to="/profil-concession"
                    className="btn-secondary cursor-pointer whitespace-nowrap text-xs"
                  >
                    Compléter
                  </Link>
                </div>
              )}

              {/* ----- Sélecteur brouillon ----- */}
              <div className="card-autodocs space-y-3">
                <div className="card-title-autodocs">
                  Pré-remplir depuis un bon de commande
                </div>
                <select
                  className="field-input"
                  value={state.brouillonId}
                  onChange={(e) => handleSelectDraft(e.target.value)}
                >
                  <option value="">— Saisie manuelle —</option>
                  {drafts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {draftLabel(d)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Pré-remplit acheteur (nom, prénom, date de naissance,
                  adresse) + véhicule (immat, VIN, marque, modèle…).
                </p>
              </div>

              {/* ============================================== */}
              {/*  Section Véhicule                              */}
              {/* ============================================== */}
              <div className="card-autodocs space-y-4">
                <div className="card-title-autodocs">🚗 Véhicule</div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">
                      Immatriculation <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      className={errClass("immatriculation")}
                      placeholder="AB-123-CD"
                      value={state.immatriculation}
                      onChange={(e) =>
                        setState((s) => ({ ...s, immatriculation: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">N° d'identification (VIN)</label>
                    <input
                      type="text"
                      className="field-input"
                      value={state.vin}
                      onChange={(e) =>
                        setState((s) => ({ ...s, vin: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Date 1ère mise en circulation</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="JJ/MM/AAAA"
                      value={state.dateMec}
                      onChange={(e) =>
                        setState((s) => ({ ...s, dateMec: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">
                      Marque <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      className={errClass("marque")}
                      value={state.marque}
                      onChange={(e) =>
                        setState((s) => ({ ...s, marque: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Dénomination commerciale (modèle)</label>
                    <input
                      type="text"
                      className="field-input"
                      value={state.modele}
                      onChange={(e) =>
                        setState((s) => ({ ...s, modele: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Genre national</label>
                    <select
                      className="field-input"
                      value={state.genre}
                      onChange={(e) =>
                        setState((s) => ({ ...s, genre: e.target.value }))
                      }
                    >
                      {GENRES.map((g) => (
                        <option key={g.value} value={g.value}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Type / variante / version</label>
                    <input
                      type="text"
                      className="field-input"
                      value={state.typeVariante}
                      onChange={(e) =>
                        setState((s) => ({ ...s, typeVariante: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">
                      Kilométrage <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      className={errClass("kilometrage")}
                      value={state.kilometrage}
                      onChange={(e) =>
                        setState((s) => ({ ...s, kilometrage: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="field-label">
                      Certificat d'immatriculation présent ?
                    </label>
                    <div className="flex gap-4 pt-1">
                      {(["oui", "non"] as const).map((v) => (
                        <label
                          key={v}
                          className="inline-flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <input
                            type="radio"
                            name="certif-present"
                            value={v}
                            checked={state.certificatPresent === v}
                            onChange={() =>
                              setState((s) => ({ ...s, certificatPresent: v }))
                            }
                          />
                          {v.toUpperCase()}
                        </label>
                      ))}
                    </div>
                  </div>
                  {state.certificatPresent === "oui" ? (
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label className="field-label">
                        N° de formule (carte grise) — 9 caractères max
                      </label>
                      <input
                        type="text"
                        maxLength={9}
                        className="field-input"
                        value={state.numeroFormule}
                        onChange={(e) =>
                          setState((s) => ({ ...s, numeroFormule: e.target.value }))
                        }
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label className="field-label">Motif d'absence</label>
                      <input
                        type="text"
                        className="field-input"
                        value={state.motifAbsenceCi}
                        onChange={(e) =>
                          setState((s) => ({ ...s, motifAbsenceCi: e.target.value }))
                        }
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* ============================================== */}
              {/*  Section Vendeur                               */}
              {/* ============================================== */}
              <div className="card-autodocs space-y-4">
                <div className="card-title-autodocs">
                  🏢 Vendeur (ancien propriétaire)
                </div>
                <p className="text-xs text-muted-foreground">
                  Pré-rempli depuis votre profil concession.
                  Modifiez ces champs depuis{" "}
                  <Link to="/profil-concession" className="underline">
                    Ma concession
                  </Link>
                  .
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="field-label">Raison sociale</label>
                    <input
                      type="text"
                      className="field-input opacity-80"
                      value={profil?.nomConcession ?? ""}
                      readOnly
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">SIREN</label>
                    <input
                      type="text"
                      className="field-input opacity-80"
                      value={profil?.siren ?? ""}
                      readOnly
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Code postal</label>
                    <input
                      type="text"
                      className="field-input opacity-80"
                      value={profil?.codePostal ?? ""}
                      readOnly
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="field-label">Adresse</label>
                    <input
                      type="text"
                      className="field-input opacity-80"
                      value={profil?.adresse ?? ""}
                      readOnly
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Ville</label>
                    <input
                      type="text"
                      className="field-input opacity-80"
                      value={profil?.ville ?? ""}
                      readOnly
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 border-t border-border/40 pt-3 md:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">
                      Date de cession <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      className={errClass("cessionDate")}
                      placeholder="JJ/MM/AAAA"
                      value={state.cessionDate}
                      onChange={(e) =>
                        setState((s) => ({ ...s, cessionDate: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Heure</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="HH:MM"
                      value={state.cessionHeure}
                      onChange={(e) =>
                        setState((s) => ({ ...s, cessionHeure: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">
                      Lieu (Fait à) <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      className={errClass("cessionLieu")}
                      value={state.cessionLieu}
                      onChange={(e) =>
                        setState((s) => ({ ...s, cessionLieu: e.target.value }))
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2 border-t border-border/40 pt-3">
                  <p className="text-xs text-muted-foreground">
                    Cases à cocher (le vendeur certifie en outre…) :
                  </p>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={state.certifSituationAdmin}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          certifSituationAdmin: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      Avoir remis le certificat de situation administrative
                      (- de 15 jours).
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={state.certifPasTransformation}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          certifPasTransformation: e.target.checked,
                        }))
                      }
                    />
                    <span>Véhicule sans transformation notable.</span>
                  </label>
                </div>
              </div>

              {/* ============================================== */}
              {/*  Section Acheteur                              */}
              {/* ============================================== */}
              <div className="card-autodocs space-y-4">
                <div className="card-title-autodocs">
                  👤 Acheteur (nouveau propriétaire)
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="field-label">Sexe</label>
                    <div className="flex gap-4 pt-1">
                      {(["M", "F"] as const).map((v) => (
                        <label
                          key={v}
                          className="inline-flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <input
                            type="radio"
                            name="acheteur-sexe"
                            value={v}
                            checked={state.acheteurSexe === v}
                            onChange={() =>
                              setState((s) => ({ ...s, acheteurSexe: v }))
                            }
                          />
                          {v === "M" ? "Masculin" : "Féminin"}
                        </label>
                      ))}
                      {state.acheteurSexe && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline cursor-pointer"
                          onClick={() =>
                            setState((s) => ({ ...s, acheteurSexe: "" }))
                          }
                        >
                          Effacer
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">
                      Nom <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      className={errClass("acheteurNom")}
                      value={state.acheteurNom}
                      onChange={(e) =>
                        setState((s) => ({ ...s, acheteurNom: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Prénom</label>
                    <input
                      type="text"
                      className="field-input"
                      value={state.acheteurPrenom}
                      onChange={(e) =>
                        setState((s) => ({ ...s, acheteurPrenom: e.target.value }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Date de naissance</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="JJ/MM/AAAA"
                      value={state.acheteurDateNaissance}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          acheteurDateNaissance: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Lieu de naissance</label>
                    <input
                      type="text"
                      className="field-input"
                      value={state.acheteurLieuNaissance}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          acheteurLieuNaissance: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="field-label">
                      Adresse <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      className={errClass("acheteurAdresse")}
                      placeholder="12 rue de la Paix"
                      value={state.acheteurAdresse}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          acheteurAdresse: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Code postal</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={5}
                      className="field-input"
                      value={state.acheteurCodePostal}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          acheteurCodePostal: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Ville</label>
                    <input
                      type="text"
                      className="field-input"
                      value={state.acheteurVille}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          acheteurVille: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </div>

              {/* Bouton générer */}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={generating}
                  className="px-5 py-3 rounded-lg text-sm font-semibold gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 inline-flex items-center gap-2 disabled:opacity-60 disabled:hover:translate-y-0"
                  style={{ boxShadow: "0 0 24px hsla(228,91%,64%,0.3)" }}
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                  {generating
                    ? "Génération en cours…"
                    : "Générer le CERFA (2 exemplaires)"}
                </button>
              </div>
            </TabsContent>

            {/* ============================================================ */}
            {/*  ONGLET HISTORIQUE                                           */}
            {/* ============================================================ */}
            <TabsContent value="historique">
              <div className="card-autodocs -mx-4 overflow-x-auto px-4 md:mx-0 md:px-5">
                {historyLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : history.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Aucun CERFA généré pour l'instant.
                  </div>
                ) : (
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="pb-3 font-medium">Date</th>
                        <th className="pb-3 font-medium">Acheteur</th>
                        <th className="pb-3 font-medium">Immatriculation</th>
                        <th className="pb-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => {
                        const data = (row.cerfa_data ?? {}) as Partial<CerfaData>;
                        const acheteurNom =
                          `${data.acheteur_prenom ?? ""} ${data.acheteur_nom ?? ""}`
                            .trim() || "—";
                        const immat = String(data.immatriculation ?? "—").trim();
                        const isDownloading = downloadingId === row.id;
                        const isDeleting = deletingId === row.id;
                        return (
                          <tr
                            key={row.id}
                            className={cn(
                              "row-hover border-b border-border/50 last:border-0",
                            )}
                          >
                            <td className="py-3 text-muted-foreground">
                              {new Date(row.created_at).toLocaleDateString("fr-FR", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                              })}
                            </td>
                            <td className="py-3 font-medium text-foreground">
                              {acheteurNom}
                            </td>
                            <td className="py-3 font-mono text-muted-foreground">
                              {immat || "—"}
                            </td>
                            <td className="py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  className="btn-secondary cursor-pointer gap-1.5 px-2 py-1.5 text-xs md:px-2.5"
                                  onClick={() => handleDownloadHistory(row)}
                                  disabled={isDownloading || !row.pdf_base64}
                                  aria-label="Télécharger le CERFA"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  <span className="hidden md:inline">
                                    Télécharger
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="btn-danger cursor-pointer gap-1.5 px-2 py-1.5 text-xs md:px-2.5"
                                  onClick={() => void handleDeleteHistory(row)}
                                  disabled={isDeleting}
                                  aria-label="Supprimer le CERFA"
                                >
                                  {isDeleting ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
};

export default CERFA;
