import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useToast } from "../context/ToastContext";
import {
  loadGoogleMapsApi,
  getStoredGoogleMapsApiKey,
  getStreetViewEmbedUrl,
} from "../utils/googleMapsLoader";

// In modern Vite, point maplibregl directly to its web worker bundle URL to prevent Worker loading error
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
maplibregl.setWorkerUrl(maplibreWorkerUrl);

function getCoordinate(val) {
  if (val === null || val === undefined) return null;
  const num = typeof val === "number" ? val : parseFloat(val);
  return isNaN(num) ? null : num;
}

function getDmiValue(row) {
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

function getPointThickness(row, fallbackThickness = null) {
  if (!row) return fallbackThickness ?? null;
  const candidates = [
    "Thickness",
    "thickness",
    "THICKNESS",
    "SlabThickness",
    "slab_thickness",
    "PavementThickness",
    "CoreThickness",
    "h",
    "H1",
  ];
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      const num = typeof row[key] === "number" ? row[key] : parseFloat(row[key]);
      if (Number.isFinite(num) && num > 0) {
        return num;
      }
    }
  }
  if (fallbackThickness !== undefined && fallbackThickness !== null) {
    const num = typeof fallbackThickness === "number" ? fallbackThickness : parseFloat(fallbackThickness);
    if (Number.isFinite(num) && num > 0) {
      return num;
    }
  }
  return null;
}

// Compute forward road bearing (azimuth 0-360 deg) between stations
function getStationHeading(points, currentIdx) {
  if (!points || points.length === 0) return 0;
  let p1, p2;
  if (currentIdx < points.length - 1) {
    p1 = points[currentIdx];
    p2 = points[currentIdx + 1];
  } else if (currentIdx > 0) {
    p1 = points[currentIdx - 1];
    p2 = points[currentIdx];
  } else {
    return 0;
  }
  const lat1 = (p1.lat * Math.PI) / 180;
  const lat2 = (p2.lat * Math.PI) / 180;
  const dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((brng + 360) % 360);
}

// Official Google Street View URL schema with viewpoint coordinates and forward road heading
function openGoogleStreetView(lat, lng, heading = 0) {
  const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}&heading=${heading}&pitch=0`;
  window.open(url, "_blank", "noopener,noreferrer");
}

const COLOR_OPTIONS = [
  { label: "Red", value: "#ef4444" },
  { label: "Black", value: "#111827" },
];

const DEFLECTION_RE = /^D(\d+)$/;

// Sensor Color Map matching Profile tab
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

export default function MapView({
  rows = [],
  columns = [],
  sectionName = "",
  selectedVariant = "A",
  sectionThickness = null,
}) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]); // Store DOM markers with inner dot reference
  const pegmanMarkerRef = useRef(null); // Active Pegman marker on map
  const chartContainerRef = useRef(null);
  const svgRef = useRef(null);
  const thicknessContainerRef = useRef(null);
  const thicknessSvgRef = useRef(null);
  const splitContainerRef = useRef(null);
  const panoContainerRef = useRef(null);
  const panoramaInstance = useRef(null);
  const streetViewServiceRef = useRef(null);
  const lastFetchedPanoRef = useRef(null);
  const { show } = useToast() || {};

  const [bearing, setBearing] = useState(0);
  const [currentZoom, setCurrentZoom] = useState(15);
  const [mapType, setMapType] = useState("google-satellite"); // "google-satellite" | "streets"
  const [dotColor, setDotColor] = useState("#ef4444");
  const [dotRadius, setDotRadius] = useState(6);
  const [showPoints, setShowPoints] = useState(true);

  // Synchronized Profile View States
  const [showProfile, setShowProfile] = useState(true);
  const [selectedSensor, setSelectedSensor] = useState("D1");
  const [showAverageLine, setShowAverageLine] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [hoveredStationId, setHoveredStationId] = useState(null);
  const [activeStationId, setActiveStationId] = useState(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [chartWidth, setChartWidth] = useState(1200);

  // Synchronized Slab / Pavement Thickness Profile States
  const [showThicknessProfile, setShowThicknessProfile] = useState(true);
  const [showThicknessAverageLine, setShowThicknessAverageLine] = useState(true);
  const [showThicknessLegend, setShowThicknessLegend] = useState(true);

  // Screenshot Clean View Mode (hides toolbars, headers, extra badges for aligned capture)
  const [isScreenshotMode, setIsScreenshotMode] = useState(false);

  // Dynamic pane heights with vertical drag splitters
  const [deflectionHeight, setDeflectionHeight] = useState(230);
  const [thicknessHeight, setThicknessHeight] = useState(230);
  const [isDraggingSplit1, setIsDraggingSplit1] = useState(false);
  const [isDraggingSplit2, setIsDraggingSplit2] = useState(false);

  // In-Map Street View & Resizable Split View states
  const [streetViewActive, setStreetViewActive] = useState(false);
  const [streetViewStation, setStreetViewStation] = useState(null);
  const [splitPercent, setSplitPercent] = useState(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [isPegmanMode, setIsPegmanMode] = useState(false);
  const isPegmanModeRef = useRef(isPegmanMode);
  isPegmanModeRef.current = isPegmanMode;

  // Street View 3D road markers state & ref
  const [showPointsInStreetView, setShowPointsInStreetView] = useState(true);
  const [panoReady, setPanoReady] = useState(false);
  const [panoStatus, setPanoStatus] = useState("OK"); // "OK" | "ZERO_RESULTS"
  const streetMarkersRef = useRef([]);

  // Google Maps JS API & Historical Timeline states
  const [googleMapsReady, setGoogleMapsReady] = useState(false);
  const [availableDates, setAvailableDates] = useState([]);
  const [currentPanoId, setCurrentPanoId] = useState("");
  const [currentImageYear, setCurrentImageYear] = useState("");
  const [currentImageDate, setCurrentImageDate] = useState("");
  const [isLoadingDates, setIsLoadingDates] = useState(false);

  // ── Load Google Maps JS SDK for Panorama & StreetViewService ──────────────
  useEffect(() => {
    loadGoogleMapsApi()
      .then((gMaps) => {
        setGoogleMapsReady(true);
        if (gMaps.StreetViewService) {
          streetViewServiceRef.current = new gMaps.StreetViewService();
        }
      })
      .catch((err) => {
        console.warn("Google Maps JS API load notice (will use embed fallback):", err);
      });
  }, []);

  // ── Fetch Street View Metadata & Historical Panoramas (data.time) ───────────
  const fetchPanoTimeline = useCallback((panoId, latLng = null) => {
    if (!streetViewServiceRef.current) return;
    if (panoId && lastFetchedPanoRef.current === panoId) return;
    if (panoId) lastFetchedPanoRef.current = panoId;

    setIsLoadingDates(true);
    const request = panoId
      ? { pano: panoId }
      : latLng
      ? {
          location: latLng,
          radius: 150,
          preference: window.google?.maps?.StreetViewPreference?.NEAREST,
          source: window.google?.maps?.StreetViewSource?.OUTDOOR,
        }
      : null;
    if (!request) {
      setIsLoadingDates(false);
      return;
    }

    try {
      streetViewServiceRef.current.getPanorama(request, (data, status) => {
        setIsLoadingDates(false);
        if (status === "OK" && data) {
          const activePano = data.location?.pano || panoId || "";
          setCurrentPanoId(activePano);
          setPanoStatus("OK");

          // Directly sync active pano to the panorama instance so it never stays black!
          if (panoramaInstance.current && activePano) {
            const curPano = panoramaInstance.current.getPano();
            if (curPano !== activePano) {
              panoramaInstance.current.setPano(activePano);
            }
            window.google?.maps?.event?.trigger(panoramaInstance.current, "resize");
          }

          const rawDate = data.imageDate || "";
          setCurrentImageDate(rawDate);
          const year = rawDate ? rawDate.split("-")[0] : "";
          setCurrentImageYear(year);

          // Parse historical panos from data.time (undocumented Google Street View history array)
          const times = Array.isArray(data.time) ? data.time : [];
          const parsed = [];

          times.forEach((item) => {
            if (!item || !item.pano) return;
            const dateKey = Object.keys(item).find((k) => k !== "pano");
            const val = dateKey ? item[dateKey] : null;
            let dateObj = null;
            if (val instanceof Date) {
              dateObj = val;
            } else if (val) {
              const parsedD = new Date(val);
              if (!isNaN(parsedD.getTime())) dateObj = parsedD;
            }

            let dStr = "";
            let yStr = "";
            let displayLabel = "";

            if (dateObj) {
              dStr = dateObj.toISOString().slice(0, 7);
              yStr = String(dateObj.getFullYear());
              displayLabel = dateObj.toLocaleDateString("en-US", { year: "numeric", month: "short" });
            } else if (typeof val === "string") {
              dStr = val.slice(0, 7);
              yStr = val.slice(0, 4);
              displayLabel = val;
            } else {
              dStr = rawDate || "Historical";
              yStr = dStr.slice(0, 4);
              displayLabel = dStr;
            }

            parsed.push({
              pano: item.pano,
              date: dStr,
              year: yStr,
              label: displayLabel,
            });
          });

          // Sort chronological descending (most recent first)
          parsed.sort((a, b) => b.date.localeCompare(a.date));

          // Ensure active panorama is present in the array
          if (!parsed.some((p) => p.pano === activePano)) {
            let currentLabel = rawDate;
            if (rawDate && rawDate.includes("-")) {
              const [y, m] = rawDate.split("-");
              const d = new Date(Number(y), Number(m) - 1, 1);
              if (!isNaN(d.getTime())) {
                currentLabel = d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
              }
            }
            parsed.unshift({
              pano: activePano,
              date: rawDate || "Current",
              year: year || "",
              label: currentLabel || rawDate || "Latest",
            });
          }

          setAvailableDates(parsed);
        } else if (status === "ZERO_RESULTS" && latLng) {
          // Retry with wider 300m radius if 150m failed
          streetViewServiceRef.current.getPanorama(
            { location: latLng, radius: 300 },
            (data300, status300) => {
              if (status300 === "OK" && data300?.location?.pano) {
                const fallbackPano = data300.location.pano;
                if (panoramaInstance.current) {
                  panoramaInstance.current.setPano(fallbackPano);
                  window.google?.maps?.event?.trigger(panoramaInstance.current, "resize");
                }
                setCurrentPanoId(fallbackPano);
                setPanoStatus("OK");
              } else {
                setPanoStatus("ZERO_RESULTS");
              }
            }
          );
        }
      });
    } catch (err) {
      console.warn("Error fetching Street View timeline metadata:", err);
      setIsLoadingDates(false);
    }
  }, []);

  // ── Switch Active Street View Date ──────────────────────────────────────────
  const handleSelectDate = useCallback((targetPanoId) => {
    if (!targetPanoId) return;
    if (panoramaInstance.current) {
      panoramaInstance.current.setPano(targetPanoId);
      setPanoStatus("OK");
      window.google?.maps?.event?.trigger(panoramaInstance.current, "resize");
    }
    setCurrentPanoId(targetPanoId);
    const match = availableDates.find((d) => d.pano === targetPanoId);
    if (match) {
      setCurrentImageDate(match.date);
      setCurrentImageYear(match.year);
    }
  }, [availableDates]);

  // ── Draggable Split Screen Resizer ──────────────────────────────────────────
  const handleSplitPointerDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingSplit(true);

    const container = splitContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const handlePointerMove = (moveEvent) => {
      moveEvent.preventDefault();
      const currentX = moveEvent.clientX;
      const offset = currentX - rect.left;
      let newPct = (offset / rect.width) * 100;
      if (newPct < 15) newPct = 15;
      if (newPct > 85) newPct = 85;
      setSplitPercent(Math.round(newPct));

      if (map.current) {
        map.current.resize();
      }
      if (panoramaInstance.current && window.google?.maps) {
        window.google.maps.event.trigger(panoramaInstance.current, "resize");
      }
    };

    const handlePointerUp = () => {
      setIsDraggingSplit(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);

      setTimeout(() => {
        if (map.current) {
          map.current.resize();
        }
        if (panoramaInstance.current && window.google?.maps) {
          window.google.maps.event.trigger(panoramaInstance.current, "resize");
        }
      }, 50);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, []);

  // Listen for Escape key to exit Screenshot Clean View
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isScreenshotMode) {
        setIsScreenshotMode(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isScreenshotMode]);

  // ── Vertical Drag Resizers for Stacked Panes (Map <-> Deflection <-> Thickness) ──
  const handleSplit1PointerDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingSplit1(true);
      const startY = e.clientY;
      const startH = deflectionHeight;

      const handlePointerMove = (ev) => {
        ev.preventDefault();
        const delta = startY - ev.clientY; // dragging upwards expands Deflection height
        const newH = Math.max(120, Math.min(600, startH + delta));
        setDeflectionHeight(Math.round(newH));
        if (map.current) map.current.resize();
      };

      const handlePointerUp = () => {
        setIsDraggingSplit1(false);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        setTimeout(() => {
          if (map.current) map.current.resize();
        }, 50);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [deflectionHeight]
  );

  const handleSplit2PointerDown = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingSplit2(true);
      const startY = e.clientY;
      const startH = thicknessHeight;

      const handlePointerMove = (ev) => {
        ev.preventDefault();
        const delta = startY - ev.clientY; // dragging upwards expands Thickness height
        const newH = Math.max(120, Math.min(600, startH + delta));
        setThicknessHeight(Math.round(newH));
        if (map.current) map.current.resize();
      };

      const handlePointerUp = () => {
        setIsDraggingSplit2(false);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        setTimeout(() => {
          if (map.current) map.current.resize();
        }, 50);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [thicknessHeight]
  );

  // Dynamic wide-format chart measurement via ResizeObserver
  useEffect(() => {
    const el = chartContainerRef.current || thicknessContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setChartWidth(Math.floor(entry.contentRect.width));
        }
      }
    });
    if (chartContainerRef.current) ro.observe(chartContainerRef.current);
    if (thicknessContainerRef.current) ro.observe(thicknessContainerRef.current);
    return () => ro.disconnect();
  }, [showProfile, showThicknessProfile]);

  // Extract deflection columns sorted numerically: D1, D2, D3...
  const deflectionCols = useMemo(() => {
    let list = columns.filter((c) => DEFLECTION_RE.test(c));
    if (list.length === 0 && rows.length > 0) {
      list = Object.keys(rows[0]).filter((k) => DEFLECTION_RE.test(k));
    }
    if (list.length === 0) list = ["D1"];
    return list.sort((a, b) => {
      const numA = parseInt(a.replace("D", ""), 10);
      const numB = parseInt(b.replace("D", ""), 10);
      return numA - numB;
    });
  }, [columns, rows]);

  // Derive effective active sensor safely
  const activeSensor = useMemo(() => {
    if (deflectionCols.includes(selectedSensor)) return selectedSensor;
    return deflectionCols[0] ?? "D1";
  }, [deflectionCols, selectedSensor]);

  // Extract valid points [lng, lat]
  const validPoints = useMemo(() => {
    return rows
      .map((r, idx) => {
        const lat = getCoordinate(r.Latitude ?? r.latitude ?? r.LAT ?? r.Lat);
        const lng = getCoordinate(r.Longitude ?? r.longitude ?? r.LON ?? r.Long ?? r.Lng);
        if (lat !== null && lng !== null && lat !== 0 && lng !== 0) {
          const dmi = getDmiValue(r);
          const stnId = r.StationID ?? r.stationId ?? r.stationid ?? r.Station ?? idx + 1;
          return {
            ...r,
            lat,
            lng,
            dmi: dmi ?? idx + 1,
            StationID: stnId,
            stationId: stnId,
            index: idx + 1,
          };
        }
        return null;
      })
      .filter(Boolean);
  }, [rows]);

  // Center & bounds
  const { initialCenter, bounds, polylineCoords } = useMemo(() => {
    if (validPoints.length === 0) {
      return { initialCenter: [-98.5795, 39.8283], bounds: null, polylineCoords: [] };
    }

    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;

    const coords = validPoints.map((pt) => {
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lng < minLng) minLng = pt.lng;
      if (pt.lng > maxLng) maxLng = pt.lng;
      return [pt.lng, pt.lat];
    });

    return {
      initialCenter: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
      bounds: [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      polylineCoords: coords,
    };
  }, [validPoints]);

  // Extract profile points sorted by DMI ascending (matching ProfileView)
  const profilePoints = useMemo(() => {
    if (validPoints.length === 0) return [];
    const pts = validPoints
      .map((pt, idx) => {
        const val = pt[activeSensor];
        const numVal = typeof val === "number" ? val : parseFloat(val);
        if (isNaN(numVal)) return null;
        return {
          originalIdx: idx,
          stationId: pt.stationId,
          dmi: pt.dmi,
          val: numVal,
          lat: pt.lat,
          lng: pt.lng,
          row: pt,
        };
      })
      .filter(Boolean);

    pts.sort((a, b) => a.dmi - b.dmi);
    return pts;
  }, [validPoints, activeSensor]);

  // Compute profile statistics (matching ProfileView)
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

  // Chart dimensions for wide format
  const chartHeight = 220;
  const padding = { top: 22, right: 35, bottom: 44, left: 68 };
  const plotWidth = Math.max(100, chartWidth - padding.left - padding.right);
  const plotHeight = Math.max(50, chartHeight - padding.top - padding.bottom);

  // Compute Scales matching ProfileView
  const scales = useMemo(() => {
    if (!stats || profilePoints.length === 0) return null;

    const maxYVal = Math.max(stats.max, showAverageLine ? stats.mean : 0);
    const yMax = Math.max(maxYVal * 1.15, 1);
    const roundedYMax = Math.ceil(yMax);

    const minDmi = stats.minDmi;
    const maxDmi = stats.maxDmi === minDmi ? minDmi + 100 : stats.maxDmi;
    const dmiRange = maxDmi - minDmi;

    const getX = (dmi) => padding.left + ((dmi - minDmi) / dmiRange) * plotWidth;
    const getY = (val) => padding.top + plotHeight - (val / roundedYMax) * plotHeight;

    const mappedPoints = profilePoints.map((p) => ({
      ...p,
      x: getX(p.dmi),
      y: getY(p.val),
    }));

    const linePath = mappedPoints.reduce((acc, p, i) => {
      return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, "");

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

    // Adapt number of tick intervals to wide plot width (approx one every 100-120px)
    const intervals = Math.max(6, Math.min(16, Math.floor(plotWidth / 110)));
    const step = getNiceStep(dmiRange, intervals);
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
    const lastTick = xTicks[xTicks.length - 1];
    if (lastTick && maxDmi - lastTick.val > step * 0.45) {
      xTicks.push({ val: maxDmi, x: getX(maxDmi) });
    }

    const averageY = getY(stats.mean);

    return {
      roundedYMax,
      getX,
      getY,
      mappedPoints,
      linePath,
      xTicks,
      averageY,
    };
  }, [stats, profilePoints, showAverageLine, plotWidth, plotHeight]);

  // Extract thickness points along road DMI
  const thicknessPoints = useMemo(() => {
    return validPoints
      .map((pt, idx) => {
        const thick = getPointThickness(pt, sectionThickness);
        return {
          originalIdx: idx,
          dmi: pt.dmi,
          val: thick,
          stationId: pt.StationID ?? pt.stationId,
          lat: pt.lat,
          lng: pt.lng,
        };
      })
      .filter((p) => p.val !== null && Number.isFinite(p.val) && p.val > 0)
      .sort((a, b) => a.dmi - b.dmi);
  }, [validPoints, sectionThickness]);

  // Summary statistics for Thickness Profile
  const thicknessStats = useMemo(() => {
    if (thicknessPoints.length === 0) return null;
    const vals = thicknessPoints.map((p) => p.val);
    const sum = vals.reduce((a, b) => a + b, 0);
    const mean = sum / vals.length;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const variance = vals.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / vals.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? (stdDev / mean) * 100 : 0;
    return { mean, min, max, stdDev, cv, count: vals.length };
  }, [thicknessPoints]);

  // Compute Thickness Scales strictly aligned to Deflection DMI range and plotWidth
  const thicknessScales = useMemo(() => {
    if (!thicknessStats || thicknessPoints.length === 0 || !stats) return null;

    // Use stats minDmi and maxDmi from deflection profile so DMIs are 100% synchronized!
    const minDmi = stats.minDmi;
    const maxDmi = stats.maxDmi === minDmi ? minDmi + 100 : stats.maxDmi;
    const dmiRange = maxDmi - minDmi;

    const getX = (dmi) => padding.left + ((dmi - minDmi) / dmiRange) * plotWidth;

    const maxVal = Math.max(thicknessStats.max, showThicknessAverageLine ? thicknessStats.mean : 0);
    const roundedYMax = Math.max(Math.ceil(maxVal * 1.25), 10);
    const getY = (val) => padding.top + plotHeight - (val / roundedYMax) * plotHeight;

    const mappedPoints = thicknessPoints.map((p) => ({
      ...p,
      x: getX(p.dmi),
      y: getY(p.val),
    }));

    const linePath = mappedPoints.reduce((acc, p, i) => {
      return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, "");

    const averageY = getY(thicknessStats.mean);

    return {
      roundedYMax,
      getX,
      getY,
      mappedPoints,
      linePath,
      averageY,
    };
  }, [thicknessStats, thicknessPoints, stats, plotWidth, plotHeight, showThicknessAverageLine]);

  // Synchronized active point for Thickness chart
  const activeHoverThicknessPoint = useMemo(() => {
    if (!thicknessScales) return null;
    const targetId = hoveredStationId ?? activeStationId;
    if (targetId !== null && targetId !== undefined) {
      return (
        thicknessScales.mappedPoints.find(
          (p) => String(p.stationId) === String(targetId)
        ) || null
      );
    }
    return null;
  }, [thicknessScales, hoveredStationId, activeStationId]);

  // Re-fit canvas when split screen opens/closes, charts toggle, or heights change
  useEffect(() => {
    if (map.current) {
      const timer = setTimeout(() => {
        map.current?.resize();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [showProfile, showThicknessProfile, deflectionHeight, thicknessHeight, streetViewActive, isScreenshotMode]);

  // Synchronized refs to avoid stale closures in event listeners
  const streetViewActiveRef = useRef(streetViewActive);
  streetViewActiveRef.current = streetViewActive;

  const streetViewStationRef = useRef(streetViewStation);
  streetViewStationRef.current = streetViewStation;

  const validPointsRef = useRef(validPoints);
  validPointsRef.current = validPoints;

  const activeSensorRef = useRef(activeSensor);
  activeSensorRef.current = activeSensor;

  const fetchPanoTimelineRef = useRef(fetchPanoTimeline);
  fetchPanoTimelineRef.current = fetchPanoTimeline;

  // Open Street View for a given point or ID
  const handleOpenStreetView = useCallback((pointOrId) => {
    let target = null;
    const pts = validPointsRef.current;
    if (typeof pointOrId === "object" && pointOrId !== null) {
      target = pointOrId;
    } else {
      target = pts.find(
        (p) => String(p.StationID ?? p.stationId) === String(pointOrId)
      );
    }
    if (!target && pts.length > 0) {
      target = pts[0];
    }
    if (target) {
      setStreetViewStation(target);
      setStreetViewActive(true);
      setActiveStationId(target.StationID ?? target.stationId);

      const targetIdx = pts.findIndex(
        (p) => String(p.StationID ?? p.stationId) === String(target.StationID ?? target.stationId)
      );
      const heading = getStationHeading(pts, targetIdx >= 0 ? targetIdx : 0);

      if (panoramaInstance.current) {
        panoramaInstance.current.setPosition({ lat: target.lat, lng: target.lng });
        panoramaInstance.current.setPov({ heading, pitch: 0, zoom: 1 });
      }
      if (fetchPanoTimelineRef.current) {
        fetchPanoTimelineRef.current(null, { lat: target.lat, lng: target.lng });
      }
      if (map.current) {
        map.current.easeTo({ center: [target.lng, target.lat], duration: 400 });
      }
      markersRef.current.forEach((m) => m.getPopup()?.remove());
    }
  }, []);

  const handleOpenStreetViewRef = useRef(handleOpenStreetView);
  handleOpenStreetViewRef.current = handleOpenStreetView;

  // Click on a station marker: navigates Street View if active or pegman mode, otherwise toggles popup
  const handleMarkerClick = useCallback((pt) => {
    if (!pt) return;
    const stId = pt.StationID ?? pt.stationId;
    setActiveStationId(stId);

    if (isPegmanModeRef.current) {
      handleOpenStreetView(pt);
      setIsPegmanMode(false);
      return;
    }

    if (streetViewActiveRef.current) {
      setStreetViewStation(pt);
      const pts = validPointsRef.current;
      const targetIdx = pts.findIndex(
        (p) => String(p.StationID ?? p.stationId) === String(stId)
      );
      const heading = getStationHeading(pts, targetIdx >= 0 ? targetIdx : 0);

      if (panoramaInstance.current) {
        panoramaInstance.current.setPosition({ lat: pt.lat, lng: pt.lng });
        panoramaInstance.current.setPov({ heading, pitch: 0, zoom: 1 });
      }
      if (fetchPanoTimelineRef.current) {
        fetchPanoTimelineRef.current(null, { lat: pt.lat, lng: pt.lng });
      }
      if (map.current) {
        map.current.easeTo({ center: [pt.lng, pt.lat], duration: 400 });
      }
      // Close any open popups so they don't block the map during split view
      markersRef.current.forEach((m) => m.getPopup()?.remove());
    } else {
      const marker = markersRef.current.find(
        (m) => String(m._stationId) === String(stId)
      );
      if (marker) {
        marker.togglePopup();
      }
    }
  }, [handleOpenStreetView]);

  const handleMarkerClickRef = useRef(handleMarkerClick);
  handleMarkerClickRef.current = handleMarkerClick;

  // Initialize Map
  useEffect(() => {
    if (!mapContainer.current || validPoints.length === 0) return;

    const isGoogle = mapType === "google-satellite";
    const isStreets = mapType === "streets";
    const isSat = isGoogle;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          googleSatellite: {
            type: "raster",
            tiles: [
              "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
            ],
            tileSize: 256,
            maxzoom: 20,
          },
          osmStreets: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
          },
        },
        layers: [
          {
            id: "google-satellite-layer",
            type: "raster",
            source: "googleSatellite",
            layout: { visibility: isGoogle ? "visible" : "none" },
          },
          {
            id: "streets-layer",
            type: "raster",
            source: "osmStreets",
            layout: { visibility: isStreets ? "visible" : "none" },
          },
        ],
      },
      center: initialCenter,
      zoom: 15,
      maxZoom: 22,
      bearing: 0,
      pitch: 0,
      dragRotate: true,
      touchPitch: false,
    });

    // Disable default incremental double-click zoom to allow direct zoom into road surface
    mapInstance.doubleClickZoom.disable();

    // Natural, responsive scroll wheel zoom so users don't have to scroll dozens of times
    mapInstance.scrollZoom.setWheelZoomRate(1 / 450);
    mapInstance.scrollZoom.setZoomRate(1 / 180);

    // Double-click zoom handler: zooms way in to road surface (19.5z)
    mapInstance.on("dblclick", (e) => {
      const currentZ = mapInstance.getZoom();
      if (currentZ < 18.5) {
        mapInstance.flyTo({ center: [e.lngLat.lng, e.lngLat.lat], zoom: 19.5, duration: 750 });
      } else {
        if (bounds) {
          mapInstance.fitBounds(bounds, { padding: 60, maxZoom: 18, duration: 600 });
        } else {
          mapInstance.flyTo({ center: [e.lngLat.lng, e.lngLat.lat], zoom: 15, duration: 600 });
        }
      }
    });

    // Single-click on map: jump Street View to exact clicked road location
    mapInstance.on("click", (e) => {
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;

      // Find closest survey station
      let closestPt = null;
      let minDistance = Infinity;
      const pts = validPointsRef.current;
      pts.forEach((pt) => {
        const d = (pt.lat - lat) ** 2 + (pt.lng - lng) ** 2;
        if (d < minDistance) {
          minDistance = d;
          closestPt = pt;
        }
      });

      const targetIdx = closestPt ? pts.indexOf(closestPt) : 0;
      const heading = getStationHeading(pts, targetIdx);

      if (streetViewServiceRef.current && panoramaInstance.current) {
        streetViewServiceRef.current.getPanorama(
          { location: { lat, lng }, radius: 100 },
          (data, status) => {
            if (status === "OK" && data?.location?.latLng) {
              const snapLat = data.location.latLng.lat();
              const snapLng = data.location.latLng.lng();
              const targetStation = closestPt
                ? { ...closestPt, lat: snapLat, lng: snapLng }
                : {
                    lat: snapLat,
                    lng: snapLng,
                    StationID: "Selected",
                    stationId: "Selected",
                    dmi: null,
                    [activeSensorRef.current]: null,
                  };
              setStreetViewStation(targetStation);
              setStreetViewActive(true);
              panoramaInstance.current.setPosition(data.location.latLng);
              panoramaInstance.current.setPov({ heading, pitch: 0, zoom: 1 });
              panoramaInstance.current.setVisible(true);
              if (fetchPanoTimelineRef.current) {
                fetchPanoTimelineRef.current(data.location.pano, data.location.latLng);
              }
            } else {
              const targetStation = closestPt || {
                lat,
                lng,
                StationID: "Selected",
                stationId: "Selected",
                dmi: null,
                [activeSensorRef.current]: null,
              };
              setStreetViewStation(targetStation);
              setStreetViewActive(true);
              show?.("No Google Street View imagery within 100m of this point.", "warning");
            }
          }
        );
      } else {
        const targetStation = closestPt || {
          lat,
          lng,
          StationID: "Selected",
          stationId: "Selected",
          dmi: null,
          [activeSensorRef.current]: null,
        };
        setStreetViewStation(targetStation);
        setStreetViewActive(true);
      }

      if (closestPt) {
        setActiveStationId(closestPt.StationID ?? closestPt.stationId);
      }
    });

    mapInstance.on("rotate", () => {
      setBearing(Math.round(mapInstance.getBearing()));
    });

    mapInstance.on("zoom", () => {
      setCurrentZoom(Number(mapInstance.getZoom().toFixed(2)));
    });

    // Fit bounds immediately on load
    mapInstance.on("load", () => {
      setCurrentZoom(Number(mapInstance.getZoom().toFixed(2)));
      if (bounds) {
        mapInstance.fitBounds(bounds, { padding: 60, maxZoom: 18, duration: 0 });
      }

      // Add road alignment path if > 1 points
      if (polylineCoords.length > 1) {
        mapInstance.addSource("survey-line", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: polylineCoords,
            },
          },
        });
        mapInstance.addLayer({
          id: "survey-line-layer",
          type: "line",
          source: "survey-line",
          layout: {
            visibility: showPoints ? "visible" : "none",
          },
          paint: {
            "line-color": isSat ? "#ffffff" : "#111827",
            "line-width": 3,
            "line-dasharray": [2, 2],
            "line-opacity": 0.8,
          },
        });
      }
    });

    // Create reliable DOM HTML Markers with inner child dot element
    // Crucial: MapLibre translates the outer wrapper element. We NEVER touch outer transform!
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    validPoints.forEach((pt) => {
      const el = document.createElement("div");
      el.className = "station-marker-wrapper";
      el.style.width = `${dotRadius * 2}px`;
      el.style.height = `${dotRadius * 2}px`;
      el.style.display = showPoints ? "flex" : "none";
      el.style.alignItems = "center";
      el.style.justifyContent = "center";
      el.style.cursor = isPegmanModeRef.current ? "crosshair" : "pointer";

      // Inner dot element that safely transforms without displacing the marker
      const dot = document.createElement("div");
      dot.className = "station-marker-dot";
      dot.style.width = "100%";
      dot.style.height = "100%";
      dot.style.backgroundColor = dotColor;
      dot.style.border = `2px solid ${isSat ? "#ffffff" : "#111827"}`;
      dot.style.borderRadius = "50%";
      dot.style.boxShadow = "0 1px 4px rgba(0,0,0,0.4)";
      dot.style.transition = "transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease";
      el.appendChild(dot);

      el.title = `Station ${pt.StationID} (Double-click to zoom in to road)`;

      // Bi-directional link: hovering/clicking marker updates chart
      el.addEventListener("mouseenter", () => {
        setHoveredStationId(pt.StationID ?? pt.stationId);
      });
      el.addEventListener("mouseleave", () => {
        setHoveredStationId(null);
      });
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (handleMarkerClickRef.current) {
          handleMarkerClickRef.current(pt);
        }
      });

      // Double-click marker: zooms way in to road surface (19.5z)
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        const currentZ = mapInstance.getZoom();
        if (currentZ < 18.5) {
          mapInstance.flyTo({ center: [pt.lng, pt.lat], zoom: 19.5, duration: 750 });
          setActiveStationId(pt.StationID ?? pt.stationId);
        } else {
          if (bounds) {
            mapInstance.fitBounds(bounds, { padding: 60, maxZoom: 18, duration: 600 });
          } else {
            mapInstance.flyTo({ center: [pt.lng, pt.lat], zoom: 15, duration: 600 });
          }
        }
      });

      // Build interactive popup with Street View & Zoom buttons
      const popupContent = document.createElement("div");
      popupContent.style.fontFamily = "Arial, sans-serif";
      popupContent.style.fontSize = "12px";
      popupContent.style.lineHeight = "1.5";
      popupContent.style.minWidth = "175px";
      popupContent.style.color = "#111827";

      popupContent.innerHTML = `
        <div style="font-weight: 700; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <span>Station ${pt.StationID ?? pt.stationId}</span>
          <span style="font-size: 11px; font-weight: 500; color: #6b7280;">DMI: ${pt.dmi} ft</span>
        </div>
        <div><strong>Drop:</strong> ${pt.DropID ?? "—"} (${selectedVariant})</div>
        ${pt.Force != null ? `<div><strong>Force:</strong> ${Number(pt.Force).toFixed(0)} lbs</div>` : ""}
        ${pt.D1 != null ? `<div><strong>D1:</strong> ${Number(pt.D1).toFixed(2)} mils</div>` : ""}
        <div><strong>Lat:</strong> ${pt.lat.toFixed(6)}</div>
        <div><strong>Lon:</strong> ${pt.lng.toFixed(6)}</div>
        <div style="margin-top: 8px; display: flex; gap: 4px;">
          <button
            class="popup-sv-btn"
            style="flex: 1; padding: 6px 8px; font-size: 11px; font-weight: 700; background: #2563eb; color: #ffffff; border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;"
            title="Open Google Street View for Station ${pt.StationID ?? pt.stationId}"
          >
            <span>🚶‍♂️</span> Street View
          </button>
          <button
            class="popup-zoom-btn"
            style="padding: 6px 8px; font-size: 11px; font-weight: 700; background: #f3f4f6; color: #111827; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;"
            title="Double-click marker or click here to zoom way in to road surface (19.5z)"
          >
            🔍 Road
          </button>
        </div>
      `;

      const svBtn = popupContent.querySelector(".popup-sv-btn");
      if (svBtn) {
        svBtn.addEventListener("click", () => {
          if (handleOpenStreetViewRef.current) {
            handleOpenStreetViewRef.current(pt);
          }
        });
      }
      const zoomBtn = popupContent.querySelector(".popup-zoom-btn");
      if (zoomBtn) {
        zoomBtn.addEventListener("click", () => {
          mapInstance.flyTo({ center: [pt.lng, pt.lat], zoom: 19.5, duration: 750 });
        });
      }

      const popup = new maplibregl.Popup({ offset: dotRadius + 4 }).setDOMContent(popupContent);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([pt.lng, pt.lat])
        .setPopup(popup)
        .addTo(mapInstance);

      marker._stationId = pt.StationID;
      marker._dot = dot;
      markersRef.current.push(marker);
    });

    map.current = mapInstance;

    return () => {
      if (pegmanMarkerRef.current) {
        pegmanMarkerRef.current.remove();
        pegmanMarkerRef.current = null;
      }
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapInstance.remove();
      map.current = null;
    };
  }, [validPoints.length]);

  // Update map layer on mapType change (Google Satellite vs Streets)
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const isGoogle = mapType === "google-satellite";
    const isStreets = mapType === "streets";

    if (map.current.getLayer("google-satellite-layer")) {
      map.current.setLayoutProperty("google-satellite-layer", "visibility", isGoogle ? "visible" : "none");
    }
    if (map.current.getLayer("streets-layer")) {
      map.current.setLayoutProperty("streets-layer", "visibility", isStreets ? "visible" : "none");
    }

    // Update alignment line color
    if (map.current.getLayer("survey-line-layer")) {
      map.current.setPaintProperty(
        "survey-line-layer",
        "line-color",
        isGoogle ? "#ffffff" : "#111827"
      );
    }
  }, [mapType]);

  // Show or hide survey marker dots and road survey line
  useEffect(() => {
    markersRef.current.forEach((marker) => {
      const el = marker.getElement();
      if (el) {
        el.style.display = showPoints ? "flex" : "none";
      }
    });
    if (map.current && map.current.isStyleLoaded() && map.current.getLayer("survey-line-layer")) {
      map.current.setLayoutProperty(
        "survey-line-layer",
        "visibility",
        showPoints ? "visible" : "none"
      );
    }
  }, [showPoints]);

  // Maintain active 🚶‍♂️ Pegman marker on side map during in-map Street View
  useEffect(() => {
    if (!map.current) return;
    if (streetViewActive && streetViewStation) {
      if (!pegmanMarkerRef.current) {
        const pegmanEl = document.createElement("div");
        pegmanEl.className = "pegman-active-marker";
        pegmanEl.style.fontSize = "26px";
        pegmanEl.style.lineHeight = "1";
        pegmanEl.style.filter = "drop-shadow(0 2px 5px rgba(0,0,0,0.6))";
        pegmanEl.style.cursor = "pointer";
        pegmanEl.style.userSelect = "none";
        pegmanEl.style.zIndex = "1200";
        pegmanEl.title = `Active Street View: Station ${streetViewStation.StationID}`;
        pegmanEl.innerHTML = `🚶‍♂️`;

        pegmanMarkerRef.current = new maplibregl.Marker({ element: pegmanEl, anchor: "bottom" })
          .setLngLat([streetViewStation.lng, streetViewStation.lat])
          .addTo(map.current);
      } else {
        pegmanMarkerRef.current.setLngLat([streetViewStation.lng, streetViewStation.lat]);
      }

      // Smoothly pan map to active station
      map.current.easeTo({ center: [streetViewStation.lng, streetViewStation.lat], duration: 400 });
    } else {
      if (pegmanMarkerRef.current) {
        pegmanMarkerRef.current.remove();
        pegmanMarkerRef.current = null;
      }
    }
  }, [streetViewActive, streetViewStation]);

  // ── Mount / Sync Google StreetViewPanorama in DOM ──────────────────────────
  useEffect(() => {
    if (!streetViewActive || !googleMapsReady || !panoContainerRef.current) return;
    if (!window.google?.maps) return;

    const initialPt = streetViewStation || validPoints[0];
    const initialLat = initialPt ? initialPt.lat : 30;
    const initialLng = initialPt ? initialPt.lng : -97;
    const targetIdx = validPoints.findIndex((p) => p.StationID === (initialPt?.StationID));
    const initialHeading = getStationHeading(validPoints, targetIdx >= 0 ? targetIdx : 0);

    if (!panoramaInstance.current) {
      const pano = new window.google.maps.StreetViewPanorama(panoContainerRef.current, {
        position: { lat: initialLat, lng: initialLng },
        pov: { heading: initialHeading, pitch: 0, zoom: 1 },
        visible: true,
        addressControl: false,
        showRoadLabels: true,
        motionTracking: false,
        motionTrackingControl: false,
        linksControl: true,
        panControl: true,
        enableCloseButton: false,
        fullscreenControl: false,
      });

      panoramaInstance.current = pano;
      setPanoReady(true);

      pano.addListener("status_changed", () => {
        const status = pano.getStatus();
        if (status === "OK") {
          setPanoStatus("OK");
        } else if (status === "ZERO_RESULTS") {
          // Attempt fallback search with 150m radius via StreetViewService
          const loc = pano.getPosition();
          const qLat = loc ? loc.lat() : initialLat;
          const qLng = loc ? loc.lng() : initialLng;
          if (streetViewServiceRef.current) {
            streetViewServiceRef.current.getPanorama(
              {
                location: { lat: qLat, lng: qLng },
                radius: 150,
                preference: window.google.maps.StreetViewPreference.NEAREST,
                source: window.google.maps.StreetViewSource.OUTDOOR,
              },
              (data, sStatus) => {
                if (sStatus === "OK" && data?.location?.pano) {
                  pano.setPano(data.location.pano);
                  setPanoStatus("OK");
                } else {
                  setPanoStatus("ZERO_RESULTS");
                }
              }
            );
          } else {
            setPanoStatus("ZERO_RESULTS");
          }
        }
      });

      pano.addListener("position_changed", () => {
        const pos = pano.getPosition();
        if (pos) {
          const pLat = pos.lat();
          const pLng = pos.lng();
          if (pegmanMarkerRef.current) {
            pegmanMarkerRef.current.setLngLat([pLng, pLat]);
          }
        }
      });

      pano.addListener("pano_changed", () => {
        const pId = pano.getPano();
        if (pId) {
          setCurrentPanoId(pId);
          setPanoStatus("OK");
          fetchPanoTimeline(pId);
        }
      });

      fetchPanoTimeline(null, { lat: initialLat, lng: initialLng });

      // Multiple resize triggers to ensure tiles are rendered after split container layout settles
      setTimeout(() => {
        if (panoramaInstance.current && window.google?.maps) {
          window.google.maps.event.trigger(panoramaInstance.current, "resize");
        }
      }, 60);
      setTimeout(() => {
        if (panoramaInstance.current && window.google?.maps) {
          window.google.maps.event.trigger(panoramaInstance.current, "resize");
        }
      }, 250);
    } else {
      window.google.maps.event.trigger(panoramaInstance.current, "resize");
      setPanoReady(true);
    }
  }, [streetViewActive, googleMapsReady, fetchPanoTimeline, validPoints, streetViewStation]);

  // ── Render Station Points directly in Google Street View (3D Perspective) ───
  useEffect(() => {
    if (!window.google?.maps || !panoramaInstance.current) {
      streetMarkersRef.current.forEach((m) => m.setMap(null));
      streetMarkersRef.current = [];
      return;
    }

    if (!streetViewActive || !showPointsInStreetView) {
      streetMarkersRef.current.forEach((m) => m.setMap(null));
      return;
    }

    // If markers already exist for all validPoints, simply update visibility, icon and z-index
    if (streetMarkersRef.current.length === validPoints.length && streetMarkersRef.current.length > 0) {
      streetMarkersRef.current.forEach((marker) => {
        marker.setMap(panoramaInstance.current);
        const pt = marker._point;
        if (!pt) return;
        const isActive = String(pt.StationID ?? pt.stationId) === String(activeStationId);
        const isHovered = String(pt.StationID ?? pt.stationId) === String(hoveredStationId);

        marker.setIcon({
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: isActive ? 13 : (isHovered ? 11 : 8.5),
          fillColor: isActive ? "#2563eb" : (isHovered ? "#38bdf8" : dotColor),
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: isActive ? 3 : 2,
        });
        marker.setZIndex(isActive ? 9999 : (isHovered ? 5000 : 100));
      });
      return;
    }

    // Recreate markers on panorama
    streetMarkersRef.current.forEach((m) => m.setMap(null));
    streetMarkersRef.current = [];

    const newMarkers = validPoints.map((pt) => {
      const isActive = String(pt.StationID ?? pt.stationId) === String(activeStationId);
      const isHovered = String(pt.StationID ?? pt.stationId) === String(hoveredStationId);

      const marker = new window.google.maps.Marker({
        position: { lat: pt.lat, lng: pt.lng },
        map: panoramaInstance.current,
        title: `Station ${pt.StationID ?? pt.stationId} (DMI: ${pt.dmi} ft)`,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: isActive ? 13 : (isHovered ? 11 : 8.5),
          fillColor: isActive ? "#2563eb" : (isHovered ? "#38bdf8" : dotColor),
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: isActive ? 3 : 2,
        },
        label: {
          text: String(pt.StationID ?? pt.stationId),
          color: "#ffffff",
          fontSize: "9px",
          fontWeight: "bold",
        },
        zIndex: isActive ? 9999 : (isHovered ? 5000 : 100),
      });

      marker._point = pt;

      marker.addListener("click", () => {
        if (handleMarkerClickRef.current) {
          handleMarkerClickRef.current(pt);
        }
      });

      marker.addListener("mouseover", () => {
        setHoveredStationId(pt.StationID ?? pt.stationId);
      });

      marker.addListener("mouseout", () => {
        setHoveredStationId(null);
      });

      return marker;
    });

    streetMarkersRef.current = newMarkers;
  }, [
    streetViewActive,
    showPointsInStreetView,
    panoReady,
    validPoints,
    activeStationId,
    hoveredStationId,
    dotColor,
  ]);

  // Sync panorama when active station / point changes
  useEffect(() => {
    if (panoramaInstance.current && streetViewStation && window.google?.maps) {
      const targetIdx = validPoints.findIndex(
        (p) => String(p.StationID ?? p.stationId) === String(streetViewStation.StationID ?? streetViewStation.stationId)
      );
      const heading = getStationHeading(validPoints, targetIdx >= 0 ? targetIdx : 0);
      panoramaInstance.current.setPov({ heading, pitch: 0, zoom: 1 });

      const service = streetViewServiceRef.current || new window.google.maps.StreetViewService();
      // Search with radius 150m first to guarantee we find the nearest road panorama
      service.getPanorama(
        {
          location: { lat: streetViewStation.lat, lng: streetViewStation.lng },
          radius: 150,
          preference: window.google.maps.StreetViewPreference.NEAREST,
          source: window.google.maps.StreetViewSource.OUTDOOR,
        },
        (data, status) => {
          if (status === "OK" && data?.location?.pano && panoramaInstance.current) {
            panoramaInstance.current.setPano(data.location.pano);
            setPanoStatus("OK");
            window.google.maps.event.trigger(panoramaInstance.current, "resize");
          } else {
            // Wider search up to 300m
            service.getPanorama(
              {
                location: { lat: streetViewStation.lat, lng: streetViewStation.lng },
                radius: 300,
              },
              (data300, status300) => {
                if (status300 === "OK" && data300?.location?.pano && panoramaInstance.current) {
                  panoramaInstance.current.setPano(data300.location.pano);
                  setPanoStatus("OK");
                  window.google.maps.event.trigger(panoramaInstance.current, "resize");
                } else {
                  // Fall back to direct setPosition in case custom Street View coverage exists
                  if (panoramaInstance.current) {
                    panoramaInstance.current.setPosition({ lat: streetViewStation.lat, lng: streetViewStation.lng });
                  }
                  setPanoStatus("ZERO_RESULTS");
                }
              }
            );
          }
        }
      );

      fetchPanoTimeline(null, { lat: streetViewStation.lat, lng: streetViewStation.lng });
    }
  }, [streetViewStation, fetchPanoTimeline, validPoints]);

  // Re-size maps when splitPercent or streetViewActive changes
  useEffect(() => {
    if (map.current) {
      map.current.resize();
    }
    if (panoramaInstance.current && window.google?.maps) {
      window.google.maps.event.trigger(panoramaInstance.current, "resize");
      setTimeout(() => {
        if (panoramaInstance.current && window.google?.maps) {
          window.google.maps.event.trigger(panoramaInstance.current, "resize");
        }
      }, 80);
      setTimeout(() => {
        if (panoramaInstance.current && window.google?.maps) {
          window.google.maps.event.trigger(panoramaInstance.current, "resize");
        }
      }, 250);
    }
  }, [splitPercent, streetViewActive]);

  // Synchronized visual highlighting of map markers on hover or selection
  // Scales only the inner dot element so coordinates NEVER jump!
  useEffect(() => {
    const isSat = mapType === "google-satellite";
    markersRef.current.forEach((marker) => {
      const dot = marker._dot;
      const el = marker.getElement();
      if (!dot || !el) return;
      const isHovered = String(marker._stationId) === String(hoveredStationId);
      const isActive = String(marker._stationId) === String(activeStationId);

      if (isHovered || isActive) {
        dot.style.transform = "scale(1.3)";
        dot.style.boxShadow = "0 0 0 2px #2563eb, 0 2px 6px rgba(0,0,0,0.4)";
        dot.style.backgroundColor = "#2563eb";
        dot.style.borderColor = "#ffffff";
        el.style.zIndex = "1000";
      } else {
        dot.style.transform = "scale(1)";
        dot.style.boxShadow = "0 1px 4px rgba(0,0,0,0.4)";
        dot.style.backgroundColor = dotColor;
        dot.style.borderColor = isSat ? "#ffffff" : "#111827";
        el.style.width = `${dotRadius * 2}px`;
        el.style.height = `${dotRadius * 2}px`;
        el.style.zIndex = "1";
      }
    });
  }, [hoveredStationId, activeStationId, dotColor, dotRadius, mapType]);

  // Rotation controls (adjusting camera bearing in +/-5 degree increments)
  const handleRotateLeft = () => {
    if (!map.current) return;
    map.current.easeTo({ bearing: map.current.getBearing() + 5, duration: 150 });
  };

  const handleRotateRight = () => {
    if (!map.current) return;
    map.current.easeTo({ bearing: map.current.getBearing() - 5, duration: 150 });
  };

  const handleResetRotation = () => {
    if (!map.current) return;
    map.current.easeTo({ bearing: 0, duration: 300 });
  };

  const handleSetExactBearing = (deg) => {
    if (!map.current) return;
    const num = parseFloat(deg);
    if (!isNaN(num)) {
      map.current.easeTo({ bearing: num, duration: 250 });
    }
  };

  // Fine zoom controls for pixel-precise road-to-chart alignment
  const handleZoomInFine = () => {
    if (!map.current) return;
    map.current.easeTo({ zoom: map.current.getZoom() + 0.15, duration: 150 });
  };

  const handleZoomOutFine = () => {
    if (!map.current) return;
    map.current.easeTo({ zoom: map.current.getZoom() - 0.15, duration: 150 });
  };

  // SVG Export Canvas helper (high-resolution 2x PNG)
  const exportChartAsCanvas = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return null;

    const clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(chartWidth));
    clone.setAttribute("height", String(chartHeight));

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
        const scale = 2; // 2x high-res
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
      const canvas = await exportChartAsCanvas();
      if (!canvas) return;

      canvas.toBlob(async (blob) => {
        if (!blob) {
          show?.("Failed to generate chart image", "error");
          return;
        }
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          show?.("Deflection Profile copied to clipboard!", "success");
        } catch (err) {
          console.error("Clipboard copy error:", err);
          show?.("Could not copy chart to clipboard", "error");
        }
      });
    } catch (err) {
      console.error("Export error:", err);
      show?.("Export failed", "error");
    }
  };

  const handleDownloadChart = async () => {
    try {
      const canvas = await exportChartAsCanvas();
      if (!canvas) return;

      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `Deflection_Profile_${activeSensor}_Drop_${selectedVariant}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      show?.("Chart downloaded!", "success");
    } catch (err) {
      console.error("Download error:", err);
      show?.("Download failed", "error");
    }
  };

  // SVG Export Canvas helper for Thickness Profile (high-resolution 2x PNG)
  const exportThicknessChartAsCanvas = () => {
    const svgEl = thicknessSvgRef.current;
    if (!svgEl) return null;

    const clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(chartWidth));
    clone.setAttribute("height", String(chartHeight));

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
        const scale = 2; // 2x high-res
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

  const handleCopyThicknessChart = async () => {
    try {
      const canvas = await exportThicknessChartAsCanvas();
      if (!canvas) return;

      canvas.toBlob(async (blob) => {
        if (!blob) {
          show?.("Failed to generate thickness chart image", "error");
          return;
        }
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          show?.("Thickness Profile copied to clipboard!", "success");
        } catch (err) {
          console.error("Clipboard copy error:", err);
          show?.("Could not copy chart to clipboard", "error");
        }
      });
    } catch (err) {
      console.error("Export error:", err);
      show?.("Export failed", "error");
    }
  };

  const handleDownloadThicknessChart = async () => {
    try {
      const canvas = await exportThicknessChartAsCanvas();
      if (!canvas) return;

      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `Thickness_Profile_Drop_${selectedVariant}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      show?.("Thickness chart downloaded!", "success");
    } catch (err) {
      console.error("Download error:", err);
      show?.("Download failed", "error");
    }
  };

  // Wide-format interactive scrubbing handler for Thickness chart
  const handleThicknessMouseMove = (e) => {
    if (!thicknessSvgRef.current || !thicknessScales || thicknessScales.mappedPoints.length === 0) return;
    const rect = thicknessSvgRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * chartWidth;

    let closest = thicknessScales.mappedPoints[0];
    let minDist = Math.abs(thicknessScales.mappedPoints[0].x - mouseX);
    for (let i = 1; i < thicknessScales.mappedPoints.length; i++) {
      const dist = Math.abs(thicknessScales.mappedPoints[i].x - mouseX);
      if (dist < minDist) {
        minDist = dist;
        closest = thicknessScales.mappedPoints[i];
      }
    }
    setHoveredPoint(closest);
    setHoveredStationId(closest.stationId);
  };

  // Wide-format interactive scrubbing handler
  const handleChartMouseMove = (e) => {
    if (!svgRef.current || !scales || scales.mappedPoints.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * chartWidth;

    let closest = scales.mappedPoints[0];
    let minDist = Math.abs(scales.mappedPoints[0].x - mouseX);
    for (let i = 1; i < scales.mappedPoints.length; i++) {
      const dist = Math.abs(scales.mappedPoints[i].x - mouseX);
      if (dist < minDist) {
        minDist = dist;
        closest = scales.mappedPoints[i];
      }
    }
    setHoveredPoint(closest);
    setHoveredStationId(closest.stationId);
  };

  const handleChartClick = () => {
    if (activeHoverPoint && map.current) {
      map.current.easeTo({ center: [activeHoverPoint.lng, activeHoverPoint.lat], duration: 350 });
      setActiveStationId(activeHoverPoint.stationId);
      const targetPt = validPoints.find(
        (p) => String(p.StationID ?? p.stationId) === String(activeHoverPoint.stationId)
      );
      if (targetPt && streetViewActive) {
        handleMarkerClick(targetPt);
      } else {
        const marker = markersRef.current.find(
          (m) => String(m._stationId) === String(activeHoverPoint.stationId)
        );
        if (marker) {
          marker.togglePopup();
        }
      }
    }
  };

  // Double-clicking chart point zooms way in to road surface on map
  const handleChartDoubleClick = () => {
    if (activeHoverPoint && map.current) {
      const currentZ = map.current.getZoom();
      if (currentZ < 18.5) {
        map.current.flyTo({ center: [activeHoverPoint.lng, activeHoverPoint.lat], zoom: 19.5, duration: 750 });
        setActiveStationId(activeHoverPoint.stationId);
      } else {
        if (bounds) {
          map.current.fitBounds(bounds, { padding: 60, maxZoom: 18, duration: 600 });
        }
      }
    }
  };

  const currentTargetIndex = useMemo(() => {
    if (!streetViewStation) return -1;
    const targetId = streetViewStation.StationID ?? streetViewStation.stationId;
    return validPoints.findIndex(
      (p) => String(p.StationID ?? p.stationId) === String(targetId)
    );
  }, [streetViewStation, validPoints]);

  // Selected or hovered point for coordinate display
  const displayCoordPoint = useMemo(() => {
    if (hoveredStationId) {
      const match = validPoints.find(
        (p) => String(p.StationID ?? p.stationId) === String(hoveredStationId)
      );
      if (match) return match;
    }
    if (activeStationId) {
      const match = validPoints.find(
        (p) => String(p.StationID ?? p.stationId) === String(activeStationId)
      );
      if (match) return match;
    }
    if (streetViewStation) {
      const match = validPoints.find(
        (p) => String(p.StationID ?? p.stationId) === String(streetViewStation.StationID ?? streetViewStation.stationId)
      );
      if (match) return match;
      if (streetViewStation.lat && streetViewStation.lng) return streetViewStation;
    }
    return validPoints[0] ?? null;
  }, [hoveredStationId, activeStationId, streetViewStation, validPoints]);

  const handleToolbarStreetView = () => {
    if (streetViewActive) {
      setStreetViewActive(false);
      return;
    }
    const pt =
      (activeStationId && validPoints.find((p) => String(p.StationID ?? p.stationId) === String(activeStationId))) ||
      (hoveredStationId && validPoints.find((p) => String(p.StationID ?? p.stationId) === String(hoveredStationId))) ||
      validPoints[0];
    if (pt) {
      handleOpenStreetView(pt);
    }
  };

  const handleToggleRoadZoom = () => {
    if (!map.current) return;
    const currentZ = map.current.getZoom();
    if (currentZ < 18.5) {
      const targetPt =
        (activeStationId && validPoints.find((p) => String(p.StationID ?? p.stationId) === String(activeStationId))) ||
        (hoveredStationId && validPoints.find((p) => String(p.StationID ?? p.stationId) === String(hoveredStationId))) ||
        null;
      if (targetPt) {
        map.current.flyTo({ center: [targetPt.lng, targetPt.lat], zoom: 19.5, duration: 750 });
      } else {
        const c = map.current.getCenter();
        map.current.flyTo({ center: [c.lng, c.lat], zoom: 19.5, duration: 750 });
      }
    } else {
      if (bounds) {
        map.current.fitBounds(bounds, { padding: 60, maxZoom: 18, duration: 600 });
      } else {
        map.current.zoomTo(15, { duration: 600 });
      }
    }
  };

  // Keyboard navigation for Street View (Esc to exit, Left/Right arrows to step stations)
  useEffect(() => {
    if (!streetViewActive || !streetViewStation) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setStreetViewActive(false);
      } else if (e.key === "ArrowLeft") {
        if (currentTargetIndex > 0) {
          const prev = validPoints[currentTargetIndex - 1];
          handleMarkerClick(prev);
        }
      } else if (e.key === "ArrowRight") {
        if (currentTargetIndex < validPoints.length - 1) {
          const next = validPoints[currentTargetIndex + 1];
          handleMarkerClick(next);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [streetViewActive, streetViewStation, currentTargetIndex, validPoints]);

  if (validPoints.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🗺️</div>
        <h3>No GPS coordinates found</h3>
        <p>
          The imported section data does not contain valid <code>Latitude</code> and{" "}
          <code>Longitude</code> values.
        </p>
      </div>
    );
  }

  const isSat = mapType === "satellite" || mapType === "google-satellite";
  const normalizedBearing = ((bearing % 360) + 360) % 360;

  // Active hover point derived from either chart hover or map hover
  const activeHoverPoint =
    hoveredPoint ||
    (hoveredStationId && scales
      ? scales.mappedPoints.find((p) => p.stationId === hoveredStationId)
      : null);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Floating Exit Clean Screenshot View Pill Button */}
      {isScreenshotMode && (
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 16,
            zIndex: 1000,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={() => setIsScreenshotMode(false)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: "20px",
              background: "rgba(17, 24, 39, 0.90)",
              color: "#ffffff",
              border: "1px solid rgba(255, 255, 255, 0.25)",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
              backdropFilter: "blur(6px)",
              transition: "all 0.15s ease",
            }}
            title="Click or press Esc to exit clean screenshot view and restore controls"
          >
            <span>📸 Exit Screenshot (Esc)</span>
          </button>
        </div>
      )}

      {/* Top Map Toolbar - Hidden in Clean Screenshot Mode */}
      {!isScreenshotMode && (
        <div className="map-toolbar">
          {/* Left: Locations count, Profile Toggle, Thickness Toggle, Screenshot Mode, Street View */}
          <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {validPoints.length.toLocaleString()} locations
            </span>
            <button
              type="button"
              className={`btn btn-sm ${showProfile ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setShowProfile((v) => !v)}
              title={showProfile ? "Hide Synchronized Deflection Profile" : "Show Synchronized Deflection Profile"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}
            >
              <span>📈</span> {showProfile ? "Hide Deflection" : "Deflection Profile"}
            </button>

            {/* Thickness Profile Toggle Button */}
            <button
              type="button"
              className={`btn btn-sm ${showThicknessProfile ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setShowThicknessProfile((v) => !v)}
              title={showThicknessProfile ? "Hide Synchronized Thickness Profile" : "Show Synchronized Thickness Profile"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}
            >
              <span>📏</span> {showThicknessProfile ? "Hide Thickness" : "Thickness Profile"}
            </button>

            {/* Screenshot View Mode Button */}
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setIsScreenshotMode(true)}
              title="Enter Screenshot Mode (hides toolbars, headers, and attached info for aligned capture)"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 700,
                background: "#f1f5f9",
                borderColor: "#cbd5e1",
                color: "#0f172a",
              }}
            >
              <span>📸</span> Screenshot
            </button>

          {/* Street View Toggle Button */}
          <button
            type="button"
            className={`btn btn-sm ${streetViewActive ? "btn-primary" : "btn-secondary"}`}
            onClick={handleToolbarStreetView}
            title={
              streetViewActive
                ? "Exit Street View split screen (Esc)"
                : activeStationId
                ? `Open Street View for Station ${activeStationId}`
                : "Open in-map Street View or click any station point"
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontWeight: 700,
              backgroundColor: streetViewActive ? "#1a73e8" : undefined,
              color: streetViewActive ? "#ffffff" : undefined,
              borderColor: streetViewActive ? "#1a73e8" : undefined,
            }}
          >
            <span style={{ fontSize: 15 }}>🚶‍♂️</span>
            <span>{streetViewActive ? "Exit Street View" : "Street View"}</span>
          </button>
        </div>

        {/* Center: Dot Style Controls & Show/Hide Points */}
        <div className="map-tool-group">
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              userSelect: "none",
              marginRight: "var(--sp-2)",
            }}
            title="Show or hide survey marker dots and road survey line"
          >
            <input
              type="checkbox"
              checked={showPoints}
              onChange={(e) => setShowPoints(e.target.checked)}
              style={{ cursor: "pointer", accentColor: "#2563eb" }}
            />
            <span>Points on Road</span>
          </label>

          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`color-swatch-btn ${dotColor === c.value ? "active" : ""}`}
                style={{ backgroundColor: c.value }}
                onClick={() => setDotColor(c.value)}
                title={c.label}
              />
            ))}
          </div>

          <span className="map-tool-label" style={{ marginLeft: "var(--sp-2)" }}>Size:</span>
          <input
            type="range"
            min="3"
            max="18"
            value={dotRadius}
            onChange={(e) => setDotRadius(Number(e.target.value))}
            style={{ width: 64, cursor: "pointer" }}
            title={`Radius: ${dotRadius}px`}
          />
          <span style={{ fontSize: 11, minWidth: 20, color: "var(--text-secondary)" }}>
            {dotRadius}px
          </span>
        </div>

        {/* Right: Fine Zoom + Rotation + Map Type toggles */}
        <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          {/* Fine Zoom Controls for Road-to-Chart Alignment */}
          <div className="rotation-control-group" title="Fine Zoom adjustment for chart alignment">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleZoomOutFine}
              title="Zoom Out (Fine: -0.15)"
              style={{ padding: "2px 8px", fontWeight: "bold", fontSize: 13, lineHeight: 1 }}
            >
              −
            </button>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-secondary)",
                minWidth: 36,
                textAlign: "center",
                userSelect: "none",
              }}
              title="Current Zoom Level"
            >
              {currentZoom.toFixed(1)}z
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleZoomInFine}
              title="Zoom In (Fine: +0.15)"
              style={{ padding: "2px 8px", fontWeight: "bold", fontSize: 13, lineHeight: 1 }}
            >
              +
            </button>
          </div>

          <div className="rotation-control-group">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleRotateLeft}
              title="Rotate View Left (↺ 5°)"
            >
              ↺
            </button>
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <input
                type="number"
                min="0"
                max="360"
                value={normalizedBearing}
                onChange={(e) => handleSetExactBearing(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.target.blur();
                  }
                }}
                title="Click to type custom angle (0° - 360°)"
                style={{
                  width: 44,
                  padding: "2px 2px",
                  fontSize: 12,
                  fontWeight: 600,
                  textAlign: "center",
                  border: "1px solid transparent",
                  borderRadius: 3,
                  background: "transparent",
                  outline: "none",
                  cursor: "text",
                  color: "var(--text-primary)",
                  fontFamily: "inherit",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "var(--border-default)";
                  e.target.style.background = "#ffffff";
                  e.target.select();
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "transparent";
                  e.target.style.background = "transparent";
                }}
              />
              <span style={{ fontSize: 11, fontWeight: 600, pointerEvents: "none", marginLeft: -4, marginRight: 2 }}>
                °
              </span>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleRotateRight}
              title="Rotate View Right (↻ 5°)"
            >
              ↻
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={normalizedBearing === 0}
              onClick={handleResetRotation}
              title={normalizedBearing === 0 ? "Already aligned to North (0°)" : "Reset rotation to North (0°)"}
              style={{
                fontWeight: 600,
                opacity: normalizedBearing === 0 ? 0.45 : 1,
                cursor: normalizedBearing === 0 ? "not-allowed" : "pointer",
              }}
            >
              Reset
            </button>
          </div>

          <div style={{ display: "flex", gap: 2 }}>
            <button
              type="button"
              className={`btn btn-sm ${mapType === "google-satellite" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setMapType("google-satellite")}
              title="Google Hybrid Satellite (High-Res Road Surface)"
            >
              🛰️ Satellite
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mapType === "streets" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setMapType("streets")}
              title="OpenStreetMap Streets"
            >
              🗺️ Streets
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Main Split-Screen Container */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          width: "100%",
          position: "relative",
        }}
      >
        {/* Top/Upper: Interactive Map & In-Map Street View Canvas */}
        <div
          ref={splitContainerRef}
          style={{
            flex: showProfile ? "1 1 54%" : "1 1 100%",
            minHeight: 260,
            width: "100%",
            position: "relative",
            display: "flex",
            flexDirection: "row",
            overflow: "hidden",
            userSelect: isDraggingSplit ? "none" : "auto",
          }}
        >
          {/* Left: In-Map Street View Viewport */}
          {streetViewActive && streetViewStation && (
            <div
              style={{
                width: `calc(${splitPercent}% - 5px)`,
                flex: "none",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                position: "relative",
                background: "#111827",
                minWidth: 260,
                zIndex: 5,
                overflow: "hidden",
              }}
            >
              {/* Street View Top Bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 12px",
                  background: "#1f2937",
                  color: "#ffffff",
                  borderBottom: "1px solid #374151",
                  fontSize: 12,
                  flexWrap: "wrap",
                  gap: 8,
                  zIndex: 10,
                }}
              >
                {/* Left: Station info + Coordinates */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    Station {streetViewStation.StationID ?? streetViewStation.stationId}
                  </span>
                  {streetViewStation.dmi != null && (
                    <>
                      <span style={{ color: "#9ca3af", fontSize: 11 }}>•</span>
                      <span style={{ color: "#9ca3af", fontSize: 11 }}>
                        DMI: {streetViewStation.dmi?.toLocaleString()} ft
                      </span>
                    </>
                  )}
                  {streetViewStation.lat != null && streetViewStation.lng != null && (
                    <>
                      <span style={{ color: "#9ca3af", fontSize: 11 }}>•</span>
                      <span
                        onClick={() => {
                          const coordStr = `${streetViewStation.lat.toFixed(6)}, ${streetViewStation.lng.toFixed(6)}`;
                          navigator.clipboard?.writeText(coordStr);
                          show?.(`Coordinates copied: ${coordStr}`, "success");
                        }}
                        style={{
                          color: "#93c5fd",
                          fontFamily: "monospace",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                        title={`Station ${streetViewStation.StationID ?? streetViewStation.stationId}: Click to copy coordinates (${streetViewStation.lat.toFixed(6)}, ${streetViewStation.lng.toFixed(6)})`}
                      >
                        📍 {streetViewStation.lat.toFixed(6)}, {streetViewStation.lng.toFixed(6)}
                      </span>
                    </>
                  )}
                </div>

                {/* Center: Prev / Next Station Stepper */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={currentTargetIndex <= 0}
                    onClick={() => {
                      if (currentTargetIndex > 0) {
                        const prev = validPoints[currentTargetIndex - 1];
                        handleMarkerClick(prev);
                      }
                    }}
                    style={{
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#374151",
                      color: "#ffffff",
                      borderColor: "#4b5563",
                    }}
                    title="Previous station along the road (Left Arrow)"
                  >
                    ◀ Prev
                  </button>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#d1d5db" }}>
                    {currentTargetIndex >= 0 ? `${currentTargetIndex + 1} / ${validPoints.length}` : `Point`}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={currentTargetIndex < 0 || currentTargetIndex >= validPoints.length - 1}
                    onClick={() => {
                      if (currentTargetIndex >= 0 && currentTargetIndex < validPoints.length - 1) {
                        const next = validPoints[currentTargetIndex + 1];
                        handleMarkerClick(next);
                      }
                    }}
                    style={{
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#374151",
                      color: "#ffffff",
                      borderColor: "#4b5563",
                    }}
                    title="Next station along the road (Right Arrow)"
                  >
                    Next ▶
                  </button>
                </div>

                {/* Right: Points on Road Toggle + Full Tab + Close buttons */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#e5e7eb",
                      cursor: "pointer",
                      background: "rgba(255, 255, 255, 0.12)",
                      border: "1px solid rgba(255, 255, 255, 0.2)",
                      padding: "2px 8px",
                      borderRadius: 4,
                      userSelect: "none",
                    }}
                    title="Show or hide FWD station points on the street in Street View"
                  >
                    <input
                      type="checkbox"
                      checked={showPointsInStreetView}
                      onChange={(e) => setShowPointsInStreetView(e.target.checked)}
                      style={{ cursor: "pointer", accentColor: "#3b82f6" }}
                    />
                    <span>Points on Road</span>
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      const heading = getStationHeading(validPoints, currentTargetIndex);
                      openGoogleStreetView(streetViewStation.lat, streetViewStation.lng, heading);
                    }}
                    style={{
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#2563eb",
                      color: "#ffffff",
                      borderColor: "#1d4ed8",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                    title="Open in full Google Maps tab"
                  >
                    <span>🌐 Full</span> <span>↗</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setStreetViewActive(false)}
                    style={{
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 700,
                      background: "#ef4444",
                      color: "#ffffff",
                      borderColor: "#dc2626",
                    }}
                    title="Exit Street View (Esc)"
                  >
                    ✕ Exit
                  </button>
                </div>
              </div>

              {/* Panorama Container or Embed Fallback */}
              <div style={{ flex: 1, position: "relative", width: "100%", height: "100%", background: "#000" }}>
                {googleMapsReady ? (
                  <div
                    ref={panoContainerRef}
                    style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
                  />
                ) : (
                  <iframe
                    key={`${streetViewStation.StationID}-${currentTargetIndex}`}
                    title={`Street View Station ${streetViewStation.StationID}`}
                    src={getStreetViewEmbedUrl(
                      streetViewStation.lat,
                      streetViewStation.lng,
                      getStationHeading(validPoints, currentTargetIndex)
                    )}
                    style={{ width: "100%", height: "100%", border: "none" }}
                    loading="eager"
                    allow="accelerometer; gyroscope; magnetometer"
                    allowFullScreen
                  />
                )}

                {/* Fallback card if Google returns ZERO_RESULTS for this station location */}
                {googleMapsReady && panoStatus === "ZERO_RESULTS" && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(15, 23, 42, 0.95)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      padding: 24,
                      textAlign: "center",
                      zIndex: 20,
                    }}
                  >
                    <div style={{ fontSize: 36, marginBottom: 10 }}>📷🚫</div>
                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
                      No Street View Directly at Station {streetViewStation?.StationID ?? streetViewStation?.stationId}
                    </div>
                    <div style={{ fontSize: 12, color: "#9ca3af", maxWidth: 380, marginBottom: 16, lineHeight: 1.5 }}>
                      Google Street View does not have panoramic imagery within 300 meters of these coordinates ({streetViewStation?.lat?.toFixed(5)}, {streetViewStation?.lng?.toFixed(5)}).
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                      {currentTargetIndex > 0 && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            const prevPt = validPoints[currentTargetIndex - 1];
                            if (prevPt) {
                              setStreetViewStation(prevPt);
                              setActiveStationId(prevPt.StationID ?? prevPt.stationId);
                            }
                          }}
                        >
                          ◀ Station {validPoints[currentTargetIndex - 1]?.StationID ?? currentTargetIndex}
                        </button>
                      )}
                      {currentTargetIndex < validPoints.length - 1 && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            const nextPt = validPoints[currentTargetIndex + 1];
                            if (nextPt) {
                              setStreetViewStation(nextPt);
                              setActiveStationId(nextPt.StationID ?? nextPt.stationId);
                            }
                          }}
                        >
                          Station {validPoints[currentTargetIndex + 1]?.StationID ?? currentTargetIndex + 2} ▶
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          const heading = getStationHeading(validPoints, currentTargetIndex);
                          openGoogleStreetView(streetViewStation.lat, streetViewStation.lng, heading);
                        }}
                      >
                        ↗ Open in Google Maps
                      </button>
                    </div>
                  </div>
                )}

                {/* Historical Street View Years Timeline Bar directly at the bottom */}
                {availableDates.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 12,
                      left: 12,
                      right: 12,
                      zIndex: 25,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      overflowX: "auto",
                      padding: "6px 12px",
                      background: "rgba(15, 23, 42, 0.88)",
                      backdropFilter: "blur(10px)",
                      border: "1px solid rgba(255, 255, 255, 0.18)",
                      borderRadius: "24px",
                      boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
                      scrollbarWidth: "thin",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        paddingRight: 8,
                        borderRight: "1px solid rgba(255, 255, 255, 0.2)",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ fontSize: 13 }}>🕒</span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#94a3b8",
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                        }}
                      >
                        Timeline:
                      </span>
                    </div>
                    {availableDates.map((d) => {
                      const isSelected = d.pano === currentPanoId;
                      return (
                        <button
                          key={d.pano}
                          type="button"
                          onClick={() => handleSelectDate(d.pano)}
                          style={{
                            padding: "4px 12px",
                            borderRadius: "16px",
                            fontSize: 12,
                            fontWeight: isSelected ? 700 : 500,
                            whiteSpace: "nowrap",
                            border: isSelected ? "1px solid #059669" : "1px solid rgba(255, 255, 255, 0.15)",
                            background: isSelected ? "#10b981" : "rgba(255, 255, 255, 0.95)",
                            color: isSelected ? "#ffffff" : "#0f172a",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            boxShadow: isSelected ? "0 2px 6px rgba(16, 185, 129, 0.4)" : "none",
                            flexShrink: 0,
                          }}
                          title={`Switch Street View to ${d.label}`}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Draggable Divider Splitter */}
          {streetViewActive && (
            <div
              onPointerDown={handleSplitPointerDown}
              className="split-resizer"
              style={{
                width: 10,
                flex: "none",
                cursor: "col-resize",
                position: "relative",
                zIndex: 25,
                background: isDraggingSplit ? "#2563eb" : "var(--border-default)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                userSelect: "none",
                touchAction: "none",
              }}
              title="Drag to resize Street View / Map ratio"
            >
              <div
                style={{
                  width: 4,
                  height: 36,
                  borderRadius: 2,
                  background: isDraggingSplit ? "#ffffff" : "var(--text-muted)",
                  opacity: 0.8,
                }}
              />
            </div>
          )}

          {/* Drag Protection Overlay */}
          {isDraggingSplit && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                cursor: "col-resize",
                userSelect: "none",
              }}
            />
          )}

          {/* Right (or Full Width): Map Canvas */}
          <div
            style={{
              width: streetViewActive ? `calc(${100 - splitPercent}% - 5px)` : "100%",
              flex: "none",
              height: "100%",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Side-view Road Overview Indicator Badge */}
            {streetViewActive && (
              <div
                style={{
                  position: "absolute",
                  top: 10,
                  left: 10,
                  zIndex: 10,
                  background: "rgba(17, 24, 39, 0.88)",
                  color: "#ffffff",
                  padding: "3px 10px",
                  borderRadius: "var(--r-md)",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.2px",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                  pointerEvents: "none",
                }}
              >
                🗺️ Road Overview
              </div>
            )}

            {/* Pegman Mode Active Indicator Banner */}
            {isPegmanMode && (
              <div
                style={{
                  position: "absolute",
                  top: 10,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 100,
                  background: "#fbbf24",
                  color: "#78350f",
                  padding: "6px 16px",
                  borderRadius: "var(--r-md)",
                  fontSize: 12,
                  fontWeight: 700,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  border: "1px solid #f59e0b",
                }}
              >
                <span>🚶 Pegman Mode: Click any station marker on the map to open Street View</span>
                <button
                  type="button"
                  onClick={() => setIsPegmanMode(false)}
                  style={{
                    background: "#78350f",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Synchronized Hover HUD Callout Pill over Map - Hidden in Clean Screenshot Mode */}
            {!isScreenshotMode && !isPegmanMode && activeHoverPoint && (
              <div
                style={{
                  position: "absolute",
                  top: 10,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 10,
                  background: "rgba(17, 24, 39, 0.92)",
                  color: "#ffffff",
                  padding: "4px 12px",
                  borderRadius: "var(--r-md)",
                  fontSize: 11.5,
                  fontWeight: 600,
                  letterSpacing: "0.2px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  backdropFilter: "blur(4px)",
                  maxWidth: "90%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <span>Station {activeHoverPoint.stationId}</span>
                <span style={{ color: "#6b7280" }}>•</span>
                <span>DMI: {activeHoverPoint.dmi.toLocaleString()} ft</span>
                <span style={{ color: "#6b7280" }}>•</span>
                <span style={{ color: "#38bdf8" }}>
                  {activeSensor}: {activeHoverPoint.val.toFixed(2)} mils
                </span>
                {!streetViewActive && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const pt = validPoints.find(
                        (p) => String(p.StationID ?? p.stationId) === String(activeHoverPoint.stationId)
                      );
                      if (pt) handleOpenStreetView(pt);
                    }}
                    style={{
                      background: "#2563eb",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 4,
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      marginLeft: 4,
                    }}
                    title="Open Google Street View for this station"
                  >
                    🚶‍♂️ Street View
                  </button>
                )}
              </div>
            )}

            {/* Floating Interactive Pegman Button - Hidden in Clean Screenshot Mode */}
            {!isScreenshotMode && !streetViewActive && (
              <div
                className="map-pegman-btn"
                onClick={() => {
                  const target =
                    (activeStationId && validPoints.find((p) => String(p.StationID ?? p.stationId) === String(activeStationId))) ||
                    (hoveredStationId && validPoints.find((p) => String(p.StationID ?? p.stationId) === String(hoveredStationId))) ||
                    validPoints[0];
                  if (target) {
                    handleOpenStreetView(target);
                  }
                }}
                title="Click to open Google Street View for selected station"
                style={{
                  position: "absolute",
                  top: 86,
                  right: 16,
                  zIndex: 1000,
                  background: "rgba(255, 255, 255, 0.95)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "50%",
                  width: 40,
                  height: 40,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                  fontSize: 22,
                  transition: "transform 0.15s ease, box-shadow 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "scale(1.12)";
                  e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "scale(1)";
                  e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
                }}
              >
                🚶‍♂️
              </div>
            )}

            {/* Floating Interactive Cardinal Compass Rose - Hidden in Clean Screenshot Mode */}
            {!isScreenshotMode && (
              <div
                className="map-compass"
                onClick={handleResetRotation}
                title="Click to reset to North"
              >
                <div
                  className="compass-rose"
                  style={{ transform: `rotate(${-normalizedBearing}deg)` }}
                >
                  <div className="compass-pointer north">
                    <span className="compass-letter">N</span>
                  </div>
                  <div className="compass-pointer south">
                    <span className="compass-letter">S</span>
                  </div>
                  <div className="compass-pointer east">
                    <span className="compass-letter">E</span>
                  </div>
                  <div className="compass-pointer west">
                    <span className="compass-letter">W</span>
                  </div>
                  <div className="compass-center-dot" />
                </div>
                {normalizedBearing !== 0 && (
                  <div className="compass-reset-hint">
                    ↺ Reset
                  </div>
                )}
              </div>
            )}

            {/* Map Canvas */}
            <div
              ref={mapContainer}
              style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
            />
          </div>
        </div>

        {/* Vertical Drag Resizer Bar: Map <-> Deflection */}
        {showProfile && (
          <div
            onPointerDown={handleSplit1PointerDown}
            style={{
              height: 7,
              width: "100%",
              cursor: "row-resize",
              background: isDraggingSplit1 ? "#3b82f6" : "#f3f4f6",
              borderTop: "1px solid #e5e7eb",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              userSelect: "none",
              touchAction: "none",
              zIndex: 20,
              transition: isDraggingSplit1 ? "none" : "background 0.15s ease",
            }}
            title="Drag vertically to resize Map / Deflection chart height"
          >
            <div
              style={{
                width: 38,
                height: 3,
                borderRadius: 2,
                background: isDraggingSplit1 ? "#ffffff" : "#9ca3af",
              }}
            />
          </div>
        )}

        {/* Bottom/Lower: Wide-Format Synchronized Deflection Profile matching ProfileView */}
        {showProfile && (
          <div
            style={{
              flex: `0 0 ${deflectionHeight}px`,
              height: deflectionHeight,
              minHeight: 120,
              borderTop: "1px solid var(--border-subtle)",
              background: "#ffffff",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 -2px 10px rgba(0,0,0,0.06)",
              zIndex: 5,
            }}
          >
            {/* Header & Controls Bar matching ProfileView - Hidden in Clean Screenshot Mode */}
            {!isScreenshotMode && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 14px",
                  background: "#f9fafb",
                  borderBottom: "1px solid var(--border-subtle)",
                  flexWrap: "wrap",
                  gap: "var(--sp-2)",
                }}
              >
              {/* Left: Sensor Selector Pills + Average Toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                    Sensor{sectionName ? ` (${sectionName})` : ""}:
                  </span>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {deflectionCols.map((col) => {
                      const isActive = col === activeSensor;
                      const colColor = SENSOR_COLORS[col] || "#2563eb";
                      return (
                        <button
                          key={col}
                          type="button"
                          onClick={() => setSelectedSensor(col)}
                          style={{
                            padding: "2px 8px",
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

                {/* Average Line Toggle (Black Dotted) */}
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
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

                {/* Legend Toggle Checkbox */}
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showLegend}
                    onChange={(e) => setShowLegend(e.target.checked)}
                    style={{ accentColor: "#111827", cursor: "pointer" }}
                  />
                  <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    Legend
                  </span>
                </label>

                {/* Section Stats Summary Badge */}
                {stats && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-secondary)",
                      background: "var(--bg-secondary)",
                      padding: "2px 8px",
                      borderRadius: "var(--r-sm)",
                    }}
                  >
                    Mean: <strong style={{ color: "#111827" }}>{stats.mean.toFixed(2)} mils</strong> | Min: {stats.min.toFixed(2)} | Max: {stats.max.toFixed(2)} mils
                  </span>
                )}

                {/* Selected Point GPS Coordinates Badge */}
                {displayCoordPoint && displayCoordPoint.lat != null && displayCoordPoint.lng != null && (
                  <span
                    onClick={() => {
                      const coordStr = `${displayCoordPoint.lat.toFixed(6)}, ${displayCoordPoint.lng.toFixed(6)}`;
                      navigator.clipboard?.writeText(coordStr);
                      show?.(`Coordinates copied: ${coordStr}`, "success");
                    }}
                    style={{
                      fontSize: 11,
                      color: "#1e40af",
                      background: "#eff6ff",
                      border: "1px solid #bfdbfe",
                      padding: "2px 8px",
                      borderRadius: "var(--r-sm)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      cursor: "pointer",
                      userSelect: "none",
                      transition: "all 0.15s ease",
                    }}
                    title={`Station ${displayCoordPoint.StationID ?? displayCoordPoint.stationId}: Click to copy coordinates (${displayCoordPoint.lat.toFixed(6)}, ${displayCoordPoint.lng.toFixed(6)})`}
                  >
                    <span style={{ fontSize: 11 }}>📍</span>
                    <strong style={{ color: "#1e3a8a" }}>
                      Station {displayCoordPoint.StationID ?? displayCoordPoint.stationId}:
                    </strong>
                    <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#1e40af" }}>
                      {displayCoordPoint.lat.toFixed(6)}, {displayCoordPoint.lng.toFixed(6)}
                    </span>
                    <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 2 }} title="Click to copy">
                      📋
                    </span>
                  </span>
                )}
              </div>

              {/* Right: Copy + Download + Close */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleCopyChart}
                  title="Copy profile chart image to clipboard"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px" }}
                >
                  <span>📋</span> Copy
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleDownloadChart}
                  title="Download profile chart as high-resolution PNG"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px" }}
                >
                  <span>⬇</span> Download
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowProfile(false)}
                  title="Close Deflection Profile"
                  style={{ padding: "2px 7px", fontSize: 12, lineHeight: 1 }}
                >
                  ✕
                </button>
              </div>
            </div>
            )}

            {/* Wide Full-Width SVG Area */}
            <div
              ref={chartContainerRef}
              style={{
                flex: 1,
                width: "100%",
                padding: "4px 12px 6px",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#ffffff",
                cursor: "crosshair",
              }}
            >
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

                const legendWidth = 195;
                const legendHeight = 12 + legendItems.length * 18;
                const legendX = padding.left + plotWidth - legendWidth - 10;
                const legendY = padding.top + 8;

                return (
                  <svg
                    ref={svgRef}
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    style={{ width: "100%", height: "100%", overflow: "visible", background: "#ffffff" }}
                    onMouseMove={handleChartMouseMove}
                    onMouseLeave={() => {
                      setHoveredPoint(null);
                      setHoveredStationId(null);
                    }}
                    onClick={handleChartClick}
                    onDoubleClick={handleChartDoubleClick}
                  >
                    {/* Major Horizontal Grid Lines & Y-axis Inner Ticks */}
                    {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                      const y = padding.top + pct * plotHeight;
                      const val = ((1 - pct) * scales.roundedYMax).toFixed(1);
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
                            stroke="#111827"
                            strokeWidth="1.5"
                          />
                          <text
                            x={padding.left - 8}
                            y={y + 4}
                            textAnchor="end"
                            fontSize="13"
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
                        <line
                          x1={tick.x}
                          y1={padding.top + plotHeight}
                          x2={tick.x}
                          y2={padding.top + plotHeight - 6}
                          stroke="#111827"
                          strokeWidth="1.5"
                        />
                        <text
                          x={tick.x}
                          y={padding.top + plotHeight + 18}
                          textAnchor="middle"
                          fontSize="13"
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
                      const isHovered =
                        activeHoverPoint?.originalIdx === pt.originalIdx ||
                        hoveredStationId === pt.stationId;
                      return (
                        <g
                          key={`pt-${pt.originalIdx}`}
                          style={{ cursor: "pointer" }}
                        >
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={isHovered ? "4.5" : "3.5"}
                            fill={isHovered ? "#ffffff" : "#111827"}
                            stroke={isHovered ? "#2563eb" : "#111827"}
                            strokeWidth={isHovered ? "2" : "1"}
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
                    {showLegend && legendItems.length > 0 && (
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
                          const itemY = 14 + idx * 18;
                          return (
                            <g key={item.id}>
                              {item.type === "solid-black" && (
                                <>
                                  <line x1="10" y1={itemY} x2="30" y2={itemY} stroke="#111827" strokeWidth="2.5" />
                                  <circle cx="20" cy={itemY} r="3" fill="#111827" stroke="#ffffff" strokeWidth="1" />
                                </>
                              )}
                              {item.type === "dotted-black" && (
                                <line x1="10" y1={itemY} x2="30" y2={itemY} stroke="#111827" strokeWidth="2" strokeDasharray="3 3" />
                              )}
                              <text
                                x="38"
                                y={itemY + 4}
                                fontSize="11"
                                fontFamily="Arial, sans-serif"
                                fill="#111827"
                                fontWeight="600"
                              >
                                {item.label}
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    )}

                    {/* Interactive Tooltip Card matching ProfileView */}
                    {activeHoverPoint && (
                      <g pointerEvents="none">
                        {/* Vertical Drop Line connecting to X-axis */}
                        <line
                          x1={activeHoverPoint.x}
                          y1={padding.top}
                          x2={activeHoverPoint.x}
                          y2={padding.top + plotHeight}
                          stroke="#9ca3af"
                          strokeWidth="1"
                          strokeDasharray="3 3"
                        />
                        {/* Highlighted active circle */}
                        <circle
                          cx={activeHoverPoint.x}
                          cy={activeHoverPoint.y}
                          r="5"
                          fill="#ffffff"
                          stroke="#2563eb"
                          strokeWidth="2"
                        />
                        {/* Tooltip Card with intelligent clearance */}
                        {(() => {
                          const tooltipWidth = 130;
                          const tooltipHeight = 52;
                          const gap = 16;
                          // If placing above would collide with top border, flip below the point
                          const placeBelow = activeHoverPoint.y - tooltipHeight - gap < padding.top;
                          const tooltipX = Math.max(
                            padding.left + 5,
                            Math.min(padding.left + plotWidth - tooltipWidth - 5, activeHoverPoint.x - tooltipWidth / 2)
                          );
                          const tooltipY = placeBelow
                            ? activeHoverPoint.y + gap
                            : activeHoverPoint.y - tooltipHeight - gap;

                          return (
                            <g transform={`translate(${tooltipX}, ${tooltipY})`}>
                              <rect
                                x="0"
                                y="0"
                                width={tooltipWidth}
                                height={tooltipHeight}
                                rx="4"
                                fill="#111827"
                                opacity="0.95"
                              />
                              <text x="8" y="16" fill="#9ca3af" fontSize="10.5" fontFamily="Arial, sans-serif">
                                Station: <tspan fill="#ffffff" fontWeight="bold">{activeHoverPoint.stationId}</tspan>
                              </text>
                              <text x="8" y="31" fill="#9ca3af" fontSize="10.5" fontFamily="Arial, sans-serif">
                                DMI: <tspan fill="#ffffff" fontWeight="bold">{activeHoverPoint.dmi.toLocaleString()} ft</tspan>
                              </text>
                              <text x="8" y="46" fill="#9ca3af" fontSize="10.5" fontFamily="Arial, sans-serif">
                                {activeSensor}: <tspan fill="#38bdf8" fontWeight="bold">{activeHoverPoint.val.toFixed(2)} mils</tspan>
                              </text>
                            </g>
                          );
                        })()}
                      </g>
                    )}

                    {/* Axis Titles in Arial Bold matching ProfileView */}
                    <text
                      x={padding.left - 44}
                      y={padding.top + plotHeight / 2}
                      textAnchor="middle"
                      fontSize="14"
                      fontWeight="bold"
                      fill="#111827"
                      fontFamily="Arial, sans-serif"
                      transform={`rotate(-90 ${padding.left - 44} ${padding.top + plotHeight / 2})`}
                    >
                      Deflection (mils)
                    </text>
                    <text
                      x={padding.left + plotWidth / 2}
                      y={chartHeight - 6}
                      textAnchor="middle"
                      fontSize="14"
                      fontWeight="bold"
                      fill="#111827"
                      fontFamily="Arial, sans-serif"
                    >
                      DMI (ft)
                    </text>
                  </svg>
                );
              })() : (
                <div className="empty-state">
                  <div className="empty-state-icon">📈</div>
                  <h3>No profile data</h3>
                  <p>Could not extract station DMI distance values from this section.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Vertical Drag Resizer Bar: Deflection <-> Thickness */}
        {showThicknessProfile && (
          <div
            onPointerDown={handleSplit2PointerDown}
            style={{
              height: 7,
              width: "100%",
              cursor: "row-resize",
              background: isDraggingSplit2 ? "#3b82f6" : "#f3f4f6",
              borderTop: "1px solid #e5e7eb",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              userSelect: "none",
              touchAction: "none",
              zIndex: 20,
              transition: isDraggingSplit2 ? "none" : "background 0.15s ease",
            }}
            title="Drag vertically to resize Deflection / Thickness chart height"
          >
            <div
              style={{
                width: 38,
                height: 3,
                borderRadius: 2,
                background: isDraggingSplit2 ? "#ffffff" : "#9ca3af",
              }}
            />
          </div>
        )}

        {/* Drag Protection Overlay for Vertical Splitters */}
        {(isDraggingSplit1 || isDraggingSplit2) && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99999,
              cursor: "row-resize",
              userSelect: "none",
            }}
          />
        )}

        {/* Bottom-most: Wide-Format Synchronized Slab / Pavement Thickness Profile */}
        {showThicknessProfile && (
          <div
            style={{
              flex: `0 0 ${thicknessHeight}px`,
              height: thicknessHeight,
              minHeight: 120,
              borderTop: "1px solid var(--border-subtle)",
              background: "#ffffff",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 -2px 10px rgba(0,0,0,0.06)",
              zIndex: 5,
            }}
          >
            {/* Header & Controls Bar - Hidden in Clean Screenshot Mode */}
            {!isScreenshotMode && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 14px",
                  background: "#fdfbf7",
                  borderBottom: "1px solid #fef3c7",
                  flexWrap: "wrap",
                  gap: "var(--sp-2)",
                }}
              >
                {/* Left: Label + Average Toggle + Legend Toggle + Stats Badge */}
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span>📏</span> Thickness Profile{sectionName ? ` (${sectionName})` : ""}:
                  </span>

                  {/* Average Line Toggle (Amber Dotted) */}
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showThicknessAverageLine}
                      onChange={(e) => setShowThicknessAverageLine(e.target.checked)}
                      style={{ accentColor: "#b45309", cursor: "pointer" }}
                    />
                    <span style={{ color: "var(--text-primary)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 12, height: 2, borderBottom: "2px dotted #b45309", display: "inline-block" }} />
                      Average
                    </span>
                  </label>

                  {/* Legend Toggle Checkbox */}
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 12,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showThicknessLegend}
                      onChange={(e) => setShowThicknessLegend(e.target.checked)}
                      style={{ accentColor: "#b45309", cursor: "pointer" }}
                    />
                    <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                      Legend
                    </span>
                  </label>

                  {/* Section Stats Summary Badge */}
                  {thicknessStats && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "#78350f",
                        background: "#fef3c7",
                        border: "1px solid #fde68a",
                        padding: "2px 8px",
                        borderRadius: "var(--r-sm)",
                      }}
                    >
                      Mean: <strong style={{ color: "#92400e" }}>{thicknessStats.mean.toFixed(1)} in</strong> | Min: {thicknessStats.min.toFixed(1)} | Max: {thicknessStats.max.toFixed(1)} in
                      {thicknessStats.cv > 0 && ` | CV: ${thicknessStats.cv.toFixed(1)}%`}
                    </span>
                  )}

                  {/* Selected / Hovered Point Thickness Badge */}
                  {activeHoverThicknessPoint && (
                    <span
                      style={{
                        fontSize: 11,
                        color: "#92400e",
                        background: "#fef3c7",
                        border: "1px solid #fde68a",
                        padding: "2px 8px",
                        borderRadius: "var(--r-sm)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <strong>Station {activeHoverThicknessPoint.stationId}:</strong>
                      <span style={{ fontWeight: 700 }}>{activeHoverThicknessPoint.val.toFixed(1)} in</span>
                    </span>
                  )}
                </div>

                {/* Right: Copy + Download + Close */}
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleCopyThicknessChart}
                    title="Copy thickness profile chart image to clipboard"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px" }}
                  >
                    <span>📋</span> Copy
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleDownloadThicknessChart}
                    title="Download thickness chart as high-resolution PNG"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px" }}
                  >
                    <span>⬇</span> Download
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowThicknessProfile(false)}
                    title="Close Thickness Profile"
                    style={{ padding: "2px 7px", fontSize: 12, lineHeight: 1 }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Wide Full-Width SVG Area for Thickness - Perfectly Matched to Deflection Chart */}
            <div
              ref={thicknessContainerRef}
              style={{
                flex: 1,
                width: "100%",
                padding: "4px 12px 6px",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#ffffff",
                cursor: "crosshair",
              }}
            >
              {thicknessScales && scales ? (() => {
                const legendItems = [];
                legendItems.push({
                  id: "thickness",
                  label: "Thickness Profile",
                  type: "solid-amber",
                });
                if (showThicknessAverageLine && thicknessStats) {
                  legendItems.push({
                    id: "average",
                    label: `Average: ${thicknessStats.mean.toFixed(1)} in`,
                    type: "dotted-amber",
                  });
                }

                const legendWidth = 195;
                const legendHeight = 12 + legendItems.length * 18;
                const legendX = padding.left + plotWidth - legendWidth - 10;
                const legendY = padding.top + 8;

                return (
                  <svg
                    ref={thicknessSvgRef}
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    style={{ width: "100%", height: "100%", overflow: "visible", background: "#ffffff" }}
                    onMouseMove={handleThicknessMouseMove}
                    onMouseLeave={() => {
                      setHoveredPoint(null);
                      setHoveredStationId(null);
                    }}
                    onClick={handleChartClick}
                    onDoubleClick={handleChartDoubleClick}
                  >
                    {/* Major Horizontal Grid Lines & Y-axis Inner Ticks */}
                    {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                      const y = padding.top + pct * plotHeight;
                      const val = ((1 - pct) * thicknessScales.roundedYMax).toFixed(1);
                      return (
                        <g key={`th-grid-${pct}`}>
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
                            stroke="#111827"
                            strokeWidth="1.5"
                          />
                          <text
                            x={padding.left - 8}
                            y={y + 4}
                            textAnchor="end"
                            fontSize="13"
                            fill="#111827"
                            fontFamily="Arial, sans-serif"
                          >
                            {val}
                          </text>
                        </g>
                      );
                    })}

                    {/* Major Vertical Grid Lines & X-axis Inner Ticks (DMI in ft - Identically Aligned to Deflection Chart) */}
                    {scales.xTicks.map((tick) => (
                      <g key={`th-x-tick-${tick.val}`}>
                        <line
                          x1={tick.x}
                          y1={padding.top}
                          x2={tick.x}
                          y2={padding.top + plotHeight}
                          stroke="#e5e7eb"
                          strokeWidth="1"
                        />
                        <line
                          x1={tick.x}
                          y1={padding.top + plotHeight}
                          x2={tick.x}
                          y2={padding.top + plotHeight - 6}
                          stroke="#111827"
                          strokeWidth="1.5"
                        />
                        <text
                          x={tick.x}
                          y={padding.top + plotHeight + 18}
                          textAnchor="middle"
                          fontSize="13"
                          fill="#111827"
                          fontFamily="Arial, sans-serif"
                        >
                          {tick.val}
                        </text>
                      </g>
                    ))}

                    {/* Average Reference Line (Dotted Amber Line) */}
                    {showThicknessAverageLine && thicknessStats && (
                      <line
                        x1={padding.left}
                        y1={thicknessScales.averageY}
                        x2={padding.left + plotWidth}
                        y2={thicknessScales.averageY}
                        stroke="#b45309"
                        strokeWidth="1.8"
                        strokeDasharray="3 3"
                      />
                    )}

                    {/* Thickness Profile Curve Path (Solid Amber Line) */}
                    <path
                      d={thicknessScales.linePath}
                      fill="none"
                      stroke="#b45309"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {/* Station Data Point Circles (Solid Amber Dots) */}
                    {thicknessScales.mappedPoints.map((pt) => {
                      const isHovered =
                        (hoveredStationId !== null && String(hoveredStationId) === String(pt.stationId)) ||
                        (activeHoverThicknessPoint && activeHoverThicknessPoint.originalIdx === pt.originalIdx);
                      return (
                        <g key={`th-pt-${pt.originalIdx}`} style={{ cursor: "pointer" }}>
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={isHovered ? "4.5" : "3.5"}
                            fill={isHovered ? "#ffffff" : "#b45309"}
                            stroke={isHovered ? "#2563eb" : "#b45309"}
                            strokeWidth={isHovered ? "2" : "1"}
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
                    {showThicknessLegend && legendItems.length > 0 && (
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
                          const itemY = 14 + idx * 18;
                          return (
                            <g key={item.id}>
                              {item.type === "solid-amber" && (
                                <>
                                  <line x1="10" y1={itemY} x2="30" y2={itemY} stroke="#b45309" strokeWidth="2.5" />
                                  <circle cx="20" cy={itemY} r="3" fill="#b45309" stroke="#ffffff" strokeWidth="1" />
                                </>
                              )}
                              {item.type === "dotted-amber" && (
                                <line x1="10" y1={itemY} x2="30" y2={itemY} stroke="#b45309" strokeWidth="2" strokeDasharray="3 3" />
                              )}
                              <text
                                x="38"
                                y={itemY + 4}
                                fontSize="11"
                                fontFamily="Arial, sans-serif"
                                fill="#111827"
                                fontWeight="600"
                              >
                                {item.label}
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    )}

                    {/* Synchronized Drop Line & Interactive Tooltip Card */}
                    {activeHoverThicknessPoint && (
                      <g pointerEvents="none">
                        <line
                          x1={activeHoverThicknessPoint.x}
                          y1={padding.top}
                          x2={activeHoverThicknessPoint.x}
                          y2={padding.top + plotHeight}
                          stroke="#9ca3af"
                          strokeWidth="1"
                          strokeDasharray="3 3"
                        />
                        <circle
                          cx={activeHoverThicknessPoint.x}
                          cy={activeHoverThicknessPoint.y}
                          r="5"
                          fill="#ffffff"
                          stroke="#b45309"
                          strokeWidth="2"
                        />
                        {(() => {
                          const tooltipWidth = 130;
                          const tooltipHeight = 52;
                          const gap = 16;
                          const placeBelow = activeHoverThicknessPoint.y - tooltipHeight - gap < padding.top;
                          const tooltipX = Math.max(
                            padding.left + 5,
                            Math.min(padding.left + plotWidth - tooltipWidth - 5, activeHoverThicknessPoint.x - tooltipWidth / 2)
                          );
                          const tooltipY = placeBelow
                            ? activeHoverThicknessPoint.y + gap
                            : activeHoverThicknessPoint.y - tooltipHeight - gap;

                          return (
                            <g transform={`translate(${tooltipX}, ${tooltipY})`}>
                              <rect
                                x="0"
                                y="0"
                                width={tooltipWidth}
                                height={tooltipHeight}
                                rx="4"
                                fill="#111827"
                                opacity="0.95"
                              />
                              <text x="8" y="16" fill="#9ca3af" fontSize="10.5" fontFamily="Arial, sans-serif">
                                Station: <tspan fill="#ffffff" fontWeight="bold">{activeHoverThicknessPoint.stationId}</tspan>
                              </text>
                              <text x="8" y="31" fill="#9ca3af" fontSize="10.5" fontFamily="Arial, sans-serif">
                                DMI: <tspan fill="#ffffff" fontWeight="bold">{activeHoverThicknessPoint.dmi.toLocaleString()} ft</tspan>
                              </text>
                              <text x="8" y="46" fill="#9ca3af" fontSize="10.5" fontFamily="Arial, sans-serif">
                                Thickness: <tspan fill="#fbbf24" fontWeight="bold">{activeHoverThicknessPoint.val.toFixed(1)} in</tspan>
                              </text>
                            </g>
                          );
                        })()}
                      </g>
                    )}

                    {/* Axis Titles in Arial Bold matching ProfileView */}
                    <text
                      x={padding.left - 44}
                      y={padding.top + plotHeight / 2}
                      textAnchor="middle"
                      fontSize="14"
                      fontWeight="bold"
                      fill="#111827"
                      fontFamily="Arial, sans-serif"
                      transform={`rotate(-90 ${padding.left - 44} ${padding.top + plotHeight / 2})`}
                    >
                      Thickness (in)
                    </text>
                    <text
                      x={padding.left + plotWidth / 2}
                      y={chartHeight - 6}
                      textAnchor="middle"
                      fontSize="14"
                      fontWeight="bold"
                      fill="#111827"
                      fontFamily="Arial, sans-serif"
                    >
                      DMI (ft)
                    </text>
                  </svg>
                );
              })() : (
                <div className="empty-state" style={{ padding: "24px 16px" }}>
                  <div className="empty-state-icon" style={{ fontSize: 24 }}>📏</div>
                  <h3 style={{ fontSize: 14, margin: "6px 0 2px" }}>No thickness data</h3>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                    No thickness profile values available for this section.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
