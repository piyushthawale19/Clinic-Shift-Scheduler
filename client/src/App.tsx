// Main application component — handles routing and navigation layout.
import { useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ShiftsPage from "./pages/ShiftsPage";
import ImportReportPage from "./pages/ImportReportPage";

type Page = "dashboard" | "shifts" | "import";

function AppContent() {
  const { user, isManager, logout } = useAuth();
  const [page, setPage] = useState<Page>(isManager ? "dashboard" : "shifts");

  if (!user) return <LoginPage />;

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span className="text-white font-semibold hidden sm:block">Clinic Scheduler</span>
              </div>

              <div className="flex items-center gap-1">
                {isManager && (
                  <button
                    onClick={() => setPage("dashboard")}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                      page === "dashboard"
                        ? "bg-primary-600/20 text-primary-400"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Dashboard
                  </button>
                )}
                <button
                  onClick={() => setPage("shifts")}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                    page === "shifts"
                      ? "bg-primary-600/20 text-primary-400"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  Shifts
                </button>
                {isManager && (
                  <button
                    onClick={() => setPage("import")}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                      page === "import"
                        ? "bg-primary-600/20 text-primary-400"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Imports
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm text-slate-300">{user.email}</p>
                <p className="text-xs text-slate-500 capitalize">
                  {user.role}{user.profession ? ` · ${user.profession}` : ""}
                </p>
              </div>
              <button
                onClick={logout}
                className="px-3 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 rounded-lg transition-all"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Page content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {page === "dashboard" && isManager && <DashboardPage />}
        {page === "shifts" && <ShiftsPage />}
        {page === "import" && isManager && <ImportReportPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
