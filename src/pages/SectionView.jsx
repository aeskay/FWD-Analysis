import React, { useState, useEffect, useMemo } from "react";
import { getSectionData } from "../firebase/firestore";
import { useAuth } from "../context/AuthContext";
import DataTable from "../components/DataTable";
import NormalizedTable from "../components/NormalizedTable";
import MapView from "../components/MapView";
import BowlView from "../components/BowlView";
import ImportSectionModal from "../components/ImportSectionModal";
import { assignVariants, normalizeRows } from "../utils/normalization";

const TABS = [
  { id: "data", label: "📊 Data" },
  { id: "normalized", label: "⚖️ Normalized" },
  { id: "map", label: "🗺️ Map" },
  { id: "bowl", label: "📉 Bowl" },
];

export default function SectionView({ project, section, onSectionUpdated }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("data");
  const [tableData, setTableData] = useState(null); // { rows, columns }
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState("A");

  useEffect(() => {
    if (!section) return;
    setLoading(true);
    setTableData(null);
    getSectionData(user.uid, project.id, section.id).then((data) => {
      setTableData(data);
      setLoading(false);
    });
  }, [section?.id]);

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
  const normalizedRows = useMemo(() => {
    if (!taggedRows.length) return [];
    const variantFiltered = taggedRows.filter((r) => r._variantLetter === selectedVariant);
    return normalizeRows(variantFiltered, 9000);
  }, [taggedRows, selectedVariant]);

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
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
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
            rows: normalizedRows,
            targetLoad: 9000,
            selectedVariant,
          }}
        />
      ) : activeTab === "normalized" ? (
        <NormalizedTable
          columns={tableData.columns}
          rows={normalizedRows}
          sectionName={section.name}
          selectedVariant={selectedVariant}
          rawRows={tableData.rows}
          rawColumns={tableData.columns}
        />
      ) : activeTab === "map" ? (
        <MapView
          rows={normalizedRows}
          selectedVariant={selectedVariant}
        />
      ) : (
        <BowlView
          rows={normalizedRows}
          columns={tableData.columns}
          selectedVariant={selectedVariant}
        />
      )}

      {showImport && (
        <ImportSectionModal
          projectId={project.id}
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
