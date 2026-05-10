import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Plus,
  ClipboardList,
  Car,
  LogOut,
  CarFront,
  Settings2,
  FileText,
  Building2,
  Users,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import { loadDrafts } from "@/utils/drafts";
import { loadConcession, getConcessionInitials } from "@/utils/concession";
import type { ConcessionData } from "@/utils/concession";
import { supabase } from "@/lib/supabase";
import { getCurrentUserIsAdmin } from "@/lib/auth";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

type SidebarItem = {
  title: string;
  path: string;
  icon: LucideIcon;
  /** Met l'item en évidence (CTA principal — utilisé pour « Nouveau bon »). */
  accent?: boolean;
};

/**
 * Sidebar regroupée par familles fonctionnelles. Chaque sous-tableau forme
 * un groupe ; un séparateur visuel est rendu entre eux.
 *
 * Note : « Brouillons », « Profil » et « Abonnement » ont été retirés.
 *  - /brouillons est désormais redirigé vers /historique (qui contient tout)
 *  - /parametres + /abonnement sont intégrés à /profil-concession
 *  Les redirections sont définies dans App.tsx pour ne pas casser les liens
 *  existants (Stripe, emails, anciens favoris).
 */
const SIDEBAR_GROUPS: SidebarItem[][] = [
  [
    { title: "Dashboard", path: "/app", icon: LayoutDashboard },
    { title: "Nouveau bon", path: "/nouveau-bon", icon: Plus, accent: true },
  ],
  [
    { title: "Historique", path: "/historique", icon: ClipboardList },
    { title: "CERFA", path: "/cerfa", icon: FileText },
    { title: "Stock véhicules", path: "/stock-vehicules", icon: Car },
    { title: "Clients", path: "/clients", icon: Users },
    { title: "Factures", path: "/factures", icon: Receipt },
  ],
  [
    { title: "Modification des champs", path: "/preferences", icon: Settings2 },
  ],
];

/** Item « Ma concession » épinglé tout en bas de la nav (avant le footer). */
const FOOTER_NAV_ITEM: SidebarItem = {
  title: "Ma concession",
  path: "/profil-concession",
  icon: Building2,
};

/** Liste à plat utilisée pour les tests / introspection externe éventuelle. */
export const sidebarNavConfig = [
  ...SIDEBAR_GROUPS.flat(),
  FOOTER_NAV_ITEM,
] as const;

const isCurrentMonth = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

/**
 * Détermine si un item est actif. Centralise les cas particuliers :
 *  - /nouveau-bon est actif sur /nouveau-bon/:id
 *  - /clients est actif sur /clients/:id
 *  - /historique est actif aussi sur l'ancien /brouillons (redirigé)
 *  - /app est actif aussi sur /dashboard
 *  - /profil-concession est actif aussi sur les anciens slugs profil/parametres/abonnement/ma-concession
 */
const matchActive = (itemPath: string, current: string): boolean => {
  switch (itemPath) {
    case "/nouveau-bon":
      return current === "/nouveau-bon" || current.startsWith("/nouveau-bon/");
    case "/clients":
      return current === "/clients" || current.startsWith("/clients/");
    case "/historique":
      return current === "/historique" || current === "/brouillons";
    case "/app":
      return current === "/app" || current === "/dashboard";
    case "/profil-concession":
      return (
        current === "/profil-concession" ||
        current === "/ma-concession" ||
        current === "/profil" ||
        current === "/parametres" ||
        current === "/abonnement"
      );
    default:
      return current === itemPath;
  }
};

type SidebarContentProps = {
  /** Fermer le drawer mobile après navigation. */
  onNavigate?: () => void;
  className?: string;
};

export function SidebarContent({ onNavigate, className }: SidebarContentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { membreRole } = useAuth();
  const [concession, setConcession] = useState<ConcessionData>({
    name: "Ma concession",
    address: "",
  });
  const [drafts, setDrafts] = useState<BonDraftData[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    void getCurrentUserIsAdmin().then(setIsAdmin);
  }, []);

  useEffect(() => {
    const refreshDrafts = () => {
      void loadDrafts().then(setDrafts);
    };
    refreshDrafts();
    window.addEventListener("autodocs_drafts_updated", refreshDrafts);
    return () => window.removeEventListener("autodocs_drafts_updated", refreshDrafts);
  }, []);

  const bonsCeMois = drafts.filter((d) => isCurrentMonth(d.createdAt)).length;

  useEffect(() => {
    const onConcessionUpdated = () => {
      void loadConcession().then(setConcession);
    };
    void loadConcession().then(setConcession);
    window.addEventListener("autodocs_concession_updated", onConcessionUpdated);
    return () => window.removeEventListener("autodocs_concession_updated", onConcessionUpdated);
  }, []);

  const displayName = concession.name.trim() || "Ma concession";
  const initials = getConcessionInitials(concession.name);

  const handleLogout = async () => {
    onNavigate?.();
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  const renderItem = (item: SidebarItem) => {
    const isActive = matchActive(item.path, location.pathname);
    const disabledNav = item.path === "/preferences" && membreRole !== "admin";
    if (disabledNav) {
      return (
        <span
          key={item.path}
          title="Réservé à l'administrateur de la concession"
          className={cn(
            "group relative flex min-h-11 cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium opacity-45",
            "text-[#64748B]",
          )}
        >
          <item.icon className="h-[18px] w-[18px] shrink-0 text-[#64748B]" strokeWidth={2} />
          <span>{item.title}</span>
        </span>
      );
    }
    return (
      <Link
        key={item.path}
        to={item.path}
        onClick={onNavigate}
        className={cn(
          "group relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
          isActive
            ? "bg-[#6366F1]/10 text-[#6366F1] shadow-sm shadow-black/20"
            : item.accent
              ? "bg-[#6366F1]/15 text-[#6366F1] hover:bg-[#6366F1]/25"
              : "text-[#94A3B8] hover:bg-white/[0.04] hover:text-[#F1F5F9]",
        )}
      >
        {isActive && (
          <span
            className="absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-[#6366F1]"
            aria-hidden
          />
        )}
        <item.icon
          className={cn(
            "h-[18px] w-[18px] shrink-0 transition-colors duration-200",
            isActive || item.accent
              ? "text-[#6366F1]"
              : "text-[#94A3B8] group-hover:text-[#F1F5F9]",
          )}
          strokeWidth={item.accent ? 2.4 : 2}
        />
        <span>{item.title}</span>
      </Link>
    );
  };

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col bg-[#0F1117] py-5 px-3",
        className,
      )}
    >
      <Link
        to="/app"
        className="flex items-center gap-2.5 px-2.5 pb-6 shrink-0 transition-opacity duration-200 hover:opacity-90"
        onClick={onNavigate}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#6366F1]/20 text-[#6366F1]">
          <CarFront className="h-5 w-5" strokeWidth={2.2} />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-display text-lg font-extrabold tracking-tight text-[#F1F5F9]">
              Auto<span className="text-[#6366F1]">Docs</span>
            </div>
            {isAdmin ? (
              <span className="rounded-md border border-violet-400/35 bg-violet-500/10 px-1.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-wider text-violet-300/95">
                Admin
              </span>
            ) : null}
          </div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-[#94A3B8]/80">
            Concession
          </p>
        </div>
      </Link>

      <nav className="flex flex-1 flex-col gap-1" aria-label="Navigation principale">
        {SIDEBAR_GROUPS.map((group, idx) => (
          <div key={`group-${idx}`} className="flex flex-col gap-1">
            {idx > 0 && (
              <div
                aria-hidden
                className="my-2 h-px w-full bg-white/[0.06]"
              />
            )}
            {group.map(renderItem)}
          </div>
        ))}

        {/* « Ma concession » épinglée tout en bas, séparée du reste. */}
        <div className="mt-auto flex flex-col gap-1 pt-2">
          <div aria-hidden className="my-2 h-px w-full bg-white/[0.06]" />
          {renderItem(FOOTER_NAV_ITEM)}
        </div>
      </nav>

      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[#1A1D27] px-3 py-3 shadow-lg shadow-black/20">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg font-display text-xs font-bold text-white gradient-primary">
            {concession.logoBase64 ? (
              <img src={concession.logoBase64} alt="" className="h-full w-full object-contain" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-[#F1F5F9]">{displayName}</div>
            <div className="text-[11px] text-[#94A3B8]">
              {bonsCeMois} bon{bonsCeMois !== 1 ? "s" : ""} ce mois
            </div>
          </div>
        </div>
        <button
          type="button"
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-transparent px-3 py-2.5 text-xs font-medium text-[#94A3B8] transition-all duration-200 hover:border-[#EF4444]/40 hover:bg-[#EF4444]/10 hover:text-[#EF4444] cursor-pointer"
          onClick={() => void handleLogout()}
        >
          <LogOut className="h-3.5 w-3.5" />
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
