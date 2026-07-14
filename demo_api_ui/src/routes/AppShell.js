import { useLocation } from "react-router-dom";
import AdminSideNav from "../components/AdminSideNav";
import TopNav from "../components/TopNav";
import { shellRendersSideNav } from "./sideNavOwner";

export default function AppShell({ user, logout, children }) {
  const { pathname } = useLocation();
  // App.js already renders the global side nav for most signed-in routes;
  // rendering a second one here painted two sidebars on every AppShell route.
  // Only supply one where App.js opts out (no-chrome routes, logged-out views).
  const ownSideNav = shellRendersSideNav({ pathname, user });

  return (
    <>
      {ownSideNav && <AdminSideNav user={user} />}
      <div className="app-shell-body">
        <TopNav user={user} onLogout={logout} />
        <main className="main-content">
          {children}
        </main>
      </div>
    </>
  );
}
