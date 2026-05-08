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
import { getCurrentUserId } from "@/lib/auth";
import { downloadBase64Pdf } from "@/utils/generatePDF";
import { loadDrafts, type BonDraftData } from "@/utils/drafts";
import {
  loadProfilConcession,
  isProfilCessionComplet,
  type ProfilConcession,
} from "@/utils/profilConcession";
import cerfaTemplate from "@/templates/cerfa-cession.html?raw";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type GenreVehicule =
  | ""
  | "VP"
  | "CTTE"
  | "MOTO"
  | "CYCL"
  | "VASP"
  | "CAM"
  | "REM"
  | "SREM";

const GENRES: { value: GenreVehicule; label: string }[] = [
  { value: "", label: "—" },
  { value: "VP", label: "VP — Voiture particulière" },
  { value: "CTTE", label: "CTTE — Camionnette" },
  { value: "MOTO", label: "MOTO — Motocyclette" },
  { value: "CYCL", label: "CYCL — Cyclomoteur" },
  { value: "VASP", label: "VASP — Véhicule automoteur spécialisé" },
  { value: "CAM", label: "CAM — Camion" },
  { value: "REM", label: "REM — Remorque" },
  { value: "SREM", label: "SREM — Semi-remorque" },
];

const ENERGIES = ["", "Essence", "Diesel", "Électrique", "Hybride", "GPL", "GNV"] as const;
type Energie = (typeof ENERGIES)[number];

type Sexe = "M" | "F" | "";

type CerfaFormState = {
  /** ID du brouillon source. */
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
  type: string;
  dateMec: string;
  kilometrage: string;
  genre: GenreVehicule;
  energie: Energie;
  numeroFormule: string;
  dateCertificatImmat: string;

  // ---- Cession ----
  cessionLieu: string;
  cessionDate: string;
  cessionHeure: string;
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
/*  Helpers : extraction & mapping                                            */
/* -------------------------------------------------------------------------- */

const FIELD_PATTERNS: Record<string, RegExp[]> = {
  marque: [/^marque$/i, /\bmarque\b/i, /\bbrand\b/i, /\bmake\b/i],
  modele: [/^mod[eè]le$/i, /\bmod[eè]le\b/i, /\bmodel\b/i, /\bd[eé]nomination\b/i],
  type: [/^type$/i, /\btype\b/i, /\bvariante\b/i, /\bversion\b/i],
  immatriculation: [/immatriculation/i, /\bplaque\b/i, /\bplate\b/i],
  vin: [/\bvin\b/i, /ch[âa]ssis/i, /serial/i, /num[ée]ro de s[ée]rie/i],
  dateMec: [
    /1[èe]?re? ?(?:mise )?(?:en )?circulation/i,
    /\bmec\b/i,
    /\bmise en circulation\b/i,
  ],
  kilometrage: [/kilom[ée]trage/i, /\bkilom[ée]tres?\b/i, /\bkm\b/i, /\bmileage\b/i],
};

function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
/*  Helpers : remplissage du template                                         */
/* -------------------------------------------------------------------------- */

/**
 * Remplit le template HTML CERFA avec les variables passées en paramètre.
 * Les valeurs sont escapées pour éviter toute injection HTML, puis
 * insérées dans les `{{PLACEHOLDER}}`. Tout placeholder restant est
 * remplacé par une chaîne vide.
 */
function fillCerfaTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let html = template;
  for (const [key, raw] of Object.entries(vars)) {
    const value = escapeHtml(String(raw ?? ""));
    html = html.replaceAll(`{{${key}}}`, value);
  }
  html = html.replace(/\{\{[A-Z0-9_]+\}\}/g, "");
  return html;
}

function buildCerfaVariables(state: CerfaFormState, profil: ProfilConcession | null) {
  const cb = (active: boolean) => (active ? "☑" : "☐");

  const vendeurNom =
    (profil?.nomConcession ?? "").trim() || "Concession";
  const vendeurAdresse = (profil?.adresse ?? "").trim();
  const vendeurCp = (profil?.codePostal ?? "").trim();
  const vendeurVille = (profil?.ville ?? "").trim();
  const vendeurSiren = (profil?.siren ?? "").trim();

  const hasNumeroFormule = state.numeroFormule.trim() !== "";

  return {
    // Véhicule
    VEHICULE_IMMATRICULATION: state.immatriculation.trim(),
    VEHICULE_VIN: state.vin.trim(),
    VEHICULE_DATE_MEC: state.dateMec.trim(),
    VEHICULE_MARQUE: state.marque.trim(),
    VEHICULE_TYPE: state.type.trim(),
    VEHICULE_GENRE: state.genre,
    VEHICULE_MODELE: state.modele.trim(),
    VEHICULE_KILOMETRAGE: state.kilometrage.trim(),
    VEHICULE_CI_OUI: cb(hasNumeroFormule),
    VEHICULE_CI_NON: cb(!hasNumeroFormule),
    VEHICULE_NUMERO_FORMULE: state.numeroFormule.trim(),
    VEHICULE_DATE_CI: state.dateCertificatImmat.trim(),
    VEHICULE_MOTIF_ABSENCE_CI: "",

    // Vendeur (concession ⇒ personne morale par défaut)
    VENDEUR_TYPE_PHYSIQUE: cb(false),
    VENDEUR_TYPE_MORALE: cb(true),
    VENDEUR_SEXE_M: cb(false),
    VENDEUR_SEXE_F: cb(false),
    VENDEUR_NOM: vendeurNom,
    VENDEUR_SIREN: vendeurSiren,
    VENDEUR_ADRESSE: vendeurAdresse,
    VENDEUR_CODE_POSTAL: vendeurCp,
    VENDEUR_VILLE: vendeurVille,
    VENDEUR_CESSION: cb(true),
    VENDEUR_DESTRUCTION: cb(false),
    VENDEUR_CERT_SITUATION: cb(false),
    VENDEUR_CERT_NON_TRANSFO: cb(false),
    VENDEUR_CERT_VHU: cb(false),
    VENDEUR_VHU_AGREMENT: "",

    // Acheteur
    ACHETEUR_TYPE_PHYSIQUE: cb(true),
    ACHETEUR_TYPE_MORALE: cb(false),
    ACHETEUR_SEXE_M: cb(state.acheteurSexe === "M"),
    ACHETEUR_SEXE_F: cb(state.acheteurSexe === "F"),
    ACHETEUR_NOM: state.acheteurNom.trim(),
    ACHETEUR_PRENOM: state.acheteurPrenom.trim(),
    ACHETEUR_SIRET: "",
    ACHETEUR_DATE_NAISSANCE: state.acheteurDateNaissance.trim(),
    ACHETEUR_LIEU_NAISSANCE: state.acheteurLieuNaissance.trim(),
    ACHETEUR_ADRESSE: state.acheteurAdresse.trim(),
    ACHETEUR_CODE_POSTAL: state.acheteurCodePostal.trim(),
    ACHETEUR_VILLE: state.acheteurVille.trim(),
    ACHETEUR_CERT_ACQUERIR: cb(true),
    ACHETEUR_CERT_INFO: cb(true),

    // Cession
    CESSION_DATE: state.cessionDate.trim(),
    CESSION_HEURE: state.cessionHeure.trim(),
    CESSION_LIEU: state.cessionLieu.trim(),
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
  type: "",
  dateMec: "",
  kilometrage: "",
  genre: "",
  energie: "",
  numeroFormule: "",
  dateCertificatImmat: "",
  cessionLieu: "",
  cessionDate: todayFr(),
  cessionHeure: nowHHMM(),
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

  // Chargement initial : brouillons + profil + historique CERFA
  useEffect(() => {
    void loadDrafts().then(setDrafts);
    void loadProfilConcession().then((p) => {
      setProfil(p);
      setProfilLoaded(true);
      // Pré-remplir le lieu de cession avec la ville de la concession.
      if (p?.ville) {
        setState((s) => (s.cessionLieu ? s : { ...s, cessionLieu: p.ville }));
      }
    });
    void refreshHistory();
  }, []);

  const refreshHistory = async () => {
    setHistoryLoading(true);
    try {
      const userId = await getCurrentUserId();
      if (!userId) {
        setHistory([]);
        return;
      }
      const { data, error } = await supabase
        .from("cerfas")
        .select("*")
        .eq("user_id", userId)
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

  // Lookup map brouillon_id → label « Prénom Nom — Immat » pour l'historique
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
    const type = findInDonnees(donnees, FIELD_PATTERNS.type);
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
      // L'adresse du brouillon est libre (peut contenir CP+ville). On la met
      // dans le champ adresse, le commercial complétera CP/ville s'il faut.
      acheteurAdresse: draft.clientAdresse ?? "",
      immatriculation: immat,
      vin,
      marque,
      modele,
      type,
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
    setErrors(next);
    return next.size === 0;
  };

  /* ------------------------------ Génération ------------------------------ */

  const handleGenerate = async () => {
    if (!validate()) {
      toast({
        title: "Champs manquants",
        description:
          "Immatriculation, nom de l'acheteur et adresse de l'acheteur sont requis.",
        variant: "destructive",
      });
      return;
    }

    setGenerating(true);
    try {
      const variables = buildCerfaVariables(state, profil);
      const html = fillCerfaTemplate(cerfaTemplate, variables);

      const { apiFetch } = await import("@/lib/apiClient");
      const response = await apiFetch("/api/generate-pdf", {
        method: "POST",
        body: JSON.stringify({ html }),
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errBody?.error || `Erreur génération CERFA (${response.status})`,
        );
      }

      const json = (await response.json()) as { pdfBase64?: string };
      if (!json.pdfBase64) throw new Error("Réponse invalide du serveur PDF.");

      const userId = await getCurrentUserId();
      if (userId) {
        const { error: insertError } = await supabase.from("cerfas").insert({
          user_id: userId,
          brouillon_id: state.brouillonId || null,
          cerfa_data: { ...variables, _state: state },
          pdf_base64: json.pdfBase64,
        });
        if (insertError) {
          console.warn("[cerfa] persist failed:", insertError);
        }
      }

      const fileName = `cerfa-cession-${
        sanitizeFileName(state.immatriculation) || "vehicule"
      }.pdf`;
      downloadBase64Pdf(json.pdfBase64, fileName);

      toast({ title: "CERFA généré ✓" });
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
      const data = (row.cerfa_data ?? {}) as Record<string, string>;
      const immat = String(data.VEHICULE_IMMATRICULATION ?? "").trim();
      const fileName = `cerfa-cession-${sanitizeFileName(immat) || "vehicule"}.pdf`;
      downloadBase64Pdf(row.pdf_base64, fileName);
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
    errors.has(field) ? "field-input border-destructive ring-1 ring-destructive" : "field-input";

  return (
    <>
      <TopBar
        title="CERFA de cession"
        subtitle="Générez et archivez les certificats de cession (CERFA 15776*01)"
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
                      vendeur du CERFA ne pourra pas être pré-remplie.
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

              {/* ----- Étape 1 : Sélection bon de commande ----- */}
              <div className="card-autodocs space-y-3">
                <div className="card-title-autodocs">
                  1. Sélectionner un bon de commande
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="field-label">Bon de commande source</label>
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
                    Les champs acheteur et véhicule seront pré-remplis.
                    Vous pourrez ensuite compléter les informations manquantes.
                  </p>
                </div>
              </div>

              {/* ----- Étape 2 : Champs ----- */}
              <div className="card-autodocs space-y-4">
                <div className="card-title-autodocs">2. Compléter les champs</div>

                {/* Acheteur */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Acheteur
                  </h3>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                        placeholder="Ville"
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
                        className="field-input"
                        inputMode="numeric"
                        maxLength={5}
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
                          setState((s) => ({ ...s, acheteurVille: e.target.value }))
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label className="field-label">Sexe</label>
                      <div className="flex gap-4 pt-1">
                        {(["M", "F"] as const).map((s) => (
                          <label
                            key={s}
                            className="inline-flex cursor-pointer items-center gap-2 text-sm"
                          >
                            <input
                              type="radio"
                              name="acheteur-sexe"
                              value={s}
                              checked={state.acheteurSexe === s}
                              onChange={() =>
                                setState((curr) => ({ ...curr, acheteurSexe: s }))
                              }
                            />
                            {s === "M" ? "Masculin" : "Féminin"}
                          </label>
                        ))}
                        {state.acheteurSexe && (
                          <button
                            type="button"
                            className="text-xs text-muted-foreground underline cursor-pointer"
                            onClick={() =>
                              setState((curr) => ({ ...curr, acheteurSexe: "" }))
                            }
                          >
                            Effacer
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Véhicule */}
                <div className="space-y-3 pt-2 border-t border-border/40">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Véhicule
                  </h3>
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
                      <label className="field-label">VIN / N° série</label>
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
                      <label className="field-label">Marque</label>
                      <input
                        type="text"
                        className="field-input"
                        value={state.marque}
                        onChange={(e) =>
                          setState((s) => ({ ...s, marque: e.target.value }))
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">Modèle</label>
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
                      <label className="field-label">Type / variante / version</label>
                      <input
                        type="text"
                        className="field-input"
                        value={state.type}
                        onChange={(e) =>
                          setState((s) => ({ ...s, type: e.target.value }))
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
                      <label className="field-label">Kilométrage</label>
                      <input
                        type="text"
                        className="field-input"
                        inputMode="numeric"
                        value={state.kilometrage}
                        onChange={(e) =>
                          setState((s) => ({ ...s, kilometrage: e.target.value }))
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">Genre national</label>
                      <select
                        className="field-input"
                        value={state.genre}
                        onChange={(e) =>
                          setState((s) => ({
                            ...s,
                            genre: e.target.value as GenreVehicule,
                          }))
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
                      <label className="field-label">Énergie</label>
                      <select
                        className="field-input"
                        value={state.energie}
                        onChange={(e) =>
                          setState((s) => ({
                            ...s,
                            energie: e.target.value as Energie,
                          }))
                        }
                      >
                        {ENERGIES.map((e) => (
                          <option key={e || "_empty"} value={e}>
                            {e || "—"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">N° de formule (carte grise)</label>
                      <input
                        type="text"
                        className="field-input"
                        value={state.numeroFormule}
                        onChange={(e) =>
                          setState((s) => ({ ...s, numeroFormule: e.target.value }))
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">
                        Date du certificat d'immat. (ancien format)
                      </label>
                      <input
                        type="text"
                        className="field-input"
                        placeholder="JJ/MM/AAAA"
                        value={state.dateCertificatImmat}
                        onChange={(e) =>
                          setState((s) => ({
                            ...s,
                            dateCertificatImmat: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Cession */}
                <div className="space-y-3 pt-2 border-t border-border/40">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Cession
                  </h3>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">Lieu (ville)</label>
                      <input
                        type="text"
                        className="field-input"
                        value={state.cessionLieu}
                        onChange={(e) =>
                          setState((s) => ({ ...s, cessionLieu: e.target.value }))
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">Date</label>
                      <input
                        type="text"
                        className="field-input"
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
                  {generating ? "Génération en cours…" : "Générer le CERFA"}
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
                        const data = (row.cerfa_data ?? {}) as Record<string, string>;
                        const acheteurNom =
                          `${data.ACHETEUR_PRENOM ?? ""} ${data.ACHETEUR_NOM ?? ""}`
                            .trim() || "—";
                        const immat = String(
                          data.VEHICULE_IMMATRICULATION ?? "—",
                        ).trim();
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
