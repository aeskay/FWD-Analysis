import React, { useState, useEffect, useMemo } from "react";
import { getSectionData, updateSectionExcludedStations } from "../firebase/firestore";
import { useAuth } from "../context/AuthContext";
import DataTable from "../components/DataTable";
import NormalizedTable from "../components/NormalizedTable";
import MapView from "../components/MapView";
import BowlView from "../components/BowlView";
import ProfileView from "../components/ProfileView";
import ImportSectionModal from "../components/ImportSectionModal";
import { assignVariants, normalizeRows } from "../utils/normalization";

const TABS = [
  { id: "data", label: "📊 Data" },
  { id: "normalized", label: "⚖️ Normalized" },
  { id: "profile", label: "📈 Profile" },
  { id: "bowl", label: "📉 Bowl" },
  { id: "map", label: "🗺️ Map" },
];

export default function SectionView({
  project,
  section,
  activeTab: controlledTab,
  onTabChange,
  onSectionUpdated,
}) {
  const { user } = useAuth();
  const [localTab, setLocalTab] = useState("data");
  const activeTab = controlledTab ?? localTab;
  const setActiveTab = onTabChange ?? setLocalTab;
  const [tableData, setTableData] = useState(null); // { rows, columns }
  const [excludedStations, setExcludedStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState("A");

  useEffect(() => {
    if (!section) return;
    setLoading(true);
    setTableData(null);
    getSectionData(user.uid, project.id, section.id).then((data) => {
      setTableData(data);
      const localSaved = (() => {
        try {
          const item = localStorage.getItem(`fwd_excluded_${section.id}`);
          return item ? JSON.parse(item) : null;
        } catch {
          return null;
        }
      })();
      setExcludedStations(data.excludedStations ?? localSaved ?? []);
      setLoading(false);
    });
  }, [section?.id]);

  const handleToggleExcludeStation = (stationId) => {
    const sId = String(stationId);
    setExcludedStations((prev) => {
      const exists = prev.some((id) => String(id) === sId);
      const next = exists
        ? prev.filter((id) => String(id) !== sId)
        : [...prev, stationId];

      try {
        localStorage.setItem(`fwd_excluded_${section.id}`, JSON.stringify(next));
      } catch {}

      if (user?.uid && project?.id && section?.id) {
        updateSectionExcludedStations(user.uid, project.id, section.id, next).catch(
          (err) => console.error("Failed to persist excluded stations:", err)
        );
      }

      return next;
    });
  };

  const handleClearExclusions = () => {
    setExcludedStations([]);
    try {
      localStorage.removeItem(`fwd_excluded_${section.id}`);
    } catch {}
    if (user?.uid && project?.id && section?.id) {
      updateSectionExcludedStations(user.uid, project.id, section.id, []).catch(
        (err) => console.error("Failed to clear exclusions:", err)
      );
    }
  };

  const handleImported = () => {
    setLoading(true);
    getSectionData(user.uid, project.id, section.id).then((data) => {
      setTableData(data);
      setLoading(false);
      onSectionUpdated?.();
    });
  };

  // Assign variant letters (A, B, C, ...) to rows based on drop sequence per StationID
  const { taggedRows, availableVariants } = useMemo(() => {
    if (!tableData?.rows?.length) return { taggedRows: [], availableVariants: [] };
    return assignVariants(tableData.rows);
  }, [tableData?.rows]);

  // Ensure default variant exists
  useEffect(() => {
    if (availableVariants.length > 0 && !availableVariants.includes(selectedVariant)) {
      setSelectedVariant(availableVariants[0]);
    }
  }, [availableVariants, selectedVariant]);

  // Filter rows for the selected variant and compute 9000 lbs normalized values
  const allNormalizedRows = useMemo(() => {
    if (!taggedRows.length) return [];
    const variantFiltered = taggedRows.filter((r) => r._variantLetter === selectedVariant);
    return normalizeRows(variantFiltered, 9000);
  }, [taggedRows, selectedVariant]);

  // Active normalized rows with excluded stations removed for downstream analysis (Profile, Bowl, Map)
  const activeNormalizedRows = useMemo(() => {
    if (!allNormalizedRows.length) return [];
    if (!excludedStations.length) return allNormalizedRows;
    const excludedSet = new Set(excludedStations.map(String));
    return allNormalizedRows.filter((r) => !excludedSet.has(String(r.StationID)));
  }, [allNormalizedRows, excludedStations]);

  if (!section) return null;

  return (
    <div className="section-view">
      {/* Toolbar */}
      <div className="section-toolbar">
        <div className="section-title-area">
          <span className="section-breadcrumb">{project.name} /</span>
          <span className="section-title truncate">{section.name}</span>
          {tableData?.rows?.length > 0 && (
            <span className="badge badge-green">
              {tableData.rows.length.toLocaleString()} rows
            </span>
          )}
          {excludedStations.length > 0 && (
            <span
              className="badge"
              style={{
                backgroundColor: "#fee2e2",
                color: "#b91c1c",
                borderColor: "#fca5a5",
                fontWeight: 600,
              }}
              title={`${excludedStations.length} station(s) excluded from downstream analysis`}
            >
              {excludedStations.length} excluded
            </span>
          )}
        </div>
        <div className="toolbar-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowImport(true)}
          >
            {tableData?.rows?.length ? "↑ Re-import" : "↑ Import Data"}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        {TABS.map((tab) => {
          const isNorm = tab.id === "normalized";
          return (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {isNorm && excludedStations.length > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 10,
                    fontWeight: 700,
                    backgroundColor: "#ef4444",
                    color: "#ffffff",
                    borderRadius: 10,
                    padding: "1px 6px",
                  }}
                  title={`${excludedStations.length} station(s) excluded`}
                >
                  -{excludedStations.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="empty-state">
          <div className="spinner spinner-lg" />
          <p className="text-secondary">Loading data…</p>
        </div>
      ) : !tableData?.rows?.length ? (
        <div className="empty-state">
          <div className="empty-state-icon">📂</div>
          <h3>No data yet</h3>
          <p>Import an Access database file to populate this section with FWD measurement data.</p>
          <button
            className="btn btn-primary"
            onClick={() => setShowImport(true)}
          >
            ↑ Import Access File
          </button>
        </div>
      ) : activeTab === "data" ? (
        <DataTable
          columns={tableData.columns}
          rows={taggedRows}
          sectionName={section.name}
          availableVariants={availableVariants}
          selectedVariant={selectedVariant}
          onSelectVariant={setSelectedVariant}
          normalizedData={{
            columns: tableData.columns,
            rows: activeNormalizedRows,
            targetLoad: 9000,
            selectedVariant,
          }}
        />
      ) : activeTab === "normalized" ? (
        <NormalizedTable
          columns={tableData.columns}
          rows={allNormalizedRows}
          sectionName={section.name}
          selectedVariant={selectedVariant}
          rawRows={tableData.rows}
          rawColumns={tableData.columns}
          excludedStations={excludedStations}
          onToggleExcludeStation={handleToggleExcludeStation}
          onClearExclusions={handleClearExclusions}
        />
      ) : activeTab === "profile" ? (
        <ProfileView
          key={`${section?.id}-${excludedStations.join(",")}`}
          rows={activeNormalizedRows}
          columns={tableData.columns}
          sectionId={section?.id}
          selectedVariant={selectedVariant}
          availableVariants={availableVariants}
          onSelectVariant={setSelectedVariant}
        />
      ) : activeTab === "bowl" ? (
        <BowlView
          key={`${section?.id}-${excludedStations.join(",")}`}
          rows={activeNormalizedRows}
          columns={tableData.columns}
          selectedVariant={selectedVariant}
          sectionName={section?.name}
        />
      ) : (
        <MapView
          key={`${section?.id}-${excludedStations.join(",")}`}
          rows={activeNormalizedRows}
          columns={tableData?.columns ?? []}
          sectionName={section?.name}
          selectedVariant={selectedVariant}
        />
      )}

      {showImport && (
        <ImportSectionModal
          projectId={project.id}
          sectionId={tableData?.rows?.length ? section.id : null}
          defaultSectionName={section.name}
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
