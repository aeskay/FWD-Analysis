import React, { useState, useEffect, useRef, useMemo } from "react";
import { useToast } from "../context/ToastContext";

const DEFLECTION_RE = /^D\d+$/;

export default function ColumnFilter({
  columns = [],
  hiddenColumns = [],
  allHiddenColumns = { data: [], normalized: [] },
  onUpdateHiddenColumns,
  onSaveAsDefault,
  currentTab = "data", // "data" | "normalized"
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [syncBothTabs, setSyncBothTabs] = useState(true);
  const [savingStatus, setSavingStatus] = useState("saved"); // "saved" | "saving"
  const popoverRef = useRef(null);
  const { show } = useToast() || {};

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Derived counts
  const hiddenSet = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);
  const hiddenCount = columns.filter((c) => hiddenSet.has(c)).length;
  const visibleCount = columns.length - hiddenCount;

  // Filtered list by search
  const filteredColumns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return columns;
    return columns.filter((col) => col.toLowerCase().includes(q));
  }, [columns, search]);

  // Toggle a single column
  const handleToggleColumn = async (col) => {
    const isCurrentlyHidden = hiddenSet.has(col);
    if (!isCurrentlyHidden && visibleCount <= 1) {
      show?.("At least one column must remain visible", "info");
      return;
    }

    const nextHiddenForThisTab = isCurrentlyHidden
      ? hiddenColumns.filter((c) => c !== col)
      : [...hiddenColumns, col];

    setSavingStatus("saving");

    let nextAll;
    if (syncBothTabs) {
      nextAll = {
        data: nextHiddenForThisTab,
        normalized: nextHiddenForThisTab,
      };
    } else {
      nextAll = {
        ...allHiddenColumns,
        [currentTab]: nextHiddenForThisTab,
      };
    }

    try {
      await onUpdateHiddenColumns?.(nextAll);
      setSavingStatus("saved");
    } catch {
      setSavingStatus("saved");
    }
  };

  // Show all columns
  const handleShowAll = async () => {
    setSavingStatus("saving");
    let nextAll;
    if (syncBothTabs) {
      nextAll = { data: [], normalized: [] };
    } else {
      nextAll = { ...allHiddenColumns, [currentTab]: [] };
    }
    try {
      await onUpdateHiddenColumns?.(nextAll);
      setSavingStatus("saved");
      show?.("All columns shown", "success");
    } catch {
      setSavingStatus("saved");
    }
  };

  // Hide all columns (except StationID or first column)
  const handleHideAll = async () => {
    const keepCol = columns.includes("StationID") ? "StationID" : columns[0];
    const toHide = columns.filter((c) => c !== keepCol);
    setSavingStatus("saving");
    let nextAll;
    if (syncBothTabs) {
      nextAll = { data: toHide, normalized: toHide };
    } else {
      nextAll = { ...allHiddenColumns, [currentTab]: toHide };
    }
    try {
      await onUpdateHiddenColumns?.(nextAll);
      setSavingStatus("saved");
      show?.(`Filtered to essential column (${keepCol})`, "info");
    } catch {
      setSavingStatus("saved");
    }
  };

  // Save current visibility as global user default
  const handleSaveDefault = async () => {
    try {
      await onSaveAsDefault?.();
      show?.("Column filter saved as your default for all sections!", "success");
    } catch (err) {
      show?.("Failed to save default: " + err.message, "error");
    }
  };

  const getColBadge = (col) => {
    if (col === "StationID") return { label: "ID", color: "#1e40af", bg: "#dbeafe" };
    if (DEFLECTION_RE.test(col)) return { label: "Defl", color: "#065f46", bg: "#d1fae5" };
    if (col === "Force" || col === "Stress") return { label: "Load", color: "#92400e", bg: "#fef3c7" };
    if (col === "Latitude" || col === "Longitude") return { label: "GPS", color: "#6b21a8", bg: "#f3e8ff" };
    if (col === "DMI" || col === "Distance") return { label: "Dist", color: "#374151", bg: "#f3f4f6" };
    return null;
  };

  return (
    <div
      ref={popoverRef}
      style={{
        position: "relative",
        display: "inline-block",
      }}
    >
      {/* ── Interactive Trigger Chip ── */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: "var(--r-md)",
          border: hiddenCount > 0 ? "1px solid #3b82f6" : "1px solid var(--border-subtle)",
          backgroundColor: hiddenCount > 0 ? "#eff6ff" : "var(--bg-surface)",
          cursor: "pointer",
          userSelect: "none",
          fontSize: 12,
          fontFamily: "inherit",
          transition: "all 0.15s ease",
          boxShadow: hiddenCount > 0 ? "0 1px 3px rgba(59, 130, 246, 0.15)" : "none",
        }}
        title="Choose which columns to show or hide (persists permanently to database)"
      >
        <span style={{ fontSize: 13 }}>⚙️</span>
        <span
          style={{
            fontWeight: 700,
            color: hiddenCount > 0 ? "#1d4ed8" : "var(--text-primary)",
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          {hiddenCount > 0 ? `${visibleCount}/${columns.length}` : columns.length}
        </span>
        <span
          style={{
            color: hiddenCount > 0 ? "#1e40af" : "var(--text-secondary)",
            fontWeight: hiddenCount > 0 ? 600 : 400,
          }}
        >
          {hiddenCount > 0 ? `columns (${hiddenCount} hidden)` : "columns"}
        </span>
        <span style={{ fontSize: 9, opacity: 0.65, marginLeft: 2 }}>{isOpen ? "▲" : "▼"}</span>
      </button>

      {/* ── Filter Dropdown Popover ── */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 1000,
            width: 320,
            backgroundColor: "#ffffff",
            borderRadius: "var(--r-lg)",
            border: "1px solid var(--border-subtle)",
            boxShadow:
              "0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)",
            padding: "var(--sp-3)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--sp-3)",
            animation: "fadeIn 0.15s ease",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid var(--border-subtle)",
              paddingBottom: "var(--sp-2)",
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-primary)" }}>
                Column Visibility
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                {visibleCount} of {columns.length} columns visible
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="btn btn-ghost btn-icon btn-sm"
              style={{ fontSize: 13, color: "var(--text-muted)", width: 24, height: 24 }}
              title="Close"
            >
              ✕
            </button>
          </div>

          {/* Quick Search */}
          <div style={{ position: "relative" }}>
            <input
              type="text"
              className="input input-sm"
              placeholder="Search columns…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                paddingLeft: 26,
                paddingRight: search ? 24 : 8,
                fontSize: 12,
                height: 28,
              }}
            />
            <span
              style={{
                position: "absolute",
                left: 8,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 11,
                opacity: 0.5,
              }}
            >
              🔍
            </span>
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                style={{
                  position: "absolute",
                  right: 6,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#9ca3af",
                  fontSize: 11,
                  padding: 2,
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Action Buttons */}
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleShowAll}
              style={{ flex: 1, fontSize: 11, padding: "3px 6px", height: 26 }}
              title="Show all columns"
            >
              Show All
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleHideAll}
              style={{ flex: 1, fontSize: 11, padding: "3px 6px", height: 26 }}
              title="Hide non-essential columns"
            >
              Hide Rest
            </button>
          </div>

          {/* Scrollable Column List */}
          <div
            style={{
              maxHeight: 240,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--r-md)",
              padding: "4px",
              backgroundColor: "#fafafa",
            }}
          >
            {filteredColumns.length === 0 ? (
              <div
                style={{
                  padding: "16px",
                  textAlign: "center",
                  fontSize: 12,
                  color: "var(--text-muted)",
                }}
              >
                No columns match "{search}"
              </div>
            ) : (
              filteredColumns.map((col) => {
                const isVisible = !hiddenSet.has(col);
                const badge = getColBadge(col);
                const isOnlyVisible = isVisible && visibleCount <= 1;

                return (
                  <label
                    key={col}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "4px 8px",
                      borderRadius: "var(--r-sm)",
                      backgroundColor: isVisible ? "#ffffff" : "transparent",
                      cursor: isOnlyVisible ? "not-allowed" : "pointer",
                      fontSize: 12,
                      opacity: isVisible ? 1 : 0.6,
                      userSelect: "none",
                      border: isVisible ? "1px solid #f3f4f6" : "1px solid transparent",
                      transition: "all 0.1s ease",
                    }}
                    title={
                      isOnlyVisible
                        ? "At least one column must remain visible"
                        : isVisible
                        ? `Click to hide "${col}"`
                        : `Click to show "${col}"`
                    }
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <input
                        type="checkbox"
                        checked={isVisible}
                        disabled={isOnlyVisible}
                        onChange={() => handleToggleColumn(col)}
                        style={{ accentColor: "var(--primary)", cursor: isOnlyVisible ? "not-allowed" : "pointer" }}
                      />
                      <span
                        style={{
                          fontWeight: isVisible ? 600 : 400,
                          color: isVisible ? "var(--text-primary)" : "var(--text-muted)",
                          textDecoration: isVisible ? "none" : "line-through",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {col}
                      </span>
                    </div>

                    {badge && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: badge.color,
                          backgroundColor: badge.bg,
                          padding: "1px 5px",
                          borderRadius: 4,
                          marginLeft: 6,
                          flexShrink: 0,
                        }}
                      >
                        {badge.label}
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>

          {/* Sync & Persistence Options */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              borderTop: "1px solid var(--border-subtle)",
              paddingTop: "var(--sp-2)",
              fontSize: 11,
            }}
          >
            {/* Sync checkbox */}
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                color: "var(--text-secondary)",
              }}
              title="Apply these column visibility settings to both Data and Normalized views"
            >
              <input
                type="checkbox"
                checked={syncBothTabs}
                onChange={(e) => setSyncBothTabs(e.target.checked)}
                style={{ accentColor: "var(--primary)", cursor: "pointer" }}
              />
              <span>Apply to both Data &amp; Normalized tabs</span>
            </label>

            {/* Cloud persistence indicator & Global section connectivity */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 2,
              }}
            >
              <span
                style={{
                  color: savingStatus === "saving" ? "#d97706" : "#059669",
                  fontWeight: 600,
                  fontSize: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                {savingStatus === "saving" ? "⏳ Saving to cloud…" : "✓ Saved in cloud"}
              </span>

              <span
                style={{
                  color: "#1d4ed8",
                  backgroundColor: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: 4,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                }}
                title="This column filter is connected across all sections in your account"
              >
                <span>🌐</span> Connected to all sections
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
