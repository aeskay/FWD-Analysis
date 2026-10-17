import React, { useState, useRef, useMemo, useEffect } from "react";
import { useToast } from "../context/ToastContext";

/**
 * Utility to convert SVG element into a high-resolution Canvas / PNG blob
 */
async function exportSvgAsCanvas(svgEl, scale = 3) {
  if (!svgEl) return null;
  const bbox = svgEl.getBoundingClientRect();
  const width = bbox.width || 600;
  const height = bbox.height || 360;

  const clone = svgEl.cloneNode(true);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

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
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
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
}

export default function RepresentativeSlideGuide({
  onClose,
  sectionStats,
  rows = [],
  columns = [],
  selectedVariant = "A",
  sectionName = "Section",
}) {
  const { show } = useToast();
  const [activeSlide, setActiveSlide] = useState(1);
  const [copiedKey, setCopiedKey] = useState(null);

  // SVG Chart refs for exporting
  const chartRef1 = useRef(null);
  const chartRef2 = useRef(null);
  const chartRef3 = useRef(null);
  const chartRef4 = useRef(null);
  const chartRef5 = useRef(null);

  // Keyboard navigation: Left/Right arrows to flip slides, Escape to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "ArrowRight") {
        setActiveSlide((s) => Math.min(5, s + 1));
      } else if (e.key === "ArrowLeft") {
        setActiveSlide((s) => Math.max(1, s - 1));
      } else if (e.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Copy text helper
  const handleCopyText = (text, key, label = "Content") => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    show?.(`${label} copied to clipboard!`, "success");
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Copy image helper
  const handleCopyChartImage = async (svgEl, chartName) => {
    try {
      const canvas = await exportSvgAsCanvas(svgEl);
      if (!canvas) return;
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          show?.(`${chartName} copied to clipboard as image!`, "success");
        } catch (err) {
          console.error("Clipboard copy error:", err);
          show?.("Could not copy chart image to clipboard", "error");
        }
      }, "image/png");
    } catch (err) {
      console.error(err);
      show?.("Error copying chart image", "error");
    }
  };

  // Download chart helper
  const handleDownloadChartImage = async (svgEl, filename) => {
    try {
      const canvas = await exportSvgAsCanvas(svgEl);
      if (!canvas) return;
      canvas.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement("a");
        link.download = filename;
        link.href = URL.createObjectURL(blob);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        show?.("Chart image downloaded!", "success");
      }, "image/png");
    } catch (err) {
      console.error(err);
      show?.("Error downloading chart image", "error");
    }
  };

  // Sensor columns detection
  const deflectionCols = useMemo(() => {
    const dCols = columns.filter((col) => {
      const upper = col.toUpperCase();
      return (
        (upper.startsWith("D") && /^D\d+$/.test(upper)) ||
        (upper.startsWith("DF") && /^DF\d+$/.test(upper)) ||
        col.toLowerCase().startsWith("deflection")
      );
    });
    if (dCols.length > 0) return dCols;
    return ["D1", "D2", "D3", "D4", "D5", "D6", "D7"].filter((c) =>
      columns.includes(c)
    );
  }, [columns]);

  const rep = sectionStats?.representative;
  const repStationId = rep?.row?.StationID ?? "—";
  const repRmse = rep?.rmse !== undefined ? rep.rmse.toFixed(3) : "—";
  const stationCount = rows.length;

  // Chart dimension constants for crisp rendering
  const chartW = 560;
  const chartH = 320;
  const pad = { top: 30, right: 25, bottom: 45, left: 60 };
  const plotW = chartW - pad.left - pad.right;
  const plotH = chartH - pad.top - pad.bottom;
  const xGap = 28;
  const availW = plotW - 2 * xGap;

  // Helper to map sensor deflections to SVG points
  const getSvgPoints = (sensorVals, maxVal) => {
    const count = deflectionCols.length;
    return deflectionCols.map((col, idx) => {
      const v = sensorVals[col] !== undefined ? sensorVals[col] : 0;
      const x = pad.left + xGap + (count > 1 ? (idx / (count - 1)) * availW : availW / 2);
      const y = pad.top + (maxVal > 0 ? (v / maxVal) * plotH : 0);
      return { sensor: col, val: v, x, y };
    });
  };

  const maxDeflection = useMemo(() => {
    if (sectionStats?.maxDeflection) return sectionStats.maxDeflection;
    let m = 0;
    rows.forEach((r) => {
      deflectionCols.forEach((c) => {
        const val = parseFloat(r[c]);
        if (!isNaN(val) && val > m) m = val;
      });
    });
    return m > 0 ? m * 1.1 : 30;
  }, [rows, deflectionCols, sectionStats]);

  // Points for Representative Station
  const repPoints = useMemo(() => {
    if (!rep) return [];
    const vals = {};
    deflectionCols.forEach((c) => {
      vals[c] = parseFloat(rep.row[c]) || 0;
    });
    return getSvgPoints(vals, maxDeflection);
  }, [rep, deflectionCols, maxDeflection]);

  // Points for Section Mean
  const meanPoints = useMemo(() => {
    if (!sectionStats?.sensorStats) return [];
    const vals = {};
    sectionStats.sensorStats.forEach((s) => {
      vals[s.col] = s.mean;
    });
    return getSvgPoints(vals, maxDeflection);
  }, [sectionStats, deflectionCols, maxDeflection]);

  // Path generator
  const makePathD = (pts) => {
    if (!pts || pts.length === 0) return "";
    return pts.reduce((acc, pt, i) => (i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`), "");
  };

  // -------------------------------------------------------------
  // SLIDE DATA DEFINITIONS (EQUATIONS, BULLETS, NOTES)
  // -------------------------------------------------------------

  const slides = [
    {
      id: 1,
      num: "Slide 1",
      badge: "Context & Motivation",
      title: "Selection of Representative Deflection Basin for Modulus Backcalculation",
      subtitle: "Why an actual physical station is required rather than a synthetic mathematical mean",
      objective:
        "Establish why multi-layer elastic backcalculation requires a real, physically measured deflection basin rather than an artificial section mean.",
      bullets: [
        "Falling Weight Deflectometer (FWD) non-destructively evaluates pavement structural capacity across 100% of tested stations.",
        "Backcalculation tools (MODULUS, BAKFAA, EVERCALC, ELMOD) apply Multi-Layer Elastic Theory (MLET) or Finite Element modeling to estimate layer moduli (E₁, E₂, E_subgrade).",
        "Pavement materials exhibit non-linear, stress-dependent behavior (e.g., granular base hardening and subgrade softening).",
        "Arithmetic averaging of deflections smooths out physical layer interactions and often yields non-convergent or unphysical backcalculated moduli.",
        `Objective: Identify the single real station (Station ${repStationId}) out of ${stationCount} tested stations whose complete basin shape best represents the central tendency of the section.`,
      ],
      latex: [
        {
          title: "Pavement Layer Modulus Backcalculation Problem",
          code: "\\min_{E_1, E_2, \\dots, E_k} \\sum_{j=1}^{N} w_j \\left[ D_j^{\\text{measured}} - D_j^{\\text{theoretical}}(E_1, \\dots, E_k) \\right]^2",
          explanation: "Backcalculation matches measured physical deflections to theoretical MLET responses.",
        },
      ],
      speakerNotes:
        "Explain that in pavement engineering practice, we never backcalculate an 'average bowl' because mathematical averaging creates a fictitious pavement structure. Instead, our goal is to find the single real, physically tested station that sits at the true structural center of the test section.",
      chartCaption: "All Basin Profiles Overlay: Illustrates the natural physical scatter across all tested stations and the necessity of selecting one representative physical bowl.",
      recommendedChart: "all_overlay",
    },
    {
      id: 2,
      num: "Slide 2",
      badge: "Step 1: Normalization & Baseline",
      title: "Data Normalization & Section Baseline Deflection Vector",
      subtitle: "Standardizing drop loads to 9,000 lbs (40 kN) and establishing the benchmark deflection vector",
      objective:
        "Explain the standard 9-kip load normalization process and formulate the multi-sensor mean deflection vector.",
      bullets: [
        "FWD impact loads vary slightly between drops due to pavement stiffness and buffer temperature.",
        "Linear force normalization scales all sensor readings to the standard 9,000 lbs (40 kN) reference wheel load.",
        `A section-wide baseline mean vector D̄ = [D̄₁, D̄₂, …, D̄₇] is computed across all M = ${stationCount} valid stations.`,
        "Dispersion is quantified using Sensor Standard Deviation (sⱼ) and Coefficient of Variation (CVⱼ).",
        "Sensors D₁-D₂ (near load plate) capture AC layer condition; outer sensors D₆-D₇ capture subgrade stiffness.",
      ],
      latex: [
        {
          title: "1. Force Normalization to Standard 9-kip Target Load",
          code: "D_{i,j}^{\\text{norm}} = D_{i,j} \\times \\left( \\frac{F_{\\text{target}}}{F_i} \\right) = D_{i,j} \\times \\left( \\frac{9000\\text{ lbs}}{F_i} \\right)",
          explanation: "Normalizes each raw deflection D_ij for station i and sensor j to 9,000 lbs reference force.",
        },
        {
          title: "2. Section Mean Deflection Vector & Coefficient of Variation",
          code: "\\bar{D}_j = \\frac{1}{M} \\sum_{i=1}^{M} D_{i,j}^{\\text{norm}}, \\quad s_j = \\sqrt{\\frac{1}{M-1}\\sum_{i=1}^{M} (D_{i,j} - \\bar{D}_j)^2}, \\quad \\text{CV}_j = \\left( \\frac{s_j}{\\bar{D}_j} \\right) \\times 100\\%",
          explanation: "Computes the baseline central tendency and dispersion for each sensor across the section.",
        },
      ],
      speakerNotes:
        "Walk through the two equations. Point out that normalization removes drop force variability. Then, explain that D̄ gives us the mathematical benchmark for every sensor, while CV_j tells us which layer has the highest variability along the project.",
      chartCaption: "Section Mean Deflection Basin: Benchmark curve against which all individual bowls are mathematically compared.",
      recommendedChart: "mean_basin",
    },
    {
      id: 3,
      num: "Slide 3",
      badge: "Step 2: Selection Criterion",
      title: "Objective Selection Metric: Multi-Sensor RMSE Minimization",
      subtitle: "Formulation of the Root Mean Square Error distance metric across all 7 geophone sensors",
      objective:
        "Present the mathematical Euclidean distance formula and explain why multi-sensor RMSE is superior to picking by D₁ alone.",
      bullets: [
        "Traditional practice often picked a station solely based on the median D₁ (maximum deflection).",
        "Limitation of D₁-only: Two stations may share identical D₁ deflections but possess vastly different basin slopes and subgrade responses.",
        "Our method computes the Root Mean Square Error (RMSE) across all N = 7 sensors for every station i.",
        "RMSE acts as an N-dimensional Euclidean distance measuring simultaneous shape and magnitude alignment.",
        `Selection Criterion: The representative station is uniquely chosen as the one minimizing RMSE across all stations (Station ${repStationId} with minimum RMSE = ${repRmse} mils).`,
      ],
      latex: [
        {
          title: "Root Mean Square Error (RMSE) Distance Metric",
          code: "\\text{RMSE}_i = \\sqrt{ \\frac{1}{N} \\sum_{j=1}^{N} \\left( D_{i,j}^{\\text{norm}} - \\bar{D}_j \\right)^2 }",
          explanation: "Quantifies the total geometric deviation between station i's bowl and the section mean vector.",
        },
        {
          title: "Representative Station Selection Criterion",
          code: "\\text{Station}_{\\text{rep}} = \\arg\\min_{i \\in \\{1, \\dots, M\\}} \\left( \\text{RMSE}_i \\right)",
          explanation: "The physical station that achieves the global minimum Euclidean distance to the section mean.",
        },
      ],
      speakerNotes:
        "Emphasize the difference between picking by D_1 alone versus multi-sensor RMSE. Show the bar chart: each bar is a station's RMSE. The lowest bar is Station " +
        repStationId +
        ". It is the mathematically closest real station to the mean across the entire pavement depth.",
      chartCaption: "Station-by-Station RMSE Comparison: Highlights Station " + repStationId + " as the global minimum RMSE across the entire project section.",
      recommendedChart: "rmse_bars",
    },
    {
      id: 4,
      num: "Slide 4",
      badge: "Step 3: Structural Validation",
      title: "Validation via Pavement Structural Indices (SCI, BDI, BCI, AREA)",
      subtitle: "Verifying layer-by-layer mechanical fidelity of the selected representative basin",
      objective:
        "Demonstrate that the selected representative basin preserves layer-specific stiffness and structural indices.",
      bullets: [
        "In addition to overall RMSE, pavement engineers evaluate depth-specific structural condition indices:",
        `Surface Curvature Index (SCI = D₁ - D₂): Reflects surface / AC layer stiffness. Rep = ${sectionStats?.repIndices?.sci?.toFixed(2) ?? "—"} mils vs Mean = ${sectionStats?.meanIndices?.sci?.toFixed(2) ?? "—"} mils.`,
        `Base Damage Index (BDI = D₂ - D₃): Reflects base layer integrity. Rep = ${sectionStats?.repIndices?.bdi?.toFixed(2) ?? "—"} mils vs Mean = ${sectionStats?.meanIndices?.bdi?.toFixed(2) ?? "—"} mils.`,
        `Base Curvature Index (BCI = D₃ - D₄): Reflects subgrade response. Rep = ${sectionStats?.repIndices?.bci?.toFixed(2) ?? "—"} mils vs Mean = ${sectionStats?.meanIndices?.bci?.toFixed(2) ?? "—"} mils.`,
        `AASHTO Basin Area Parameter: Overall structural rigidity. Rep = ${sectionStats?.repIndices?.area?.toFixed(1) ?? "—"} in vs Mean = ${sectionStats?.meanIndices?.area?.toFixed(1) ?? "—"} in.`,
        "The close alignment between Representative and Section Mean indices confirms physical fidelity.",
      ],
      latex: [
        {
          title: "Standard Pavement Structural Basin Indices",
          code: "\\begin{aligned} \\text{SCI} &= D_1 - D_2 \\quad &\\text{(Surface / AC Layer)} \\\\ \\text{BDI} &= D_2 - D_3 \\quad &\\text{(Base Layer Condition)} \\\\ \\text{BCI} &= D_3 - D_4 \\quad &\\text{(Subgrade Response)} \\\\ \\text{AREA} &= 6 \\times \\left[ 1 + 2\\left(\\frac{D_2}{D_1}\\right) + 2\\left(\\frac{D_3}{D_1}\\right) + \\left(\\frac{D_4}{D_1}\\right) \\right] \\quad &\\text{(AASHTO Stiffness)} \\end{aligned}",
          explanation: "Standard industry metrics (AASHTO / TxDOT) isolating structural health at specific pavement depths.",
        },
      ],
      speakerNotes:
        "Walk the audience through each structural index. Point out that SCI isolates the top AC layer, BDI isolates the granular base, and BCI isolates the deep subgrade. Show how closely our selected station matches the section mean across all four indices.",
      chartCaption: "Representative vs. Section Mean Overlay: Direct visual comparison showing close alignment of curvature and offsets.",
      recommendedChart: "rep_vs_mean",
    },
    {
      id: 5,
      num: "Slide 5",
      badge: "Final Summary",
      title: "Final Selection & Backcalculation Input Package",
      subtitle: "Summary of selected representative parameters ready for engineering analysis",
      objective:
        "Provide the final executive summary table and ready-to-use inputs for backcalculation software.",
      bullets: [
        `Selected Representative Station: Station ${repStationId} (Drop ${selectedVariant}, 9,000 lbs normalized).`,
        `Minimum RMSE: ${repRmse} mils from section mean vector (lowest among ${stationCount} stations).`,
        `Deflection Readings (mils): ${deflectionCols.map((c) => `${c}=${parseFloat(rep?.row?.[c] || 0).toFixed(2)}`).join(", ")}.`,
        "Key Engineering Advantages:",
        "  1. 100% Objective and Reproducible: Removes arbitrary subjective selection.",
        "  2. Non-linear Preservation: Maintains true physical multi-layer interaction.",
        "  3. Validated Structural Indices: Matches section-wide SCI, BDI, BCI, and AREA.",
        "Ready for immediate input into MODULUS, BAKFAA, or EVERCALC for modulus backcalculation.",
      ],
      latex: [
        {
          title: "Summary Output Vector for Backcalculation",
          code: "\\mathbf{D}_{\\text{rep}} = \\left[ " + deflectionCols.map((c) => parseFloat(rep?.row?.[c] || 0).toFixed(2)).join(",\\; ") + " \\right]^T \\quad \\text{at } F = 9000\\text{ lbs}",
          explanation: "The physical deflection vector inputted into layer backcalculation algorithms.",
        },
      ],
      speakerNotes:
        "Conclude by highlighting that our approach is fully automated, transparent, and defensible in any pavement design or forensic report. We preserve true non-linear material response while rigorously representing the section central tendency.",
      chartCaption: "Representative Station Deflection Bowl: The final validated physical basin selected for backcalculation.",
      recommendedChart: "rep_bowl",
    },
  ];

  const currentSlide = slides.find((s) => s.id === activeSlide) || slides[0];

  // Helper to compile full slide text for copying
  const compileSlideText = (slide) => {
    let out = `## ${slide.title}\n`;
    out += `*${slide.subtitle}*\n\n`;
    out += `### Slide Purpose / Objective:\n${slide.objective}\n\n`;
    out += `### Recommended Bullet Points:\n`;
    slide.bullets.forEach((b) => {
      out += `• ${b}\n`;
    });
    out += `\n### Mathematical Equations:\n`;
    slide.latex.forEach((lx) => {
      out += `**${lx.title}**\n\`\`\`latex\n${lx.code}\n\`\`\`\n*${lx.explanation}*\n\n`;
    });
    out += `### Recommended Chart to Include:\n${slide.chartCaption}\n\n`;
    out += `### Speaker Notes:\n${slide.speakerNotes}\n`;
    return out;
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1240,
          height: "92vh",
          background: "#ffffff",
          borderRadius: "16px",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
          overflow: "hidden",
          border: "1px solid #e2e8f0",
        }}
      >
        {/* ── Top Header / Toolbar ── */}
        <div
          style={{
            padding: "14px 24px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#0f172a",
            color: "#ffffff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22 }}>📊</span>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>
                  Representative Basin Selection — Slide Presentation Guide
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "2px 8px",
                    borderRadius: 12,
                    background: "#3b82f6",
                    color: "#ffffff",
                  }}
                >
                  Temporary Workspace Tool
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                Step-by-step slides, equations, bullet points, and live charts for {sectionName} (Drop {selectedVariant})
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Quick Action: Copy all slide notes */}
            <button
              onClick={() => handleCopyText(compileSlideText(currentSlide), `full-${currentSlide.id}`, "Full slide")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 6,
                color: "#e2e8f0",
                fontSize: 12,
                cursor: "pointer",
                fontWeight: 500,
              }}
              title="Copy all bullet points, equations, and speaker notes to clipboard"
            >
              <span>{copiedKey === `full-${currentSlide.id}` ? "✓ Copied!" : "📋 Copy Slide Text"}</span>
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                fontSize: 22,
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: 6,
                lineHeight: 1,
              }}
              title="Close Guide (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Slide Navigation Bar ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 24px",
            background: "#f8fafc",
            borderBottom: "1px solid #e2e8f0",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {slides.map((s) => {
              const isActive = s.id === activeSlide;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSlide(s.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: isActive ? "1px solid #2563eb" : "1px solid #e2e8f0",
                    background: isActive ? "#eff6ff" : "#ffffff",
                    color: isActive ? "#1d4ed8" : "#475569",
                    fontWeight: isActive ? 700 : 500,
                    fontSize: 12,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: isActive ? "#2563eb" : "#e2e8f0",
                      color: isActive ? "#ffffff" : "#64748b",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {s.id}
                  </span>
                  <span>{s.badge}</span>
                </button>
              );
            })}
          </div>

          {/* Prev / Next controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              disabled={activeSlide === 1}
              onClick={() => setActiveSlide((s) => Math.max(1, s - 1))}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: activeSlide === 1 ? "#f1f5f9" : "#ffffff",
                color: activeSlide === 1 ? "#94a3b8" : "#1e293b",
                fontSize: 12,
                cursor: activeSlide === 1 ? "not-allowed" : "pointer",
                fontWeight: 600,
              }}
            >
              ← Prev Slide
            </button>
            <span style={{ fontSize: 12, color: "#64748b", padding: "0 6px", fontWeight: 600 }}>
              {activeSlide} / {slides.length}
            </span>
            <button
              disabled={activeSlide === slides.length}
              onClick={() => setActiveSlide((s) => Math.min(slides.length, s + 1))}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: activeSlide === slides.length ? "#f1f5f9" : "#ffffff",
                color: activeSlide === slides.length ? "#94a3b8" : "#1e293b",
                fontSize: 12,
                cursor: activeSlide === slides.length ? "not-allowed" : "pointer",
                fontWeight: 600,
              }}
            >
              Next Slide →
            </button>
          </div>
        </div>

        {/* ── Slide Content Viewport (Two-Column Layout) ── */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px",
            display: "grid",
            gridTemplateColumns: "1.1fr 1fr",
            gap: "24px",
            background: "#ffffff",
          }}
        >
          {/* ══════ LEFT COLUMN: SLIDE TEXT, BULLETS & EQUATIONS ══════ */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Slide Header Card */}
            <div
              style={{
                padding: "16px 20px",
                borderRadius: "10px",
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span
                  style={{
                    background: "#2563eb",
                    color: "#ffffff",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 4,
                  }}
                >
                  {currentSlide.num}
                </span>
                <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                  {currentSlide.badge}
                </span>
              </div>
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "#0f172a",
                  margin: "0 0 6px 0",
                  lineHeight: 1.3,
                }}
              >
                {currentSlide.title}
              </h2>
              <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.4 }}>
                {currentSlide.subtitle}
              </div>
            </div>

            {/* Slide Objective Callout */}
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "8px",
                background: "#eff6ff",
                borderLeft: "4px solid #3b82f6",
                fontSize: 13,
                color: "#1e40af",
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: "#1d4ed8" }}>🎯 Slide Objective: </strong>
              {currentSlide.objective}
            </div>

            {/* Bullet Points to Put on the Slide */}
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
                background: "#ffffff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 15 }}>📝</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    Bullet Points for this Slide
                  </span>
                </div>
                <button
                  onClick={() =>
                    handleCopyText(
                      currentSlide.bullets.map((b) => `• ${b}`).join("\n"),
                      `bullets-${currentSlide.id}`,
                      "Bullets"
                    )
                  }
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    background: "#f1f5f9",
                    border: "1px solid #cbd5e1",
                    borderRadius: 4,
                    cursor: "pointer",
                    color: "#334155",
                    fontWeight: 600,
                  }}
                >
                  {copiedKey === `bullets-${currentSlide.id}` ? "✓ Copied" : "📋 Copy Bullets"}
                </button>
              </div>

              <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                {currentSlide.bullets.map((bullet, i) => (
                  <li key={i} style={{ fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
                    {bullet}
                  </li>
                ))}
              </ul>
            </div>

            {/* Mathematical Equations */}
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
                background: "#ffffff",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                <span style={{ fontSize: 15 }}>📐</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                  Mathematical Formulation & Equations
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {currentSlide.latex.map((lx, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      padding: "12px 14px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>
                        {lx.title}
                      </span>
                      <button
                        onClick={() => handleCopyText(lx.code, `latex-${activeSlide}-${idx}`, "LaTeX formula")}
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          background: "#ffffff",
                          border: "1px solid #cbd5e1",
                          borderRadius: 4,
                          cursor: "pointer",
                          color: "#475569",
                          fontWeight: 600,
                        }}
                        title="Copy LaTeX string (Paste into PowerPoint via Alt+=)"
                      >
                        {copiedKey === `latex-${activeSlide}-${idx}` ? "✓ Copied" : "📋 Copy LaTeX"}
                      </button>
                    </div>

                    {/* Styled Math Formula Block */}
                    <div
                      style={{
                        padding: "10px 12px",
                        background: "#0f172a",
                        color: "#38bdf8",
                        borderRadius: "6px",
                        fontFamily: "JetBrains Mono, Courier New, monospace",
                        fontSize: 12,
                        overflowX: "auto",
                        lineHeight: 1.5,
                      }}
                    >
                      {lx.code}
                    </div>

                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 6, fontStyle: "italic" }}>
                      {lx.explanation}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Speaker Notes */}
            <div
              style={{
                border: "1px solid #fed7aa",
                borderRadius: "10px",
                padding: "14px 16px",
                background: "#fffbeb",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>💡</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>
                  Presenter / Speaker Notes
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#78350f", lineHeight: 1.5 }}>
                {currentSlide.speakerNotes}
              </div>
            </div>
          </div>

          {/* ══════ RIGHT COLUMN: RECOMMENDED CHART FOR THIS SLIDE ══════ */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
                background: "#ffffff",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {/* Chart Header Bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 15 }}>📈</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                      Recommended Chart for {currentSlide.num}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    Live visual generated from active project data
                  </div>
                </div>

                {/* Copy Chart PNG to Clipboard & Download */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    onClick={() => {
                      const refMap = [chartRef1, chartRef2, chartRef3, chartRef4, chartRef5];
                      const currentRef = refMap[activeSlide - 1];
                      handleCopyChartImage(currentRef.current, `Chart for ${currentSlide.num}`);
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      padding: "4px 8px",
                      background: "#2563eb",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                    title="Copy chart image to clipboard (Paste directly into PowerPoint / Word)"
                  >
                    <span>📋</span> Copy Chart Image
                  </button>
                  <button
                    onClick={() => {
                      const refMap = [chartRef1, chartRef2, chartRef3, chartRef4, chartRef5];
                      const currentRef = refMap[activeSlide - 1];
                      handleDownloadChartImage(
                        currentRef.current,
                        `Slide_${activeSlide}_Chart_${sectionName}_Drop_${selectedVariant}.png`
                      );
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      padding: "4px 8px",
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      borderRadius: 4,
                      cursor: "pointer",
                      color: "#334155",
                      fontWeight: 600,
                    }}
                    title="Download high-resolution 300 DPI PNG"
                  >
                    <span>⬇</span> PNG
                  </button>
                </div>
              </div>

              {/* ── LIVE RENDERED SVG CHART PREVIEWS ── */}
              <div
                style={{
                  width: "100%",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  background: "#ffffff",
                  overflow: "hidden",
                  display: "flex",
                  justifyContent: "center",
                  padding: "10px",
                }}
              >
                {/* ── CHART 1: ALL BOWLS OVERLAY (SLIDE 1) ── */}
                {activeSlide === 1 && (
                  <svg
                    ref={chartRef1}
                    width={chartW}
                    height={chartH}
                    viewBox={`0 0 ${chartW} ${chartH}`}
                    style={{ display: "block", background: "#ffffff" }}
                  >
                    <text
                      x={chartW / 2}
                      y={18}
                      textAnchor="middle"
                      fontSize="13"
                      fontWeight="bold"
                      fill="#0f172a"
                      fontFamily="Arial, sans-serif"
                    >
                      Pavement Deflection Bowl Scatter ({stationCount} Stations)
                    </text>

                    {/* Grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                      const y = pad.top + pct * plotH;
                      const val = (pct * maxDeflection).toFixed(1);
                      return (
                        <g key={pct}>
                          <line
                            x1={pad.left}
                            y1={y}
                            x2={pad.left + plotW}
                            y2={y}
                            stroke="#e2e8f0"
                            strokeWidth="1"
                          />
                          <text
                            x={pad.left - 6}
                            y={y + 4}
                            textAnchor="end"
                            fontSize="9"
                            fill="#64748b"
                            fontFamily="Arial, sans-serif"
                          >
                            {val}
                          </text>
                        </g>
                      );
                    })}

                    {/* All stations in light gray lines */}
                    {rows.map((r, idx) => {
                      const pts = getSvgPoints(r, maxDeflection);
                      return (
                        <path
                          key={idx}
                          d={makePathD(pts)}
                          fill="none"
                          stroke="#94a3b8"
                          strokeWidth="1"
                          strokeOpacity="0.4"
                        />
                      );
                    })}

                    {/* Section Mean in dashed red */}
                    {meanPoints.length > 0 && (
                      <path
                        d={makePathD(meanPoints)}
                        fill="none"
                        stroke="#dc2626"
                        strokeWidth="2.5"
                        strokeDasharray="5,3"
                      />
                    )}

                    {/* Representative Station in solid green */}
                    {repPoints.length > 0 && (
                      <path
                        d={makePathD(repPoints)}
                        fill="none"
                        stroke="#16a34a"
                        strokeWidth="3"
                      />
                    )}

                    {/* Chart Box */}
                    <rect
                      x={pad.left}
                      y={pad.top}
                      width={plotW}
                      height={plotH}
                      fill="none"
                      stroke="#0f172a"
                      strokeWidth="1.2"
                    />

                    {/* X Ticks */}
                    {deflectionCols.map((c, i) => {
                      const x = pad.left + xGap + (deflectionCols.length > 1 ? (i / (deflectionCols.length - 1)) * availW : availW / 2);
                      return (
                        <g key={c}>
                          <line x1={x} y1={pad.top + plotH} x2={x} y2={pad.top + plotH + 4} stroke="#0f172a" strokeWidth="1" />
                          <text x={x} y={pad.top + plotH + 16} textAnchor="middle" fontSize="10" fill="#0f172a" fontFamily="Arial, sans-serif">
                            {c}
                          </text>
                        </g>
                      );
                    })}

                    {/* Y Title */}
                    <text
                      x={pad.left - 36}
                      y={pad.top + plotH / 2}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="bold"
                      fill="#0f172a"
                      fontFamily="Arial, sans-serif"
                      transform={`rotate(-90 ${pad.left - 36} ${pad.top + plotH / 2})`}
                    >
                      Deflection (mils)
                    </text>

                    {/* Mini Legend */}
                    <rect x={pad.left + plotW - 175} y={pad.top + 10} width={165} height={60} fill="#ffffff" stroke="#cbd5e1" strokeWidth="1" rx="4" />
                    <line x1={pad.left + plotW - 165} y1={pad.top + 24} x2={pad.left + plotW - 145} y2={pad.top + 24} stroke="#94a3b8" strokeWidth="2" />
                    <text x={pad.left + plotW - 140} y={pad.top + 27} fontSize="10" fill="#475569" fontFamily="Arial, sans-serif">All Stations ({stationCount})</text>
                    <line x1={pad.left + plotW - 165} y1={pad.top + 40} x2={pad.left + plotW - 145} y2={pad.top + 40} stroke="#dc2626" strokeWidth="2" strokeDasharray="4,2" />
                    <text x={pad.left + plotW - 140} y={pad.top + 43} fontSize="10" fill="#dc2626" fontWeight="bold" fontFamily="Arial, sans-serif">Section Mean (D̄)</text>
                    <line x1={pad.left + plotW - 165} y1={pad.top + 56} x2={pad.left + plotW - 145} y2={pad.top + 56} stroke="#16a34a" strokeWidth="2.5" />
                    <text x={pad.left + plotW - 140} y={pad.top + 59} fontSize="10" fill="#16a34a" fontWeight="bold" fontFamily="Arial, sans-serif">Rep Station {repStationId}</text>
                  </svg>
                )}

                {/* ── CHART 2: SECTION MEAN BASELINE BASIN (SLIDE 2) ── */}
                {activeSlide === 2 && (
                  <svg
                    ref={chartRef2}
                    width={chartW}
                    height={chartH}
                    viewBox={`0 0 ${chartW} ${chartH}`}
                    style={{ display: "block", background: "#ffffff" }}
                  >
                    <text
                      x={chartW / 2}
                      y={18}
                      textAnchor="middle"
                      fontSize="13"
                      fontWeight="bold"
                      fill="#0f172a"
                      fontFamily="Arial, sans-serif"
                    >
                      Baseline Normalized Mean Deflection Basin (9,000 lbs)
                    </text>

                    {/* Grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                      const y = pad.top + pct * plotH;
                      const val = (pct * maxDeflection).toFixed(1);
                      return (
                        <g key={pct}>
                          <line x1={pad.left} y1={y} x2={pad.left + plotW} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                          <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="Arial, sans-serif">
                            {val}
                          </text>
                        </g>
                      );
                    })}

                    {/* Shaded Area under Mean */}
                    {meanPoints.length > 0 && (
                      <path
                        d={`${makePathD(meanPoints)} L ${meanPoints[meanPoints.length - 1].x} ${pad.top} L ${meanPoints[0].x} ${pad.top} Z`}
                        fill="#fee2e2"
                        fillOpacity="0.45"
                      />
                    )}

                    {/* Mean line */}
                    {meanPoints.length > 0 && (
                      <path d={makePathD(meanPoints)} fill="none" stroke="#dc2626" strokeWidth="2.5" />
                    )}

                    {/* Points & mean labels */}
                    {meanPoints.map((pt) => (
                      <g key={pt.sensor}>
                        <circle cx={pt.x} cy={pt.y} r="4.5" fill="#dc2626" stroke="#ffffff" strokeWidth="1.5" />
                        <text
                          x={pt.x}
                          y={pt.y > pad.top + plotH - 20 ? pt.y - 8 : pt.y + 14}
                          textAnchor="middle"
                          fontSize="9.5"
                          fontWeight="bold"
                          fill="#991b1b"
                          fontFamily="Arial, sans-serif"
                        >
                          {pt.val.toFixed(2)}
                        </text>
                      </g>
                    ))}

                    {/* Chart Box */}
                    <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="none" stroke="#0f172a" strokeWidth="1.2" />

                    {/* X Ticks */}
                    {deflectionCols.map((c, i) => {
                      const x = pad.left + xGap + (deflectionCols.length > 1 ? (i / (deflectionCols.length - 1)) * availW : availW / 2);
                      return (
                        <g key={c}>
                          <line x1={x} y1={pad.top + plotH} x2={x} y2={pad.top + plotH + 4} stroke="#0f172a" strokeWidth="1" />
                          <text x={x} y={pad.top + plotH + 16} textAnchor="middle" fontSize="10" fill="#0f172a" fontFamily="Arial, sans-serif">
                            {c}
                          </text>
                        </g>
                      );
                    })}

                    <text
                      x={pad.left - 36}
                      y={pad.top + plotH / 2}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="bold"
                      fill="#0f172a"
                      fontFamily="Arial, sans-serif"
                      transform={`rotate(-90 ${pad.left - 36} ${pad.top + plotH / 2})`}
                    >
                      Deflection (mils)
                    </text>
                  </svg>
                )}

                {/* ── CHART 3: STATION-BY-STATION RMSE BAR CHART (SLIDE 3) ── */}
                {activeSlide === 3 && (
                  <svg
                    ref={chartRef3}
                    width={chartW}
                    height={chartH}
                    viewBox={`0 0 ${chartW} ${chartH}`}
                    style={{ display: "block", background: "#ffffff" }}
                  >
                    <text
                      x={chartW / 2}
                      y={18}
                      textAnchor="middle"
                      fontSize="13"
                      fontWeight="bold"
                      fill="#0f172a"
                      fontFamily="Arial, sans-serif"
                    >
                      RMSE Distance from Section Mean Across All Stations
                    </text>

                    {(() => {
                      const rowsDist = sectionStats?.rowsWithDistance || [];
                      const count = rowsDist.length;
                      if (count === 0) return null;
                      const maxRmse = Math.max(...rowsDist.map((r) => r.rmse).filter(isFinite), 1) * 1.15;
                      const slotW = plotW / count;
                      const bWidth = Math.max(2, Math.min(14, slotW * 0.75));

                      return (
                        <g>
                          {/* Grid lines */}
                          {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                            const y = pad.top + (1 - pct) * plotH;
                            const val = (pct * maxRmse).toFixed(2);
                            return (
                              <g key={pct}>
                                <line x1={pad.left} y1={y} x2={pad.left + plotW} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                                <text x={pad.left - 6} y={y + 3.5} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="Arial, sans-serif">
                                  {val}
                                </text>
                              </g>
                            );
                          })}

                          {/* Bars */}
                          {rowsDist.map((item, idx) => {
                            const cx = pad.left + idx * slotW + slotW / 2;
                            const bx = cx - bWidth / 2;
                            const bH = maxRmse > 0 ? (item.rmse / maxRmse) * plotH : 0;
                            const by = pad.top + plotH - bH;
                            const isThisRep = item.originalIdx === rep?.originalIdx;

                            return (
                              <g key={item.originalIdx}>
                                <rect
                                  x={bx}
                                  y={by}
                                  width={bWidth}
                                  height={bH}
                                  fill={isThisRep ? "#2563eb" : "#94a3b8"}
                                />
                                {isThisRep && (
                                  <g>
                                    <polygon
                                      points={`${cx},${by - 4} ${cx - 5},${by - 12} ${cx + 5},${by - 12}`}
                                      fill="#2563eb"
                                    />
                                    <text
                                      x={cx}
                                      y={by - 15}
                                      textAnchor="middle"
                                      fontSize="10"
                                      fontWeight="bold"
                                      fill="#1d4ed8"
                                      fontFamily="Arial, sans-serif"
                                    >
                                      Rep ({item.row.StationID})
                                    </text>
                                  </g>
                                )}
                              </g>
                            );
                          })}

                          {/* Chart Box */}
                          <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="none" stroke="#0f172a" strokeWidth="1.2" />

                          {/* Y Title */}
                          <text
                            x={pad.left - 36}
                            y={pad.top + plotH / 2}
                            textAnchor="middle"
                            fontSize="11"
                            fontWeight="bold"
                            fill="#0f172a"
                            fontFamily="Arial, sans-serif"
                            transform={`rotate(-90 ${pad.left - 36} ${pad.top + plotH / 2})`}
                          >
                            RMSE (mils)
                          </text>

                          {/* X Title */}
                          <text
                            x={pad.left + plotW / 2}
                            y={chartH - 10}
                            textAnchor="middle"
                            fontSize="11"
                            fontWeight="bold"
                            fill="#0f172a"
                            fontFamily="Arial, sans-serif"
                          >
                            Pavement Test Station Sequence
                          </text>
                        </g>
                      );
                    })()}
                  </svg>
                )}

                {/* ── CHART 4: REP VS MEAN OVERLAY (SLIDE 4) ── */}
                {activeSlide === 4 && (
                  <svg
                    ref={chartRef4}
                    width={chartW}
                    height={chartH}
                    viewBox={`0 0 ${chartW} ${chartH}`}
                    style={{ display: "block", background: "#ffffff" }}
                  >
                    <text
                      x={chartW / 2}
                      y={18}
                      textAnchor="middle"
                      fontSize="13"
                      fontWeight="bold"
                      fill="#0f172a"
                      fontFamily="Arial, sans-serif"
                    >
                      Geometric Alignment: Representative Basin vs. Section Mean
                    </text>

                    {/* Grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                      const y = pad.top + pct * plotH;
                      const val = (pct * maxDeflection).toFixed(1);
                      return (
                        <g key={pct}>
                          <line x1={pad.left} y1={y} x2={pad.left + plotW} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                          <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="Arial, sans-serif">
                            {val}
                          </text>
                        </g>
                      );
                    })}

                    {/* Section Mean in dashed red */}
                    {meanPoints.length > 0 && (
                      <path d={makePathD(meanPoints)} fill="none" stroke="#dc2626" strokeWidth="2.5" strokeDasharray="5,3" />
                    )}

                    {/* Representative Station in solid green */}
                    {repPoints.length > 0 && (
                      <path d={makePathD(repPoints)} fill="none" stroke="#16a34a" strokeWidth="3" />
                    )}

                    {/* Rep circles */}
                    {repPoints.map((pt) => (
                      <circle key={pt.sensor} cx={pt.x} cy={pt.y} r="4.5" fill="#16a34a" stroke="#ffffff" strokeWidth="1.5" />
                    ))}

                    {/* Mean circles */}
                    {meanPoints.map((pt) => (
                      <circle key={pt.sensor} cx={pt.x} cy={pt.y} r="3.5" fill="#dc2626" />
                    ))}

                    {/* Chart Box */}
                    <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="none" stroke="#0f172a" strokeWidth="1.2" />

                    {/* X Ticks */}
                    {deflectionCols.map((c, i) => {
                      const x = pad.left + xGap + (deflectionCols.length > 1 ? (i / (deflectionCols.length - 1)) * availW : availW / 2);
                      return (
                        <g key={c}>
                          <line x1={x} y1={pad.top + plotH} x2={x} y2={pad.top + plotH + 4} stroke="#0f172a" strokeWidth="1" />
                          <text x={x} y={pad.top + plotH + 16} textAnchor="middle" fontSize="10" fill="#0f172a" fontFamily="Arial, sans-serif">
                            {c}
                          </text>
                        </g>
                      );
                    })}

                    <text
                      x={pad.left - 36}
                      y={pad.top + plotH / 2}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="bold"
                      fill="#0f172a"
                      fontFamily="Arial, sans-serif"
                      transform={`rotate(-90 ${pad.left - 36} ${pad.top + plotH / 2})`}
                    >
                      Deflection (mils)
                    </text>

                    {/* Legend */}
                    <rect x={pad.left + plotW - 195} y={pad.top + 10} width={185} height={46} fill="#ffffff" stroke="#cbd5e1" strokeWidth="1" rx="4" />
                    <line x1={pad.left + plotW - 185} y1={pad.top + 24} x2={pad.left + plotW - 160} y2={pad.top + 24} stroke="#dc2626" strokeWidth="2.5" strokeDasharray="4,2" />
                    <text x={pad.left + plotW - 152} y={pad.top + 27} fontSize="10" fill="#dc2626" fontWeight="bold" fontFamily="Arial, sans-serif">Section Mean (D̄)</text>
                    <line x1={pad.left + plotW - 185} y1={pad.top + 40} x2={pad.left + plotW - 160} y2={pad.top + 40} stroke="#16a34a" strokeWidth="3" />
                    <text x={pad.left + plotW - 152} y={pad.top + 43} fontSize="10" fill="#16a34a" fontWeight="bold" fontFamily="Arial, sans-serif">Rep Station {repStationId} (Min RMSE)</text>
                  </svg>
                )}

                {/* ── CHART 5: FINAL REPRESENTATIVE BASIN (SLIDE 5) ── */}
                {activeSlide === 5 && (
                  <svg
                    ref={chartRef5}
                    width={chartW}
                    height={chartH}
                    viewBox={`0 0 ${chartW} ${chartH}`}
                    style={{ display: "block", background: "#ffffff" }}
                  >
                    <text
                      x={chartW / 2}
                      y={18}
                      textAnchor="middle"
                      fontSize="13"
                      fontWeight="bold"
                      fill="#0f172a"
                      fontFamily="Arial, sans-serif"
                    >
                      Final Representative Basin: Station {repStationId} (Drop {selectedVariant})
                    </text>

                    {/* Grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                      const y = pad.top + pct * plotH;
                      const val = (pct * maxDeflection).toFixed(1);
                      return (
                        <g key={pct}>
                          <line x1={pad.left} y1={y} x2={pad.left + plotW} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                          <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize="9" fill="#64748b" fontFamily="Arial, sans-serif">
                            {val}
                          </text>
                        </g>
                      );
                    })}

                    {/* Shaded Area under Curve */}
                    {repPoints.length > 0 && (
                      <path
                        d={`${makePathD(repPoints)} L ${repPoints[repPoints.length - 1].x} ${pad.top} L ${repPoints[0].x} ${pad.top} Z`}
                        fill="#dcfce7"
                        fillOpacity="0.5"
                      />
                    )}

                    {/* Representative Curve */}
                    {repPoints.length > 0 && (
                      <path d={makePathD(repPoints)} fill="none" stroke="#16a34a" strokeWidth="3" />
                    )}

                    {/* Points & Deflection values */}
                    {repPoints.map((pt) => (
                      <g key={pt.sensor}>
                        <circle cx={pt.x} cy={pt.y} r="5" fill="#16a34a" stroke="#ffffff" strokeWidth="2" />
                        <text
                          x={pt.x}
                          y={pt.y > pad.top + plotH - 22 ? pt.y - 10 : pt.y + 16}
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight="bold"
                          fill="#14532d"
                          fontFamily="Arial, sans-serif"
                        >
                          {pt.val.toFixed(2)}
                        </text>
                      </g>
                    ))}

                    {/* Chart Box */}
                    <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="none" stroke="#0f172a" strokeWidth="1.2" />

                    {/* X Ticks */}
                    {deflectionCols.map((c, i) => {
                      const x = pad.left + xGap + (deflectionCols.length > 1 ? (i / (deflectionCols.length - 1)) * availW : availW / 2);
                      return (
                        <g key={c}>
                          <line x1={x} y1={pad.top + plotH} x2={x} y2={pad.top + plotH + 4} stroke="#0f172a" strokeWidth="1" />
                          <text x={x} y={pad.top + plotH + 16} textAnchor="middle" fontSize="10" fill="#0f172a" fontFamily="Arial, sans-serif">
                            {c}
                          </text>
                        </g>
                      );
                    })}

                    <text
                      x={pad.left - 36}
                      y={pad.top + plotH / 2}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="bold"
                      fill="#0f172a"
                      fontFamily="Arial, sans-serif"
                      transform={`rotate(-90 ${pad.left - 36} ${pad.top + plotH / 2})`}
                    >
                      Deflection (mils)
                    </text>
                  </svg>
                )}
              </div>

              {/* Chart Caption & Interpretation */}
              <div
                style={{
                  fontSize: 12,
                  color: "#475569",
                  background: "#f8fafc",
                  padding: "10px 14px",
                  borderRadius: "6px",
                  lineHeight: 1.4,
                  border: "1px solid #e2e8f0",
                }}
              >
                <strong style={{ color: "#0f172a" }}>Chart Description for Slide: </strong>
                {currentSlide.chartCaption}
              </div>

              {/* Live Data Summary Pills / Cards for Slide 4 & 5 */}
              {activeSlide === 4 && sectionStats?.repIndices && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                  <div style={{ padding: "8px 10px", background: "#f1f5f9", borderRadius: 6, fontSize: 11 }}>
                    <div style={{ color: "#64748b", fontWeight: 600 }}>SCI (Surface AC)</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginTop: 2 }}>
                      Rep: {sectionStats.repIndices.sci.toFixed(2)} mils{" "}
                      <span style={{ fontWeight: 400, color: "#64748b" }}>(Mean: {sectionStats.meanIndices.sci.toFixed(2)})</span>
                    </div>
                  </div>
                  <div style={{ padding: "8px 10px", background: "#f1f5f9", borderRadius: 6, fontSize: 11 }}>
                    <div style={{ color: "#64748b", fontWeight: 600 }}>BDI (Base Layer)</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginTop: 2 }}>
                      Rep: {sectionStats.repIndices.bdi.toFixed(2)} mils{" "}
                      <span style={{ fontWeight: 400, color: "#64748b" }}>(Mean: {sectionStats.meanIndices.bdi.toFixed(2)})</span>
                    </div>
                  </div>
                  <div style={{ padding: "8px 10px", background: "#f1f5f9", borderRadius: 6, fontSize: 11 }}>
                    <div style={{ color: "#64748b", fontWeight: 600 }}>BCI (Subgrade)</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginTop: 2 }}>
                      Rep: {sectionStats.repIndices.bci.toFixed(2)} mils{" "}
                      <span style={{ fontWeight: 400, color: "#64748b" }}>(Mean: {sectionStats.meanIndices.bci.toFixed(2)})</span>
                    </div>
                  </div>
                  <div style={{ padding: "8px 10px", background: "#f1f5f9", borderRadius: 6, fontSize: 11 }}>
                    <div style={{ color: "#64748b", fontWeight: 600 }}>AASHTO Area</div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginTop: 2 }}>
                      Rep: {sectionStats.repIndices.area.toFixed(1)} in{" "}
                      <span style={{ fontWeight: 400, color: "#64748b" }}>(Mean: {sectionStats.meanIndices.area.toFixed(1)})</span>
                    </div>
                  </div>
                </div>
              )}

              {activeSlide === 5 && rep && (
                <div style={{ padding: "10px 14px", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 6, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: "#065f46", marginBottom: 4 }}>
                    ✅ Selected Station Parameters Ready for Backcalculation:
                  </div>
                  <div style={{ color: "#047857", lineHeight: 1.5 }}>
                    • <strong>Station:</strong> {rep.row.StationID} (Row #{rep.originalIdx + 1})<br />
                    • <strong>Minimum RMSE:</strong> {rep.rmse.toFixed(3)} mils<br />
                    • <strong>Impact Load:</strong> 9,000 lbs normalized<br />
                    • <strong>D₁ to D₇:</strong> {deflectionCols.map((c) => `${c}=${parseFloat(rep.row[c] || 0).toFixed(2)}`).join(", ")} mils
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            padding: "10px 24px",
            background: "#f8fafc",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11,
            color: "#64748b",
          }}
        >
          <div>
            💡 <em>Tip: You can use the Left and Right arrow keys on your keyboard to navigate between slides.</em>
          </div>
          <div>
            When you're finished with your presentation, this guide can be removed anytime.
          </div>
        </div>
      </div>
    </div>
  );
}
