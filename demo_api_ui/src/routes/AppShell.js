import AdminSideNav from "../components/AdminSideNav";
import TopNav from "../components/TopNav";

export default function AppShell({ user, logout, children }) {
  return (
    <>
      <AdminSideNav user={user} />
      <div className="app-shell-body">
        <TopNav user={user} onLogout={logout} />
        <main className="main-content">
          {children}
        </main>
      </div>
    </>
  );
}
