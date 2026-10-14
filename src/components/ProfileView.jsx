import React, { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import {
  getUserEquation,
  saveUserEquation,
  updateSectionThickness,
} from "../firebase/firestore";

const DEFLECTION_RE = /^D(\d+)$/;

// Chart dimensions and paddings
const chartWidth = 860;
const chartHeight = 440;
const padding = { top: 40, right: 45, bottom: 65, left: 75 };
const plotWidth = chartWidth - padding.left - padding.right;
const plotHeight = chartHeight - padding.top - padding.bottom;

const SENSOR_COLORS = {
  D1: "#2563eb", // Blue
  D2: "#7c3aed", // Purple
  D3: "#059669", // Emerald
  D4: "#d97706", // Amber
  D5: "#dc2626", // Red
  D6: "#4f46e5", // Indigo
  D7: "#0891b2", // Cyan
  D8: "#ea580c", // Orange
  D9: "#0284c7", // Sky
};

function getDmiValue(row) {
  // Check column names for station / dmi
  const candidates = [
    "STATION",
    "Station",
    "station",
    "DMI",
    "Dmi",
    "dmi",
    "Distance",
    "DISTANCE",
    "dist",
    "StationID",
    "stationid",
  ];
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      const num = typeof row[key] === "number" ? row[key] : parseFloat(row[key]);
      if (!isNaN(num)) {
        return Math.round(num);
      }
    }
  }
  return null;
}

export default function ProfileView({
  rows = [],
  columns = [],
  projectId = "",
  sectionId = "",
  initialThickness = 10,
  onThicknessChange,
  selectedVariant = "A",
  availableVariants = [],
  onSelectVariant,
}) {
  const { user } = useAuth();
  const { show } = useToast() || {};

  const [selectedSensor, setSelectedSensor] = useState("D1");
  const [showAverageLine, setShowAverageLine] = useState(true);
  const [showStatewideLine, setShowStatewideLine] = useState(true);

  // ── Global Equation State (Firestore + LocalStorage) ──────────────────────
  const [coeffA, setCoeffA] = useState(() => {
    try {
      return localStorage.getItem("fwd_statewide_a") || "60";
    } catch {
      return "60";
    }
  });

  const [powerB, setPowerB] = useState(() => {
    try {
      return localStorage.getItem("fwd_statewide_b") || "-1.5";
    } catch {
      return "-1.5";
    }
  });

  const [savedEquation, setSavedEquation] = useState({ a: coeffA, b: powerB });
  const [equationStatus, setEquationStatus] = useState("saved"); // "saved" | "unsaved" | "saving"

  // Fetch equation from Firestore on mount
  useEffect(() => {
    if (!user?.uid) return;
    getUserEquation(user.uid).then((eq) => {
      if (eq && (eq.a !== undefined || eq.b !== undefined)) {
        const aVal = String(eq.a ?? "60");
        const bVal = String(eq.b ?? "-1.5");
        setCoeffA(aVal);
        setPowerB(bVal);
        setSavedEquation({ a: aVal, b: bVal });
        setEquationStatus("saved");
        try {
          localStorage.setItem("fwd_statewide_a", aVal);
          localStorage.setItem("fwd_statewide_b", bVal);
        } catch {}
      }
    });
  }, [user?.uid]);

  const handleAChange = (val) => {
    setCoeffA(val);
    try {
      localStorage.setItem("fwd_statewide_a", val);
    } catch {}
    setEquationStatus(val === savedEquation.a && powerB === savedEquation.b ? "saved" : "unsaved");
  };

  const handleBChange = (val) => {
    setPowerB(val);
    try {
      localStorage.setItem("fwd_statewide_b", val);
    } catch {}
    setEquationStatus(coeffA === savedEquation.a && val === savedEquation.b ? "saved" : "unsaved");
  };

  const handleSaveEquation = async () => {
    if (!user?.uid) {
      show?.("Sign in to save equation to your cloud profile", "info");
      return;
    }
    setEquationStatus("saving");
    try {
      await saveUserEquation(user.uid, coeffA, powerB);
      setSavedEquation({ a: coeffA, b: powerB });
      setEquationStatus("saved");
      show?.(`Statewide equation (a=${coeffA}, b=${powerB}) saved to cloud!`, "success");
    } catch (err) {
      console.error("Failed to save equation:", err);
      setEquationStatus("unsaved");
      show?.("Failed to save equation: " + err.message, "error");
    }
  };

  // ── Section Slab Thickness State (Firestore Section Document + LocalStorage) ─
  const [thickness, setThickness] = useState(() => {
    if (initialThickness !== undefined && initialThickness !== null) {
      return String(initialThickness);
    }
    try {
      if (sectionId) {
        const saved = localStorage.getItem(`fwd_section_thickness_${sectionId}`);
        if (saved) return saved;
      }
      return "10";
    } catch {
      return "10";
    }
  });

  const [savedThickness, setSavedThickness] = useState(thickness);
  const [thicknessStatus, setThicknessStatus] = useState("saved"); // "saved" | "unsaved" | "saving"

  // When initialThickness or sectionId changes from parent
  useEffect(() => {
    if (initialThickness !== undefined && initialThickness !== null) {
      const sVal = String(initialThickness);
      setThickness(sVal);
      setSavedThickness(sVal);
      setThicknessStatus("saved");
      try {
        if (sectionId) localStorage.setItem(`fwd_section_thickness_${sectionId}`, sVal);
      } catch {}
    }
  }, [sectionId, initialThickness]);

  const handleThicknessChange = (val) => {
    setThickness(val);
    try {
      if (sectionId) {
        localStorage.setItem(`fwd_section_thickness_${sectionId}`, val);
      }
    } catch {}
    setThicknessStatus(val === savedThickness ? "saved" : "unsaved");
  };

  const handleSaveThickness = async (valToSave = thickness) => {
    const parsed = parseFloat(valToSave);
    const validVal = !isNaN(parsed) && parsed > 0 ? parsed : 10;
    if (!user?.uid || !projectId || !sectionId) {
      setSavedThickness(String(validVal));
      setThicknessStatus("saved");
      onThicknessChange?.(validVal);
      return;
    }
    setThicknessStatus("saving");
    try {
      await updateSectionThickness(user.uid, projectId, sectionId, validVal);
      setSavedThickness(String(validVal));
      setThicknessStatus("saved");
      onThicknessChange?.(validVal);
      show?.(`Section slab thickness saved (${validVal} in) to database!`, "success");
    } catch (err) {
      console.error("Failed to save section thickness:", err);
      setThicknessStatus("unsaved");
      show?.("Failed to save thickness: " + err.message, "error");
    }
  };

  const handleThicknessBlur = () => {
    if (thickness !== savedThickness && thicknessStatus === "unsaved") {
      handleSaveThickness();
    }
  };

  const handleThicknessKeyDown = (e) => {
    if (e.key === "Enter") {
      e.target.blur();
      handleSaveThickness();
    }
  };

  const [hoveredPoint, setHoveredPoint] = useState(null);
  const svgRef = useRef(null);

  // Extract deflection columns sorted numerically: D1, D2, D3...
  const deflectionCols = useMemo(() => {
    return columns
      .filter((c) => DEFLECTION_RE.test(c))
      .sort((a, b) => {
        const numA = parseInt(a.replace("D", ""), 10);
        const numB = parseInt(b.replace("D", ""), 10);
        return numA - numB;
      });
  }, [columns]);

  // Ensure selectedSensor is valid
  const activeSensor = useMemo(() => {
    if (deflectionCols.includes(selectedSensor)) return selectedSensor;
    return deflectionCols[0] ?? "D1";
  }, [deflectionCols, selectedSensor]);

  // Compute Statewide Average via power function: Deflection = a * (thickness)^b
  const statewideVal = useMemo(() => {
    const a = parseFloat(coeffA);
    const h = parseFloat(thickness);
    const b = parseFloat(powerB);
    if (isNaN(a) || isNaN(h) || isNaN(b) || h <= 0) return null;
    const res = a * Math.pow(h, b);
    return isNaN(res) || res <= 0 ? null : res;
  }, [coeffA, thickness, powerB]);

  // Extract valid data points sorted by DMI distance
  const profilePoints = useMemo(() => {
    if (rows.length === 0) return [];

    const pts = rows
      .map((row, idx) => {
        const dmi = getDmiValue(row);
        const val = row[activeSensor];
        const numVal = typeof val === "number" ? val : parseFloat(val);

        if (dmi === null || isNaN(numVal)) return null;

        return {
          originalIdx: idx,
          stationId: row.StationID ?? idx + 1,
          dmi,
          val: numVal,
          row,
        };
      })
      .filter(Boolean);

    // Sort by DMI ascending
    pts.sort((a, b) => a.dmi - b.dmi);
    return pts;
  }, [rows, activeSensor]);

  // Compute profile statistics
  const stats = useMemo(() => {
    if (profilePoints.length === 0) return null;
    const values = profilePoints.map((p) => p.val);
    const mean = values.reduce((s, x) => s + x, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const variance =
      values.length > 1
        ? values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1)
        : 0;
    const std = Math.sqrt(variance);

    const minDmi = profilePoints[0].dmi;
    const maxDmi = profilePoints[profilePoints.length - 1].dmi;
    const totalDistance = maxDmi - minDmi;

    return {
      count: profilePoints.length,
      mean,
      std,
      min,
      max,
      minDmi,
      maxDmi,
      totalDistance,
    };
  }, [profilePoints]);

  // Compute Scales
  const scales = useMemo(() => {
    if (!stats || profilePoints.length === 0) return null;

    const maxYVal = Math.max(
      stats.max,
      showStatewideLine && statewideVal ? statewideVal : 0,
      showAverageLine ? stats.mean : 0
    );
    const yMax = Math.max(maxYVal * 1.15, 1);
    const roundedYMax = Math.ceil(yMax);

    const minDmi = stats.minDmi;
    const maxDmi = stats.maxDmi === minDmi ? minDmi + 100 : stats.maxDmi;
    const dmiRange = maxDmi - minDmi;

    const getX = (dmi) => padding.left + ((dmi - minDmi) / dmiRange) * plotWidth;
    const getY = (val) => padding.top + plotHeight - (val / roundedYMax) * plotHeight;

    // Projected SVG points
    const mappedPoints = profilePoints.map((p) => ({
      ...p,
      x: getX(p.dmi),
      y: getY(p.val),
    }));

    // SVG path string
    const linePath = mappedPoints.reduce((acc, p, i) => {
      return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, "");

    // Area under path
    const areaPath =
      mappedPoints.length > 0
        ? `${linePath} L ${mappedPoints[mappedPoints.length - 1].x} ${
            padding.top + plotHeight
          } L ${mappedPoints[0].x} ${padding.top + plotHeight} Z`
        : "";

    // Divide chart into ~10 intervals (10 places) based on DMI range
    function getNiceStep(range, targetIntervals = 10) {
      if (range <= 0) return 100;
      const roughStep = range / targetIntervals;
      const power = Math.pow(10, Math.floor(Math.log10(roughStep)));
      const fraction = roughStep / power;

      let niceFraction = 1;
      if (fraction < 1.5) niceFraction = 1;
      else if (fraction < 2.25) niceFraction = 2;
      else if (fraction < 3.5) niceFraction = 2.5;
      else if (fraction < 7.5) niceFraction = 5;
      else niceFraction = 10;

      return Math.max(1, Math.round(niceFraction * power));
    }

    const step = getNiceStep(dmiRange, 10);

    const xTicks = [];
    const startTick = Math.floor(minDmi / step) * step;
    for (let d = startTick; d <= maxDmi; d += step) {
      if (d >= minDmi) {
        xTicks.push({
          val: d,
          x: getX(d),
        });
      }
    }
    // If maxDmi has enough clearance from the last tick, include it
    const lastTick = xTicks[xTicks.length - 1];
    if (lastTick && maxDmi - lastTick.val > step * 0.45) {
      xTicks.push({ val: maxDmi, x: getX(maxDmi) });
    }

    const averageY = getY(stats.mean);
    const statewideY = statewideVal ? getY(statewideVal) : null;

    return {
      roundedYMax,
      getX,
      getY,
      mappedPoints,
      linePath,
      areaPath,
      xTicks,
      averageY,
      statewideY,
    };
  }, [stats, profilePoints, showStatewideLine, statewideVal, showAverageLine]);

  // Export / Copy to canvas helper
  const exportChartAsCanvas = async (svgEl) => {
    if (!svgEl) return null;
    const clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(chartWidth));
    clone.setAttribute("height", String(chartHeight));

    // White background
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
        const scale = 2; // 2x high-DPI
        const canvas = document.createElement("canvas");
        canvas.width = chartWidth * scale;
        canvas.height = chartHeight * scale;
        const ctx = canvas.getContext("2d");
        if (ctx) {
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

  const handleCopyChart = async () => {
    try {
      const canvas = await exportChartAsCanvas(svgRef.current);
      if (!canvas) return;
      canvas.toBlob(async (blob) => {
        if (!blob) {
          show?.("Failed to generate profile image", "error");
          return;
        }
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          show?.("Profile chart copied to clipboard!", "success");
        } catch (err) {
          console.error("Clipboard copy error:", err);
          show?.("Could not copy chart to clipboard", "error");
        }
      }, "image/png");
    } catch (err) {
      console.error("Export error:", err);
      show?.("Error exporting chart", "error");
    }
  };

  const handleDownloadChart = async () => {
    try {
      const canvas = await exportChartAsCanvas(svgRef.current);
      if (!canvas) return;
      canvas.toBlob((blob) => {
        if (!blob) {
          show?.("Failed to generate profile image", "error");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Deflection_Profile_${activeSensor}_Drop_${selectedVariant}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        show?.("Profile chart downloaded!", "success");
      }, "image/png");
    } catch (err) {
      console.error("Export error:", err);
      show?.("Error downloading chart", "error");
    }
  };

  const strokeColor = SENSOR_COLORS[activeSensor] || "#2563eb";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#ffffff",
        overflowY: "auto",
        height: "calc(100vh - var(--header-h) - 48px)",
      }}
    >
      {/* ── Top Toolbar: Drop Variant, Sensor Pills, and Actions ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--sp-4) var(--sp-6)",
          borderBottom: "1px solid var(--border-subtle)",
          flexWrap: "wrap",
          gap: "var(--sp-3)",
          background: "#ffffff",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-4)", flexWrap: "wrap" }}>
          {/* Drop Variant Selector */}
          {availableVariants.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                Drop:
              </span>
              <div style={{ display: "flex", gap: 4 }}>
                {availableVariants.map((v) => (
                  <button
                    key={v}
                    onClick={() => onSelectVariant?.(v)}
                    className={`btn btn-sm ${selectedVariant === v ? "btn-primary" : "btn-secondary"}`}
                    style={{ minWidth: 32, padding: "2px 8px" }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Sensor Selector Pills */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
              Sensor:
            </span>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {deflectionCols.map((col) => {
                const isActive = col === activeSensor;
                const colColor = SENSOR_COLORS[col] || "#2563eb";
                return (
                  <button
                    key={col}
                    onClick={() => setSelectedSensor(col)}
                    style={{
                      padding: "3px 10px",
                      borderRadius: "var(--r-sm)",
                      fontSize: 12,
                      fontWeight: isActive ? 700 : 500,
                      cursor: "pointer",
                      border: `1.5px solid ${isActive ? colColor : "var(--border-subtle)"}`,
                      background: isActive ? colColor : "#ffffff",
                      color: isActive ? "#ffffff" : "var(--text-primary)",
                      transition: "all var(--t-fast)",
                    }}
                  >
                    {col}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reference Line Toggles */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
            {/* Average Line Toggle (Black Dotted) */}
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={showAverageLine}
                onChange={(e) => setShowAverageLine(e.target.checked)}
                style={{ accentColor: "#111827", cursor: "pointer" }}
              />
              <span style={{ color: "var(--text-primary)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 12, height: 2, borderBottom: "2px dotted #111827", display: "inline-block" }} />
                Average
              </span>
            </label>

            {/* Statewide Average Toggle (Red Dotted) */}
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={showStatewideLine}
                onChange={(e) => setShowStatewideLine(e.target.checked)}
                style={{ accentColor: "#dc2626", cursor: "pointer" }}
              />
              <span style={{ color: "#dc2626", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 12, height: 2, borderBottom: "2px dotted #dc2626", display: "inline-block" }} />
                Statewide Average
              </span>
            </label>
          </div>
        </div>

        {/* Copy & Download Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleCopyChart}
            title="Copy profile chart image to clipboard"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span>📋</span> Copy
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleDownloadChart}
            title="Download profile chart as high-resolution PNG"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <span>⬇</span> Download
          </button>
        </div>
      </div>

      {/* ── Statewide Average Power Function Parameter Bar ── */}
      {showStatewideLine && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            padding: "8px var(--sp-6)",
            background: "#fef2f2",
            borderBottom: "1px solid #fee2e2",
            flexWrap: "wrap",
            fontSize: 13,
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 700, color: "#991b1b" }}>
              Statewide Function:
            </span>
            <span style={{ fontFamily: "serif", fontStyle: "italic", color: "#7f1d1d" }}>
              Deflection = a × (thickness)ᵇ
            </span>
          </div>

          {/* Parameter: a */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <label style={{ fontWeight: 600, color: "#991b1b" }}>a:</label>
            <input
              type="number"
              step="any"
              value={coeffA}
              onChange={(e) => handleAChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveEquation();
              }}
              style={{
                width: 65,
                padding: "2px 6px",
                border: "1px solid #fca5a5",
                borderRadius: "var(--r-sm)",
                fontSize: 13,
                fontWeight: 600,
                textAlign: "right",
                background: "#ffffff",
              }}
            />
          </div>

          {/* Parameter: b */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <label style={{ fontWeight: 600, color: "#991b1b" }}>b:</label>
            <input
              type="number"
              step="any"
              value={powerB}
              onChange={(e) => handleBChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveEquation();
              }}
              style={{
                width: 65,
                padding: "2px 6px",
                border: "1px solid #fca5a5",
                borderRadius: "var(--r-sm)",
                fontSize: 13,
                fontWeight: 600,
                textAlign: "right",
                background: "#ffffff",
              }}
            />
          </div>

          {/* Save Equation Button */}
          <button
            type="button"
            className="btn btn-sm"
            onClick={handleSaveEquation}
            disabled={equationStatus === "saving"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: "var(--r-sm)",
              background: equationStatus === "unsaved" ? "#dc2626" : "#ffffff",
              color: equationStatus === "unsaved" ? "#ffffff" : "#b91c1c",
              border: `1px solid ${equationStatus === "unsaved" ? "#b91c1c" : "#fca5a5"}`,
              cursor: "pointer",
              boxShadow: equationStatus === "unsaved" ? "0 1px 3px rgba(220,38,38,0.25)" : "none",
              transition: "all 0.15s ease",
            }}
            title="Store equation parameters permanently to Firestore for your account (persists across sessions)"
          >
            {equationStatus === "saving" ? (
              <>⏳ Saving…</>
            ) : equationStatus === "unsaved" ? (
              <>💾 Save Equation *</>
            ) : (
              <>✓ Equation Saved</>
            )}
          </button>

          {/* Vertical Divider */}
          <div style={{ width: 1, height: 20, background: "#fca5a5", margin: "0 4px" }} />

          {/* Parameter: slab thickness (Section attribute) */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <label style={{ fontWeight: 600, color: "#991b1b" }} title="Permanent attribute of this specific section">
              Slab Thickness:
            </label>
            <input
              type="number"
              step="0.5"
              min="1"
              value={thickness}
              onChange={(e) => handleThicknessChange(e.target.value)}
              onBlur={handleThicknessBlur}
              onKeyDown={handleThicknessKeyDown}
              style={{
                width: 65,
                padding: "2px 6px",
                border: "1px solid #fca5a5",
                borderRadius: "var(--r-sm)",
                fontSize: 13,
                fontWeight: 600,
                textAlign: "right",
                background: "#ffffff",
              }}
            />
            <span style={{ color: "#7f1d1d", fontSize: 12 }}>in</span>

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleSaveThickness()}
              disabled={thicknessStatus === "saving"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "var(--r-sm)",
                background: thicknessStatus === "unsaved" ? "#dc2626" : "#ffffff",
                color: thicknessStatus === "unsaved" ? "#ffffff" : "#b91c1c",
                border: `1px solid ${thicknessStatus === "unsaved" ? "#b91c1c" : "#fca5a5"}`,
                cursor: "pointer",
                boxShadow: thicknessStatus === "unsaved" ? "0 1px 3px rgba(220,38,38,0.25)" : "none",
                transition: "all 0.15s ease",
              }}
              title="Save slab thickness permanently as an attribute of this section in Firestore database"
            >
              {thicknessStatus === "saving" ? (
                <>⏳ Saving…</>
              ) : thicknessStatus === "unsaved" ? (
                <>💾 Save</>
              ) : (
                <>✓ Saved</>
              )}
            </button>
          </div>

          {/* Calculated Output Pill */}
          <div
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "#ffffff",
              border: "1px solid #f87171",
              borderRadius: 99,
              padding: "2px 10px",
              fontWeight: 700,
              color: "#dc2626",
            }}
          >
            <span>Target Line:</span>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>
              {statewideVal !== null ? `${statewideVal.toFixed(2)} mils` : "Invalid input"}
            </span>
          </div>
        </div>
      )}

      {/* ── KPI Summary Cards ── */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: "var(--sp-3)",
            padding: "var(--sp-4) var(--sp-6) 0",
          }}
        >
          <div className="card" style={{ padding: "var(--sp-3)" }}>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>Active Sensor</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginTop: 2 }}>
              {activeSensor}
            </div>
          </div>

          <div className="card" style={{ padding: "var(--sp-3)" }}>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>Average Deflection</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", marginTop: 2 }}>
              {stats.mean.toFixed(2)}{" "}
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>mils</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              Std Dev: ±{stats.std.toFixed(2)}
            </div>
          </div>

          {showStatewideLine && statewideVal !== null && (
            <div className="card" style={{ padding: "var(--sp-3)", borderColor: "#fecaca", background: "#fffafa" }}>
              <div style={{ fontSize: 11, color: "#dc2626", fontWeight: 600 }}>Statewide Average</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color: "#dc2626", marginTop: 2 }}>
                {statewideVal.toFixed(2)}{" "}
                <span style={{ fontSize: 11, fontWeight: 400, color: "#b91c1c" }}>mils</span>
              </div>
            </div>
          )}

          <div className="card" style={{ padding: "var(--sp-3)" }}>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>Min Deflection</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", marginTop: 2 }}>
              {stats.min.toFixed(2)}{" "}
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>mils</span>
            </div>
          </div>

          <div className="card" style={{ padding: "var(--sp-3)" }}>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>Max Deflection</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", marginTop: 2 }}>
              {stats.max.toFixed(2)}{" "}
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>mils</span>
            </div>
          </div>

          <div className="card" style={{ padding: "var(--sp-3)" }}>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>Survey Extent</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", marginTop: 2 }}>
              {stats.totalDistance.toLocaleString()}{" "}
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>ft</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {stats.count} stations ({stats.minDmi} → {stats.maxDmi} ft)
            </div>
          </div>
        </div>
      )}

      {/* ── Main Chart Area ── */}
      <div style={{ padding: "var(--sp-4) var(--sp-6)", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {scales ? (() => {
          const legendItems = [];
          legendItems.push({
            id: "profile",
            label: "Deflection Profile",
            type: "solid-black",
          });
          if (showAverageLine && stats) {
            legendItems.push({
              id: "average",
              label: `Average: ${stats.mean.toFixed(2)} mils`,
              type: "dotted-black",
            });
          }
          if (showStatewideLine && statewideVal !== null) {
            legendItems.push({
              id: "statewide",
              label: `Statewide Avg: ${statewideVal.toFixed(2)} mils`,
              type: "dotted-red",
            });
          }

          const legendWidth = 215;
          const legendHeight = 14 + legendItems.length * 20;
          const legendX = padding.left + plotWidth - legendWidth - 12;
          const legendY = padding.top + 12;

          return (
            <div
              style={{
                width: "100%",
                maxWidth: chartWidth,
                background: "#ffffff",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--r-md)",
                padding: "var(--sp-4)",
                boxShadow: "var(--shadow-sm)",
                position: "relative",
              }}
            >
              <svg
                ref={svgRef}
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                style={{ width: "100%", height: "auto", overflow: "visible", background: "#ffffff" }}
                onMouseLeave={() => setHoveredPoint(null)}
              >
                {/* Major Horizontal Grid Lines & Y-axis Inner Ticks */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                  const y = padding.top + pct * plotHeight;
                  const val = ((1 - pct) * scales.roundedYMax).toFixed(1);
                  return (
                    <g key={pct}>
                      {/* Grid line */}
                      <line
                        x1={padding.left}
                        y1={y}
                        x2={padding.left + plotWidth}
                        y2={y}
                        stroke="#e5e7eb"
                        strokeWidth="1"
                      />
                      {/* Inner Tick mark at Y-axis */}
                      <line
                        x1={padding.left}
                        y1={y}
                        x2={padding.left + 6}
                        y2={y}
                        stroke="#111827"
                        strokeWidth="1.5"
                      />
                      {/* Y-axis tick label */}
                      <text
                        x={padding.left - 10}
                        y={y + 5}
                        textAnchor="end"
                        fontSize="14"
                        fill="#111827"
                        fontFamily="Arial, sans-serif"
                      >
                        {val}
                      </text>
                    </g>
                  );
                })}

                {/* Major Vertical Grid Lines & X-axis Inner Ticks (DMI in ft) */}
                {scales.xTicks.map((tick) => (
                  <g key={`x-tick-${tick.val}`}>
                    <line
                      x1={tick.x}
                      y1={padding.top}
                      x2={tick.x}
                      y2={padding.top + plotHeight}
                      stroke="#e5e7eb"
                      strokeWidth="1"
                    />
                    {/* Inner Tick mark at X-axis */}
                    <line
                      x1={tick.x}
                      y1={padding.top + plotHeight}
                      x2={tick.x}
                      y2={padding.top + plotHeight - 6}
                      stroke="#111827"
                      strokeWidth="1.5"
                    />
                    {/* X-axis tick label */}
                    <text
                      x={tick.x}
                      y={padding.top + plotHeight + 22}
                      textAnchor="middle"
                      fontSize="14"
                      fill="#111827"
                      fontFamily="Arial, sans-serif"
                    >
                      {tick.val}
                    </text>
                  </g>
                ))}

                {/* Average Reference Line (Clean Black Dotted Line) */}
                {showAverageLine && stats && (
                  <line
                    x1={padding.left}
                    y1={scales.averageY}
                    x2={padding.left + plotWidth}
                    y2={scales.averageY}
                    stroke="#111827"
                    strokeWidth="1.8"
                    strokeDasharray="3 3"
                  />
                )}

                {/* Statewide Average Reference Line (Clean Red Dotted Line) */}
                {showStatewideLine && scales.statewideY !== null && statewideVal !== null && (
                  <line
                    x1={padding.left}
                    y1={scales.statewideY}
                    x2={padding.left + plotWidth}
                    y2={scales.statewideY}
                    stroke="#dc2626"
                    strokeWidth="1.8"
                    strokeDasharray="4 4"
                  />
                )}

                {/* Deflection Profile Curve Path (Solid Black Line) */}
                <path
                  d={scales.linePath}
                  fill="none"
                  stroke="#111827"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Station Data Point Circles (Solid Black Dots) */}
                {scales.mappedPoints.map((pt) => {
                  const isHovered = hoveredPoint?.originalIdx === pt.originalIdx;
                  return (
                    <g
                      key={`pt-${pt.originalIdx}`}
                      onMouseEnter={() => setHoveredPoint(pt)}
                      style={{ cursor: "pointer" }}
                    >
                      {/* Invisible larger hit target */}
                      <circle cx={pt.x} cy={pt.y} r="12" fill="transparent" />
                      {/* Black Dot */}
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isHovered ? "6" : "4"}
                        fill={isHovered ? "#ffffff" : "#111827"}
                        stroke={isHovered ? "#2563eb" : "#111827"}
                        strokeWidth={isHovered ? "2.5" : "1"}
                      />
                    </g>
                  );
                })}

                {/* 4-sided Inner Box Border in Solid Black */}
                <rect
                  x={padding.left}
                  y={padding.top}
                  width={plotWidth}
                  height={plotHeight}
                  fill="none"
                  stroke="#111827"
                  strokeWidth="1.5"
                />

                {/* Top-Right Legend Box with Solid Black Border */}
                {legendItems.length > 0 && (
                  <g transform={`translate(${legendX}, ${legendY})`}>
                    <rect
                      x="0"
                      y="0"
                      width={legendWidth}
                      height={legendHeight}
                      fill="rgba(255, 255, 255, 0.95)"
                      stroke="#111827"
                      strokeWidth="1.5"
                      rx="3"
                    />
                    {legendItems.map((item, idx) => {
                      const itemY = 16 + idx * 20;
                      return (
                        <g key={item.id}>
                          {item.type === "solid-black" && (
                            <>
                              <line x1="12" y1={itemY} x2="34" y2={itemY} stroke="#111827" strokeWidth="2.5" />
                              <circle cx="23" cy={itemY} r="3.5" fill="#111827" stroke="#ffffff" strokeWidth="1" />
                            </>
                          )}
                          {item.type === "dotted-black" && (
                            <line x1="12" y1={itemY} x2="34" y2={itemY} stroke="#111827" strokeWidth="2" strokeDasharray="3 3" />
                          )}
                          {item.type === "dotted-red" && (
                            <line x1="12" y1={itemY} x2="34" y2={itemY} stroke="#dc2626" strokeWidth="2" strokeDasharray="4 4" />
                          )}
                          <text
                            x="42"
                            y={itemY + 4}
                            fontSize="11"
                            fontFamily="Arial, sans-serif"
                            fill={item.type === "dotted-red" ? "#dc2626" : "#111827"}
                            fontWeight="600"
                          >
                            {item.label}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                )}

                {/* Interactive Tooltip Card with intelligent clearance */}
                {hoveredPoint && (() => {
                  const tooltipWidth = 135;
                  const tooltipHeight = 54;
                  const gap = 16;
                  const placeBelow = hoveredPoint.y - tooltipHeight - gap < padding.top;
                  const tooltipX = Math.max(
                    padding.left + 5,
                    Math.min(padding.left + plotWidth - tooltipWidth - 5, hoveredPoint.x - tooltipWidth / 2)
                  );
                  const tooltipY = placeBelow
                    ? hoveredPoint.y + gap
                    : hoveredPoint.y - tooltipHeight - gap;

                  return (
                    <g transform={`translate(${tooltipX}, ${tooltipY})`} pointerEvents="none">
                      <rect
                        x="0"
                        y="0"
                        width={tooltipWidth}
                        height={tooltipHeight}
                        rx="4"
                        fill="#111827"
                        opacity="0.95"
                      />
                      <text x="10" y="16" fill="#9ca3af" fontSize="11" fontFamily="Arial, sans-serif">
                        Station: <tspan fill="#ffffff" fontWeight="bold">{hoveredPoint.stationId}</tspan>
                      </text>
                      <text x="10" y="32" fill="#9ca3af" fontSize="11" fontFamily="Arial, sans-serif">
                        DMI: <tspan fill="#ffffff" fontWeight="bold">{hoveredPoint.dmi.toLocaleString()} ft</tspan>
                      </text>
                      <text x="10" y="48" fill="#9ca3af" fontSize="11" fontFamily="Arial, sans-serif">
                        {activeSensor}: <tspan fill="#38bdf8" fontWeight="bold">{hoveredPoint.val.toFixed(2)} mils</tspan>
                      </text>
                    </g>
                  );
                })()}

                {/* Axis Titles */}
                <text
                  x={padding.left - 48}
                  y={padding.top + plotHeight / 2}
                  textAnchor="middle"
                  fontSize="16"
                  fontWeight="bold"
                  fill="#111827"
                  fontFamily="Arial, sans-serif"
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
                  fill="#111827"
                  fontFamily="Arial, sans-serif"
                >
                  DMI (ft)
                </text>
              </svg>
            </div>
          );
        })() : (
          <div className="empty-state">
            <div className="empty-state-icon">📈</div>
            <h3>No profile data</h3>
            <p>Could not extract station DMI distance values from this section.</p>
          </div>
        )}
      </div>

      {/* ── Profile Data Table (Sorted by DMI) ── */}
      {profilePoints.length > 0 && (
        <div style={{ padding: "0 var(--sp-6) var(--sp-8)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "var(--sp-2)",
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
              Alignment Survey Stations ({profilePoints.length} points)
            </span>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Sorted by DMI distance (ft)
            </span>
          </div>

          <div
            style={{
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--r-md)",
              overflow: "hidden",
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            <table className="data-table" style={{ width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 60, textAlign: "center", background: "#f9fafb" }}>#</th>
                  <th style={{ textAlign: "left", background: "#f9fafb" }}>StationID</th>
                  <th style={{ textAlign: "right", background: "#f9fafb", color: "#111827", fontWeight: 700 }}>
                    DMI (ft)
                  </th>
                  {deflectionCols.map((col) => (
                    <th
                      key={col}
                      style={{
                        textAlign: "right",
                        background: col === activeSensor ? "#f0fdf4" : "#f9fafb",
                        color: col === activeSensor ? strokeColor : "inherit",
                        fontWeight: col === activeSensor ? 700 : "normal",
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profilePoints.map((pt, i) => (
                  <tr
                    key={pt.originalIdx}
                    onMouseEnter={() => setHoveredPoint(pt)}
                    style={{
                      backgroundColor: hoveredPoint?.originalIdx === pt.originalIdx ? "#f0f9ff" : undefined,
                    }}
                  >
                    <td style={{ textAlign: "center", fontSize: 11, color: "var(--text-muted)" }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{pt.stationId}</td>
                    <td style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
                      {pt.dmi}
                    </td>
                    {deflectionCols.map((col) => {
                      const v = pt.row[col];
                      const n = typeof v === "number" ? v : parseFloat(v);
                      return (
                        <td
                          key={col}
                          style={{
                            textAlign: "right",
                            fontFamily: "JetBrains Mono, monospace",
                            background: col === activeSensor ? "rgba(37, 99, 235, 0.04)" : undefined,
                            fontWeight: col === activeSensor ? 600 : "normal",
                            color: col === activeSensor ? strokeColor : undefined,
                          }}
                        >
                          {isNaN(n) ? "—" : n.toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
