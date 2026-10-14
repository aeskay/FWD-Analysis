import React, { useState, useEffect } from "react";
import { signOut } from "../firebase/auth";
import { getUserHiddenColumns, saveUserHiddenColumns } from "../firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Sidebar from "../components/Sidebar";
import SectionView from "../pages/SectionView";

export default function AppLayout() {
  const { user } = useAuth();
  const { show } = useToast();
  const [activeSection, setActiveSection] = useState(null);
  const [activeTab, setActiveTab] = useState("data");
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Global Account-Wide Column Visibility State (Synced Across All Sections) ─
  const [hiddenColumns, setHiddenColumns] = useState(() => {
    try {
      const saved = localStorage.getItem("fwd_user_hidden_columns");
      if (saved) return JSON.parse(saved);
    } catch {}
    return { data: [], normalized: [] };
  });

  // Load from Firestore user document on mount / login
  useEffect(() => {
    if (!user?.uid) return;
    getUserHiddenColumns(user.uid).then((hc) => {
      if (hc) {
        setHiddenColumns(hc);
        try {
          localStorage.setItem("fwd_user_hidden_columns", JSON.stringify(hc));
        } catch {}
      }
    });
  }, [user?.uid]);

  const handleUpdateHiddenColumns = async (nextHidden) => {
    setHiddenColumns(nextHidden);
    try {
      localStorage.setItem("fwd_user_hidden_columns", JSON.stringify(nextHidden));
    } catch {}
    if (user?.uid) {
      await saveUserHiddenColumns(user.uid, nextHidden).catch((err) =>
        console.error("Failed to save hidden columns to user profile:", err)
      );
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      show("Failed to sign out", "error");
    }
  };

  const initials = user?.displayName
    ? user.displayName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? "U";

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="app-header">
        <div className="header-logo">
          <div className="header-logo-icon">📡</div>
          <span>FWD Analysis</span>
        </div>

        <div className="header-right">
          <div className="user-chip">
            <div className="user-avatar">{initials}</div>
            <span className="truncate" style={{ maxWidth: 160 }}>
              {user?.displayName || user?.email}
            </span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleSignOut}
            title="Sign out"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Sidebar */}
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
      />

      {/* Main content */}
      <main className="app-main">
        {activeSection ? (
          <SectionView
            key={activeSection.id}
            project={activeSection.project}
            section={activeSection}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onSectionUpdated={() => setRefreshKey((k) => k + 1)}
            hiddenColumns={hiddenColumns}
            onUpdateHiddenColumns={handleUpdateHiddenColumns}
          />
        ) : (
          <div className="main-empty">
            <div className="main-empty-icon">📁</div>
            <h3 style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
              Select a section to view data
            </h3>
            <p style={{ fontSize: 13, maxWidth: 300, textAlign: "center" }}>
              Choose a project and section from the sidebar, or create a new one to import data.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
