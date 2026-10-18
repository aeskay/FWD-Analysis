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
 * Prioritizes thickness in inches if both mm and inches exist.
 */
export function detectThicknessColumn(columns) {
  if (!columns || columns.length === 0) return "";

  // Priority 1: explicitly in inches
  const inchesMatch = columns.find((c) => {
    const lower = c.toLowerCase();
    return (
      (lower.includes("thick") || lower.includes("slab") || lower.includes("h_") || lower.includes("depth")) &&
      (lower.includes("(in") || lower.includes("inch") || lower.includes("_in") || lower.endsWith(" in"))
    );
  });
  if (inchesMatch) return inchesMatch;

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
 * Auto-detects the column most likely to contain DMI / Distance values.
 */
export function detectDmiColumn(columns) {
  if (!columns || columns.length === 0) return "";

  const priorityKeywords = [
    "dmift",
    "dmi",
    "distanceft",
    "distance",
    "distft",
    "dist",
    "stationdmi",
    "stationdistance",
    "chainage",
    "offset",
  ];

  for (const kw of priorityKeywords) {
    const found = columns.find((c) => {
      const clean = cleanHeaderName(c);
      return clean === kw || clean.startsWith(kw) || clean.includes(kw);
    });
    if (found) return found;
  }

  return "";
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
 * Helper to extract DMI value from a section data row.
 */
export function extractRowDmi(row) {
  if (!row) return null;
  const candidates = [
    "DMI",
    "dmi",
    "Dmi",
    "DMI (ft)",
    "DMI(ft)",
    "Distance",
    "distance",
    "DISTANCE",
    "dist",
    "STATION",
    "Station",
    "station",
  ];
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      const num = typeof row[key] === "number" ? row[key] : parseFloat(row[key]);
      if (!isNaN(num) && Number.isFinite(num)) {
        return Math.round(num);
      }
    }
  }
  return null;
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
      const dmi = extractRowDmi(r);
      stationsMap.set(key, {
        stationId: sId,
        dmi,
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
 * @param {string} method - 'dmi' (by DMI distance), 'order' (corresponding sequential order), or 'station' (by station ID)
 * @param {string} dmiCol - optional DMI column in file
 */
export function matchThicknessToStations(
  uniqueStations,
  fileRows,
  thicknessCol,
  stationCol = "",
  method = "dmi",
  dmiCol = ""
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
      hasFileRow: false,
      isMissingInFile: false,
    }));
  }

  // 1. Match by DMI (Distance)
  if (method === "dmi" && dmiCol) {
    const fileDmiMap = new Map();
    const fileDmiList = [];

    fileRows.forEach((r, idx) => {
      const rawDmi = r[dmiCol];
      if (rawDmi !== null && rawDmi !== undefined && String(rawDmi).trim() !== "") {
        const cleanedStr = String(rawDmi).replace(/[^0-9.-]/g, "").trim();
        const parsedDmi = parseFloat(cleanedStr);
        if (!Number.isNaN(parsedDmi) && Number.isFinite(parsedDmi)) {
          const thickness = cleanThicknessValue(r[thicknessCol]);
          const entry = {
            dmi: parsedDmi,
            roundedDmi: Math.round(parsedDmi),
            thickness,
            rawVal: r[thicknessCol],
            rawDmi,
            fileRowNumber: idx + 1,
          };
          fileDmiList.push(entry);

          const intKey = Math.round(parsedDmi);
          if (!fileDmiMap.has(intKey)) {
            fileDmiMap.set(intKey, entry);
          }
          if (!fileDmiMap.has(String(parsedDmi))) {
            fileDmiMap.set(String(parsedDmi), entry);
          }
        }
      }
    });

    return uniqueStations.map((stn) => {
      let targetDmi = null;
      if (stn.dmi !== null && stn.dmi !== undefined) {
        const num = typeof stn.dmi === "number" ? stn.dmi : parseFloat(stn.dmi);
        if (!Number.isNaN(num) && Number.isFinite(num)) {
          targetDmi = num;
        }
      }
      if (targetDmi === null && stn.stationId !== null && stn.stationId !== undefined) {
        const num = parseFloat(String(stn.stationId).replace(/[^0-9.-]/g, ""));
        if (!Number.isNaN(num) && Number.isFinite(num)) {
          targetDmi = num;
        }
      }

      let match = null;
      if (targetDmi !== null) {
        const roundedTarget = Math.round(targetDmi);
        if (fileDmiMap.has(roundedTarget)) {
          match = fileDmiMap.get(roundedTarget);
        } else if (fileDmiMap.has(String(targetDmi))) {
          match = fileDmiMap.get(String(targetDmi));
        } else {
          // Tolerance match within ±5 ft
          const tolerance = 5;
          let bestDiff = Infinity;
          for (const item of fileDmiList) {
            const diff = Math.abs(item.dmi - targetDmi);
            if (diff <= tolerance && diff < bestDiff) {
              bestDiff = diff;
              match = item;
            }
          }
        }
      }

      return {
        stationId: stn.stationId,
        dmi: stn.dmi != null ? stn.dmi : targetDmi,
        fileRowNumber: match ? match.fileRowNumber : null,
        rawFileValue: match ? match.rawVal : null,
        thickness: match ? match.thickness : null,
        isMeasured: match ? match.thickness !== null : false,
        hasFileRow: !!match,
        isMissingInFile: !match,
      };
    });
  }

  // 2. Match by Station ID Column
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
        hasFileRow: !!match,
        isMissingInFile: !match,
      };
    });
  }

  // 3. Default: Corresponding sequential station order (Row-by-Row)
  return uniqueStations.map((stn, idx) => {
    const fileRow = fileRows[idx] ?? null;
    const rawVal = fileRow ? fileRow[thicknessCol] : null;
    const thickness = cleanThicknessValue(rawVal);

    return {
      stationId: stn.stationId,
      dmi: stn.dmi,
      fileRowNumber: fileRow ? idx + 1 : null,
      rawFileValue: rawVal,
      thickness,
      isMeasured: thickness !== null,
      hasFileRow: !!fileRow,
      isMissingInFile: !fileRow,
    };
  });
}

/**
 * Extracts extra rows from the file that exceed the total count of section stations.
 */
export function getExtraFileRows(fileRows, uniqueStationsCount, thicknessCol) {
  if (!fileRows || fileRows.length <= uniqueStationsCount) return [];
  return fileRows.slice(uniqueStationsCount).map((r, idx) => {
    const rawVal = r ? r[thicknessCol] : null;
    return {
      fileRowNumber: uniqueStationsCount + idx + 1,
      rawFileValue: rawVal,
      thickness: cleanThicknessValue(rawVal),
    };
  });
}

/**
 * Diagnoses discrepancies between file rows and section stations.
 */
export function diagnoseRowMismatch({
  totalStations,
  fileRowCount,
  matchingMethod,
  matchedList = [],
  stationCol = "",
  dmiCol = "",
}) {
  const diff = fileRowCount - totalStations;

  if (matchingMethod === "dmi") {
    const missingStations = matchedList.filter((m) => m.isMissingInFile || !m.hasFileRow);
    const matchedCount = matchedList.length - missingStations.length;
    const mappedRowSet = new Set(matchedList.map((m) => m.fileRowNumber).filter(Boolean));
    const unmappedFileRowsCount = Math.max(0, fileRowCount - mappedRowSet.size);

    if (missingStations.length > 0 || unmappedFileRowsCount > 0) {
      return {
        hasMismatch: true,
        type: "dmi_mismatch",
        difference: missingStations.length > 0 ? -missingStations.length : unmappedFileRowsCount,
        missingCount: missingStations.length,
        extraCount: unmappedFileRowsCount,
        severity: "warning",
        title: `DMI Matching: ${missingStations.length} Missing Station${missingStations.length === 1 ? "" : "s"}`,
        message: `${missingStations.length > 0 ? `${missingStations.length} of ${totalStations} section stations have no matching DMI in the file and are highlighted in red below (they will remain empty). ` : ""}${unmappedFileRowsCount > 0 ? `${unmappedFileRowsCount} file row${unmappedFileRowsCount === 1 ? "" : "s"} did not match any section station DMI.` : ""}`,
        details: `Successfully matched ${matchedCount} of ${totalStations} stations by DMI (using column "${dmiCol || "DMI"}"). Missing stations are highlighted in RED in the table below.`,
      };
    }

    return {
      hasMismatch: false,
      type: "exact",
      difference: 0,
      missingCount: 0,
      extraCount: 0,
      severity: "success",
      title: "All Stations Matched by DMI",
      message: `All ${totalStations} stations successfully matched by DMI with no missing stations!`,
      details: null,
    };
  }

  if (matchingMethod === "order") {
    if (diff === 0) {
      return {
        hasMismatch: false,
        type: "exact",
        difference: 0,
        missingCount: 0,
        extraCount: 0,
        severity: "success",
        title: "Exact Count Match",
        message: `Perfect match: Exactly ${fileRowCount} rows in the file corresponding to all ${totalStations} stations in this section.`,
        details: null,
      };
    }

    if (diff < 0) {
      const missingCount = Math.abs(diff);
      return {
        hasMismatch: true,
        type: "fewer_rows",
        difference: diff,
        missingCount,
        extraCount: 0,
        severity: "warning",
        title: `Row Count Mismatch (${missingCount} fewer rows)`,
        message: `The imported file has ${fileRowCount} rows, but this section has ${totalStations} stations. The last ${missingCount} station${missingCount === 1 ? "" : "s"} (Stations ${fileRowCount + 1} to ${totalStations}) have no corresponding row in the file and will remain empty (—).`,
        details: `File rows 1–${fileRowCount} matched to Stations 1–${fileRowCount}. Stations ${fileRowCount + 1}–${totalStations} have no file data.`,
      };
    }

    // diff > 0
    const extraCount = diff;
    return {
      hasMismatch: true,
      type: "extra_rows",
      difference: diff,
      missingCount: 0,
      extraCount,
      severity: "warning",
      title: `Row Count Mismatch (${extraCount} extra rows)`,
      message: `The imported file has ${fileRowCount} rows, but this section only has ${totalStations} stations. The first ${totalStations} rows are matched to Stations 1–${totalStations}. The last ${extraCount} file row${extraCount === 1 ? "" : "s"} (Rows ${totalStations + 1} to ${fileRowCount}) will be ignored.`,
      details: `Rows 1–${totalStations} matched to Section Stations 1–${totalStations}. File rows ${totalStations + 1}–${fileRowCount} exceed section stations and will not be applied.`,
    };
  } else {
    // Station ID column matching
    const unmappedStations = matchedList.filter((m) => m.fileRowNumber == null);
    const mappedRowSet = new Set(matchedList.map((m) => m.fileRowNumber).filter(Boolean));
    const unmappedFileRowsCount = Math.max(0, fileRowCount - mappedRowSet.size);

    if (unmappedStations.length > 0 || unmappedFileRowsCount > 0) {
      return {
        hasMismatch: true,
        type: "station_id_mismatch",
        difference: diff,
        missingCount: unmappedStations.length,
        extraCount: unmappedFileRowsCount,
        severity: "warning",
        title: "Station ID Mapping Discrepancy",
        message: `${unmappedStations.length > 0 ? `${unmappedStations.length} of ${totalStations} section stations could not be found in the file and will remain empty (—). ` : ""}${unmappedFileRowsCount > 0 ? `${unmappedFileRowsCount} row${unmappedFileRowsCount === 1 ? "" : "s"} in the file did not match any section station.` : ""}`,
        details: `Matched ${totalStations - unmappedStations.length} of ${totalStations} stations using column "${stationCol || "StationID"}".`,
      };
    }

    return {
      hasMismatch: false,
      type: "exact",
      difference: 0,
      missingCount: 0,
      extraCount: 0,
      severity: "success",
      title: "All Stations Matched",
      message: `All ${totalStations} stations successfully matched by Station ID.`,
      details: null,
    };
  }
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
