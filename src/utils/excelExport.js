/**
 * excelExport.js
 * Exports section masterfile data to Excel using SheetJS (xlsx).
 * Sheet 1: Raw Data
 * Sheet 2: Normalized Data (if provided)
 */
import * as XLSX from "xlsx";

/**
 * Creates an XLSX worksheet from columns and rows.
 */
function createSheet(columns, rows) {
  const header = columns;
  const data = [
    header,
    ...rows.map((row) =>
      header.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return "";
        return val;
      })
    ),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(data);

  // Auto width heuristic
  worksheet["!cols"] = header.map((col) => ({
    wch: Math.max(col.length, 10),
  }));

  // Freeze top row
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };

  return worksheet;
}

/**
 * @param {string[]} rawColumns - ordered column names for raw data
 * @param {object[]} rawRows    - array of raw row objects
 * @param {string}   filename   - output filename (without extension)
 * @param {object}   [normalizedData] - optional { columns, rows, targetLoad, selectedVariant }
 */
export function exportToExcel(rawColumns, rawRows, filename = "fwd_masterfile", normalizedData = null) {
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Raw Data
  const rawSheet = createSheet(rawColumns, rawRows);
  XLSX.utils.book_append_sheet(workbook, rawSheet, "Raw Data");

  // Sheet 2: Normalized (if available)
  if (normalizedData && normalizedData.rows && normalizedData.rows.length > 0) {
    const normSheet = createSheet(normalizedData.columns, normalizedData.rows);
    XLSX.utils.book_append_sheet(workbook, normSheet, "Normalized");
  }

  XLSX.writeFile(workbook, `${filename}.xlsx`);
}
