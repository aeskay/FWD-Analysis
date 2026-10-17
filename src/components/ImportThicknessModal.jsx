/**
 * ImportThicknessModal.jsx
 * Interactive modal for importing and matching pavement thickness data
 * from Excel (.xlsx, .xls) or CSV (.csv) files directly into the Data tab.
 */
import React, { useState, useRef, useMemo } from "react";
import {
  readThicknessSpreadsheet,
  detectThicknessColumn,
  detectStationColumn,
  getUniqueSectionStations,
  matchThicknessToStations,
  computeThicknessStats,
  applyThicknessToSectionRows,
  insertThicknessColumn,
} from "../utils/thicknessParser";
import { useToast } from "../context/ToastContext";

export default function ImportThicknessModal({
  rows = [],
  columns = [],
  onClose,
  onApplyThickness,
}) {
  const { show } = useToast();
  const fileInputRef = useRef(null);

  const [dragOver, setDragOver] = useState(false);
  const [fileData, setFileData] = useState(null); // { fileName, columns, rows, rowCount }
  const [selectedThicknessCol, setSelectedThicknessCol] = useState("");
  const [selectedStationCol, setSelectedStationCol] = useState("");
  const [matchingMethod, setMatchingMethod] = useState("order"); // "order" | "station"
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState("");

  // Extract unique stations from section rows in order
  const uniqueStations = useMemo(() => {
    return getUniqueSectionStations(rows);
  }, [rows]);

  // Handle file reading
  const processFile = async (file) => {
    if (!file) return;
    setError("");

    const isSupported = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!isSupported) {
      setError("Please select a valid Excel (.xlsx, .xls) or CSV (.csv) file.");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const parsed = readThicknessSpreadsheet(buffer);

      const detectedThick = detectThicknessColumn(parsed.columns);
      const detectedStn = detectStationColumn(parsed.columns);

      setFileData({
        fileName: file.name,
        columns: parsed.columns,
        rows: parsed.rows,
        rowCount: parsed.rowCount,
      });

      setSelectedThicknessCol(detectedThick);
      setSelectedStationCol(detectedStn);
      setMatchingMethod("order"); // default to corresponding order
    } catch (err) {
      console.error("Failed to parse thickness spreadsheet:", err);
      setError(err.message || "Failed to read the file. Please check the file format.");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  // Matched list and statistics
  const matchedList = useMemo(() => {
    if (!fileData || !selectedThicknessCol) return [];
    return matchThicknessToStations(
      uniqueStations,
      fileData.rows,
      selectedThicknessCol,
      selectedStationCol,
      matchingMethod
    );
  }, [
    uniqueStations,
    fileData,
    selectedThicknessCol,
    selectedStationCol,
    matchingMethod,
  ]);

  const stats = useMemo(() => {
    return computeThicknessStats(matchedList);
  }, [matchedList]);

  // Commit and apply to section data
  const handleApply = async () => {
    if (!matchedList || matchedList.length === 0) return;
    setIsApplying(true);
    setError("");

    try {
      const updatedRows = applyThicknessToSectionRows(rows, matchedList);
      const updatedColumns = insertThicknessColumn(columns);

      await onApplyThickness(updatedRows, updatedColumns, stats.mean);
      show?.(
        `Pavement thickness successfully imported (${stats.measuredCount} stations measured, ${stats.emptyCount} empty)!`,
        "success"
      );
      onClose();
    } catch (err) {
      console.error("Failed to apply thickness data:", err);
      setError(err.message || "Failed to save thickness data to section.");
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal-lg" style={{ maxWidth: 840, width: "95vw" }}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>📏</span>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                Import Pavement Thickness
              </h2>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  margin: "2px 0 0",
                }}
              >
                Match thickness measurements from a CSV or Excel file to FWD section stations.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            disabled={isApplying}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: "var(--sp-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-4)",
            maxHeight: "75vh",
            overflowY: "auto",
          }}
        >
          {error && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                borderRadius: "var(--r-md)",
                padding: "8px 12px",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Upload Drop Zone */}
          {!fileData ? (
            <div
              className={`drop-zone ${dragOver ? "drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                cursor: "pointer",
                padding: "36px 20px",
                textAlign: "center",
                background: dragOver ? "var(--bg-hover)" : "var(--bg-secondary)",
                borderRadius: "var(--r-md)",
                border: "2px dashed var(--border-default)",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
              <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
                Click to browse or drag & drop a file here
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                Supports Excel (.xlsx, .xls) and CSV (.csv) files
              </div>
              <div
                style={{
                  marginTop: 12,
                  display: "inline-block",
                  fontSize: 11,
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  padding: "4px 10px",
                  borderRadius: 20,
                  fontWeight: 500,
                  border: "1px solid #bfdbfe",
                }}
              >
                Target Section: {uniqueStations.length} stations
              </div>
            </div>
          ) : (
            /* File Loaded & Mapping Stage */
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              {/* File Info Bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--bg-secondary)",
                  padding: "8px 14px",
                  borderRadius: "var(--r-md)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>📊</span>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
                      {fileData.fileName}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 8 }}>
                      ({fileData.rowCount} rows, {fileData.columns.length} columns)
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setFileData(null);
                    setSelectedThicknessCol("");
                  }}
                  style={{ fontSize: 11, padding: "2px 8px" }}
                >
                  Change File
                </button>
              </div>

              {/* Column Selection & Method Form */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                  background: "#f9fafb",
                  padding: "14px",
                  borderRadius: "var(--r-md)",
                  border: "1px solid var(--border-default)",
                }}
              >
                {/* Heading with Thickness */}
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 700,
                      marginBottom: 6,
                      color: "#111827",
                    }}
                  >
                    Heading with Thickness (in inches) <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <select
                    className="select-input"
                    value={selectedThicknessCol}
                    onChange={(e) => setSelectedThicknessCol(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "6px 10px",
                      fontSize: 13,
                      borderRadius: "var(--r-sm)",
                      border: "1px solid var(--border-default)",
                      background: "#ffffff",
                    }}
                  >
                    <option value="" disabled>
                      -- Select Thickness Column --
                    </option>
                    {fileData.columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                  <p style={{ fontSize: 11, color: "#6b7280", margin: "4px 0 0" }}>
                    Select the heading that contains the thickness values.
                  </p>
                </div>

                {/* Matching Method */}
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 700,
                      marginBottom: 6,
                      color: "#111827",
                    }}
                  >
                    Matching Method
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="matchingMethod"
                        value="order"
                        checked={matchingMethod === "order"}
                        onChange={() => setMatchingMethod("order")}
                        style={{ accentColor: "#2563eb" }}
                      />
                      <span style={{ fontWeight: matchingMethod === "order" ? 600 : 400 }}>
                        Corresponding Order (Row 1 → Station 1, etc.)
                      </span>
                    </label>

                    {fileData.columns.length > 1 && (
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="radio"
                          name="matchingMethod"
                          value="station"
                          checked={matchingMethod === "station"}
                          onChange={() => setMatchingMethod("station")}
                          style={{ accentColor: "#2563eb" }}
                        />
                        <span style={{ fontWeight: matchingMethod === "station" ? 600 : 400 }}>
                          Match by Station Column ID
                        </span>
                      </label>
                    )}
                  </div>

                  {matchingMethod === "station" && (
                    <div style={{ marginTop: 8 }}>
                      <select
                        className="select-input"
                        value={selectedStationCol}
                        onChange={(e) => setSelectedStationCol(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "4px 8px",
                          fontSize: 12,
                          borderRadius: "var(--r-sm)",
                          border: "1px solid var(--border-default)",
                          background: "#ffffff",
                        }}
                      >
                        <option value="" disabled>
                          -- Select Station Column --
                        </option>
                        {fileData.columns
                          .filter((c) => c !== selectedThicknessCol)
                          .map((col) => (
                            <option key={col} value={col}>
                              {col}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Stats Summary Bar */}
              {stats.totalStations > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    padding: "8px 14px",
                    borderRadius: "var(--r-md)",
                    flexWrap: "wrap",
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "#166534", fontWeight: 700 }}>
                    Match Summary:
                  </span>
                  <span>
                    Total: <strong>{stats.totalStations}</strong> stations
                  </span>
                  <span style={{ color: "#16a34a" }}>
                    Measured: <strong>{stats.measuredCount}</strong>
                  </span>
                  {stats.emptyCount > 0 && (
                    <span style={{ color: "#b45309" }}>
                      Unmeasured / Empty: <strong>{stats.emptyCount}</strong>
                    </span>
                  )}
                  {stats.mean != null && (
                    <span style={{ color: "#1e40af" }}>
                      Avg Thickness: <strong>{stats.mean}″</strong>
                    </span>
                  )}
                  {stats.min != null && stats.max != null && (
                    <span style={{ color: "#4b5563" }}>
                      Range: {stats.min}″ – {stats.max}″
                    </span>
                  )}
                </div>
              )}

              {/* Interactive Match Preview Table */}
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
                    Station Match Preview
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    Showing first {Math.min(matchedList.length, 30)} of {matchedList.length} stations
                  </span>
                </div>

                <div
                  style={{
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--r-md)",
                    maxHeight: 240,
                    overflowY: "auto",
                    background: "#ffffff",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 12,
                      textAlign: "left",
                    }}
                  >
                    <thead
                      style={{
                        position: "sticky",
                        top: 0,
                        background: "#f3f4f6",
                        zIndex: 1,
                        borderBottom: "1px solid #d1d5db",
                      }}
                    >
                      <tr>
                        <th style={{ padding: "6px 10px", fontWeight: 700, color: "#374151" }}>
                          Section Station
                        </th>
                        <th style={{ padding: "6px 10px", fontWeight: 700, color: "#374151" }}>
                          DMI (ft)
                        </th>
                        <th style={{ padding: "6px 10px", fontWeight: 700, color: "#374151" }}>
                          File Row #
                        </th>
                        <th style={{ padding: "6px 10px", fontWeight: 700, color: "#374151" }}>
                          Raw Value
                        </th>
                        <th style={{ padding: "6px 10px", fontWeight: 700, color: "#374151" }}>
                          Matched Thickness
                        </th>
                        <th style={{ padding: "6px 10px", fontWeight: 700, color: "#374151" }}>
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchedList.slice(0, 30).map((item, idx) => {
                        const isEven = idx % 2 === 0;
                        return (
                          <tr
                            key={item.stationId}
                            style={{
                              background: isEven ? "#ffffff" : "#f9fafb",
                              borderBottom: "1px solid #f3f4f6",
                            }}
                          >
                            <td style={{ padding: "6px 10px", fontWeight: 600 }}>
                              Station {item.stationId}
                            </td>
                            <td style={{ padding: "6px 10px", color: "#6b7280" }}>
                              {item.dmi != null ? `${item.dmi.toLocaleString()} ft` : "—"}
                            </td>
                            <td style={{ padding: "6px 10px", color: "#6b7280" }}>
                              {item.fileRowNumber != null ? `#${item.fileRowNumber}` : "—"}
                            </td>
                            <td
                              style={{
                                padding: "6px 10px",
                                fontFamily: "monospace",
                                color: "#4b5563",
                              }}
                            >
                              {item.rawFileValue != null && String(item.rawFileValue).trim() !== ""
                                ? String(item.rawFileValue)
                                : "—"}
                            </td>
                            <td style={{ padding: "6px 10px" }}>
                              {item.thickness != null ? (
                                <strong style={{ color: "#1e3a8a" }}>
                                  {item.thickness.toFixed(2)}″
                                </strong>
                              ) : (
                                <span style={{ color: "#9ca3af", fontStyle: "italic" }}>
                                  — Empty
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "6px 10px" }}>
                              {item.thickness != null ? (
                                <span
                                  style={{
                                    display: "inline-block",
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color: "#166534",
                                    background: "#dcfce7",
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                  }}
                                >
                                  ✓ Matched
                                </span>
                              ) : (
                                <span
                                  style={{
                                    display: "inline-block",
                                    fontSize: 10,
                                    fontWeight: 600,
                                    color: "#6b7280",
                                    background: "#f3f4f6",
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                  }}
                                >
                                  Unmeasured
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isApplying}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleApply}
            disabled={!fileData || !selectedThicknessCol || isApplying || matchedList.length === 0}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "#2563eb",
              color: "#ffffff",
            }}
          >
            {isApplying ? (
              <>
                <div className="spinner spinner-sm" />
                <span>Applying…</span>
              </>
            ) : (
              <>
                <span>📏</span>
                <span>Apply Thickness to Stations</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
