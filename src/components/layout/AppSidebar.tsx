import { SidebarContent } from "./SidebarContent";

/** Barre latérale desktop (240px). Sur mobile, utiliser le drawer dans AppLayout. */
const AppSidebar = () => {
  return (
    <aside className="hidden h-screen w-[240px] shrink-0 border-r border-white/[0.06] md:flex md:flex-col">
      <SidebarContent className="h-full" />
    </aside>
  );
};

export default AppSidebar;
