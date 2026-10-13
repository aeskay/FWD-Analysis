/**
 * excelParser.js
 * Parses Excel (.xlsx, .xls) and CSV (.csv) files with smart column auto-matching
 * and interactive mapping for FWD analysis data.
 */
import * as XLSX from "xlsx";

/**
 * Normalizes a column name for fuzzy/flexible matching:
 * Lowercases, strips punctuation, underscores, dashes, spaces, and units in parentheses.
 */
export function cleanColumnName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "") // remove anything in (parentheses) like (mils), (lbs)
    .replace(/[^a-z0-9]/g, "") // remove all non-alphanumeric chars
    .trim();
}

/**
 * Standard FWD target fields schema
 */
export const STANDARD_FIELDS = [
  {
    key: "StationID",
    label: "Station ID",
    required: true,
    category: "required",
    description: "Unique station number or location identifier",
    aliases: ["stationid", "station", "stnid", "stn", "point", "pointid", "testpoint", "location", "loc"],
  },
  {
    key: "D1",
    label: "D1 (Center Sensor)",
    required: true,
    category: "deflections",
    description: "Center deflection at load plate (0 in / 0 mm)",
    aliases: ["d1", "def1", "defl1", "deflection1", "sensor1", "geophone1", "geo1", "s1"],
  },
  {
    key: "D2",
    label: "D2 Sensor",
    required: false,
    category: "deflections",
    description: "Deflection sensor 2 (typically 8 in / 200 mm)",
    aliases: ["d2", "def2", "defl2", "deflection2", "sensor2", "geophone2", "geo2", "s2"],
  },
  {
    key: "D3",
    label: "D3 Sensor",
    required: false,
    category: "deflections",
    description: "Deflection sensor 3 (typically 12 in / 300 mm)",
    aliases: ["d3", "def3", "defl3", "deflection3", "sensor3", "geophone3", "geo3", "s3"],
  },
  {
    key: "D4",
    label: "D4 Sensor",
    required: false,
    category: "deflections",
    description: "Deflection sensor 4 (typically 18 in / 450 mm)",
    aliases: ["d4", "def4", "defl4", "deflection4", "sensor4", "geophone4", "geo4", "s4"],
  },
  {
    key: "D5",
    label: "D5 Sensor",
    required: false,
    category: "deflections",
    description: "Deflection sensor 5 (typically 24 in / 600 mm)",
    aliases: ["d5", "def5", "defl5", "deflection5", "sensor5", "geophone5", "geo5", "s5"],
  },
  {
    key: "D6",
    label: "D6 Sensor",
    required: false,
    category: "deflections",
    description: "Deflection sensor 6 (typically 36 in / 900 mm)",
    aliases: ["d6", "def6", "defl6", "deflection6", "sensor6", "geophone6", "geo6", "s6"],
  },
  {
    key: "D7",
    label: "D7 Sensor",
    required: false,
    category: "deflections",
    description: "Deflection sensor 7 (typically 48 in / 1200 mm)",
    aliases: ["d7", "def7", "defl7", "deflection7", "sensor7", "geophone7", "geo7", "s7"],
  },
  {
    key: "D8",
    label: "D8 Sensor",
    required: false,
    category: "deflections",
    description: "Deflection sensor 8 (typically 60 in / 1500 mm)",
    aliases: ["d8", "def8", "defl8", "deflection8", "sensor8", "geophone8", "geo8", "s8"],
  },
  {
    key: "D9",
    label: "D9 Sensor",
    required: false,
    category: "deflections",
    description: "Deflection sensor 9 (typically 72 in / 1800 mm)",
    aliases: ["d9", "def9", "defl9", "deflection9", "sensor9", "geophone9", "geo9", "s9"],
  },
  {
    key: "Force",
    label: "Force / Load",
    required: false,
    category: "operational",
    description: "Impact load in lbs (defaults to 9,000 lbs if missing)",
    defaultVal: 9000,
    aliases: ["force", "load", "fwdforce", "targetload", "appliedload", "peakload", "impactload"],
  },
  {
    key: "DropID",
    label: "Drop # / Drop ID",
    required: false,
    category: "operational",
    description: "Drop sequence index (defaults to auto-increment)",
    defaultVal: 1,
    aliases: ["dropid", "drop", "dropnum", "seq", "sequence", "dropnumber"],
  },
  {
    key: "DMI",
    label: "DMI / Distance",
    required: false,
    category: "location",
    description: "Distance along roadway in ft or m",
    aliases: ["dmi", "distance", "dist", "stationft", "chainage", "milepost", "mp", "offset"],
  },
  {
    key: "Latitude",
    label: "Latitude",
    required: false,
    category: "location",
    description: "GPS Latitude in decimal degrees",
    aliases: ["latitude", "lat", "gpslat", "y", "northing"],
  },
  {
    key: "Longitude",
    label: "Longitude",
    required: false,
    category: "location",
    description: "GPS Longitude in decimal degrees",
    aliases: ["longitude", "long", "lng", "lon", "gpslon", "gpslng", "x", "easting"],
  },
  {
    key: "DateTime",
    label: "Date / Time",
    required: false,
    category: "operational",
    description: "Test timestamp",
    aliases: ["datetime", "date", "time", "timestamp"],
  },
  {
    key: "Stress",
    label: "Stress",
    required: false,
    category: "operational",
    description: "Peak plate stress in psi or kPa",
    aliases: ["stress", "contactstress", "pressure", "psi", "kpa"],
  },
];

/**
 * Reads a spreadsheet file (XLSX, XLS, or CSV) from an ArrayBuffer
 */
export function readSpreadsheetFile(buffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error("The selected file does not contain any worksheets.");
  }

  const firstSheetName = sheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  if (!worksheet) {
    throw new Error("Could not read sheet from the file.");
  }

  const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: null });
  if (!rawRows || rawRows.length === 0) {
    throw new Error("The sheet contains no data rows.");
  }

  // Extract all distinct headers across rows
  const colSet = new Set();
  rawRows.forEach((r) => {
    Object.keys(r).forEach((k) => {
      if (k && !k.startsWith("__EMPTY")) colSet.add(k.trim());
    });
  });
  const columns = Array.from(colSet);

  return {
    sheetNames,
    activeSheet: firstSheetName,
    columns,
    rows: rawRows,
    rowCount: rawRows.length,
  };
}

/**
 * Smartly auto-matches file columns to standard target fields
 * Returns: { [targetKey]: matchedFileColumnName || "" }
 */
export function autoMatchColumns(availableColumns) {
  const mapping = {};
  const usedColumns = new Set();

  const cleanedCols = availableColumns.map((col) => ({
    original: col,
    cleaned: cleanColumnName(col),
  }));

  // Helper to find best match for a field
  const findMatch = (field) => {
    // 1. Exact cleaned key match (e.g. "stationid" === "stationid")
    const keyClean = cleanColumnName(field.key);
    for (const c of cleanedCols) {
      if (usedColumns.has(c.original)) continue;
      if (c.cleaned === keyClean) {
        return c.original;
      }
    }

    // 2. Exact alias match
    for (const alias of field.aliases) {
      const aliasClean = cleanColumnName(alias);
      for (const c of cleanedCols) {
        if (usedColumns.has(c.original)) continue;
        if (c.cleaned === aliasClean) {
          return c.original;
        }
      }
    }

    // 3. Substring / regex match (e.g. "Sensor 1 (mils)" starts with "sensor1" or contains "d1")
    for (const alias of field.aliases) {
      const aliasClean = cleanColumnName(alias);
      for (const c of cleanedCols) {
        if (usedColumns.has(c.original)) continue;
        if (c.cleaned.startsWith(aliasClean) || (aliasClean.length >= 4 && c.cleaned.includes(aliasClean))) {
          return c.original;
        }
      }
    }

    return "";
  };

  // Match required fields first, then deflections, then operational
  STANDARD_FIELDS.forEach((field) => {
    const matched = findMatch(field);
    mapping[field.key] = matched;
    if (matched) {
      usedColumns.add(matched);
    }
  });

  return mapping;
}

/**
 * Transforms raw spreadsheet rows according to the column mapping.
 * Handles type conversions, auto-drop sequence, default force, and extra columns.
 */
export function transformSpreadsheetData(rawRows, columnMapping, options = {}) {
  const { defaultForce = 9000 } = options;

  // Track sequential StationIDs to auto-generate DropID if not mapped
  const isDropMapped = Boolean(columnMapping["DropID"]);
  const dropCounterMap = new Map();

  const transformedRows = rawRows.map((rawRow, idx) => {
    const row = {};

    // Map standard fields
    STANDARD_FIELDS.forEach((field) => {
      const srcCol = columnMapping[field.key];
      if (srcCol && rawRow[srcCol] !== undefined && rawRow[srcCol] !== null && rawRow[srcCol] !== "") {
        let val = rawRow[srcCol];

        // Parse numerical fields
        if (
          field.key.startsWith("D") ||
          field.key === "Force" ||
          field.key === "Stress" ||
          field.key === "DMI" ||
          field.key === "Latitude" ||
          field.key === "Longitude"
        ) {
          if (typeof val === "string") {
            const parsedNum = parseFloat(val.replace(/,/g, ""));
            val = !isNaN(parsedNum) ? parsedNum : val;
          }
        }
        row[field.key] = val;
      } else if (field.key === "Force" && !columnMapping["Force"]) {
        row["Force"] = defaultForce;
      } else {
        row[field.key] = null;
      }
    });

    // Handle DropID auto-generation if missing
    if (!isDropMapped) {
      const sId = String(row["StationID"] ?? idx + 1);
      const count = dropCounterMap.get(sId) || 0;
      row["DropID"] = count + 1;
      dropCounterMap.set(sId, count + 1);
    } else if (row["DropID"] === null) {
      row["DropID"] = 1;
    }

    // Also preserve any unmapped original columns
    const mappedSources = new Set(Object.values(columnMapping).filter(Boolean));
    Object.keys(rawRow).forEach((origKey) => {
      if (!mappedSources.has(origKey) && row[origKey] === undefined) {
        row[origKey] = rawRow[origKey];
      }
    });

    return row;
  });

  // Collect ordered columns
  const standardKeys = STANDARD_FIELDS.map((f) => f.key);
  const activeStandardCols = standardKeys.filter((k) =>
    transformedRows.some((r) => r[k] !== null && r[k] !== undefined)
  );

  const extraCols = [];
  if (transformedRows.length > 0) {
    Object.keys(transformedRows[0]).forEach((k) => {
      if (!standardKeys.includes(k) && !k.startsWith("_")) {
        extraCols.push(k);
      }
    });
  }

  const finalColumns = [...activeStandardCols, ...extraCols];

  return {
    rows: transformedRows,
    columns: finalColumns,
    rowCount: transformedRows.length,
    preview: transformedRows.slice(0, 5),
  };
}
