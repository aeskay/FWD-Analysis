import React, { useState, useRef } from "react";
import { parseAccessFile } from "../utils/accessParser";
import { createSection, saveSectionData } from "../firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const STAGES = { idle: "idle", parsing: "parsing", preview: "preview", saving: "saving", done: "done" };

export default function ImportSectionModal({ projectId, onClose, onImported }) {
  const { user } = useAuth();
  const { show } = useToast();

  const [stage, setStage] = useState(STAGES.idle);
  const [dragOver, setDragOver] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [parsed, setParsed] = useState(null); // { rows, columns, rowCount, preview }
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const fileRef = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    setError("");
    // Auto-populate section name from filename (strip extension)
    const autoName = file.name.replace(/\.[^.]+$/, "");
    setSectionName(autoName);
    setStage(STAGES.parsing);
    setProgress(20);
    try {
      const buffer = await file.arrayBuffer();
      setProgress(60);
      const result = await parseAccessFile(buffer);
      setProgress(100);
      setParsed(result);
      setStage(STAGES.preview);
    } catch (err) {
      setError(err.message);
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

  const handleImport = async () => {
    if (!parsed || !sectionName.trim()) return;
    setStage(STAGES.saving);
    try {
      const sectionRef = await createSection(user.uid, projectId, sectionName.trim());
      await saveSectionData(user.uid, projectId, sectionRef.id, parsed.rows, parsed.columns);
      show(`Section "${sectionName}" imported — ${parsed.rowCount.toLocaleString()} rows`, "success");
      onImported?.(sectionRef.id, sectionName.trim());
      onClose();
    } catch (err) {
      show("Import failed: " + err.message, "error");
      setStage(STAGES.preview);
    }
  };

  const formatVal = (v) => {
    if (v === null || v === undefined) return "—";
    if (v instanceof Date) return v.toLocaleString();
    if (typeof v === "number") return Number.isInteger(v) ? v : v.toFixed(4);
    return String(v);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && stage !== STAGES.saving && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h3>Import Section Data</h3>
          {stage !== STAGES.saving && (
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>✕</button>
          )}
        </div>

        {/* ── Stage: idle / parsing ── */}
        {(stage === STAGES.idle || stage === STAGES.parsing) && (
          <>
            <div
              className={`drop-zone ${dragOver ? "drag-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".mdb,.accdb"
                onChange={(e) => handleFile(e.target.files[0])}
              />
              <div className="drop-zone-icon">🗄️</div>
              {stage === STAGES.parsing ? (
                <>
                  <div className="drop-zone-text">Parsing Access database…</div>
                  <div className="import-progress-bar" style={{ marginTop: "var(--sp-4)", width: "100%", maxWidth: 280 }}>
                    <div className="import-progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                </>
              ) : (
                <>
                  <div className="drop-zone-text">Drop your Access file here, or click to browse</div>
                  <div className="drop-zone-hint">Supports .mdb and .accdb files</div>
                </>
              )}
            </div>
            {error && <div className="auth-error mt-4">{error}</div>}
          </>
        )}

        {/* ── Stage: preview ── */}
        {stage === STAGES.preview && parsed && (
          <>
            {/* Section name field */}
            <div className="field" style={{ marginBottom: "var(--sp-5)" }}>
              <label>Section Name</label>
              <input
                className="input"
                type="text"
                value={sectionName}
                onChange={(e) => setSectionName(e.target.value)}
                placeholder="Enter section name"
                autoFocus
              />
            </div>

            {/* Stats */}
            <div className="import-status" style={{ marginBottom: "var(--sp-5)" }}>
              <div className="import-status-row">
                <span className="text-success">✓</span>
                <span>
                  <strong>{parsed.rowCount.toLocaleString()}</strong> rows merged from Drops + Stations
                  &nbsp;·&nbsp;
                  <strong>{parsed.columns.length}</strong> non-empty columns kept
                </span>
              </div>
            </div>

            {/* Data preview */}
            <div style={{ marginBottom: "var(--sp-4)" }}>
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
          </>
        )}

        {/* ── Stage: saving ── */}
        {stage === STAGES.saving && (
          <div className="empty-state">
            <div className="spinner spinner-lg" />
            <p className="text-secondary">Saving to Firestore…</p>
          </div>
        )}

        {/* Footer */}
        {stage !== STAGES.saving && (
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            {stage === STAGES.preview && (
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={!sectionName.trim()}
              >
                Import Section
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
