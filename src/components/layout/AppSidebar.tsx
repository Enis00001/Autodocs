import { useEffect, useState } from "react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { LayoutDashboard, Plus, ClipboardList, FileText, Car, Settings, LogOut } from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import { loadDrafts } from "@/utils/drafts";
import { loadConcession, getConcessionInitials } from "@/utils/concession";
import type { ConcessionData } from "@/utils/concession";
import { supabase } from "@/lib/supabase";

const navItems = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard },
  { title: "Nouveau bon", path: "/nouveau-bon", icon: Plus },
  { title: "Historique", path: "/historique", icon: ClipboardList },
  { title: "Templates", path: "/templates", icon: FileText },
  { title: "Infos véhicule", path: "/infos-vehicule", icon: Car },
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
    <aside className="w-[220px] min-h-screen bg-card border-r border-border flex flex-col py-6 px-4 gap-1 shrink-0">
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
            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <item.icon className="w-4 h-4" />
            <span>{item.title}</span>
          </Link>
        );
      })}

      {/* Bottom badge */}
      <div className="mt-auto border-t border-border pt-4">
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-secondary rounded-lg border border-border">
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
          className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors bg-transparent cursor-pointer"
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
