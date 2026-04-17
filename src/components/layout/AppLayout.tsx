import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";

const AppLayout = () => {
  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(ellipse at top right, hsla(228,91%,64%,0.08), transparent 42%), radial-gradient(ellipse at bottom left, hsla(263,84%,58%,0.07), transparent 40%)",
          }}
        />
        <Outlet />
      </main>
    </div>
  );
};

export default AppLayout;
