import React, { useState, useMemo } from "react";
import { exportToExcel } from "../utils/excelExport";

const PAGE_SIZE = 100;

const COL_CLASS = {
  StationID: "col-stationid",
  DropID: "col-dropid",
  Force: "col-force",
  Stress: "col-force",
};
const DEFLECTION_RE = /^D\d+$/;

function formatCell(col, val) {
  if (val === null || val === undefined) return "—";
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

export default function NormalizedTable({
  columns,
  rows,
  sectionName,
  selectedVariant = "A",
  rawRows = [],
  rawColumns = [],
  excludedStations = [],
  onToggleExcludeStation,
  onClearExclusions,
}) {
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const excludedSet = useMemo(() => {
    return new Set(excludedStations.map(String));
  }, [excludedStations]);

  const activeCount = useMemo(() => {
    return rows.filter((r) => !excludedSet.has(String(r.StationID))).length;
  }, [rows, excludedSet]);

  const excludedCount = rows.length - activeCount;

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
    const exportRows = rows.filter((r) => !excludedSet.has(String(r.StationID)));
    exportToExcel(rawColumns, rawRows, sectionName ?? "fwd_masterfile", {
      columns,
      rows: exportRows,
      targetLoad: 9000,
      selectedVariant,
    });
  };

  const sortIcon = (col) => {
    if (sortCol !== col) return <span className="sort-icon">⇅</span>;
    return <span className="sort-icon">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="data-tab">
      {/* Normalized Header Summary Banner */}
      <div className="normalized-banner">
        <div className="normalized-banner-info">
          <span className="badge badge-dark">9,000 lbs</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            Drop {selectedVariant}
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <button className="btn btn-secondary btn-sm" onClick={handleExport}>
            ⬇ Export to Excel
          </button>
        </div>
      </div>

      {/* Toolbar stats */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--sp-2) var(--sp-6)",
          borderBottom: "1px solid var(--border-subtle)",
          background: "#fafafa",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: "var(--sp-4)", alignItems: "center", flexWrap: "wrap" }}>
          <div className="stat-chip">
            <span className="stat-value">{activeCount.toLocaleString()}</span>
            <span className="stat-label">active stations</span>
          </div>
          {excludedCount > 0 && (
            <div
              className="stat-chip"
              style={{
                background: "#fef2f2",
                borderColor: "#fca5a5",
              }}
            >
              <span className="stat-value" style={{ color: "#dc2626", fontWeight: 700 }}>
                {excludedCount.toLocaleString()}
              </span>
              <span className="stat-label" style={{ color: "#b91c1c" }}>excluded</span>
            </div>
          )}
          <div className="stat-chip">
            <span className="stat-value">{columns.length}</span>
            <span className="stat-label">columns</span>
          </div>
          {excludedCount > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClearExclusions}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                color: "#dc2626",
                borderColor: "#fca5a5",
                fontWeight: 600,
              }}
              title="Include all excluded stations back into analysis"
            >
              Reset Exclusions ({excludedCount})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th
                style={{ width: 68, textAlign: "center" }}
                title="Exclude or include station from analysis"
              >
                Exclude
              </th>
              <th style={{ width: 60, textAlign: "center" }}>Variant</th>
              {columns.map((col) => (
                <th
                  key={col}
                  className={sortCol === col ? "sort-active" : ""}
                  onClick={() => handleSort(col)}
                >
                  {DEFLECTION_RE.test(col) ? `${col} (Norm)` : col}
                  {sortIcon(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => {
              const isExcluded = excludedSet.has(String(row.StationID));
              return (
                <tr
                  key={row.StationID ?? i}
                  style={
                    isExcluded
                      ? {
                          backgroundColor: "#fef2f2",
                          opacity: 0.58,
                          transition: "opacity 0.15s ease, background-color 0.15s ease",
                        }
                      : {
                          transition: "opacity 0.15s ease, background-color 0.15s ease",
                        }
                  }
                >
                  <td
                    style={{
                      textAlign: "center",
                      padding: "4px 8px",
                      verticalAlign: "middle",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleExcludeStation?.(row.StationID)}
                      title={
                        isExcluded
                          ? `Station ${row.StationID} is excluded. Click to re-include.`
                          : `Click to exclude Station ${row.StationID} from analysis`
                      }
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 24,
                        height: 24,
                        borderRadius: 4,
                        border: isExcluded ? "1.5px solid #ef4444" : "1px solid #d1d5db",
                        backgroundColor: isExcluded ? "#fee2e2" : "#ffffff",
                        color: isExcluded ? "#dc2626" : "#9ca3af",
                        fontWeight: isExcluded ? "900" : "500",
                        fontSize: isExcluded ? 13 : 11,
                        cursor: "pointer",
                        lineHeight: 1,
                        padding: 0,
                        transition: "all 0.15s ease",
                      }}
                    >
                      {isExcluded ? "✕" : "—"}
                    </button>
                  </td>
                  <td style={{ textAlign: "center", fontWeight: 700 }}>
                    <span
                      className="badge badge-dark"
                      style={{
                        fontSize: 10,
                        padding: "2px 6px",
                        opacity: isExcluded ? 0.6 : 1,
                      }}
                    >
                      {selectedVariant}
                    </span>
                  </td>
                  {columns.map((col) => {
                    const cls =
                      COL_CLASS[col] ||
                      (DEFLECTION_RE.test(col)
                        ? "col-deflection"
                        : col === "DateTime"
                        ? "col-datetime"
                        : "");
                    return (
                      <td
                        key={col}
                        className={cls}
                        style={
                          isExcluded
                            ? {
                                textDecoration: col === "StationID" ? "line-through" : "none",
                                color: "#6b7280",
                              }
                            : {}
                        }
                      >
                        {formatCell(col, row[col])}
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
    </div>
  );
}
