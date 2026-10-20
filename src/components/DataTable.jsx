import React, { useState, useMemo } from "react";
import { exportToExcel } from "../utils/excelExport";
import ColumnFilter from "./ColumnFilter";
import ImportThicknessModal from "./ImportThicknessModal";

const PAGE_SIZE = 100;

// Columns that get special styling
const COL_CLASS = {
  StationID: "col-stationid",
  DropID: "col-dropid",
  Force: "col-force",
  Stress: "col-force",
  Thickness: "col-thickness",
};
const DEFLECTION_RE = /^D\d+$/;

function formatCell(col, val) {
  if (val === null || val === undefined) return "—";
  if (col === "Thickness") {
    if (val === "" || Number.isNaN(val)) return "—";
    const num = Number(val);
    return Number.isFinite(num) ? `${num.toFixed(2)}″` : "—";
  }
  if (val instanceof Date) {
    return val.toLocaleString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  if (typeof val === "number") {
    if (DEFLECTION_RE.test(col)) return val.toFixed(2);
    if (col === "Force" || col === "Stress") return val.toFixed(0);
    if (col === "Latitude" || col === "Longitude") return val.toFixed(6);
    return Number.isInteger(val) ? val : val.toFixed(3);
  }
  return String(val);
}

export default function DataTable({
  columns,
  rows,
  sectionName,
  availableVariants = [],
  selectedVariant = "A",
  onSelectVariant,
  normalizedData = null,
  hiddenColumns = [],
  allHiddenColumns = { data: [], normalized: [] },
  onUpdateHiddenColumns,
  onSaveImportedThickness,
  onUpdateCell = null,
  onReimport = null,
}) {
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [showThicknessModal, setShowThicknessModal] = useState(false);
  const [editingCell, setEditingCell] = useState(null); // { rowIndex, col, value }
  const [justSavedCell, setJustSavedCell] = useState(null); // `${rowIndex}-${col}`

  const handleCommitEdit = () => {
    if (!editingCell || !onUpdateCell) {
      setEditingCell(null);
      return;
    }
    const { rowIndex, col, value } = editingCell;
    onUpdateCell(rowIndex, col, value);
    setJustSavedCell(`${rowIndex}-${col}`);
    setTimeout(() => {
      setJustSavedCell(null);
    }, 1500);
    setEditingCell(null);
  };

  const visibleColumns = useMemo(() => {
    const hiddenSet = new Set(hiddenColumns);
    const filtered = columns.filter((c) => !hiddenSet.has(c));
    return filtered.length > 0 ? filtered : columns;
  }, [columns, hiddenColumns]);

  const sorted = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortCol] ?? "";
      const bv = b[sortCol] ?? "";
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
    setPage(1);
  };

  const handleExport = () => {
    exportToExcel(visibleColumns, rows, sectionName ?? "fwd_masterfile", normalizedData);
  };

  const sortIcon = (col) => {
    if (sortCol !== col) return <span className="sort-icon">⇅</span>;
    return <span className="sort-icon">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  // Count rows in the currently selected variant
  const selectedCount = useMemo(() => {
    return rows.filter((r) => r._variantLetter === selectedVariant).length;
  }, [rows, selectedVariant]);

  return (
    <div className="data-tab">
      {/* Top Station Selection Bar */}
      {availableVariants.length > 0 && (
        <div className="station-selector-bar">
          <div className="station-selector-label">
            <span>Drop:</span>
          </div>
          <div className="station-selector-pills">
            {availableVariants.map((letter) => {
              const isSelected = selectedVariant === letter;
              const count = rows.filter((r) => r._variantLetter === letter).length;
              return (
                <button
                  key={letter}
                  type="button"
                  className={`variant-pill ${isSelected ? "active" : ""}`}
                  onClick={() => onSelectVariant && onSelectVariant(letter)}
                >
                  <span className="variant-pill-indicator">
                    {isSelected ? "●" : "○"}
                  </span>
                  <span className="variant-pill-name">Drop {letter}</span>
                  <span className="variant-pill-count">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="station-selector-info">
            <span className="badge badge-dark">
              {selectedCount.toLocaleString()} stations
            </span>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--sp-3) var(--sp-6)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          gap: "var(--sp-4)",
        }}
      >
        <div className="stats-row" style={{ padding: 0, border: 0, margin: 0, display: "flex", gap: "var(--sp-3)", alignItems: "center" }}>
          <div className="stat-chip">
            <span className="stat-value">{rows.length.toLocaleString()}</span>
            <span className="stat-label">total drops</span>
          </div>
          <ColumnFilter
            columns={columns}
            hiddenColumns={hiddenColumns}
            allHiddenColumns={allHiddenColumns}
            onUpdateHiddenColumns={onUpdateHiddenColumns}
            currentTab="data"
          />
          {onUpdateCell && (
            <span
              style={{
                fontSize: 11,
                color: "var(--text-secondary)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "var(--bg-secondary)",
                padding: "3px 8px",
                borderRadius: 4,
                border: "1px solid var(--border-subtle)",
              }}
              title="You can double-click on any cell to edit its value directly and save it to the database"
            >
              <span>✏️</span> Double-click any cell to edit
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          {onReimport && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={onReimport}
              title="Re-import and totally replace the current section dataset with a new file"
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <span>🔄</span>
              <span>Re-import</span>
            </button>
          )}
          {onSaveImportedThickness && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowThicknessModal(true)}
              title="Import pavement thickness from Excel or CSV file"
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <span>📏</span>
              <span>Import Thickness</span>
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={handleExport}>
            ⬇ Export to Excel
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 60, textAlign: "center" }}>Variant</th>
              {visibleColumns.map((col) => (
                <th
                  key={col}
                  className={sortCol === col ? "sort-active" : ""}
                  onClick={() => handleSort(col)}
                >
                  {col}
                  {sortIcon(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => {
              const isChosen = row._variantLetter === selectedVariant;
              const originalRowIndex = row._rowIndex ?? ((page - 1) * PAGE_SIZE + i);
              return (
                <tr
                  key={i}
                  style={
                    isChosen
                      ? { backgroundColor: "rgba(17, 24, 39, 0.04)" }
                      : { opacity: 0.75 }
                  }
                >
                  <td style={{ textAlign: "center", fontWeight: 700 }}>
                    <span
                      className={`badge ${
                        isChosen ? "badge-dark" : "badge-gray"
                      }`}
                      style={{ fontSize: 10, padding: "2px 6px" }}
                    >
                      {row._variantLetter ?? "—"}
                    </span>
                  </td>
                  {visibleColumns.map((col) => {
                    const cls =
                      COL_CLASS[col] ||
                      (DEFLECTION_RE.test(col)
                        ? "col-deflection"
                        : col === "DateTime"
                        ? "col-datetime"
                        : "");
                    const isEditing =
                      editingCell &&
                      editingCell.rowIndex === originalRowIndex &&
                      editingCell.col === col;
                    const isJustSaved =
                      justSavedCell === `${originalRowIndex}-${col}`;

                    return (
                      <td
                        key={col}
                        className={`${cls} ${isJustSaved ? "cell-just-saved" : ""}`}
                        onDoubleClick={() => {
                          if (onUpdateCell) {
                            setEditingCell({
                              rowIndex: originalRowIndex,
                              col,
                              value:
                                row[col] !== null && row[col] !== undefined
                                  ? String(row[col])
                                  : "",
                            });
                          }
                        }}
                        style={{
                          cursor: onUpdateCell ? "pointer" : "default",
                          backgroundColor: isJustSaved
                            ? "rgba(34, 197, 94, 0.18)"
                            : undefined,
                          transition: "background-color 0.3s ease",
                          position: "relative",
                        }}
                        title={
                          onUpdateCell
                            ? "Double-click to edit this value"
                            : undefined
                        }
                      >
                        {isEditing ? (
                          <input
                            type="text"
                            autoFocus
                            value={editingCell.value}
                            onChange={(e) =>
                              setEditingCell((prev) => ({
                                ...prev,
                                value: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleCommitEdit();
                              } else if (e.key === "Escape") {
                                setEditingCell(null);
                              }
                            }}
                            onBlur={handleCommitEdit}
                            style={{
                              width: "100%",
                              minWidth: 50,
                              padding: "2px 4px",
                              fontSize: 12,
                              fontFamily: "inherit",
                              border: "1.5px solid #2563eb",
                              borderRadius: 3,
                              background: "#ffffff",
                              color: "#111827",
                              outline: "none",
                              boxShadow: "0 0 0 2px rgba(37, 99, 235, 0.25)",
                            }}
                          />
                        ) : (
                          formatCell(col, row[col])
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="table-pagination">
        <span className="pagination-info">
          Rows {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–
          {Math.min(page * PAGE_SIZE, sorted.length).toLocaleString()} of{" "}
          {sorted.length.toLocaleString()}
        </span>
        <div className="pagination-controls">
          <button
            className="btn btn-ghost btn-sm"
            disabled={page === 1}
            onClick={() => setPage(1)}
          >
            «
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ‹ Prev
          </button>
          <span className="text-secondary">
            Page {page} / {totalPages}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next ›
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={page === totalPages}
            onClick={() => setPage(totalPages)}
          >
            »
          </button>
        </div>
      </div>

      {showThicknessModal && (
        <ImportThicknessModal
          rows={rows}
          columns={columns}
          onClose={() => setShowThicknessModal(false)}
          onApplyThickness={onSaveImportedThickness}
        />
      )}
    </div>
  );
}
