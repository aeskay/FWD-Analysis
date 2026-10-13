import React, { useState, useEffect, useRef, useMemo } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// In modern Vite, point maplibregl directly to its web worker bundle URL to prevent Worker loading error
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
maplibregl.setWorkerUrl(maplibreWorkerUrl);

function getCoordinate(val) {
  if (val === null || val === undefined) return null;
  const num = typeof val === "number" ? val : parseFloat(val);
  return isNaN(num) ? null : num;
}

const COLOR_OPTIONS = [
  { label: "Cyan", value: "#06b6d4" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Lime", value: "#10b981" },
  { label: "Red", value: "#ef4444" },
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#111827" },
];

export default function MapView({ rows = [], selectedVariant = "A" }) {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]); // Store DOM markers
  const [bearing, setBearing] = useState(0);
  const [mapType, setMapType] = useState("satellite"); // "satellite" | "streets"
  const [dotColor, setDotColor] = useState("#06b6d4");
  const [dotRadius, setDotRadius] = useState(7);

  // Extract valid points [lng, lat]
  const validPoints = useMemo(() => {
    return rows
      .map((r, idx) => {
        const lat = getCoordinate(r.Latitude ?? r.latitude ?? r.LAT ?? r.Lat);
        const lng = getCoordinate(r.Longitude ?? r.longitude ?? r.LON ?? r.Long ?? r.Lng);
        if (lat !== null && lng !== null && lat !== 0 && lng !== 0) {
          return {
            ...r,
            lat,
            lng,
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

  // Initialize Map
  useEffect(() => {
    if (!mapContainer.current || validPoints.length === 0) return;

    const isSat = mapType === "satellite";

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          esriSatellite: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            maxzoom: 19,
          },
          esriLabels: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            maxzoom: 19,
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
            id: "satellite-layer",
            type: "raster",
            source: "esriSatellite",
            layout: { visibility: isSat ? "visible" : "none" },
          },
          {
            id: "satellite-labels",
            type: "raster",
            source: "esriLabels",
            layout: { visibility: isSat ? "visible" : "none" },
          },
          {
            id: "streets-layer",
            type: "raster",
            source: "osmStreets",
            layout: { visibility: !isSat ? "visible" : "none" },
          },
        ],
      },
      center: initialCenter,
      zoom: 15,
      bearing: 0,
      pitch: 0,
      dragRotate: true,
      touchPitch: false,
    });

    mapInstance.on("rotate", () => {
      setBearing(Math.round(mapInstance.getBearing()));
    });

    // Fit bounds immediately on load
    mapInstance.on("load", () => {
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
          paint: {
            "line-color": isSat ? "#ffffff" : "#111827",
            "line-width": 3,
            "line-dasharray": [2, 2],
            "line-opacity": 0.8,
          },
        });
      }
    });

    // Create reliable DOM HTML Markers for all survey stations
    // (DOM markers never fail if WebGL worker is slow or re-syncing)
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    validPoints.forEach((pt) => {
      const el = document.createElement("div");
      el.className = "station-map-dot";
      el.style.width = `${dotRadius * 2}px`;
      el.style.height = `${dotRadius * 2}px`;
      el.style.backgroundColor = dotColor;
      el.style.border = `2px solid ${isSat ? "#ffffff" : "#111827"}`;
      el.style.borderRadius = "50%";
      el.style.cursor = "pointer";
      el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.4)";
      el.title = `Station ${pt.StationID}`;

      const popup = new maplibregl.Popup({ offset: dotRadius + 4 }).setHTML(`
        <div style="font-family: inherit; font-size: 12px; line-height: 1.5; min-width: 150px; color: #111827;">
          <div style="font-weight: 700; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-bottom: 4px;">
            Station ${pt.StationID}
          </div>
          <div><strong>Drop:</strong> ${pt.DropID ?? "—"} (${selectedVariant})</div>
          ${pt.Force != null ? `<div><strong>Force:</strong> ${Number(pt.Force).toFixed(0)} lbs</div>` : ""}
          ${pt.D1 != null ? `<div><strong>D1:</strong> ${Number(pt.D1).toFixed(2)} mils</div>` : ""}
          <div><strong>Lat:</strong> ${pt.lat.toFixed(6)}</div>
          <div><strong>Lon:</strong> ${pt.lng.toFixed(6)}</div>
        </div>
      `);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([pt.lng, pt.lat])
        .setPopup(popup)
        .addTo(mapInstance);

      markersRef.current.push(marker);
    });

    map.current = mapInstance;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapInstance.remove();
      map.current = null;
    };
  }, [validPoints.length]);

  // Update map layer on mapType change (Satellite vs Streets)
  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const isSat = mapType === "satellite";

    map.current.setLayoutProperty(
      "satellite-layer",
      "visibility",
      isSat ? "visible" : "none"
    );
    map.current.setLayoutProperty(
      "satellite-labels",
      "visibility",
      isSat ? "visible" : "none"
    );
    map.current.setLayoutProperty(
      "streets-layer",
      "visibility",
      !isSat ? "visible" : "none"
    );

    // Update alignment line color
    if (map.current.getLayer("survey-line-layer")) {
      map.current.setPaintProperty(
        "survey-line-layer",
        "line-color",
        isSat ? "#ffffff" : "#111827"
      );
    }

    // Update marker borders
    markersRef.current.forEach((marker) => {
      const el = marker.getElement();
      if (el) {
        el.style.borderColor = isSat ? "#ffffff" : "#111827";
      }
    });
  }, [mapType]);

  // Update marker color and radius in real-time
  useEffect(() => {
    const isSat = mapType === "satellite";
    markersRef.current.forEach((marker) => {
      const el = marker.getElement();
      if (el) {
        el.style.backgroundColor = dotColor;
        el.style.width = `${dotRadius * 2}px`;
        el.style.height = `${dotRadius * 2}px`;
        el.style.borderColor = isSat ? "#ffffff" : "#111827";
      }
    });
  }, [dotColor, dotRadius, mapType]);

  // Rotation controls
  const handleRotateLeft = () => {
    if (!map.current) return;
    map.current.easeTo({ bearing: map.current.getBearing() - 15, duration: 200 });
  };

  const handleRotateRight = () => {
    if (!map.current) return;
    map.current.easeTo({ bearing: map.current.getBearing() + 15, duration: 200 });
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

  const isSat = mapType === "satellite";
  const normalizedBearing = ((bearing % 360) + 360) % 360;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", width: "100%", position: "relative" }}>
      {/* Top Map Toolbar */}
      <div className="map-toolbar">
        {/* Left: Section tag & count */}
        <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          <span className="badge badge-dark">Drop {selectedVariant}</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {validPoints.length.toLocaleString()} locations
          </span>
        </div>

        {/* Center: Dot Style Controls (Color & Size) */}
        <div className="map-tool-group">
          <span className="map-tool-label">Marker:</span>
          {/* Color swatches */}
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
            <input
              type="color"
              value={dotColor}
              onChange={(e) => setDotColor(e.target.value)}
              title="Custom color"
              style={{
                width: 20,
                height: 20,
                padding: 0,
                border: "1px solid #d1d5db",
                borderRadius: 4,
                cursor: "pointer",
                background: "none",
              }}
            />
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

        {/* Right: Rotation + Map Type toggles */}
        <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          {/* Rotate Controls */}
          <div className="rotation-control-group">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleRotateLeft}
              title="Rotate Left (-15°)"
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
              title="Rotate Right (+15°)"
            >
              ↻
            </button>
            {normalizedBearing !== 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleResetRotation}
                title="Reset to North (0°)"
                style={{ fontWeight: 600 }}
              >
                Reset
              </button>
            )}
          </div>

          {/* Satellite vs Streets toggle */}
          <div style={{ display: "flex", gap: 2 }}>
            <button
              type="button"
              className={`btn btn-sm ${isSat ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setMapType("satellite")}
            >
              🛰️ Satellite
            </button>
            <button
              type="button"
              className={`btn btn-sm ${!isSat ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setMapType("streets")}
            >
              🗺️ Streets
            </button>
          </div>
        </div>
      </div>

      {/* Full Viewport Canvas */}
      <div style={{ flex: 1, width: "100%", height: "100%", position: "relative" }}>
        {/* Floating Interactive Cardinal Compass Rose */}
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

        {/* Native WebGL Map Canvas Container */}
        <div
          ref={mapContainer}
          style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
        />
      </div>
    </div>
  );
}
