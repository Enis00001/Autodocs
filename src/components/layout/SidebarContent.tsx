import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Plus, ClipboardList, Car, Settings, LogOut, CarFront, CreditCard } from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import { loadDrafts } from "@/utils/drafts";
import { loadConcession, getConcessionInitials } from "@/utils/concession";
import type { ConcessionData } from "@/utils/concession";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const sidebarNavConfig = [
  { title: "Dashboard", path: "/app", icon: LayoutDashboard },
  { title: "Nouveau bon", path: "/nouveau-bon", icon: Plus },
  { title: "Historique", path: "/historique", icon: ClipboardList },
  { title: "Stock véhicules", path: "/stock-vehicules", icon: Car },
  { title: "Abonnement", path: "/abonnement", icon: CreditCard },
  { title: "Paramètres", path: "/parametres", icon: Settings },
] as const;

const isCurrentMonth = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

type SidebarContentProps = {
  /** Fermer le drawer mobile après navigation. */
  onNavigate?: () => void;
  className?: string;
};

export function SidebarContent({ onNavigate, className }: SidebarContentProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [concession, setConcession] = useState<ConcessionData>({
    name: "Ma concession",
    address: "",
  });
  const [drafts, setDrafts] = useState<BonDraftData[]>([]);

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
          <div className="font-display text-lg font-extrabold tracking-tight text-[#F1F5F9]">
            Auto<span className="text-[#6366F1]">Docs</span>
          </div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-[#94A3B8]/80">
            Concession
          </p>
        </div>
      </Link>

      <nav className="flex flex-1 flex-col gap-1" aria-label="Navigation principale">
        {sidebarNavConfig.map((item) => {
          const isActive =
            item.path === "/nouveau-bon"
              ? location.pathname === "/nouveau-bon" || location.pathname.startsWith("/nouveau-bon/")
              : item.path === "/app"
                ? location.pathname === "/app" || location.pathname === "/dashboard"
                : location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={cn(
                "group relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-[#6366F1]/10 text-[#6366F1] shadow-sm shadow-black/20"
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
                  isActive ? "text-[#6366F1]" : "text-[#94A3B8] group-hover:text-[#F1F5F9]",
                )}
              />
              <span>{item.title}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/[0.06] pt-4">
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
