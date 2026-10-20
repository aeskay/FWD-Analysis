/**
 * normalization.js
 * Utilities for assigning drop variant letters (A, B, C, ...) to rows
 * and computing 9,000 lbs normalized deflections.
 */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Returns letter representation for 0-indexed position (0 -> 'A', 1 -> 'B', etc.)
 */
export function getVariantLetter(index) {
  if (index < LETTERS.length) return LETTERS[index];
  return `V${index + 1}`;
}

/**
 * Group rows by StationID and assign a variant letter to each row
 * based on its drop index within that StationID.
 * 
 * Returns: {
 *   taggedRows: row with _variantLetter attached,
 *   availableVariants: ['A', 'B', ...] list of variant letters found
 * }
 */
export function assignVariants(rows) {
  if (!rows || rows.length === 0) {
    return { taggedRows: [], availableVariants: [] };
  }

  // Count occurrence index of each stationId encountered
  const stationCounters = new Map();
  let maxCount = 0;

  const taggedRows = rows.map((row, idx) => {
    const sId = row["StationID"] ?? "unknown";
    const currentCount = stationCounters.get(sId) || 0;
    const letter = getVariantLetter(currentCount);
    stationCounters.set(sId, currentCount + 1);

    if (currentCount + 1 > maxCount) {
      maxCount = currentCount + 1;
    }

    return {
      ...row,
      _variantLetter: letter,
      _rowIndex: idx,
    };
  });

  const availableVariants = [];
  for (let i = 0; i < maxCount; i++) {
    availableVariants.push(getVariantLetter(i));
  }

  return { taggedRows, availableVariants };
}

/**
 * Computes normalized deflection: D_norm = D * (targetLoad / Force)
 * Default targetLoad = 9000 lbs
 */
export function normalizeRows(rows, targetLoad = 9000) {
  const DEFLECTION_RE = /^D\d+$/;

  return rows.map((row) => {
    const force = typeof row.Force === "number" ? row.Force : parseFloat(row.Force);
    const validForce = !isNaN(force) && force > 0;

    const normRow = { ...row };

    // Update deflection columns to normalized values
    Object.keys(row).forEach((col) => {
      if (DEFLECTION_RE.test(col)) {
        const dVal = typeof row[col] === "number" ? row[col] : parseFloat(row[col]);
        if (!isNaN(dVal) && validForce) {
          // Normalization formula
          normRow[col] = (dVal * (targetLoad / force));
        } else {
          normRow[col] = row[col];
        }
      }
    });

    // Also record the normalization target
    normRow._normalizedTo = targetLoad;

    return normRow;
  });
}
