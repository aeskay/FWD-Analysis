/**
 * thicknessParser.js
 * Utilities for importing and matching pavement / slab thickness data
 * from Excel (.xlsx, .xls) and CSV (.csv) files to FWD section stations.
 */
import * as XLSX from "xlsx";

/**
 * Normalizes a column name for fuzzy/flexible matching.
 */
export function cleanHeaderName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "") // remove anything in (parentheses) like (in), (inches)
    .replace(/[^a-z0-9]/g, "") // remove non-alphanumeric
    .trim();
}

/**
 * Parses an Excel (.xlsx, .xls) or CSV (.csv) ArrayBuffer.
 */
export function readThicknessSpreadsheet(buffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error("The selected file does not contain any worksheets.");
  }

  const sheetName = sheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error("Could not read sheet from file.");
  }

  // Parse rows with null for empty cells
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: null });
  if (!rawRows || rawRows.length === 0) {
    throw new Error("The selected spreadsheet contains no data rows.");
  }

  // Extract non-empty column headers
  const colSet = new Set();
  rawRows.forEach((r) => {
    Object.keys(r).forEach((k) => {
      if (k && !k.startsWith("__EMPTY")) {
        colSet.add(k.trim());
      }
    });
  });
  const columns = Array.from(colSet);

  return {
    sheetNames,
    activeSheet: sheetName,
    columns,
    rows: rawRows,
    rowCount: rawRows.length,
  };
}

/**
 * Auto-detects the column most likely to contain Thickness data.
 */
export function detectThicknessColumn(columns) {
  if (!columns || columns.length === 0) return "";

  // Priority keywords for thickness
  const keywords = [
    "thickness",
    "thick",
    "thk",
    "slabthickness",
    "pavementthickness",
    "corethickness",
    "core",
    "depth",
    "hpcc",
    "h_pcc",
    "hac",
    "h_ac",
    "slab",
    "h",
  ];

  for (const kw of keywords) {
    const found = columns.find((c) => {
      const clean = cleanHeaderName(c);
      return clean === kw || clean.includes(kw);
    });
    if (found) return found;
  }

  return columns[0] || "";
}

/**
 * Auto-detects the column most likely to contain Station / Point identifiers.
 */
export function detectStationColumn(columns) {
  if (!columns || columns.length === 0) return "";

  const keywords = [
    "stationid",
    "station",
    "stnid",
    "stn",
    "pointid",
    "point",
    "testpoint",
    "pt",
    "location",
    "loc",
    "id",
  ];

  for (const kw of keywords) {
    const found = columns.find((c) => {
      const clean = cleanHeaderName(c);
      return clean === kw || clean.includes(kw);
    });
    if (found) return found;
  }

  return "";
}

/**
 * Cleans and converts a raw cell value into a strictly valid thickness float or null.
 * Never returns NaN.
 */
export function cleanThicknessValue(val) {
  if (val === null || val === undefined) return null;

  if (typeof val === "number") {
    if (!Number.isFinite(val) || Number.isNaN(val) || val <= 0) return null;
    return Math.round(val * 1000) / 1000;
  }

  const str = String(val).trim();
  if (!str) return null;

  // Ignore common placeholder words for missing data
  const lower = str.toLowerCase();
  if (
    lower === "na" ||
    lower === "n/a" ||
    lower === "null" ||
    lower === "none" ||
    lower === "—" ||
    lower === "-" ||
    lower === "--" ||
    lower === "nan" ||
    lower === "empty"
  ) {
    return null;
  }

  // Strip common units like in, inch, inches, ", mm, cm
  const cleaned = str
    .replace(/"/g, "")
    .replace(/(inches|inch|in|mm|cm)\.?/gi, "")
    .trim();

  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || Number.isNaN(num) || num <= 0) return null;

  return Math.round(num * 1000) / 1000;
}

/**
 * Extracts unique ordered stations from section rows.
 */
export function getUniqueSectionStations(rows) {
  if (!rows || rows.length === 0) return [];
  const stationsMap = new Map();

  rows.forEach((r, idx) => {
    const sId = r.StationID ?? r.stationId ?? r.stationid ?? r.Station ?? (idx + 1);
    const key = String(sId);
    if (!stationsMap.has(key)) {
      stationsMap.set(key, {
        stationId: sId,
        dmi: r.DMI ?? r.dmi ?? null,
        firstRowIndex: idx,
      });
    }
  });

  return Array.from(stationsMap.values());
}

/**
 * Matches thickness values from the file to section stations.
 *
 * @param {Array} uniqueStations - ordered array of unique section stations
 * @param {Array} fileRows - rows parsed from uploaded file
 * @param {string} thicknessCol - selected thickness column
 * @param {string} stationCol - optional station column in file
 * @param {string} method - 'order' (corresponding sequential order) or 'station' (by station ID)
 */
export function matchThicknessToStations(
  uniqueStations,
  fileRows,
  thicknessCol,
  stationCol = "",
  method = "order"
) {
  if (!uniqueStations || uniqueStations.length === 0) return [];
  if (!fileRows || fileRows.length === 0 || !thicknessCol) {
    return uniqueStations.map((stn, idx) => ({
      stationId: stn.stationId,
      dmi: stn.dmi,
      fileRowNumber: idx + 1,
      rawFileValue: null,
      thickness: null,
      isMeasured: false,
    }));
  }

  if (method === "station" && stationCol) {
    // Build lookup map by station ID string and numeric
    const lookup = new Map();
    fileRows.forEach((r, idx) => {
      const rawStn = r[stationCol];
      if (rawStn !== null && rawStn !== undefined && String(rawStn).trim() !== "") {
        const key = String(rawStn).trim();
        const thickness = cleanThicknessValue(r[thicknessCol]);
        lookup.set(key, { thickness, rawVal: r[thicknessCol], fileRowNumber: idx + 1 });

        // Also normalize numeric keys (e.g. "01" vs "1")
        const numKey = parseFloat(key);
        if (!Number.isNaN(numKey)) {
          lookup.set(`num_${numKey}`, { thickness, rawVal: r[thicknessCol], fileRowNumber: idx + 1 });
        }
      }
    });

    return uniqueStations.map((stn) => {
      const sKey = String(stn.stationId).trim();
      const numKey = parseFloat(sKey);
      const match =
        lookup.get(sKey) ||
        (!Number.isNaN(numKey) ? lookup.get(`num_${numKey}`) : null);

      return {
        stationId: stn.stationId,
        dmi: stn.dmi,
        fileRowNumber: match ? match.fileRowNumber : null,
        rawFileValue: match ? match.rawVal : null,
        thickness: match ? match.thickness : null,
        isMeasured: match ? match.thickness !== null : false,
      };
    });
  }

  // Default: Corresponding sequential station order (Row-by-Row)
  return uniqueStations.map((stn, idx) => {
    const fileRow = fileRows[idx] ?? null;
    const rawVal = fileRow ? fileRow[thicknessCol] : null;
    const thickness = cleanThicknessValue(rawVal);

    return {
      stationId: stn.stationId,
      dmi: stn.dmi,
      fileRowNumber: idx + 1,
      rawFileValue: rawVal,
      thickness,
      isMeasured: thickness !== null,
    };
  });
}

/**
 * Computes summary statistics from matched stations.
 */
export function computeThicknessStats(matchedList) {
  if (!matchedList || matchedList.length === 0) {
    return {
      totalStations: 0,
      measuredCount: 0,
      emptyCount: 0,
      mean: null,
      min: null,
      max: null,
    };
  }

  const measured = matchedList.filter((m) => m.thickness !== null && m.thickness > 0);
  const values = measured.map((m) => m.thickness);

  const totalStations = matchedList.length;
  const measuredCount = values.length;
  const emptyCount = totalStations - measuredCount;

  if (values.length === 0) {
    return {
      totalStations,
      measuredCount: 0,
      emptyCount,
      mean: null,
      min: null,
      max: null,
    };
  }

  const sum = values.reduce((acc, v) => acc + v, 0);
  const mean = Math.round((sum / values.length) * 100) / 100;
  const min = Math.min(...values);
  const max = Math.max(...values);

  return {
    totalStations,
    measuredCount,
    emptyCount,
    mean,
    min,
    max,
  };
}

/**
 * Applies matched thicknesses to all section rows.
 * Guarantees row.Thickness is either a valid positive number or null (never NaN).
 */
export function applyThicknessToSectionRows(rows, matchedList) {
  if (!rows || rows.length === 0) return [];
  if (!matchedList || matchedList.length === 0) return rows;

  const stationMap = new Map();
  matchedList.forEach((m) => {
    stationMap.set(String(m.stationId), m.thickness);
  });

  return rows.map((row) => {
    const sId = String(row.StationID ?? row.stationId ?? row.stationid ?? row.Station ?? "");
    const matchedThickness = stationMap.has(sId) ? stationMap.get(sId) : null;

    return {
      ...row,
      Thickness: matchedThickness !== null && Number.isFinite(matchedThickness) ? matchedThickness : null,
    };
  });
}

/**
 * Inserts "Thickness" into the columns list right before D1 or after Stress.
 */
export function insertThicknessColumn(columns) {
  if (!columns || columns.length === 0) return ["Thickness"];
  if (columns.includes("Thickness")) return [...columns];

  const nextCols = [...columns];
  const d1Idx = nextCols.findIndex((c) => c === "D1" || c.toLowerCase() === "d1");
  if (d1Idx >= 0) {
    nextCols.splice(d1Idx, 0, "Thickness");
    return nextCols;
  }

  const stressIdx = nextCols.findIndex((c) => c === "Stress" || c.toLowerCase() === "stress");
  if (stressIdx >= 0) {
    nextCols.splice(stressIdx + 1, 0, "Thickness");
    return nextCols;
  }

  const forceIdx = nextCols.findIndex((c) => c === "Force" || c.toLowerCase() === "force");
  if (forceIdx >= 0) {
    nextCols.splice(forceIdx + 1, 0, "Thickness");
    return nextCols;
  }

  nextCols.push("Thickness");
  return nextCols;
}
