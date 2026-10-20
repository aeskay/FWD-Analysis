import React, { useState, useRef, useMemo } from "react";
import { parseAccessFile } from "../utils/accessParser";
import {
  readSpreadsheetFile,
  autoMatchColumns,
  transformSpreadsheetData,
  STANDARD_FIELDS,
} from "../utils/excelParser";
import { createSection, saveSectionData, updateSectionThickness } from "../firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const STAGES = {
  idle: "idle",
  parsing: "parsing",
  mapping: "mapping",
  preview: "preview",
  saving: "saving",
};

export default function ImportSectionModal({
  projectId,
  sectionId = null,
  defaultSectionName = "",
  onClose,
  onImported,
}) {
  const { user } = useAuth();
  const { show } = useToast();

  const [fileType, setFileType] = useState("access"); // "access" | "excel"
  const [stage, setStage] = useState(STAGES.idle);
  const [dragOver, setDragOver] = useState(false);
  const [sectionName, setSectionName] = useState(defaultSectionName || "");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const fileRef = useRef();

  // Excel / CSV raw state
  const [rawSpreadsheet, setRawSpreadsheet] = useState(null); // { columns, rows, rowCount, fileName }
  const [columnMapping, setColumnMapping] = useState({}); // { [targetKey]: sourceCol }
  const [defaultForce, setDefaultForce] = useState(9000);
  const [showOptionalFields, setShowOptionalFields] = useState(false);

  // Final parsed data ready for preview/saving { rows, columns, rowCount, preview }
  const [parsed, setParsed] = useState(null);

  // Format file extension check
  const isExcelFile = (name) => /\.(xlsx|xls|csv)$/i.test(name);
  const isAccessFile = (name) => /\.(mdb|accdb)$/i.test(name);

  const handleFile = async (file) => {
    if (!file) return;
    setError("");

    // Auto-detect file format from extension
    let targetType = fileType;
    if (isExcelFile(file.name)) {
      targetType = "excel";
      setFileType("excel");
    } else if (isAccessFile(file.name)) {
      targetType = "access";
      setFileType("access");
    }

    const autoName = file.name.replace(/\.[^.]+$/, "");
    if (!sectionName.trim()) {
      setSectionName(autoName);
    }

    setStage(STAGES.parsing);
    setProgress(30);

    try {
      const buffer = await file.arrayBuffer();
      setProgress(60);

      if (targetType === "access") {
        const result = await parseAccessFile(buffer);
        setProgress(100);
        setParsed(result);
        setStage(STAGES.preview);
      } else {
        // Excel / CSV flow
        const spreadsheet = readSpreadsheetFile(buffer);
        setProgress(85);
        const autoMapping = autoMatchColumns(spreadsheet.columns);
        setProgress(100);

        setRawSpreadsheet({
          ...spreadsheet,
          fileName: file.name,
        });
        setColumnMapping(autoMapping);
        setStage(STAGES.mapping);
      }
    } catch (err) {
      setError(err.message || "Failed to parse file.");
      setStage(STAGES.idle);
      setProgress(0);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // Live transformed preview during column mapping
  const liveExcelData = useMemo(() => {
    if (!rawSpreadsheet || stage !== STAGES.mapping) return null;
    try {
      return transformSpreadsheetData(rawSpreadsheet.rows, columnMapping, {
        defaultForce: Number(defaultForce) || 9000,
      });
    } catch {
      return null;
    }
  }, [rawSpreadsheet, columnMapping, defaultForce, stage]);

  // Check if required columns are mapped
  const mappingErrors = useMemo(() => {
    if (stage !== STAGES.mapping) return [];
    const errors = [];
    if (!columnMapping["StationID"]) errors.push("Station ID");
    if (!columnMapping["D1"]) errors.push("D1 (Center Deflection)");
    return errors;
  }, [columnMapping, stage]);

  const handleProceedFromMapping = () => {
    if (mappingErrors.length > 0) return;
    if (!liveExcelData) return;

    setParsed(liveExcelData);
    setStage(STAGES.preview);
  };

  const handleImport = async () => {
    if (!parsed || !sectionName.trim()) return;
    setStage(STAGES.saving);
    try {
      let targetSectionId = sectionId;
      if (!targetSectionId) {
        const sectionRef = await createSection(user.uid, projectId, sectionName.trim());
        targetSectionId = sectionRef.id;
      }
      await saveSectionData(user.uid, projectId, targetSectionId, parsed.rows, parsed.columns);

      // If Thickness column was mapped and populated, update section average thickness
      const measuredThick = parsed.rows
        .map((r) => r.Thickness)
        .filter((v) => v !== null && v !== undefined && !isNaN(v) && v > 0);
      if (measuredThick.length > 0) {
        const avgThickness = Math.round((measuredThick.reduce((a, b) => a + b, 0) / measuredThick.length) * 100) / 100;
        await updateSectionThickness(user.uid, projectId, targetSectionId, avgThickness);
      }

      show(`Section "${sectionName}" imported — ${parsed.rowCount.toLocaleString()} rows`, "success");
      onImported?.(targetSectionId, sectionName.trim());
      onClose();
    } catch (err) {
      show("Import failed: " + err.message, "error");
      setStage(STAGES.preview);
    }
  };

  const formatVal = (v) => {
    if (v === null || v === undefined) return "—";
    if (v instanceof Date) return v.toLocaleString();
    if (typeof v === "number") return Number.isInteger(v) ? v : v.toFixed(3);
    return String(v);
  };

  // Target fields categories
  const requiredFields = STANDARD_FIELDS.filter((f) => f.required);
  const deflectionFields = STANDARD_FIELDS.filter((f) => f.category === "deflections" && !f.required);
  const otherFields = STANDARD_FIELDS.filter((f) => f.category !== "deflections" && !f.required);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && stage !== STAGES.saving && onClose()}
    >
      <div className={`modal ${stage === STAGES.mapping ? "modal-lg" : "modal-lg"}`} style={{ maxWidth: 840 }}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>{fileType === "excel" ? "📊" : "🗄️"}</span>
            <h3 style={{ margin: 0 }}>Import Section Data</h3>
          </div>
          {stage !== STAGES.saving && (
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        {/* ── Stage: idle / parsing ── */}
        {(stage === STAGES.idle || stage === STAGES.parsing) && (
          <div style={{ padding: "var(--sp-2) 0" }}>
            {/* Format Selector Tabs */}
            <div className="import-type-selector">
              <button
                type="button"
                className={`import-type-btn ${fileType === "access" ? "active" : ""}`}
                onClick={() => {
                  setFileType("access");
                  setError("");
                }}
              >
                <span className="import-type-icon">🗄️</span>
                <div>
                  <div className="import-type-title">Access Database</div>
                  <div className="import-type-desc">.mdb or .accdb (Drops & Stations tables)</div>
                </div>
              </button>

              <button
                type="button"
                className={`import-type-btn ${fileType === "excel" ? "active" : ""}`}
                onClick={() => {
                  setFileType("excel");
                  setError("");
                }}
              >
                <span className="import-type-icon">📊</span>
                <div>
                  <div className="import-type-title">CSV / Excel</div>
                  <div className="import-type-desc">.xlsx, .xls, .csv with Smart Column Matching</div>
                </div>
              </button>
            </div>

            {/* Drop Zone */}
            <div
              className={`drop-zone ${dragOver ? "drag-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept={fileType === "access" ? ".mdb,.accdb" : ".xlsx,.xls,.csv"}
                onChange={(e) => handleFile(e.target.files[0])}
              />
              <div className="drop-zone-icon">
                {stage === STAGES.parsing ? "⏳" : fileType === "excel" ? "📊" : "🗄️"}
              </div>

              {stage === STAGES.parsing ? (
                <>
                  <div className="drop-zone-text">
                    {fileType === "access" ? "Parsing Access database…" : "Reading spreadsheet & matching columns…"}
                  </div>
                  <div
                    className="import-progress-bar"
                    style={{ marginTop: "var(--sp-4)", width: "100%", maxWidth: 280, marginInline: "auto" }}
                  >
                    <div className="import-progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                </>
              ) : (
                <>
                  <div className="drop-zone-text">
                    {fileType === "access"
                      ? "Drop your Access file here, or click to browse"
                      : "Drop your Excel (.xlsx, .xls) or CSV file here, or click to browse"}
                  </div>
                  <div className="drop-zone-hint">
                    {fileType === "access"
                      ? "Supports Dynatest / KUAB / JILS .mdb and .accdb files"
                      : "Supports single-sheet Excel workbooks and CSV files with auto column matching"}
                  </div>
                </>
              )}
            </div>

            {error && <div className="auth-error mt-4">{error}</div>}
          </div>
        )}

        {/* ── Stage: mapping (Excel / CSV Smart Column Matcher) ── */}
        {stage === STAGES.mapping && rawSpreadsheet && (
          <div style={{ maxHeight: "72vh", overflowY: "auto", paddingRight: 4 }}>
            {/* File info banner */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "var(--r-md)",
                marginBottom: "var(--sp-4)",
                fontSize: 12,
              }}
            >
              <div>
                <strong>{rawSpreadsheet.fileName}</strong> —{" "}
                <span style={{ color: "#166534" }}>
                  {rawSpreadsheet.rowCount.toLocaleString()} rows found · {rawSpreadsheet.columns.length} columns detected
                </span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setStage(STAGES.idle);
                  setRawSpreadsheet(null);
                }}
                style={{ fontSize: 11 }}
              >
                Change File
              </button>
            </div>

            {/* Section Name Input */}
            <div className="field" style={{ marginBottom: "var(--sp-4)" }}>
              <label style={{ fontWeight: 600, fontSize: 12 }}>Section Name</label>
              <input
                className="input"
                type="text"
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                placeholder="Enter section name"
              />
            </div>

            {/* Smart Column Mapping Card */}
            <div className="import-mapping-card">
              <div className="import-mapping-section-title">
                <span>1. Required Fields</span>
                {mappingErrors.length > 0 && (
                  <span style={{ color: "#dc2626", fontSize: 11, textTransform: "none", fontWeight: 600 }}>
                    ⚠️ Missing: {mappingErrors.join(", ")}
                  </span>
                )}
              </div>

              <div className="import-mapping-grid" style={{ marginBottom: "var(--sp-4)" }}>
                {requiredFields.map((field) => {
                  const mappedCol = columnMapping[field.key] || "";
                  return (
                    <div key={field.key} className="import-field-item">
                      <div className="import-field-label">
                        <span>
                          {field.label} <span style={{ color: "#ef4444" }}>*</span>
                        </span>
                        {mappedCol ? (
                          <span style={{ color: "#16a34a", fontSize: 10, fontWeight: 700 }}>✓ Matched</span>
                        ) : (
                          <span style={{ color: "#dc2626", fontSize: 10, fontWeight: 700 }}>Required</span>
                        )}
                      </div>
                      <select
                        className={`import-field-select ${mappedCol ? "matched" : "unmatched"}`}
                        value={mappedCol}
                        onChange={(e) =>
                          setColumnMapping((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                      >
                        <option value="">— Select Column —</option>
                        {rawSpreadsheet.columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{field.description}</span>
                    </div>
                  );
                })}
              </div>

              {/* Deflection Sensors */}
              <div className="import-mapping-section-title">
                <span>2. Deflection Basin Sensors</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "none" }}>
                  Mapped: {Object.keys(columnMapping).filter((k) => k.startsWith("D") && columnMapping[k]).length} sensors
                </span>
              </div>

              <div className="import-mapping-grid" style={{ marginBottom: "var(--sp-4)" }}>
                {deflectionFields.map((field) => {
                  const mappedCol = columnMapping[field.key] || "";
                  return (
                    <div key={field.key} className="import-field-item">
                      <div className="import-field-label">
                        <span>{field.label}</span>
                        {mappedCol && <span style={{ color: "#16a34a", fontSize: 10 }}>✓</span>}
                      </div>
                      <select
                        className={`import-field-select ${mappedCol ? "matched" : ""}`}
                        value={mappedCol}
                        onChange={(e) =>
                          setColumnMapping((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                      >
                        <option value="">(None / Skip)</option>
                        {rawSpreadsheet.columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              {/* Operational & Coordinates */}
              <div className="import-mapping-section-title">
                <span>3. Operational, Distance & GPS Coordinates</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowOptionalFields((v) => !v)}
                  style={{ fontSize: 11, padding: "2px 6px" }}
                >
                  {showOptionalFields ? "Hide Optional" : "Show All"}
                </button>
              </div>

              <div className="import-mapping-grid">
                {otherFields
                  .filter((f) => showOptionalFields || ["Force", "DropID", "DMI", "Thickness", "Latitude", "Longitude"].includes(f.key))
                  .map((field) => {
                    const mappedCol = columnMapping[field.key] || "";
                    return (
                      <div key={field.key} className="import-field-item">
                        <div className="import-field-label">
                          <span>{field.label}</span>
                          {mappedCol ? (
                            <span style={{ color: "#16a34a", fontSize: 10 }}>✓</span>
                          ) : field.key === "Force" ? (
                            <span style={{ color: "#d97706", fontSize: 10 }}>Default: {defaultForce} lbs</span>
                          ) : field.key === "DropID" ? (
                            <span style={{ color: "var(--text-muted)", fontSize: 10 }}>Auto-sequenced</span>
                          ) : field.key === "Thickness" ? (
                            <span style={{ color: "var(--text-muted)", fontSize: 10 }}>Optional</span>
                          ) : null}
                        </div>
                        <select
                          className={`import-field-select ${mappedCol ? "matched" : ""}`}
                          value={mappedCol}
                          onChange={(e) =>
                            setColumnMapping((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                        >
                          <option value="">(None / Skip)</option>
                          {rawSpreadsheet.columns.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        {field.key === "Force" && !mappedCol && (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Target Load:</span>
                            <input
                              type="number"
                              className="input"
                              value={defaultForce}
                              onChange={(e) => setDefaultForce(e.target.value)}
                              style={{ width: 80, padding: "2px 6px", fontSize: 11 }}
                            />
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>lbs</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Live Data Preview */}
            {liveExcelData && liveExcelData.preview.length > 0 && (
              <div style={{ marginBottom: "var(--sp-3)" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
                  Mapped Data Preview (First 5 Rows):
                </div>
                <div className="import-preview-table" style={{ maxHeight: 150 }}>
                  <table>
                    <thead>
                      <tr>
                        {liveExcelData.columns.slice(0, 10).map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {liveExcelData.preview.map((row, i) => (
                        <tr key={i}>
                          {liveExcelData.columns.slice(0, 10).map((col) => (
                            <td key={col}>{formatVal(row[col])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Stage: preview (Final Confirmation) ── */}
        {stage === STAGES.preview && parsed && (
          <div style={{ padding: "var(--sp-2) 0" }}>
            <div className="field" style={{ marginBottom: "var(--sp-4)" }}>
              <label style={{ fontWeight: 600 }}>Section Name</label>
              <input
                className="input"
                type="text"
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                placeholder="Enter section name"
                autoFocus
              />
            </div>

            <div className="import-status" style={{ marginBottom: "var(--sp-4)" }}>
              <div className="import-status-row">
                <span className="text-success" style={{ fontSize: 16 }}>✓</span>
                <span>
                  <strong>{parsed.rowCount.toLocaleString()}</strong> rows parsed and validated
                  &nbsp;·&nbsp;
                  <strong>{parsed.columns.length}</strong> columns available
                </span>
              </div>
            </div>

            <div>
              <div className="text-sm text-muted" style={{ marginBottom: "var(--sp-2)" }}>
                Preview — first 5 rows
              </div>
              <div className="import-preview-table">
                <table>
                  <thead>
                    <tr>
                      {parsed.columns.map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.preview.map((row, i) => (
                      <tr key={i}>
                        {parsed.columns.map((col) => (
                          <td key={col}>{formatVal(row[col])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Stage: saving ── */}
        {stage === STAGES.saving && (
          <div className="empty-state" style={{ padding: "var(--sp-10)" }}>
            <div className="spinner spinner-lg" />
            <p className="text-secondary" style={{ marginTop: "var(--sp-4)" }}>
              Saving section data to database…
            </p>
          </div>
        )}

        {/* Footer */}
        {stage !== STAGES.saving && (
          <div className="modal-footer" style={{ marginTop: "var(--sp-4)" }}>
            {stage === STAGES.mapping ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setStage(STAGES.idle);
                    setRawSpreadsheet(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleProceedFromMapping}
                  disabled={mappingErrors.length > 0 || !sectionName.trim()}
                >
                  {mappingErrors.length > 0 ? "Map Required Columns to Continue" : "Continue to Preview →"}
                </button>
              </>
            ) : stage === STAGES.preview ? (
              <>
                {rawSpreadsheet && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setStage(STAGES.mapping)}
                  >
                    ← Adjust Mapping
                  </button>
                )}
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={!sectionName.trim()}
                >
                  Import Section
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
