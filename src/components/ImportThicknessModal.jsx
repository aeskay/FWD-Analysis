/**
 * ImportThicknessModal.jsx
 * Interactive modal for importing and matching pavement thickness data
 * from Excel (.xlsx, .xls) or CSV (.csv) files directly into the Data tab.
 * Includes a comprehensive warning system for row count discrepancies.
 */
import React, { useState, useRef, useMemo } from "react";
import {
  readThicknessSpreadsheet,
  detectThicknessColumn,
  detectStationColumn,
  getUniqueSectionStations,
  matchThicknessToStations,
  computeThicknessStats,
  diagnoseRowMismatch,
  getExtraFileRows,
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
  const [previewFilter, setPreviewFilter] = useState("all"); // "all" | "measured" | "empty" | "missing_row"
  const [showExtraRowsDrawer, setShowExtraRowsDrawer] = useState(false);
  const [acknowledgedMismatch, setAcknowledgedMismatch] = useState(false);
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
    setAcknowledgedMismatch(false);
    setShowExtraRowsDrawer(false);
    setPreviewFilter("all");

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

  // Row count mismatch diagnosis
  const mismatch = useMemo(() => {
    if (!fileData || !selectedThicknessCol) return null;
    return diagnoseRowMismatch({
      totalStations: uniqueStations.length,
      fileRowCount: fileData.rowCount,
      matchingMethod,
      matchedList,
      stationCol: selectedStationCol,
    });
  }, [
    fileData,
    selectedThicknessCol,
    uniqueStations.length,
    matchingMethod,
    matchedList,
    selectedStationCol,
  ]);

  // Extra unapplied rows if file has more rows than section stations
  const extraRows = useMemo(() => {
    if (!fileData || !selectedThicknessCol || matchingMethod !== "order") return [];
    return getExtraFileRows(fileData.rows, uniqueStations.length, selectedThicknessCol);
  }, [fileData, selectedThicknessCol, matchingMethod, uniqueStations.length]);

  // Filtered preview stations
  const filteredPreviewList = useMemo(() => {
    if (!matchedList) return [];
    if (previewFilter === "measured") {
      return matchedList.filter((m) => m.thickness !== null);
    }
    if (previewFilter === "empty") {
      return matchedList.filter((m) => m.thickness === null);
    }
    if (previewFilter === "missing_row") {
      return matchedList.filter((m) => !m.hasFileRow);
    }
    return matchedList;
  }, [matchedList, previewFilter]);

  // Commit and apply to section data
  const handleApply = async () => {
    if (!matchedList || matchedList.length === 0) return;
    setIsApplying(true);
    setError("");

    try {
      const updatedRows = applyThicknessToSectionRows(rows, matchedList);
      const updatedColumns = insertThicknessColumn(columns);

      await onApplyThickness(updatedRows, updatedColumns, stats.mean);
      
      const mismatchNote = mismatch?.hasMismatch
        ? ` (${mismatch.missingCount > 0 ? `${mismatch.missingCount} stations empty` : `${mismatch.extraCount} extra rows skipped`})`
        : "";
      
      show?.(
        `Pavement thickness successfully imported (${stats.measuredCount} stations measured, ${stats.emptyCount} empty)${mismatchNote}!`,
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
      <div className="modal modal-lg" style={{ maxWidth: 880, width: "95vw" }}>
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
                      ({fileData.rowCount} data rows, {fileData.columns.length} columns)
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setFileData(null);
                    setSelectedThicknessCol("");
                    setAcknowledgedMismatch(false);
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
                    onChange={(e) => {
                      setSelectedThicknessCol(e.target.value);
                      setAcknowledgedMismatch(false);
                    }}
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
                    Select the heading containing the measured pavement thickness.
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
                        onChange={() => {
                          setMatchingMethod("order");
                          setAcknowledgedMismatch(false);
                        }}
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
                          onChange={() => {
                            setMatchingMethod("station");
                            setAcknowledgedMismatch(false);
                          }}
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
                        onChange={(e) => {
                          setSelectedStationCol(e.target.value);
                          setAcknowledgedMismatch(false);
                        }}
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

              {/* ── ROW COUNT MISMATCH WARNING SYSTEM BANNER ── */}
              {mismatch && mismatch.hasMismatch ? (
                <div
                  style={{
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                    borderLeft: "5px solid #f59e0b",
                    borderRadius: "var(--r-md)",
                    padding: "12px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    boxShadow: "0 1px 3px rgba(245, 158, 11, 0.08)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18 }}>⚠️</span>
                      <strong style={{ fontSize: 13, color: "#92400e" }}>
                        {mismatch.title}
                      </strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                      <span
                        style={{
                          background: "#ffffff",
                          border: "1px solid #fcd34d",
                          color: "#92400e",
                          padding: "2px 8px",
                          borderRadius: 12,
                          fontWeight: 600,
                        }}
                      >
                        Section: {uniqueStations.length} stations
                      </span>
                      <span
                        style={{
                          background: "#ffffff",
                          border: "1px solid #fcd34d",
                          color: "#92400e",
                          padding: "2px 8px",
                          borderRadius: 12,
                          fontWeight: 600,
                        }}
                      >
                        File: {fileData.rowCount} rows
                      </span>
                      <span
                        style={{
                          background: mismatch.difference < 0 ? "#fee2e2" : "#fef3c7",
                          border: `1px solid ${mismatch.difference < 0 ? "#fca5a5" : "#f59e0b"}`,
                          color: mismatch.difference < 0 ? "#991b1b" : "#b45309",
                          padding: "2px 8px",
                          borderRadius: 12,
                          fontWeight: 700,
                        }}
                      >
                        Discrepancy: {mismatch.difference > 0 ? `+${mismatch.difference} extra` : `${mismatch.difference} fewer`}
                      </span>
                    </div>
                  </div>

                  <p style={{ margin: 0, fontSize: 12, color: "#78350f", lineHeight: 1.5 }}>
                    {mismatch.message}
                  </p>

                  {mismatch.details && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#92400e",
                        background: "rgba(254, 243, 199, 0.6)",
                        padding: "6px 10px",
                        borderRadius: 4,
                        border: "1px dashed #fcd34d",
                      }}
                    >
                      ℹ️ {mismatch.details}
                    </div>
                  )}

                  {/* Extra rows drawer */}
                  {extraRows.length > 0 && (
                    <div style={{ marginTop: 2 }}>
                      <button
                        type="button"
                        onClick={() => setShowExtraRowsDrawer((prev) => !prev)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#b45309",
                          fontWeight: 600,
                          fontSize: 11,
                          cursor: "pointer",
                          padding: 0,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          textDecoration: "underline",
                        }}
                      >
                        {showExtraRowsDrawer
                          ? "▼ Hide extra unapplied file rows"
                          : `▶ View ${extraRows.length} extra unapplied file row${extraRows.length === 1 ? "" : "s"} (Rows ${uniqueStations.length + 1}–${fileData.rowCount})`}
                      </button>

                      {showExtraRowsDrawer && (
                        <div
                          style={{
                            marginTop: 6,
                            maxHeight: 130,
                            overflowY: "auto",
                            border: "1px solid #fcd34d",
                            borderRadius: 4,
                            background: "#ffffff",
                            fontSize: 11,
                          }}
                        >
                          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                            <thead style={{ background: "#fef3c7", borderBottom: "1px solid #fcd34d" }}>
                              <tr>
                                <th style={{ padding: "4px 8px", color: "#92400e" }}>File Row #</th>
                                <th style={{ padding: "4px 8px", color: "#92400e" }}>Raw Cell Value</th>
                                <th style={{ padding: "4px 8px", color: "#92400e" }}>Parsed Value</th>
                                <th style={{ padding: "4px 8px", color: "#92400e" }}>Action Taken</th>
                              </tr>
                            </thead>
                            <tbody>
                              {extraRows.map((er) => (
                                <tr key={er.fileRowNumber} style={{ borderBottom: "1px solid #fef3c7" }}>
                                  <td style={{ padding: "4px 8px", fontWeight: 600 }}>Row #{er.fileRowNumber}</td>
                                  <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{er.rawFileValue ?? "—"}</td>
                                  <td style={{ padding: "4px 8px" }}>
                                    {er.thickness != null ? `${er.thickness}″` : "—"}
                                  </td>
                                  <td style={{ padding: "4px 8px", color: "#b91c1c", fontWeight: 600 }}>
                                    Skipped (exceeds section stations count)
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : mismatch && !mismatch.hasMismatch ? (
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                    borderLeft: "5px solid #22c55e",
                    borderRadius: "var(--r-md)",
                    padding: "8px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#16a34a", fontSize: 16 }}>✓</span>
                    <span style={{ color: "#166534", fontWeight: 600 }}>
                      {mismatch.title}: Exactly {fileData.rowCount} file rows match all {uniqueStations.length} section stations.
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Stats Summary Bar */}
              {stats.totalStations > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    padding: "8px 14px",
                    borderRadius: "var(--r-md)",
                    flexWrap: "wrap",
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "#0f172a", fontWeight: 700 }}>
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
                    marginBottom: 8,
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
                      Station Match Preview
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                      (Showing {filteredPreviewList.length} of {matchedList.length} stations)
                    </span>
                  </div>

                  {/* Filter Pills */}
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>Filter:</span>
                    <button
                      type="button"
                      className={`btn btn-xs ${previewFilter === "all" ? "btn-dark" : "btn-secondary"}`}
                      onClick={() => setPreviewFilter("all")}
                      style={{ fontSize: 11, padding: "2px 8px" }}
                    >
                      All ({matchedList.length})
                    </button>
                    <button
                      type="button"
                      className={`btn btn-xs ${previewFilter === "measured" ? "btn-dark" : "btn-secondary"}`}
                      onClick={() => setPreviewFilter("measured")}
                      style={{ fontSize: 11, padding: "2px 8px" }}
                    >
                      Measured ({stats.measuredCount})
                    </button>
                    {stats.emptyCount > 0 && (
                      <button
                        type="button"
                        className={`btn btn-xs ${previewFilter === "empty" ? "btn-dark" : "btn-secondary"}`}
                        onClick={() => setPreviewFilter("empty")}
                        style={{ fontSize: 11, padding: "2px 8px", color: previewFilter === "empty" ? undefined : "#b45309" }}
                      >
                        Empty ({stats.emptyCount})
                      </button>
                    )}
                    {mismatch?.type === "fewer_rows" && (
                      <button
                        type="button"
                        className={`btn btn-xs ${previewFilter === "missing_row" ? "btn-dark" : "btn-secondary"}`}
                        onClick={() => setPreviewFilter("missing_row")}
                        style={{ fontSize: 11, padding: "2px 8px", color: previewFilter === "missing_row" ? undefined : "#dc2626" }}
                      >
                        ⚠️ No File Row ({mismatch.missingCount})
                      </button>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid var(--border-default)",
                    borderRadius: "var(--r-md)",
                    maxHeight: 260,
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
                      {filteredPreviewList.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>
                            No stations match the selected filter.
                          </td>
                        </tr>
                      ) : (
                        filteredPreviewList.map((item, idx) => {
                          const isEven = idx % 2 === 0;
                          return (
                            <tr
                              key={item.stationId}
                              style={{
                                background: !item.hasFileRow
                                  ? "#fffbeb"
                                  : isEven
                                  ? "#ffffff"
                                  : "#f9fafb",
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
                                {item.rawFileValue != null && String(item.rawFileValue).trim() !== "" ? (
                                  String(item.rawFileValue)
                                ) : !item.hasFileRow ? (
                                  <span style={{ color: "#9ca3af", fontStyle: "italic" }}>
                                    None (end of file)
                                  </span>
                                ) : (
                                  "—"
                                )}
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
                                {item.hasFileRow ? (
                                  item.thickness != null ? (
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
                                      Empty Cell
                                    </span>
                                  )
                                ) : (
                                  <span
                                    style={{
                                      display: "inline-block",
                                      fontSize: 10,
                                      fontWeight: 700,
                                      color: "#92400e",
                                      background: "#fef3c7",
                                      border: "1px solid #fde68a",
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                    }}
                                  >
                                    ⚠️ No File Row
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer with Safety Acknowledgment */}
        <div
          className="modal-footer"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {/* Mismatch acknowledgment check */}
          <div>
            {mismatch && mismatch.hasMismatch && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  cursor: "pointer",
                  color: "#92400e",
                  fontWeight: 600,
                  background: "#fffbeb",
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid #fde68a",
                }}
              >
                <input
                  type="checkbox"
                  checked={acknowledgedMismatch}
                  onChange={(e) => setAcknowledgedMismatch(e.target.checked)}
                  style={{ accentColor: "#d97706", width: 15, height: 15, cursor: "pointer" }}
                />
                <span>
                  I acknowledge row mismatch ({mismatch.missingCount > 0 ? `${mismatch.missingCount} stations remain empty` : `${mismatch.extraCount} rows skipped`})
                </span>
              </label>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
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
              disabled={
                !fileData ||
                !selectedThicknessCol ||
                isApplying ||
                matchedList.length === 0 ||
                (mismatch?.hasMismatch && !acknowledgedMismatch)
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background:
                  mismatch?.hasMismatch && !acknowledgedMismatch
                    ? "#9ca3af"
                    : "#2563eb",
                cursor:
                  mismatch?.hasMismatch && !acknowledgedMismatch
                    ? "not-allowed"
                    : "pointer",
                color: "#ffffff",
              }}
              title={
                mismatch?.hasMismatch && !acknowledgedMismatch
                  ? "Please check the box to acknowledge the row count mismatch before applying"
                  : undefined
              }
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
    </div>
  );
}
