import { useEffect, useState } from "react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { LayoutDashboard, Plus, ClipboardList, Car, Settings, LogOut } from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import { loadDrafts } from "@/utils/drafts";
import { loadConcession, getConcessionInitials } from "@/utils/concession";
import type { ConcessionData } from "@/utils/concession";
import { supabase } from "@/lib/supabase";

const navItems = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard },
  { title: "Nouveau bon", path: "/nouveau-bon", icon: Plus },
  { title: "Historique", path: "/historique", icon: ClipboardList },
  { title: "Stock véhicules", path: "/stock-vehicules", icon: Car },
  { title: "Paramètres", path: "/parametres", icon: Settings },
];

const isCurrentMonth = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

const AppSidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [concession, setConcession] = useState<ConcessionData>({ name: "Ma concession", address: "" });
  const [drafts, setDrafts] = useState<BonDraftData[]>([]);

  useEffect(() => {
    const refreshDrafts = () => {
      loadDrafts().then(setDrafts);
    };
    refreshDrafts();
    window.addEventListener("autodocs_drafts_updated", refreshDrafts);
    return () => window.removeEventListener("autodocs_drafts_updated", refreshDrafts);
  }, []);

  const bonsCeMois = drafts.filter((d) => isCurrentMonth(d.createdAt)).length;

  useEffect(() => {
    const onConcessionUpdated = () => {
      loadConcession().then(setConcession);
    };
    // Chargement initial
    loadConcession().then(setConcession);
    window.addEventListener("autodocs_concession_updated", onConcessionUpdated);
    return () =>
      window.removeEventListener("autodocs_concession_updated", onConcessionUpdated);
  }, []);

  const displayName = concession.name.trim() || "Ma concession";
  const initials = getConcessionInitials(concession.name);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <aside className="w-[230px] min-h-screen bg-card/95 border-r border-border/80 flex flex-col py-6 px-4 gap-1 shrink-0 backdrop-blur-sm">
      {/* Logo */}
      <div className="font-display font-extrabold text-xl px-3 pb-6 tracking-tight">
        Auto<span className="gradient-text">Docs</span>
      </div>

      {/* Nav */}
      {navItems.map((item) => {
        const isActive =
          item.path === "/nouveau-bon"
            ? location.pathname === "/nouveau-bon" || location.pathname.startsWith("/nouveau-bon/")
            : location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 interactive-lift ${
              isActive
                ? "bg-primary/12 text-primary border border-primary/25 shadow-[0_0_0_1px_hsla(228,91%,64%,0.2)]"
                : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground border border-transparent"
            }`}
          >
            <item.icon className="w-4 h-4" />
            <span>{item.title}</span>
          </Link>
        );
      })}

      {/* Bottom badge */}
      <div className="mt-auto border-t border-border pt-4">
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-secondary/80 rounded-lg border border-border interactive-lift">
          <div className="w-[30px] h-[30px] rounded-md flex items-center justify-center text-xs font-bold font-display text-primary-foreground shrink-0 overflow-hidden gradient-primary">
            {concession.logoBase64 ? (
              <img
                src={concession.logoBase64}
                alt=""
                className="w-full h-full object-contain"
              />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium text-foreground truncate">
              {displayName}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Plan Pro · {bonsCeMois} bon{bonsCeMois !== 1 ? "s" : ""} ce mois
            </div>
          </div>
        </div>
        <button
          type="button"
          className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all bg-transparent cursor-pointer interactive-lift"
          onClick={handleLogout}
        >
          <LogOut className="w-3.5 h-3.5" />
          Se déconnecter
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;
