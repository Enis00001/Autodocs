import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  Building2,
  MapPin,
  Hash,
  Phone,
  Loader2,
  Save,
  Mail,
  Upload,
  User as UserIcon,
  KeyRound,
  CreditCard,
  Sparkles,
  Zap,
  Check,
  ArrowRight,
  Star,
  Users,
  UserPlus,
  Shield,
  Ban,
  CircleCheck,
} from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { toast } from "@/hooks/use-toast";
import {
  emptyProfilConcession,
  loadProfilConcession,
  saveProfilConcession,
  type ProfilConcession as ProfilConcessionData,
} from "@/utils/profilConcession";
import { loadConcession, saveConcession, type ConcessionData } from "@/utils/concession";
import {
  loadAbonnement,
  startCheckout,
  QUOTA_GRATUIT,
  type AbonnementInfo,
  type CheckoutInterval,
} from "@/utils/abonnement";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/apiClient";
import { useAuth } from "@/context/AuthContext";

const ACCEPT_LOGO = "image/jpeg,image/png,image/svg+xml,.jpg,.jpeg,.png,.svg";

type GerantInfos = {
  prenom: string;
  nom: string;
  email: string;
};

const ProfilConcession = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const abonnementSectionRef = useRef<HTMLDivElement>(null);
  const { concessionId, membreRole } = useAuth();
  const isAdminMembre = membreRole === "admin";
  const lockConcessionFields = !isAdminMembre;

  // ---- Section 1 — Identité légale + logo
  const [profil, setProfil] = useState<ProfilConcessionData>(emptyProfilConcession);
  const [concession, setConcession] = useState<ConcessionData>({
    name: "",
    address: "",
  });
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ---- Section 2 — Mon compte (gérant)
  const [gerant, setGerant] = useState<GerantInfos>({
    prenom: "",
    nom: "",
    email: "",
  });
  const [savingGerant, setSavingGerant] = useState(false);
  const [sendingResetMail, setSendingResetMail] = useState(false);

  type TeamMemberRow = {
    id: string;
    user_id: string;
    email: string | null;
    prenom: string | null;
    nom: string | null;
    role: string;
    actif: boolean;
  };

  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<{ id: string; email: string; created_at: string }[]>(
    [],
  );
  const [teamLoading, setTeamLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmailInput, setInviteEmailInput] = useState("");
  const [inviteSending, setInviteSending] = useState(false);

  // ---- Section 3 — Abonnement
  const [abonnement, setAbonnement] = useState<AbonnementInfo | null>(null);
  const [abonnementLoading, setAbonnementLoading] = useState(true);
  const [submittingPlan, setSubmittingPlan] = useState<CheckoutInterval | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [profilData, concessionData, abonnementData, userResult] = await Promise.all([
        loadProfilConcession(),
        loadConcession(),
        loadAbonnement(),
        supabase.auth.getUser(),
      ]);
      if (!active) return;
      if (profilData) setProfil(profilData);
      setConcession(concessionData);
      setAbonnement(abonnementData);
      const meta = (userResult.data.user?.user_metadata ?? {}) as Record<string, unknown>;
      setGerant({
        prenom: typeof meta.gerant_prenom === "string" ? meta.gerant_prenom : "",
        nom: typeof meta.gerant_nom === "string" ? meta.gerant_nom : "",
        email: userResult.data.user?.email ?? "",
      });
      setAbonnementLoading(false);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Auto-scroll vers la section Abonnement quand on arrive avec
  // /profil-concession#abonnement (depuis la sidebar mobile, un CTA ou
  // un redirect /abonnement → /profil-concession#abonnement).
  useEffect(() => {
    if (loading) return;
    if (location.hash !== "#abonnement") return;
    const el = abonnementSectionRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [loading, location.hash]);

  // Feedback retour Stripe lorsqu'un utilisateur revient ici avec
  // ?status=success / ?status=cancel (cas du redirect depuis /abonnement
  // s'il n'y a pas de ?plan à consommer).
  useEffect(() => {
    const status = searchParams.get("status");
    if (status === "success") {
      toast({
        title: "Merci !",
        description: "Votre abonnement Pro est en cours d'activation.",
      });
      searchParams.delete("status");
      searchParams.delete("interval");
      setSearchParams(searchParams, { replace: true });
    } else if (status === "cancel") {
      toast({
        title: "Paiement annulé",
        description: "Vous pouvez reprendre quand vous voulez.",
      });
      searchParams.delete("status");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const reloadTeam = useCallback(async () => {
    if (!concessionId || !isAdminMembre) {
      setTeamMembers([]);
      setPendingInvites([]);
      setTeamLoading(false);
      return;
    }
    setTeamLoading(true);
    const [memRes, invRes] = await Promise.all([
      supabase
        .from("membres_concession")
        .select("id, user_id, email, prenom, nom, role, actif")
        .eq("concession_id", concessionId)
        .order("created_at", { ascending: true }),
      supabase
        .from("invitations")
        .select("id, email, created_at")
        .eq("concession_id", concessionId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false }),
    ]);
    if (!memRes.error && memRes.data) {
      setTeamMembers(memRes.data as TeamMemberRow[]);
    } else {
      setTeamMembers([]);
    }
    if (!invRes.error && invRes.data) {
      setPendingInvites(invRes.data as { id: string; email: string; created_at: string }[]);
    } else {
      setPendingInvites([]);
    }
    setTeamLoading(false);
  }, [concessionId, isAdminMembre]);

  useEffect(() => {
    void reloadTeam();
  }, [reloadTeam]);

  // ---- Section 1 helpers
  const updateProfil = <K extends keyof ProfilConcessionData>(
    key: K,
    value: ProfilConcessionData[K],
  ) => setProfil((p) => ({ ...p, [key]: value }));

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

  const handleSaveConcession = async () => {
    setSaving(true);
    try {
      // Le `nom` court de la table `concession` (utilisé par la sidebar/avatar)
      // est aligné sur le nom officiel saisi dans le profil. L'`adresse` courte
      // reprend "adresse — CP ville" tronqué pour rester lisible dans la nav.
      const shortAddress = [profil.adresse, [profil.codePostal, profil.ville].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
      await Promise.all([
        saveProfilConcession(profil),
        saveConcession({
          name: profil.nomConcession.trim() || concession.name,
          address: shortAddress || concession.address,
          logoBase64: concession.logoBase64,
        }),
      ]);
      toast({ title: "Concession sauvegardée ✓" });
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

  // ---- Section 2 helpers
  const handleSaveGerant = async () => {
    setSavingGerant(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          gerant_prenom: gerant.prenom.trim(),
          gerant_nom: gerant.nom.trim(),
        },
      });
      if (error) throw error;
      toast({ title: "Compte mis à jour ✓" });
    } catch (err) {
      toast({
        title: "Mise à jour impossible",
        description:
          err instanceof Error ? err.message : "Réessayez dans un instant.",
        variant: "destructive",
      });
    } finally {
      setSavingGerant(false);
    }
  };

  const handleSendResetPasswordMail = async () => {
    if (!gerant.email) {
      toast({
        title: "Email indisponible",
        description: "Aucune adresse email associée à ce compte.",
        variant: "destructive",
      });
      return;
    }
    setSendingResetMail(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(gerant.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error && !/rate.?limit|too.?many/i.test(error.message)) {
        throw error;
      }
      toast({
        title: "Email envoyé ✓",
        description: `Un lien de réinitialisation a été envoyé à ${gerant.email}.`,
      });
    } catch (err) {
      toast({
        title: "Envoi impossible",
        description:
          err instanceof Error ? err.message : "Réessayez dans quelques minutes.",
        variant: "destructive",
      });
    } finally {
      setSendingResetMail(false);
    }
  };

  const handleSendInvite = async () => {
    const email = inviteEmailInput.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({
        title: "Email invalide",
        description: "Vérifiez l'adresse saisie.",
        variant: "destructive",
      });
      return;
    }
    setInviteSending(true);
    try {
      const res = await apiFetch("/api/actions", {
        method: "POST",
        body: JSON.stringify({ action: "invite-membre", email }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Invitation impossible.");
      toast({ title: "Invitation envoyée ✓" });
      setInviteOpen(false);
      setInviteEmailInput("");
      await reloadTeam();
    } catch (err) {
      toast({
        title: "Invitation impossible",
        description: err instanceof Error ? err.message : "Réessayez.",
        variant: "destructive",
      });
    } finally {
      setInviteSending(false);
    }
  };

  const handleToggleMemberActif = async (memberId: string, nextActif: boolean) => {
    const { error } = await supabase.from("membres_concession").update({ actif: nextActif }).eq("id", memberId);
    if (error) {
      toast({
        title: "Mise à jour impossible",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: nextActif ? "Membre réactivé ✓" : "Membre désactivé ✓" });
    await reloadTeam();
  };

  // ---- Section 3 helpers
  const handleUpgrade = useCallback(async (interval: CheckoutInterval) => {
    setSubmittingPlan(interval);
    try {
      await startCheckout(interval);
    } catch (err) {
      toast({
        title: "Paiement indisponible",
        description: err instanceof Error ? err.message : "Réessayez plus tard.",
        variant: "destructive",
      });
      setSubmittingPlan(null);
    }
  }, []);

  const plan = abonnement?.plan ?? "gratuit";
  const isPro = plan === "pro";
  const isAdmin = abonnement?.isAdmin ?? false;
  const bons = abonnement?.bonsTotal ?? 0;
  const remainingFreeBons = Math.max(0, QUOTA_GRATUIT - bons);
  const percent = Math.min(100, (bons / QUOTA_GRATUIT) * 100);
  const renewal = abonnement?.dateRenouvellement
    ? new Date(abonnement.dateRenouvellement).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <>
      <TopBar
        title="Ma concession"
        subtitle="Identité légale, compte gérant et abonnement"
      />
      <div className="page-shell">
        <div className="page-content space-y-5 max-w-3xl">
          {loading ? (
            <div className="card-autodocs flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* ============================================================
                  Section 1 — Informations de la concession
                  ============================================================ */}
              <section
                id="concession"
                aria-labelledby="section-concession-title"
                className="card-autodocs space-y-4"
              >
                <div id="section-concession-title" className="card-title-autodocs">
                  🏢 Informations de la concession
                </div>

                <div
                  className={cn(
                    "grid grid-cols-1 gap-3 md:grid-cols-2",
                    lockConcessionFields && "pointer-events-none opacity-70 select-none",
                  )}
                >
                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="field-label">
                      Nom de la concession <span className="text-destructive">*</span>
                    </label>
                    <div className="relative">
                      <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={profil.nomConcession}
                        onChange={(e) => updateProfil("nomConcession", e.target.value)}
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
                        onChange={(e) => updateProfil("adresse", e.target.value)}
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
                      onChange={(e) => updateProfil("codePostal", e.target.value)}
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
                      onChange={(e) => updateProfil("ville", e.target.value)}
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
                        onChange={(e) => updateProfil("siren", e.target.value)}
                        placeholder="123 456 789"
                        className="field-input pl-10"
                        inputMode="numeric"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">SIRET</label>
                    <div className="relative">
                      <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={profil.siret}
                        onChange={(e) => updateProfil("siret", e.target.value)}
                        placeholder="123 456 789 00012"
                        className="field-input pl-10"
                        inputMode="numeric"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="field-label">N° TVA intracommunautaire</label>
                    <input
                      type="text"
                      value={profil.tvaIntracommunautaire}
                      onChange={(e) => updateProfil("tvaIntracommunautaire", e.target.value)}
                      placeholder="FR XX XXX XXX XXX"
                      className="field-input"
                      autoComplete="off"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="field-label">Email affiché sur factures</label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="email"
                        value={profil.emailContact}
                        onChange={(e) => updateProfil("emailContact", e.target.value)}
                        placeholder="contact@ma-concession.fr"
                        className="field-input pl-10"
                        autoComplete="email"
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
                        onChange={(e) => updateProfil("telephone", e.target.value)}
                        placeholder="04 00 00 00 00"
                        className="field-input pl-10"
                        autoComplete="tel"
                      />
                    </div>
                  </div>

                  <div className="col-span-1 flex flex-col gap-1.5 md:col-span-2">
                    <label className="field-label">Logo de la concession</label>
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
                      disabled={lockConcessionFields}
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
                          <span className="text-sm">Uploader un logo</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {!lockConcessionFields ? (
                  <button
                    type="button"
                    onClick={() => void handleSaveConcession()}
                    disabled={saving}
                    className="px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 inline-flex items-center gap-2 disabled:opacity-60 disabled:hover:translate-y-0"
                    style={{ boxShadow: "0 0 20px hsla(228,91%,64%,0.25)" }}
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {saving ? "Sauvegarde…" : "Sauvegarder la concession"}
                  </button>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Seul l&apos;administrateur peut modifier l&apos;identité légale et le logo.
                  </p>
                )}

                <p className="text-xs text-muted-foreground">
                  Ces informations pré-remplissent le CERFA 15776*01, les bons de
                  commande et les factures PDF (SIRET, TVA, coordonnées). Le logo
                  apparaît sur vos documents.
                </p>
              </section>

              {/* ============================================================
                  Section 2 — Mon compte (gérant)
                  ============================================================ */}
              <section
                id="compte"
                aria-labelledby="section-compte-title"
                className="card-autodocs space-y-4"
              >
                <div id="section-compte-title" className="card-title-autodocs">
                  👤 Mon compte
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Prénom du gérant</label>
                    <div className="relative">
                      <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={gerant.prenom}
                        onChange={(e) => setGerant((g) => ({ ...g, prenom: e.target.value }))}
                        placeholder="Jean"
                        className="field-input pl-10"
                        autoComplete="given-name"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="field-label">Nom du gérant</label>
                    <div className="relative">
                      <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={gerant.nom}
                        onChange={(e) => setGerant((g) => ({ ...g, nom: e.target.value }))}
                        placeholder="Dupont"
                        className="field-input pl-10"
                        autoComplete="family-name"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 md:col-span-2">
                    <label className="field-label">
                      Email de connexion <span className="text-muted-foreground/70 text-[11px]">(non modifiable)</span>
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="email"
                        value={gerant.email}
                        readOnly
                        disabled
                        className="field-input pl-10 cursor-not-allowed opacity-70"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                  <button
                    type="button"
                    onClick={() => void handleSaveGerant()}
                    disabled={savingGerant}
                    className="px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:hover:translate-y-0"
                    style={{ boxShadow: "0 0 20px hsla(228,91%,64%,0.25)" }}
                  >
                    {savingGerant ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {savingGerant ? "Sauvegarde…" : "Sauvegarder le compte"}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleSendResetPasswordMail()}
                    disabled={sendingResetMail || !gerant.email}
                    className="btn-secondary cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {sendingResetMail ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    {sendingResetMail ? "Envoi…" : "Changer le mot de passe"}
                  </button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Le changement de mot de passe se fait par email sécurisé : un
                  lien de réinitialisation est envoyé à votre adresse de
                  connexion.
                </p>
              </section>

              {/* ============================================================
                  Section 2bis — Équipe (admin uniquement)
                  ============================================================ */}
              {isAdminMembre ? (
                <section className="card-autodocs space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="card-title-autodocs mb-0 flex items-center gap-2">
                      <Users className="h-5 w-5 text-primary" />
                      Mon équipe
                    </div>
                    <button
                      type="button"
                      onClick={() => setInviteOpen(true)}
                      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer border-0"
                    >
                      <UserPlus className="h-4 w-4" />
                      Inviter un commercial
                    </button>
                  </div>

                  {teamLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto rounded-input border border-border/60">
                        <table className="w-full text-sm">
                          <thead className="border-b border-border/60 bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-semibold">Membre</th>
                              <th className="px-3 py-2 font-semibold">Email</th>
                              <th className="px-3 py-2 font-semibold">Rôle</th>
                              <th className="px-3 py-2 font-semibold">Statut</th>
                              <th className="px-3 py-2 font-semibold text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teamMembers.map((m) => (
                              <tr key={m.id} className="border-b border-border/40 last:border-0">
                                <td className="px-3 py-2.5 font-medium text-foreground">
                                  {[m.prenom, m.nom].filter(Boolean).join(" ") || "—"}
                                </td>
                                <td className="px-3 py-2.5 text-muted-foreground">{m.email ?? "—"}</td>
                                <td className="px-3 py-2.5">
                                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                    <Shield className="h-3 w-3" />
                                    {m.role === "admin" ? "Administrateur" : "Commercial"}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5">
                                  {m.actif ? (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                                      <CircleCheck className="h-3.5 w-3.5" />
                                      Actif
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                                      <Ban className="h-3.5 w-3.5" />
                                      Inactif
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  <button
                                    type="button"
                                    className="text-xs font-medium text-primary hover:underline cursor-pointer bg-transparent border-0"
                                    onClick={() =>
                                      void handleToggleMemberActif(m.id, !m.actif)
                                    }
                                  >
                                    {m.actif ? "Désactiver" : "Réactiver"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {pendingInvites.length > 0 ? (
                        <div className="rounded-input border border-dashed border-border/70 bg-secondary/20 px-3 py-3">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Invitations en attente
                          </div>
                          <ul className="space-y-1 text-sm text-muted-foreground">
                            {pendingInvites.map((inv) => (
                              <li key={inv.id}>
                                <span className="text-foreground">{inv.email}</span>
                                <span className="mx-2 text-border">·</span>
                                envoyée le{" "}
                                {new Date(inv.created_at).toLocaleDateString("fr-FR")}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  )}
                </section>
              ) : null}

              {inviteOpen ? (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4">
                  <div className="card-autodocs w-full max-w-md space-y-4 shadow-xl">
                    <div className="card-title-autodocs mb-0">Inviter un commercial</div>
                    <p className="text-sm text-muted-foreground">
                      Un email d&apos;invitation sera envoyé avec un lien sécurisé valable 7 jours.
                    </p>
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">Email du collaborateur</label>
                      <input
                        type="email"
                        className="field-input"
                        value={inviteEmailInput}
                        onChange={(e) => setInviteEmailInput(e.target.value)}
                        placeholder="commercial@exemple.fr"
                        autoComplete="off"
                      />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className="btn-secondary cursor-pointer border-0"
                        onClick={() => {
                          setInviteOpen(false);
                          setInviteEmailInput("");
                        }}
                        disabled={inviteSending}
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        className="gradient-primary rounded-lg px-4 py-2 text-[13px] font-medium text-primary-foreground border-0 cursor-pointer disabled:opacity-60"
                        disabled={inviteSending}
                        onClick={() => void handleSendInvite()}
                      >
                        {inviteSending ? "Envoi…" : "Envoyer l'invitation"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* ============================================================
                  Section 3 — Abonnement
                  ============================================================ */}
              <section
                id="abonnement"
                ref={abonnementSectionRef}
                aria-labelledby="section-abonnement-title"
                className="space-y-4 scroll-mt-20"
              >
                <div className="flex items-center justify-between">
                  <h2
                    id="section-abonnement-title"
                    className="font-display text-base font-bold tracking-tight text-foreground"
                  >
                    💳 Abonnement
                  </h2>
                </div>

                {!isAdminMembre ? (
                  <p className="text-xs text-muted-foreground">
                    L&apos;abonnement et les paiements sont gérés par l&apos;administrateur de la
                    concession. Vous bénéficiez du même plan et du même quota que toute l&apos;équipe.
                  </p>
                ) : null}

                {abonnementLoading ? (
                  <div className="card-autodocs space-y-3">
                    <div className="skeleton h-6 w-40 rounded" />
                    <div className="skeleton h-4 w-full rounded" />
                    <div className="skeleton h-4 w-3/4 rounded" />
                  </div>
                ) : (
                  <>
                    <div
                      className={cn(
                        "card-autodocs flex flex-col gap-4 border md:flex-row md:items-center md:justify-between",
                        isPro ? "border-primary/30 bg-primary/5" : "border-border/60",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "flex h-12 w-12 items-center justify-center rounded-input",
                            isPro
                              ? "bg-primary/20 text-primary"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          {isPro ? (
                            <Sparkles className="h-6 w-6" />
                          ) : (
                            <CreditCard className="h-6 w-6" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-display text-lg font-bold text-foreground">
                              {isPro ? "Plan Pro" : "Plan Gratuit"}
                            </h3>
                            {isPro && (
                              <span className="rounded-full bg-primary/15 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-primary">
                                Pro
                              </span>
                            )}
                            {!isPro && isAdmin && (
                              <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-violet-300">
                                Admin
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {isPro
                              ? renewal
                                ? `Renouvellement le ${renewal}`
                                : "Abonnement actif"
                              : isAdmin
                                ? "Bons de commande illimités (compte administrateur)"
                                : `${QUOTA_GRATUIT} bons de commande offerts`}
                          </p>
                        </div>
                      </div>

                      {!isPro && !isAdmin && isAdminMembre && (
                        <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
                          <button
                            type="button"
                            className="btn-secondary w-full cursor-pointer md:w-auto"
                            onClick={() => handleUpgrade("monthly")}
                            disabled={submittingPlan !== null}
                          >
                            <Zap className="h-4 w-4" />
                            {submittingPlan === "monthly" ? "Redirection…" : "Mensuel — 49 €/mois"}
                          </button>
                          <button
                            type="button"
                            className="btn-primary w-full cursor-pointer md:w-auto"
                            onClick={() => handleUpgrade("annual")}
                            disabled={submittingPlan !== null}
                          >
                            <Star className="h-4 w-4 fill-current" />
                            {submittingPlan === "annual"
                              ? "Redirection…"
                              : "Annuel — 399 €/an · 2 mois offerts"}
                          </button>
                        </div>
                      )}
                    </div>

                    {!isPro && !isAdmin && isAdminMembre && (
                      <div className="card-autodocs space-y-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold text-foreground">Quota gratuit</span>
                          <span className="tabular-nums text-muted-foreground">
                            {bons} / {QUOTA_GRATUIT} bons utilisés
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              percent >= 100
                                ? "bg-destructive"
                                : percent >= 80
                                  ? "bg-amber-500"
                                  : "bg-primary",
                            )}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {percent >= 100
                            ? "Limite atteinte — passez au Pro pour des bons illimités."
                            : `Il vous reste ${remainingFreeBons} bon${remainingFreeBons > 1 ? "s" : ""} gratuit${remainingFreeBons > 1 ? "s" : ""}.`}
                        </p>
                      </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-3">
                      <PlanCard
                        name="Gratuit"
                        price="0 €"
                        cadence=""
                        current={!isPro}
                        features={[
                          `${QUOTA_GRATUIT} bons de commande offerts`,
                          "Import CSV / Excel du stock",
                          "Génération PDF",
                        ]}
                      />
                      <PlanCard
                        name="Pro mensuel"
                        price="49 €"
                        cadence="/ mois"
                        highlight
                        current={isPro}
                        features={[
                          "Bons de commande illimités",
                          "Support prioritaire",
                          "Toutes les fonctionnalités",
                        ]}
                        cta={
                          !isPro && !isAdmin && isAdminMembre ? (
                            <button
                              type="button"
                              className="btn-secondary w-full cursor-pointer"
                              onClick={() => handleUpgrade("monthly")}
                              disabled={submittingPlan !== null}
                            >
                              {submittingPlan === "monthly" ? "Redirection…" : "Choisir Mensuel"}
                              <ArrowRight className="h-4 w-4" />
                            </button>
                          ) : undefined
                        }
                      />
                      <PlanCard
                        name="Pro annuel"
                        price="399 €"
                        cadence="/ an"
                        badge="⭐ Meilleure offre"
                        featured
                        current={isPro}
                        features={[
                          "Tout le Pro mensuel",
                          "= 33 €/mois seulement",
                          "🎁 2 mois offerts",
                          "💰 Économisez 189 € / an",
                        ]}
                        cta={
                          !isPro && !isAdmin && isAdminMembre ? (
                            <button
                              type="button"
                              className="btn-primary w-full cursor-pointer"
                              onClick={() => handleUpgrade("annual")}
                              disabled={submittingPlan !== null}
                            >
                              {submittingPlan === "annual" ? "Redirection…" : "Choisir Annuel"}
                              <ArrowRight className="h-4 w-4" />
                            </button>
                          ) : isPro ? (
                            <div className="rounded-input border border-success/30 bg-success/10 px-3 py-2 text-center text-sm font-semibold text-success">
                              Plan actif
                            </div>
                          ) : undefined
                        }
                      />
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
};

const PlanCard = ({
  name,
  price,
  cadence,
  features,
  highlight,
  featured,
  badge,
  current,
  cta,
}: {
  name: string;
  price: string;
  cadence: string;
  features: string[];
  /** Card mise en avant discrètement (bord indigo léger). */
  highlight?: boolean;
  /** Card "meilleure offre" : bord indigo brillant + badge + scale légère. */
  featured?: boolean;
  /** Badge affiché en haut de la card (ex: "⭐ Meilleure offre"). */
  badge?: string;
  current?: boolean;
  cta?: React.ReactNode;
}) => (
  <div
    className={cn(
      "card-autodocs relative flex flex-col gap-4",
      highlight && !featured && "border-primary/40 shadow-indigo",
      featured &&
        "border-2 border-primary/70 shadow-[0_0_0_1px_rgba(99,102,241,0.25),0_24px_60px_-20px_rgba(99,102,241,0.5)] plan-card-featured md:scale-[1.02]",
      current && !highlight && !featured && "border-success/30",
    )}
  >
    {featured && (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-card plan-card-shine"
      />
    )}
    {badge && (
      <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-[#4F46E5] to-[#6366F1] px-3 py-1 font-display text-[10px] font-bold uppercase tracking-wider text-white shadow-lg shadow-indigo-500/30">
        {badge}
      </span>
    )}
    <div className="flex items-start justify-between">
      <div>
        <h3 className="font-display text-base font-bold text-foreground">{name}</h3>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="font-display text-3xl font-semibold text-foreground">{price}</span>
          <span className="text-xs text-muted-foreground">{cadence}</span>
        </div>
      </div>
      {current && (
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">
          Actuel
        </span>
      )}
    </div>
    <ul className="space-y-1.5 text-sm text-muted-foreground">
      {features.map((f) => (
        <li key={f} className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          <span>{f}</span>
        </li>
      ))}
    </ul>
    {cta && <div className="mt-auto pt-2">{cta}</div>}
  </div>
);

export default ProfilConcession;
