import React, { useState, useMemo, useRef } from "react";
import { useToast } from "../context/ToastContext";
import RepresentativeSlideGuide from "./RepresentativeSlideGuide";

const DEFLECTION_RE = /^D(\d+)$/;

// SVG Chart dimensions and scaling
const chartWidth = 640;
const chartHeight = 400;
const padding = { top: 40, right: 35, bottom: 65, left: 75 };
const plotWidth = chartWidth - padding.left - padding.right;
const plotHeight = chartHeight - padding.top - padding.bottom;
const xGap = 28; // small margin before D1 and after D7 so curves/points don't start right on the border lines

export default function BowlView({
  rows = [],
  columns = [],
  selectedVariant = "A",
  sectionName = "",
}) {
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [prevVariant, setPrevVariant] = useState(selectedVariant);
  const [showSlideGuide, setShowSlideGuide] = useState(false);
  const selectedSvgRef = useRef(null);
  const overlaySvgRef = useRef(null);
  const rmseSvgRef = useRef(null);
  const { show } = useToast() || {};

  // Overlay chart layer visibility toggles
  const [showRepresentative, setShowRepresentative] = useState(true);
  const [showMean, setShowMean] = useState(true);
  const [showCurrent, setShowCurrent] = useState(true);
  const [showAll, setShowAll] = useState(true);

  if (prevVariant !== selectedVariant) {
    setPrevVariant(selectedVariant);
    setSelectedRowIndex(0);
  }

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

  const maxDeflection = useMemo(() => {
    const vals = bowlData.map((d) => d.val);
    const m = Math.max(...vals, 1);
    return Math.ceil(m * 1.15); // 15% headroom
  }, [bowlData]);

  // Build SVG polyline points and smooth path for Selected Row
  const svgPoints = useMemo(() => {
    if (bowlData.length === 0) return [];
    const count = bowlData.length;
    const availableWidth = Math.max(plotWidth - 2 * xGap, 0);
    return bowlData.map((d, i) => {
      const x =
        padding.left +
        xGap +
        (count > 1 ? (i / (count - 1)) * availableWidth : availableWidth / 2);
      const y = padding.top + (d.val / maxDeflection) * plotHeight;
      return { ...d, x, y };
    });
  }, [bowlData, maxDeflection]);

  const pathD = useMemo(() => {
    if (svgPoints.length === 0) return "";
    return svgPoints.reduce((acc, pt, i) => {
      return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, "");
  }, [svgPoints]);

  const areaD = useMemo(() => {
    if (svgPoints.length === 0) return "";
    const first = svgPoints[0];
    const last = svgPoints[svgPoints.length - 1];
    return `${pathD} L ${last.x} ${padding.top} L ${first.x} ${padding.top} Z`;
  }, [pathD, svgPoints]);

  // ── SECTION STATISTICAL ANALYSIS & REPRESENTATIVE BASIN ──
  const sectionStats = useMemo(() => {
    if (rows.length === 0 || deflectionCols.length === 0) return null;

    // 1. Calculate Mean, Std Dev, Min, Max for each sensor
    const sensorStats = deflectionCols.map((col) => {
      const values = rows
        .map((r) => {
          const v = r[col];
          return typeof v === "number" ? v : parseFloat(v);
        })
        .filter((v) => !isNaN(v));

      if (values.length === 0) {
        return { col, mean: 0, std: 0, cv: 0, min: 0, max: 0, count: 0 };
      }

      const mean = values.reduce((s, x) => s + x, 0) / values.length;
      const variance =
        values.length > 1
          ? values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1)
          : 0;
      const std = Math.sqrt(variance);
      const cv = mean > 0 ? (std / mean) * 100 : 0;
      const min = Math.min(...values);
      const max = Math.max(...values);

      return { col, mean, std, cv, min, max, count: values.length };
    });

    // Create mean vector lookup
    const meanMap = {};
    sensorStats.forEach((s) => {
      meanMap[s.col] = s.mean;
    });

    // 2. Compute RMSE distance from Mean vector for each station
    const rowsWithDistance = rows.map((r, originalIdx) => {
      let sumSq = 0;
      let validCount = 0;
      deflectionCols.forEach((col) => {
        const v = r[col];
        const num = typeof v === "number" ? v : parseFloat(v);
        if (!isNaN(num) && meanMap[col] !== undefined) {
          sumSq += (num - meanMap[col]) ** 2;
          validCount++;
        }
      });
      const rmse = validCount > 0 ? Math.sqrt(sumSq / validCount) : Infinity;
      return { row: r, originalIdx, rmse };
    });

    // 3. Representative Station: Minimum RMSE from mean
    let representative = null;
    let minRmse = Infinity;
    rowsWithDistance.forEach((item) => {
      if (item.rmse < minRmse) {
        minRmse = item.rmse;
        representative = item;
      }
    });

    // Compute all station RMSEs and section average RMSE
    const rmseByIndex = rowsWithDistance.map((r) => r.rmse);
    const validRmses = rmseByIndex.filter((v) => isFinite(v));
    const meanSectionRmse =
      validRmses.length > 0
        ? validRmses.reduce((s, x) => s + x, 0) / validRmses.length
        : 0;

    // 4. Basin Structural Indices (SCI, BDI, BCI, AREA)
    const computeBasinIndices = (getVal) => {
      const d1 = getVal("D1") ?? 0;
      const d2 = getVal("D2") ?? 0;
      const d3 = getVal("D3") ?? 0;
      const d4 = getVal("D4") ?? 0;

      const sci = d1 - d2; // Surface Curvature Index (Surface / AC layer)
      const bdi = d2 - d3; // Base Damage Index (Base layer)
      const bci = d3 - d4; // Base Curvature Index (Subbase / Subgrade)
      // AASHTO Area formula in inches
      const area = d1 > 0 ? 6 * (1 + 2 * (d2 / d1) + 2 * (d3 / d1) + (d4 / d1)) : 0;

      return { d1, d2, d3, d4, sci, bdi, bci, area };
    };

    const repIndices = representative
      ? computeBasinIndices((c) => {
          const v = representative.row[c];
          const n = typeof v === "number" ? v : parseFloat(v);
          return isNaN(n) ? 0 : n;
        })
      : null;

    const meanIndices = computeBasinIndices((c) => meanMap[c] ?? 0);

    // 5. Global maximum deflection for Overlay Chart scaling
    let globalMax = 1;
    rows.forEach((r) => {
      deflectionCols.forEach((col) => {
        const v = r[col];
        const n = typeof v === "number" ? v : parseFloat(v);
        if (!isNaN(n) && n > globalMax) globalMax = n;
      });
    });
    const overlayMaxDeflection = Math.ceil(globalMax * 1.15);

    return {
      sensorStats,
      meanMap,
      representative,
      repIndices,
      meanIndices,
      overlayMaxDeflection,
      validStationCount: rowsWithDistance.length,
      rmseByIndex,
      meanSectionRmse,
      rowsWithDistance,
    };
  }, [rows, deflectionCols]);

  const maxRmse = useMemo(() => {
    if (!sectionStats?.rowsWithDistance?.length) return 0.5;
    const vals = sectionStats.rowsWithDistance
      .map((r) => r.rmse)
      .filter((v) => isFinite(v));
    const m = Math.max(...vals, 0.05);
    return Math.ceil(m * 120) / 100;
  }, [sectionStats]);

  const selectedRowRmse = sectionStats?.rmseByIndex?.[selectedRowIndex] ?? null;
  const isRepSelected = sectionStats?.representative?.originalIdx === selectedRowIndex;

  // ── OVERLAY CHART SVG PATH COMPUTATIONS ──
  const overlayData = useMemo(() => {
    if (!sectionStats || deflectionCols.length === 0) return null;
    const { overlayMaxDeflection, meanMap, representative } = sectionStats;
    const count = deflectionCols.length;
    const availableWidth = Math.max(plotWidth - 2 * xGap, 0);

    const getX = (i) =>
      padding.left +
      xGap +
      (count > 1 ? (i / (count - 1)) * availableWidth : availableWidth / 2);

    // Background station curves
    const stationPaths = rows.map((r, idx) => {
      const pts = deflectionCols.map((col, i) => {
        const v = r[col];
        const num = typeof v === "number" ? v : parseFloat(v);
        const val = isNaN(num) ? 0 : num;
        const x = getX(i);
        const y = padding.top + (val / overlayMaxDeflection) * plotHeight;
        return { x, y };
      });
      const d = pts.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), "");
      return { id: r.StationID ?? idx, d };
    });

    // Mean curve points & path
    const meanPoints = deflectionCols.map((col, i) => {
      const val = meanMap[col] ?? 0;
      const x = getX(i);
      const y = padding.top + (val / overlayMaxDeflection) * plotHeight;
      return { sensor: col, val, x, y };
    });
    const meanPath = meanPoints.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), "");

    // Representative Station curve points & path
    const repPoints = representative
      ? deflectionCols.map((col, i) => {
          const v = representative.row[col];
          const num = typeof v === "number" ? v : parseFloat(v);
          const val = isNaN(num) ? 0 : num;
          const x = getX(i);
          const y = padding.top + (val / overlayMaxDeflection) * plotHeight;
          return { sensor: col, val, x, y };
        })
      : [];
    const repPath = repPoints.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), "");

    // Current / Selected Station curve points & path
    const currentPoints = activeRow
      ? deflectionCols.map((col, i) => {
          const v = activeRow[col];
          const num = typeof v === "number" ? v : parseFloat(v);
          const val = isNaN(num) ? 0 : num;
          const x = getX(i);
          const y = padding.top + (val / overlayMaxDeflection) * plotHeight;
          return { sensor: col, val, x, y };
        })
      : [];
    const currentPath = currentPoints.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), "");

    return {
      stationPaths,
      meanPoints,
      meanPath,
      repPoints,
      repPath,
      currentPoints,
      currentPath,
      overlayMaxDeflection,
    };
  }, [sectionStats, rows, deflectionCols, activeRow]);

  // ── EXPORT / COPY TO CANVAS HELPER ──
  const exportChartAsCanvas = async (svgEl) => {
    if (!svgEl) return null;

    const clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    // Get true viewBox dimensions or fallback
    const vb = svgEl.viewBox?.baseVal;
    const actualWidth = vb && vb.width > 0 ? vb.width : (svgEl.clientWidth || chartWidth);
    const actualHeight = vb && vb.height > 0 ? vb.height : (svgEl.clientHeight || chartHeight);

    clone.setAttribute("width", String(actualWidth));
    clone.setAttribute("height", String(actualHeight));

    // Ensure white background inside SVG clone so exported image is opaque
    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("width", "100%");
    bgRect.setAttribute("height", "100%");
    bgRect.setAttribute("fill", "#ffffff");
    clone.insertBefore(bgRect, clone.firstChild);

    const svgString = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = 3; // 3x ultra-sharp resolution (no blurriness)
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(actualWidth * scale);
        canvas.height = Math.round(actualHeight * scale);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  };

  const handleCopyChart = async (svgEl, label = "Chart") => {
    try {
      const canvas = await exportChartAsCanvas(svgEl);
      if (!canvas) return;

      canvas.toBlob(async (blob) => {
        if (!blob) {
          show?.("Failed to generate chart image", "error");
          return;
        }
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          show?.(`${label} copied to clipboard!`, "success");
        } catch (err) {
          console.error("Clipboard copy error:", err);
          show?.("Could not copy chart to clipboard", "error");
        }
      }, "image/png");
    } catch (err) {
      console.error("Export error:", err);
      show?.("Error copying chart", "error");
    }
  };

  const handleDownloadChart = async (svgEl, filename) => {
    try {
      const canvas = await exportChartAsCanvas(svgEl);
      if (!canvas) return;

      canvas.toBlob((blob) => {
        if (!blob) {
          show?.("Failed to generate chart image", "error");
          return;
        }
        const link = document.createElement("a");
        link.download = filename;
        link.href = URL.createObjectURL(blob);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        show?.("Chart downloaded as PNG!", "success");
      }, "image/png");
    } catch (err) {
      console.error("Download error:", err);
      show?.("Error downloading chart", "error");
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", height: "100%", overflow: "hidden", background: "#f5f6f8" }}>
      {/* ── Left Half: Station Deflection Table ── */}
      <div
        style={{
          flex: "0 0 380px",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid var(--border-subtle)",
          background: "#ffffff",
          overflow: "hidden",
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
          {sectionStats?.representative && (
            <span
              style={{ fontSize: 11, color: "var(--accent-blue)", cursor: "pointer", fontWeight: 600 }}
              onClick={() => setSelectedRowIndex(sectionStats.representative.originalIdx)}
              title="Select representative station"
            >
              Rep: Station {sectionStats.representative.row.StationID}
            </span>
          )}
        </div>

        {/* Scrollable Table */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th
                  style={{
                    width: 40,
                    minWidth: 40,
                    textAlign: "center",
                    position: "sticky",
                    left: 0,
                    zIndex: 3,
                    background: "#f9fafb",
                  }}
                >
                  #
                </th>
                <th
                  style={{
                    position: "sticky",
                    left: 40,
                    zIndex: 3,
                    background: "#f9fafb",
                  }}
                >
                  StationID
                </th>
                <th
                  style={{
                    textAlign: "right",
                    background: "#f9fafb",
                    padding: "6px 10px",
                  }}
                  title="Root-Mean-Square Error distance to Section Mean Bowl"
                >
                  RMSE (mils)
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
                const isRep = sectionStats?.representative?.originalIdx === idx;
                return (
                  <tr
                    key={row.StationID ? `${row.StationID}-${idx}` : idx}
                    onClick={() => setSelectedRowIndex(idx)}
                    className={isSelected ? "selected-row" : ""}
                    style={{
                      cursor: "pointer",
                    }}
                  >
                    <td
                      className="col-index"
                      style={{
                        textAlign: "center",
                        fontSize: 11,
                        position: "sticky",
                        left: 0,
                        zIndex: 1,
                      }}
                    >
                      {idx + 1}
                    </td>
                    <td
                      className="col-stationid-sticky"
                      style={{
                        position: "sticky",
                        left: 40,
                        zIndex: 1,
                        fontWeight: 700,
                      }}
                    >
                      <span>{row.StationID ?? "—"}</span>
                      {isRep && (
                        <span
                          style={{
                            marginLeft: 4,
                            fontSize: 9,
                            padding: "1px 4px",
                            borderRadius: 3,
                            background: isSelected ? "#374151" : "#dbeafe",
                            color: isSelected ? "#93c5fd" : "#1d4ed8",
                          }}
                          title="Representative Station (Minimum RMSE to section mean)"
                        >
                          REP
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontFamily: "JetBrains Mono, monospace",
                        fontSize: 11,
                        padding: "6px 10px",
                        color: isRep ? "#2563eb" : "var(--text-secondary)",
                        fontWeight: isRep ? 700 : 400,
                        background: isRep && !isSelected ? "rgba(37, 99, 235, 0.06)" : undefined,
                      }}
                      title={
                        isRep
                          ? `Representative Station (Lowest RMSE: ${sectionStats?.rmseByIndex?.[idx]?.toFixed(3)} mils)`
                          : `RMSE to Section Mean: ${sectionStats?.rmseByIndex?.[idx]?.toFixed(3)} mils`
                      }
                    >
                      {sectionStats?.rmseByIndex?.[idx] !== undefined && isFinite(sectionStats.rmseByIndex[idx])
                        ? sectionStats.rmseByIndex[idx].toFixed(3)
                        : "—"}
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

      {/* ── Right Half: Scrollable Analysis & Bowls Panel ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: "#ffffff",
          overflowY: "auto",
          overflowX: "hidden",
          minWidth: 460,
        }}
      >
        {/* ── 1. SELECTED STATION DEFLECTION BOWL ── */}
        <div style={{ padding: "var(--sp-4) var(--sp-6) var(--sp-6)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "var(--sp-4)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                Selected Station Bowl
              </span>
              {activeRow && (
                <span className="badge badge-dark">
                  Station {activeRow.StationID ?? "—"}
                </span>
              )}
              {isRepSelected && (
                <span className="badge badge-green" style={{ fontSize: 12, padding: "3px 8px" }}>
                  Representative Station
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowSlideGuide(true)}
                title="Open step-by-step presentation slides explaining representative bowl selection, equations, and charts"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "#2563eb",
                  color: "#ffffff",
                  fontWeight: 600,
                  boxShadow: "0 1px 3px rgba(37, 99, 235, 0.25)",
                }}
              >
                <span>📊</span> Slides Guide
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleCopyChart(selectedSvgRef.current, "Station Bowl")}
                title="Copy chart image to clipboard"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span>📋</span> Copy
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  handleDownloadChart(
                    selectedSvgRef.current,
                    `Deflection_Bowl_Station_${activeRow?.StationID ?? "data"}_Drop_${selectedVariant}.png`
                  )
                }
                title="Download chart as PNG image"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span>⬇</span> Download
              </button>
            </div>
          </div>

          {activeRow ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", alignItems: "center" }}>
              <div
                style={{
                  width: "100%",
                  maxWidth: chartWidth,
                  background: "#ffffff",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--r-md)",
                  padding: "var(--sp-4)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <svg
                  ref={selectedSvgRef}
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  style={{ width: "100%", height: "auto", overflow: "visible", background: "#ffffff" }}
                  shapeRendering="crispEdges"
                  textRendering="geometricPrecision"
                >
                  {/* Major Horizontal Grid Lines & Y-axis Inner Ticks */}
                  {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                    const y = padding.top + pct * plotHeight;
                    const val = (pct * maxDeflection).toFixed(1);
                    return (
                      <g key={pct}>
                        <line
                          x1={padding.left}
                          y1={y}
                          x2={padding.left + plotWidth}
                          y2={y}
                          stroke="#e5e7eb"
                          strokeWidth="1"
                        />
                        <line
                          x1={padding.left}
                          y1={y}
                          x2={padding.left + 6}
                          y2={y}
                          stroke="#000000"
                          strokeWidth="1.5"
                        />
                        <text
                          x={padding.left - 10}
                          y={y + 5}
                          textAnchor="end"
                          fontSize="14"
                          fill="#000000"
                          fontFamily="Arial, sans-serif"
                          shapeRendering="auto"
                        >
                          {val}
                        </text>
                      </g>
                    );
                  })}

                  {/* Major Vertical Grid Lines & X-axis Inner Ticks */}
                  {svgPoints.map((pt) => (
                    <g key={`grid-x-${pt.sensor}`}>
                      <line
                        x1={pt.x}
                        y1={padding.top}
                        x2={pt.x}
                        y2={padding.top + plotHeight}
                        stroke="#e5e7eb"
                        strokeWidth="1"
                      />
                      <line
                        x1={pt.x}
                        y1={padding.top + plotHeight}
                        x2={pt.x}
                        y2={padding.top + plotHeight - 6}
                        stroke="#000000"
                        strokeWidth="1.5"
                      />
                      <text
                        x={pt.x}
                        y={padding.top + plotHeight + 22}
                        textAnchor="middle"
                        fontSize="14"
                        fontWeight="normal"
                        fill="#000000"
                        fontFamily="Arial, sans-serif"
                        shapeRendering="auto"
                      >
                        {pt.sensor}
                      </text>
                    </g>
                  ))}

                  {/* Shaded deformation bowl area */}
                  <path d={areaD} fill="rgba(0, 0, 0, 0.05)" shapeRendering="auto" />

                  {/* Bowl Curve Path */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#000000"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    shapeRendering="auto"
                  />

                  {/* Sensor Data Points & Data Labels */}
                  {svgPoints.map((pt, i) => {
                    const textAnchor = "middle";
                    const labelX = pt.x;
                    const labelY = pt.y > padding.top + plotHeight - 25 ? pt.y - 10 : pt.y + 18;
                    return (
                      <g key={pt.sensor}>
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r="5"
                          fill="#000000"
                          stroke="#ffffff"
                          strokeWidth="2"
                          shapeRendering="auto"
                        />
                        <text
                          x={labelX}
                          y={labelY}
                          textAnchor={textAnchor}
                          fontSize="12"
                          fontWeight="normal"
                          fill="#000000"
                          fontFamily="Arial, sans-serif"
                          shapeRendering="auto"
                        >
                          {pt.val.toFixed(2)}
                        </text>
                      </g>
                    );
                  })}

                  {/* 4-sided Inner Box Border */}
                  <rect
                    x={padding.left}
                    y={padding.top}
                    width={plotWidth}
                    height={plotHeight}
                    fill="none"
                    stroke="#000000"
                    strokeWidth="1.5"
                  />

                  {/* Axis Titles */}
                  <text
                    x={padding.left - 48}
                    y={padding.top + plotHeight / 2}
                    textAnchor="middle"
                    fontSize="16"
                    fontWeight="bold"
                    fill="#000000"
                    fontFamily="Arial, sans-serif"
                    shapeRendering="auto"
                    transform={`rotate(-90 ${padding.left - 48} ${padding.top + plotHeight / 2})`}
                  >
                    Deflection (mils)
                  </text>
                  <text
                    x={padding.left + plotWidth / 2}
                    y={chartHeight - 14}
                    textAnchor="middle"
                    fontSize="16"
                    fontWeight="bold"
                    fill="#000000"
                    fontFamily="Arial, sans-serif"
                    shapeRendering="auto"
                  >
                    Sensor
                  </text>
                </svg>
              </div>

              {/* Sensor Reading Chips */}
              <div
                style={{
                  width: "100%",
                  maxWidth: chartWidth,
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

        {/* ── SECTION SEPARATOR ── */}
        <div style={{ height: 1, background: "var(--border-subtle)", margin: "var(--sp-2) var(--sp-6)" }} />

        {/* ── 2. BASIN DEVIATION COMPARISON (WHY REPRESENTATIVE WINS) ── */}
        {sectionStats?.representative && sectionStats.rowsWithDistance?.length > 0 && (
          <div style={{ padding: "var(--sp-4) var(--sp-6) var(--sp-6)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "var(--sp-4)",
                flexWrap: "wrap",
                gap: "var(--sp-2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
                  RMSE Comparison
                </h3>
                <span className="badge badge-dark" style={{ fontSize: 12, padding: "3px 8px" }}>
                  Current (Station {activeRow?.StationID ?? "—"}): {selectedRowRmse !== null && isFinite(selectedRowRmse) ? `${selectedRowRmse.toFixed(3)} mils` : "—"}
                </span>
                {sectionStats.representative && (
                  <span className="badge badge-blue" style={{ fontSize: 12, padding: "3px 8px" }}>
                    Representative (Station {sectionStats.representative.row.StationID}): {sectionStats.representative.rmse.toFixed(3)} mils
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowSlideGuide(true)}
                  title="View step-by-step slides and mathematical equations for representative selection"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    borderColor: "#93c5fd",
                    color: "#1d4ed8",
                    background: "#eff6ff",
                    fontWeight: 600,
                  }}
                >
                  <span>📖</span> Methodology Slides
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleCopyChart(rmseSvgRef.current, "RMSE Comparison")}
                  title="Copy comparison chart image to clipboard"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span>📋</span> Copy
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    handleDownloadChart(
                      rmseSvgRef.current,
                      `RMSE_Comparison_Drop_${selectedVariant}.png`
                    )
                  }
                  title="Download comparison chart as PNG image"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span>⬇</span> Download
                </button>
              </div>
            </div>

            {/* Comparison SVG Chart */}
            {(() => {
              const count = sectionStats.rowsWithDistance.length;
              const cWidth = chartWidth;
              const cHeight = 220;
              const pad = { top: 25, right: 20, bottom: 46, left: 60 };
              const pWidth = cWidth - pad.left - pad.right;
              const pHeight = cHeight - pad.top - pad.bottom;
              const slotWidth = count > 1 ? pWidth / count : pWidth;
              const barWidth = Math.max(2.5, Math.min(14, slotWidth - 2));

              // Compute station label font size based on density
              const stationFontSize = count > 60 ? 8 : count > 35 ? 9 : 10;
              // Sample interval if there are way too many bars (e.g. > 100), otherwise show all
              const step = count > 80 ? Math.ceil(count / 50) : 1;

              return (
                <div
                  style={{
                    background: "#ffffff",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--r-md)",
                    padding: "var(--sp-4)",
                    boxShadow: "var(--shadow-sm)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  }}
                >
                  <svg
                    ref={rmseSvgRef}
                    viewBox={`0 0 ${cWidth} ${cHeight}`}
                    style={{ width: "100%", height: "auto", overflow: "visible", background: "#ffffff" }}
                    shapeRendering="crispEdges"
                    textRendering="geometricPrecision"
                  >
                    {/* Horizontal Gridlines & Y-axis Ticks */}
                    {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                      const y = pad.top + (1 - pct) * pHeight;
                      const val = (pct * maxRmse).toFixed(2);
                      return (
                        <g key={pct}>
                          <line
                            x1={pad.left}
                            y1={y}
                            x2={pad.left + pWidth}
                            y2={y}
                            stroke="#e5e7eb"
                            strokeWidth="1"
                          />
                          <line
                            x1={pad.left}
                            y1={y}
                            x2={pad.left + 6}
                            y2={y}
                            stroke="#000000"
                            strokeWidth="1.5"
                          />
                          <text
                            x={pad.left - 8}
                            y={y + 3.5}
                            textAnchor="end"
                            fontSize="10"
                            fill="#000000"
                            fontFamily="Arial, sans-serif"
                            shapeRendering="auto"
                          >
                            {val}
                          </text>
                        </g>
                      );
                    })}

                    {/* Station Bars & Ticks */}
                    {sectionStats.rowsWithDistance.map((item, idx) => {
                      const cx = pad.left + idx * slotWidth + slotWidth / 2;
                      const bx = cx - barWidth / 2;
                      const bHeight = maxRmse > 0 ? (item.rmse / maxRmse) * pHeight : 0;
                      const by = pad.top + pHeight - bHeight;
                      const showLabel = idx % step === 0 || idx === count - 1;
                      const rmseValStr = item.rmse.toFixed(2);
                      const fitsInside = bHeight >= 34;
                      const valY = fitsInside ? by + 5 : by - 4;
                      const valAnchor = fitsInside ? "end" : "start";
                      const valFill = fitsInside ? "#ffffff" : "#000000";
                      const valFontSize = barWidth >= 12 ? 8.5 : barWidth >= 9 ? 7.5 : 6.5;

                      return (
                        <g key={item.originalIdx}>
                          <rect
                            x={bx}
                            y={by}
                            width={barWidth}
                            height={bHeight}
                            rx={0}
                            fill="#000000"
                          >
                            <title>Station {item.row.StationID}: {rmseValStr} mils</title>
                          </rect>

                          {/* Vertical RMSE Value on the Bar */}
                          {barWidth >= 5 && (
                            <text
                              x={cx}
                              y={valY}
                              textAnchor={valAnchor}
                              dominantBaseline="central"
                              fontSize={valFontSize}
                              fontWeight="bold"
                              fill={valFill}
                              fontFamily="Arial, sans-serif"
                              shapeRendering="auto"
                              transform={`rotate(-90 ${cx} ${valY})`}
                            >
                              {rmseValStr}
                            </text>
                          )}

                          {/* X-axis Station Ticks & Rotated Label (-90deg centered on bar) */}
                          {showLabel && (
                            <g>
                              <line
                                x1={cx}
                                y1={pad.top + pHeight}
                                x2={cx}
                                y2={pad.top + pHeight + 4}
                                stroke="#000000"
                                strokeWidth="1"
                              />
                              <text
                                x={cx}
                                y={pad.top + pHeight + 6}
                                textAnchor="end"
                                dominantBaseline="central"
                                fontSize={stationFontSize}
                                fill="#000000"
                                fontFamily="Arial, sans-serif"
                                shapeRendering="auto"
                                transform={`rotate(-90 ${cx} ${pad.top + pHeight + 6})`}
                              >
                                {item.row.StationID ?? idx + 1}
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                    {/* Chart Box Border */}
                    <rect
                      x={pad.left}
                      y={pad.top}
                      width={pWidth}
                      height={pHeight}
                      fill="none"
                      stroke="#000000"
                      strokeWidth="1.5"
                    />

                    {/* Axis Titles */}
                    <text
                      x={pad.left - 42}
                      y={pad.top + pHeight / 2}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="bold"
                      fill="#000000"
                      fontFamily="Arial, sans-serif"
                      shapeRendering="auto"
                      transform={`rotate(-90 ${pad.left - 42} ${pad.top + pHeight / 2})`}
                    >
                      RMSE (mils)
                    </text>
                    <text
                      x={pad.left + pWidth / 2}
                      y={pad.top + pHeight + 38}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="bold"
                      fill="#000000"
                      fontFamily="Arial, sans-serif"
                      shapeRendering="auto"
                    >
                      Station ID
                    </text>
                  </svg>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── SECTION SEPARATOR ── */}
        <div style={{ height: 1, background: "var(--border-subtle)", margin: "var(--sp-2) var(--sp-6)" }} />

        {/* ── 2. SECTION STATISTICAL ANALYSIS RESULTS ── */}
        {sectionStats && (
          <div style={{ padding: "var(--sp-4) var(--sp-6) var(--sp-6)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "var(--sp-3)",
                marginBottom: "var(--sp-4)",
              }}
            >
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
                  Section Statistical Analysis{sectionName ? ` — ${sectionName}` : ""}
                </h3>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                {sectionStats.representative && (
                  <span className="badge badge-dark" style={{ fontSize: 12, padding: "3px 8px" }}>
                    Representative: Station {sectionStats.representative.row.StationID}
                  </span>
                )}
              </div>
            </div>

            {/* Basin Structural Indices (SCI, BDI, BCI, AREA) */}
            {sectionStats.repIndices && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                  gap: "var(--sp-3)",
                  marginBottom: "var(--sp-4)",
                }}
              >
                <div className="card" style={{ padding: "var(--sp-3)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>D1 (Max Defl.)</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", marginTop: 2 }}>
                    {sectionStats.repIndices.d1.toFixed(2)}{" "}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>mils</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    Mean: {sectionStats.meanIndices.d1.toFixed(2)}
                  </div>
                </div>

                <div className="card" style={{ padding: "var(--sp-3)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>SCI (D1 - D2)</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", marginTop: 2 }}>
                    {sectionStats.repIndices.sci.toFixed(2)}{" "}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>mils</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    Surface / AC stiffness
                  </div>
                </div>

                <div className="card" style={{ padding: "var(--sp-3)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>BDI (D2 - D3)</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", marginTop: 2 }}>
                    {sectionStats.repIndices.bdi.toFixed(2)}{" "}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>mils</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    Base layer condition
                  </div>
                </div>

                <div className="card" style={{ padding: "var(--sp-3)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>BCI (D3 - D4)</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", marginTop: 2 }}>
                    {sectionStats.repIndices.bci.toFixed(2)}{" "}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>mils</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    Subgrade response
                  </div>
                </div>

                <div className="card" style={{ padding: "var(--sp-3)" }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>AREA Parameter</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", marginTop: 2 }}>
                    {sectionStats.repIndices.area.toFixed(1)}{" "}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>in</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    Mean: {sectionStats.meanIndices.area.toFixed(1)} in
                  </div>
                </div>
              </div>
            )}

            {/* Sensor Statistics Summary Table */}
            <div
              style={{
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--r-md)",
                overflow: "hidden",
                background: "#ffffff",
              }}
            >
              <table className="data-table" style={{ width: "100%", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ background: "#f9fafb" }}>Sensor</th>
                    <th style={{ textAlign: "right", background: "#f9fafb" }}>Mean (μ)</th>
                    <th style={{ textAlign: "right", background: "#f9fafb" }}>Std Dev (σ)</th>
                    <th style={{ textAlign: "right", background: "#f9fafb" }}>CV (%)</th>
                    <th style={{ textAlign: "right", background: "#f9fafb", color: "#111827", fontWeight: 700 }}>
                      Rep (#{sectionStats.representative?.row.StationID ?? "—"})
                    </th>
                    <th style={{ textAlign: "right", background: "#f9fafb" }}>Min</th>
                    <th style={{ textAlign: "right", background: "#f9fafb" }}>Max</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionStats.sensorStats.map((st) => {
                    const repVal = sectionStats.representative
                      ? parseFloat(sectionStats.representative.row[st.col])
                      : NaN;
                    return (
                      <tr key={st.col}>
                        <td style={{ fontWeight: 600 }}>{st.col}</td>
                        <td style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace" }}>
                          {st.mean.toFixed(2)}
                        </td>
                        <td style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", color: "var(--text-secondary)" }}>
                          {st.std.toFixed(2)}
                        </td>
                        <td style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", color: "var(--text-secondary)" }}>
                          {st.cv.toFixed(1)}%
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            fontFamily: "JetBrains Mono, monospace",
                            fontWeight: 700,
                            background: "rgba(17, 24, 39, 0.03)",
                          }}
                        >
                          {isNaN(repVal) ? "—" : repVal.toFixed(2)}
                        </td>
                        <td style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", color: "var(--text-muted)" }}>
                          {st.min.toFixed(2)}
                        </td>
                        <td style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", color: "var(--text-muted)" }}>
                          {st.max.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── SECTION SEPARATOR ── */}
        <div style={{ height: 1, background: "var(--border-subtle)", margin: "var(--sp-2) var(--sp-6)" }} />

        {/* ── 3. SECTION DEFLECTION BOWL OVERLAY CHART ── */}
        {overlayData && (() => {
          const legendItems = [];
          if (showRepresentative && sectionStats?.representative) {
            legendItems.push({
              id: "rep",
              label: `Representative (STA ${sectionStats.representative.row.StationID})`,
              type: "solid-green",
            });
          }
          if (showMean) {
            legendItems.push({
              id: "mean",
              label: "Section Mean",
              type: "dashed-red",
            });
          }
          if (showCurrent && activeRow) {
            legendItems.push({
              id: "current",
              label: `Current (${activeRow.StationID ?? "—"})`,
              type: "solid-blue",
            });
          }
          if (showAll) {
            legendItems.push({
              id: "all",
              label: `All Stations (${rows.length})`,
              type: "thin-black",
            });
          }

          const legendWidth = 230;
          const legendHeight = 16 + legendItems.length * 20;
          const legendX = padding.left + plotWidth - legendWidth - 14;
          const legendY = padding.top + plotHeight - legendHeight - 14;

          return (
            <div style={{ padding: "var(--sp-4) var(--sp-6) var(--sp-8)" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "var(--sp-3)",
                  flexWrap: "wrap",
                  gap: "var(--sp-2)",
                }}
              >
                <div>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                    Section Deflection Bowl Overlay
                  </span>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                    Compare Representative, Section Mean, Current Station, and all section stations
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleCopyChart(overlaySvgRef.current, "Overlay Chart")}
                    title="Copy overlay chart image to clipboard"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <span>📋</span> Copy
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      handleDownloadChart(
                        overlaySvgRef.current,
                        `Deflection_Bowl_Overlay_Section_Drop_${selectedVariant}.png`
                      )
                    }
                    title="Download overlay chart as PNG image"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <span>⬇</span> Download
                  </button>
                </div>
              </div>

              {/* Layer Checkboxes Bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--sp-5)",
                  flexWrap: "wrap",
                  padding: "8px 14px",
                  background: "#f9fafb",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--r-sm)",
                  marginBottom: "var(--sp-4)",
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>
                  Layers:
                </span>

                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={showRepresentative}
                    onChange={(e) => setShowRepresentative(e.target.checked)}
                    style={{ accentColor: "#16a34a", cursor: "pointer" }}
                  />
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 500 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
                    Representative (STA {sectionStats?.representative?.row.StationID ?? "—"})
                  </span>
                </label>

                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={showMean}
                    onChange={(e) => setShowMean(e.target.checked)}
                    style={{ accentColor: "#dc2626", cursor: "pointer" }}
                  />
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 500 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#dc2626", display: "inline-block" }} />
                    Section Mean
                  </span>
                </label>

                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={showCurrent}
                    onChange={(e) => setShowCurrent(e.target.checked)}
                    style={{ accentColor: "#2563eb", cursor: "pointer" }}
                  />
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 500 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#2563eb", display: "inline-block" }} />
                    Current Station ({activeRow?.StationID ?? "—"})
                  </span>
                </label>

                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(e) => setShowAll(e.target.checked)}
                    style={{ accentColor: "#111827", cursor: "pointer" }}
                  />
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 500 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#111827", display: "inline-block" }} />
                    All Stations ({rows.length})
                  </span>
                </label>
              </div>

              {/* Overlay SVG Container */}
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", alignItems: "center" }}>
                <div
                  style={{
                    width: "100%",
                    maxWidth: chartWidth,
                    background: "#ffffff",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--r-md)",
                    padding: "var(--sp-4)",
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <svg
                    ref={overlaySvgRef}
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    style={{ width: "100%", height: "auto", overflow: "visible", background: "#ffffff" }}
                    shapeRendering="crispEdges"
                    textRendering="geometricPrecision"
                  >
                    {/* Major Horizontal Grid Lines & Y-axis Inner Ticks */}
                    {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                      const y = padding.top + pct * plotHeight;
                      const val = (pct * overlayData.overlayMaxDeflection).toFixed(1);
                      return (
                        <g key={pct}>
                          <line
                            x1={padding.left}
                            y1={y}
                            x2={padding.left + plotWidth}
                            y2={y}
                            stroke="#e5e7eb"
                            strokeWidth="1"
                          />
                          <line
                            x1={padding.left}
                            y1={y}
                            x2={padding.left + 6}
                            y2={y}
                            stroke="#000000"
                            strokeWidth="1.5"
                          />
                          <text
                            x={padding.left - 10}
                            y={y + 5}
                            textAnchor="end"
                            fontSize="14"
                            fill="#000000"
                            fontFamily="Arial, sans-serif"
                            shapeRendering="auto"
                          >
                            {val}
                          </text>
                        </g>
                      );
                    })}

                    {/* Major Vertical Grid Lines & X-axis Inner Ticks */}
                    {overlayData.meanPoints.map((pt) => (
                      <g key={`overlay-grid-x-${pt.sensor}`}>
                        <line
                          x1={pt.x}
                          y1={padding.top}
                          x2={pt.x}
                          y2={padding.top + plotHeight}
                          stroke="#e5e7eb"
                          strokeWidth="1"
                        />
                        <line
                          x1={pt.x}
                          y1={padding.top + plotHeight}
                          x2={pt.x}
                          y2={padding.top + plotHeight - 6}
                          stroke="#000000"
                          strokeWidth="1.5"
                        />
                        <text
                          x={pt.x}
                          y={padding.top + plotHeight + 22}
                          textAnchor="middle"
                          fontSize="14"
                          fontWeight="normal"
                          fill="#000000"
                          fontFamily="Arial, sans-serif"
                          shapeRendering="auto"
                        >
                          {pt.sensor}
                        </text>
                      </g>
                    ))}

                    {/* 1. All Stations (Others in Black) */}
                    {showAll &&
                      overlayData.stationPaths.map((sp) => (
                        <path
                          key={sp.id}
                          d={sp.d}
                          fill="none"
                          stroke="#111827"
                          strokeWidth="1.2"
                          opacity="0.20"
                        />
                      ))}

                    {/* 2. Current Station (Blue) */}
                    {showCurrent && overlayData.currentPath && (
                      <>
                        <path
                          d={overlayData.currentPath}
                          fill="none"
                          stroke="#2563eb"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {overlayData.currentPoints.map((pt) => {
                          const textAnchor = "middle";
                          const labelX = pt.x;
                          const labelY = pt.y > padding.top + plotHeight - 25 ? pt.y - 10 : pt.y + 18;
                          return (
                            <g key={`current-pt-${pt.sensor}`}>
                              <circle
                                cx={pt.x}
                                cy={pt.y}
                                r="4.5"
                                fill="#2563eb"
                                stroke="#ffffff"
                                strokeWidth="1.5"
                              />
                              {(!showRepresentative || activeRow?.StationID !== sectionStats?.representative?.row.StationID) && (
                                <text
                                  x={labelX}
                                  y={labelY}
                                  textAnchor={textAnchor}
                                  fontSize="12"
                                  fontWeight="normal"
                                  fill="#2563eb"
                                  fontFamily="Arial, sans-serif"
                                >
                                  {pt.val.toFixed(2)}
                                </text>
                              )}
                            </g>
                          );
                        })}
                      </>
                    )}

                    {/* 3. Section Mean Curve (Red) */}
                    {showMean && (
                      <>
                        <path
                          d={overlayData.meanPath}
                          fill="none"
                          stroke="#dc2626"
                          strokeWidth="2"
                          strokeDasharray="6 3"
                        />
                        {overlayData.meanPoints.map((pt) => (
                          <circle
                            key={`mean-pt-${pt.sensor}`}
                            cx={pt.x}
                            cy={pt.y}
                            r="3.5"
                            fill="#dc2626"
                            stroke="#ffffff"
                            strokeWidth="1.5"
                          />
                        ))}
                      </>
                    )}

                    {/* 4. Representative Station Curve (Green) */}
                    {showRepresentative && overlayData.repPath && (
                      <>
                        <path
                          d={overlayData.repPath}
                          fill="none"
                          stroke="#16a34a"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {overlayData.repPoints.map((pt) => {
                          const textAnchor = "middle";
                          const labelX = pt.x;
                          const labelY = pt.y > padding.top + plotHeight - 25 ? pt.y - 10 : pt.y + 18;
                          return (
                            <g key={`rep-pt-${pt.sensor}`}>
                              <circle
                                cx={pt.x}
                                cy={pt.y}
                                r="5"
                                fill="#16a34a"
                                stroke="#ffffff"
                                strokeWidth="2"
                              />
                              <text
                                x={labelX}
                                y={labelY}
                                textAnchor={textAnchor}
                                fontSize="12"
                                fontWeight="normal"
                                fill="#16a34a"
                                fontFamily="Arial, sans-serif"
                              >
                                {pt.val.toFixed(2)}
                              </text>
                            </g>
                          );
                        })}
                      </>
                    )}

                    {/* 4-sided Inner Box Border */}
                    <rect
                      x={padding.left}
                      y={padding.top}
                      width={plotWidth}
                      height={plotHeight}
                      fill="none"
                      stroke="#000000"
                      strokeWidth="1.5"
                    />

                    {/* Bottom-Right Legend Box with Solid Black Border */}
                    {legendItems.length > 0 && (
                      <g transform={`translate(${legendX}, ${legendY})`}>
                        <rect
                          x="0"
                          y="0"
                          width={legendWidth}
                          height={legendHeight}
                          fill="rgba(255, 255, 255, 0.96)"
                          stroke="#000000"
                          strokeWidth="1.5"
                          rx="3"
                        />
                        {legendItems.map((item, idx) => {
                          const itemY = 16 + idx * 20;
                          return (
                            <g key={item.id}>
                              {item.type === "solid-green" && (
                                <>
                                  <line x1="12" y1={itemY} x2="34" y2={itemY} stroke="#16a34a" strokeWidth="3" />
                                  <circle cx="23" cy={itemY} r="3.5" fill="#16a34a" stroke="#ffffff" strokeWidth="1" />
                                </>
                              )}
                              {item.type === "dashed-red" && (
                                <>
                                  <line x1="12" y1={itemY} x2="34" y2={itemY} stroke="#dc2626" strokeWidth="2" strokeDasharray="5 2.5" />
                                  <circle cx="23" cy={itemY} r="3" fill="#dc2626" stroke="#ffffff" strokeWidth="1" />
                                </>
                              )}
                              {item.type === "solid-blue" && (
                                <>
                                  <line x1="12" y1={itemY} x2="34" y2={itemY} stroke="#2563eb" strokeWidth="2.5" />
                                  <circle cx="23" cy={itemY} r="3" fill="#2563eb" stroke="#ffffff" strokeWidth="1" />
                                </>
                              )}
                              {item.type === "thin-black" && (
                                <line x1="12" y1={itemY} x2="34" y2={itemY} stroke="#000000" strokeWidth="1.2" opacity="0.6" />
                              )}
                              <text
                                x="42"
                                y={itemY + 4}
                                fontSize="11"
                                fontFamily="Arial, sans-serif"
                                fill="#000000"
                                fontWeight={item.type === "thin-black" ? "normal" : "600"}
                                shapeRendering="auto"
                              >
                                {item.label}
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    )}

                    {/* Axis Titles */}
                    <text
                      x={padding.left - 48}
                      y={padding.top + plotHeight / 2}
                      textAnchor="middle"
                      fontSize="16"
                      fontWeight="bold"
                      fill="#000000"
                      fontFamily="Arial, sans-serif"
                      shapeRendering="auto"
                      transform={`rotate(-90 ${padding.left - 48} ${padding.top + plotHeight / 2})`}
                    >
                      Deflection (mils)
                    </text>
                    <text
                      x={padding.left + plotWidth / 2}
                      y={chartHeight - 14}
                      textAnchor="middle"
                      fontSize="16"
                      fontWeight="bold"
                      fill="#000000"
                      fontFamily="Arial, sans-serif"
                      shapeRendering="auto"
                    >
                      Sensor
                    </text>
                  </svg>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Temporary Slide Presentation Guide Modal ── */}
      {showSlideGuide && (
        <RepresentativeSlideGuide
          onClose={() => setShowSlideGuide(false)}
          sectionStats={sectionStats}
          rows={rows}
          columns={columns}
          selectedVariant={selectedVariant}
          sectionName={sectionName}
        />
      )}
    </div>
  );
}
