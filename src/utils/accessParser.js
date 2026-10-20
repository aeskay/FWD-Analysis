/**
 * accessParser.js
 * Parses a Microsoft Access (.mdb/.accdb) file and merges the Drops and
 * Stations tables into a single masterfile, excluding all-zero/all-null cols.
 */
import MDBReader from "mdb-reader";
import { Buffer } from "buffer";

/**
 * Returns true if a column's values are all zero, null, undefined, or "".
 */
function isColumnEmpty(rows, col) {
  return rows.every((row) => {
    const v = row[col];
    return v === null || v === undefined || v === "" || v === 0 || v === 0.0;
  });
}

/**
 * Parse an ArrayBuffer / Buffer of an .mdb/.accdb file.
 * Returns { mergedRows, columns, dropsColumns, stationsColumns, preview }
 */
export async function parseAccessFile(rawInput) {
  // mdb-reader requires a Node-style Buffer (it accesses buffer[0], buffer.readUInt16LE, etc.)
  const buffer = Buffer.isBuffer(rawInput) ? rawInput : Buffer.from(rawInput);
  const reader = new MDBReader(buffer);
  const tableNames = reader.getTableNames({ normalTables: true });

  // Find Drops and Stations tables (case-insensitive)
  const dropsName = tableNames.find((t) => t.toLowerCase() === "drops");
  const stationsName = tableNames.find((t) => t.toLowerCase() === "stations");

  if (!dropsName) throw new Error('Could not find a "Drops" table in this file.');
  if (!stationsName) throw new Error('Could not find a "Stations" table in this file.');

  const dropsTable = reader.getTable(dropsName);
  const stationsTable = reader.getTable(stationsName);

  const dropsRows = dropsTable.getData();
  const stationsRows = stationsTable.getData();

  // Build a map of StationID → station row for O(1) lookup
  const stationMap = new Map();
  stationsRows.forEach((row) => {
    const key = row["StationID"] ?? row["stationid"];
    if (key !== undefined && !stationMap.has(key)) {
      stationMap.set(key, row);
    }
  });

  // Identify which Drops columns are non-empty
  const dropsColNames = dropsTable.getColumnNames();
  const activeDropsCols = dropsColNames.filter(
    (col) => !isColumnEmpty(dropsRows, col)
  );

  // Identify which Stations columns are non-empty and not already in Drops
  const stationsColNames = stationsTable.getColumnNames();
  const dropsColSet = new Set(activeDropsCols.map((c) => c.toLowerCase()));
  const activeStationsCols = stationsColNames.filter((col) => {
    if (dropsColSet.has(col.toLowerCase())) return false; // skip duplicates
    return !isColumnEmpty(stationsRows, col);
  });

  // Build merged rows
  const mergedRows = dropsRows.map((drop) => {
    const stationId = drop["StationID"] ?? drop["stationid"];
    const station = stationMap.get(stationId) ?? {};

    const row = {};
    activeDropsCols.forEach((col) => {
      row[col] = drop[col] ?? null;
    });
    activeStationsCols.forEach((col) => {
      row[col] = station[col] ?? null;
    });
    return row;
  });

  // Final column order: priority cols first, then the rest
  const PRIORITY = [
    "StationID","DropID","DateTime","Force","Stress","Thickness",
    "D1","D2","D3","D4","D5","D6","D7","D8","D9","D10",
    "D11","D12","D13","D14","D15",
  ];

  const allCols = [...activeDropsCols, ...activeStationsCols];
  const priorityCols = PRIORITY.filter((p) =>
    allCols.some((c) => c === p)
  );
  const remainingCols = allCols.filter(
    (c) => !PRIORITY.includes(c)
  );
  const orderedColumns = [...priorityCols, ...remainingCols];

  return {
    rows: mergedRows,
    columns: orderedColumns,
    rowCount: mergedRows.length,
    preview: mergedRows.slice(0, 5),
  };
}
