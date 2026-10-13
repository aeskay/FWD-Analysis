import React, { useState, useMemo } from "react";

const DEFLECTION_RE = /^D(\d+)$/;

export default function BowlView({
  rows = [],
  columns = [],
  selectedVariant = "A",
}) {
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);

  // Extract deflection columns in numeric order: D1, D2, D3, ...
  const deflectionCols = useMemo(() => {
    return columns
      .filter((c) => DEFLECTION_RE.test(c))
      .sort((a, b) => {
        const numA = parseInt(a.replace("D", ""), 10);
        const numB = parseInt(b.replace("D", ""), 10);
        return numA - numB;
      });
  }, [columns]);

  // Selected row
  const activeRow = rows[selectedRowIndex] ?? rows[0] ?? null;

  // Compute deflection curve points for active row
  const bowlData = useMemo(() => {
    if (!activeRow) return [];
    return deflectionCols.map((col, idx) => {
      const val = activeRow[col];
      const numVal = typeof val === "number" ? val : parseFloat(val);
      return {
        sensor: col,
        index: idx,
        val: isNaN(numVal) ? 0 : numVal,
      };
    });
  }, [activeRow, deflectionCols]);

  // SVG Chart dimensions and scaling
  const chartWidth = 560;
  const chartHeight = 340;
  const padding = { top: 35, right: 40, bottom: 55, left: 65 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  const maxDeflection = useMemo(() => {
    const vals = bowlData.map((d) => d.val);
    const m = Math.max(...vals, 1);
    return Math.ceil(m * 1.15); // 15% headroom
  }, [bowlData]);

  // Build SVG polyline points and smooth path
  const svgPoints = useMemo(() => {
    if (bowlData.length === 0) return [];
    const count = bowlData.length;
    return bowlData.map((d, i) => {
      const x =
        padding.left +
        (count > 1 ? (i / (count - 1)) * plotWidth : plotWidth / 2);
      // FWD deflection bowls typically plot downward or upward
      // Plotting zero at top, deflections dipping downward represents the bowl deformation
      const y = padding.top + (d.val / maxDeflection) * plotHeight;
      return { ...d, x, y };
    });
  }, [bowlData, plotWidth, plotHeight, maxDeflection]);

  // Create SVG path string
  const pathD = useMemo(() => {
    if (svgPoints.length === 0) return "";
    return svgPoints.reduce((acc, pt, i) => {
      return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, "");
  }, [svgPoints]);

  // Create filled polygon area below/above curve
  const areaD = useMemo(() => {
    if (svgPoints.length === 0) return "";
    const first = svgPoints[0];
    const last = svgPoints[svgPoints.length - 1];
    return `${pathD} L ${last.x} ${padding.top} L ${first.x} ${padding.top} Z`;
  }, [pathD, svgPoints]);

  return (
    <div style={{ flex: 1, display: "flex", height: "100%", overflow: "hidden", background: "#f5f6f8" }}>
      {/* ── Left Half: Station Deflection Table ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid var(--border-subtle)",
          background: "#ffffff",
          overflow: "hidden",
          minWidth: 380,
        }}
      >
        {/* Table Toolbar */}
        <div
          style={{
            padding: "var(--sp-2) var(--sp-4)",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#ffffff",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
            <span className="badge badge-dark">Drop {selectedVariant}</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {rows.length.toLocaleString()} stations
            </span>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Click row to view deflection bowl
          </span>
        </div>

        {/* Scrollable Table */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: "center" }}>#</th>
                <th style={{ position: "sticky", left: 0, zIndex: 3, background: "#f9fafb" }}>
                  StationID
                </th>
                {deflectionCols.map((col) => (
                  <th key={col} style={{ textAlign: "right" }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const isSelected = idx === selectedRowIndex;
                return (
                  <tr
                    key={row.StationID ? `${row.StationID}-${idx}` : idx}
                    onClick={() => setSelectedRowIndex(idx)}
                    style={{
                      cursor: "pointer",
                      backgroundColor: isSelected ? "#111827" : undefined,
                      color: isSelected ? "#ffffff" : undefined,
                    }}
                  >
                    <td
                      style={{
                        textAlign: "center",
                        fontSize: 11,
                        color: isSelected ? "#9ca3af" : "var(--text-muted)",
                      }}
                    >
                      {idx + 1}
                    </td>
                    <td
                      style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 1,
                        fontWeight: 700,
                        backgroundColor: isSelected ? "#111827" : undefined,
                        color: isSelected ? "#ffffff" : "var(--text-primary)",
                      }}
                    >
                      {row.StationID ?? "—"}
                    </td>
                    {deflectionCols.map((col) => {
                      const val = row[col];
                      const num = typeof val === "number" ? val : parseFloat(val);
                      return (
                        <td
                          key={col}
                          style={{
                            textAlign: "right",
                            fontFamily: "JetBrains Mono, monospace",
                            color: isSelected ? "#ffffff" : "var(--text-primary)",
                          }}
                        >
                          {isNaN(num) ? "—" : num.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Right Half: Deflection Bowl Curve ── */}
      <div
        style={{
          flex: 1.1,
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          overflow: "hidden",
          minWidth: 420,
        }}
      >
        {/* Bowl Header */}
        <div
          style={{
            padding: "var(--sp-2) var(--sp-6)",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#ffffff",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Deflection Bowl</span>
            {activeRow && (
              <span className="badge badge-dark">
                Station {activeRow.StationID ?? "—"}
              </span>
            )}
          </div>
          {activeRow?.Force && (
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Target Load: <strong>9,000 lbs</strong>
            </span>
          )}
        </div>

        {/* Deflection Chart Canvas */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "var(--sp-6)",
          }}
        >
          {activeRow ? (
            <div style={{ width: "100%", maxWidth: chartWidth, display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              {/* SVG Curve Container */}
              <div
                style={{
                  background: "#ffffff",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--r-md)",
                  padding: "var(--sp-4)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  style={{ width: "100%", height: "auto", overflow: "visible" }}
                >
                  {/* Grid Lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                    const y = padding.top + pct * plotHeight;
                    const val = (pct * maxDeflection).toFixed(1);
                    return (
                      <g key={pct}>
                        <line
                          x1={padding.left}
                          y1={y}
                          x2={chartWidth - padding.right}
                          y2={y}
                          stroke="#e5e7eb"
                          strokeDasharray="3 3"
                        />
                        <text
                          x={padding.left - 10}
                          y={y + 4}
                          textAnchor="end"
                          fontSize="10"
                          fill="#6b7280"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {val}
                        </text>
                      </g>
                    );
                  })}

                  {/* Surface Zero Reference Line */}
                  <line
                    x1={padding.left}
                    y1={padding.top}
                    x2={chartWidth - padding.right}
                    y2={padding.top}
                    stroke="#111827"
                    strokeWidth="1.5"
                  />

                  {/* Shaded deformation bowl area */}
                  <path
                    d={areaD}
                    fill="rgba(17, 24, 39, 0.05)"
                  />

                  {/* Bowl Curve Path */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#111827"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Sensor Data Points & Labels */}
                  {svgPoints.map((pt) => (
                    <g key={pt.sensor}>
                      {/* Vertical sensor drop line */}
                      <line
                        x1={pt.x}
                        y1={padding.top}
                        x2={pt.x}
                        y2={pt.y}
                        stroke="#d1d5db"
                        strokeDasharray="2 2"
                      />

                      {/* Point marker circle */}
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r="5"
                        fill="#111827"
                        stroke="#ffffff"
                        strokeWidth="2"
                      />

                      {/* Deflection Value label above dot */}
                      <text
                        x={pt.x}
                        y={pt.y + 16}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="600"
                        fill="#111827"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {pt.val.toFixed(2)}
                      </text>

                      {/* Sensor Name (D1, D2, ...) on X-axis */}
                      <text
                        x={pt.x}
                        y={chartHeight - padding.bottom + 20}
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="700"
                        fill="#374151"
                      >
                        {pt.sensor}
                      </text>
                    </g>
                  ))}

                  {/* Axis Titles */}
                  <text
                    x={padding.left - 30}
                    y={padding.top + plotHeight / 2}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="600"
                    fill="#6b7280"
                    transform={`rotate(-90 ${padding.left - 30} ${padding.top + plotHeight / 2})`}
                  >
                    Deflection (mils)
                  </text>
                  <text
                    x={padding.left + plotWidth / 2}
                    y={chartHeight - 12}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="600"
                    fill="#6b7280"
                  >
                    Sensor Distance / Offset
                  </text>
                </svg>
              </div>

              {/* Sensor Reading Chips */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(70px, 1fr))",
                  gap: "var(--sp-2)",
                }}
              >
                {bowlData.map((d) => (
                  <div
                    key={d.sensor}
                    style={{
                      background: "#ffffff",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--r-sm)",
                      padding: "6px 8px",
                      textAlign: "center",
                      boxShadow: "var(--shadow-xs)",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)" }}>
                      {d.sensor}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "JetBrains Mono, monospace", color: "var(--text-primary)" }}>
                      {d.val.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📉</div>
              <p>Select a station row on the left to view its deflection bowl.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
