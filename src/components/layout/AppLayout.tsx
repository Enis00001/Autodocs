import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { Menu, CarFront, User } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SidebarContent } from "./SidebarContent";
import AppSidebar from "./AppSidebar";
import { cn } from "@/lib/utils";

const AppLayout = () => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-[#0F1117]">
      <AppSidebar />
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className={cn(
            "drawer-left w-[280px] max-w-[85vw] border-r border-white/[0.08] p-0",
            "bg-[#0F1117] data-[state=open]:border-white/[0.08]",
            "data-[state=open]:duration-200 data-[state=closed]:duration-200",
          )}
        >
          <span className="sr-only">Menu de navigation</span>
          <SidebarContent onNavigate={() => setMobileOpen(false)} className="border-0" />
        </SheetContent>
      </Sheet>

      {/* Header fixe — mobile uniquement (56px) */}
      <header className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-white/[0.06] bg-[#0F1117]/95 px-3 backdrop-blur-md md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#1A1D27] text-[#F1F5F9] transition-all duration-200 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1] active:scale-[0.98]"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <Link
          to="/app"
          className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2 transition-opacity duration-200 hover:opacity-90"
          aria-label="Retour au dashboard"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#6366F1]/20 text-[#6366F1]">
            <CarFront className="h-4 w-4" />
          </div>
          <span className="font-display text-base font-bold text-[#F1F5F9]">
            Auto<span className="text-[#6366F1]">Docs</span>
          </span>
        </Link>

        <Link
          to="/parametres"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#1A1D27] text-[#F1F5F9] transition-all duration-200 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1] active:scale-[0.98]"
          aria-label="Paramètres du profil"
        >
          <User className="h-5 w-5" />
        </Link>
      </header>

      <main className="relative flex min-h-0 min-h-screen flex-1 flex-col overflow-hidden pt-14 md:pt-0">
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 100% 0%, rgba(99, 102, 241, 0.12), transparent 50%), radial-gradient(ellipse 60% 40% at 0% 100%, rgba(99, 102, 241, 0.06), transparent 45%)",
          }}
        />
        <Outlet />
      </main>
    </div>
  );
};

export default AppLayout;
