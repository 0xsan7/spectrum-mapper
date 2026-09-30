/**
 * CSV and JSON serialisation of a frame plus its history.
 *
 * Kept separate from the HTTP layer so the formatting is unit testable: a
 * mis-quoted field is invisible in a browser download until someone opens the
 * file in a spreadsheet.
 */

/** Quote a value only when it needs it, and escape embedded quotes. */
function csvField(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(values) {
  return values.map(csvField).join(',');
}

/**
 * One row per sample: the time series, plus the tracked transmitter's true and
 * estimated position and the resulting error.
 */
function seriesToCsv(series) {
  const header = csvRow([
    'sample',
    'timestamp',
    'avg_rssi_dbm',
    'max_rssi_dbm',
    'min_rssi_dbm',
    'error_m',
  ]);
  const rows = series.map((s, index) =>
    csvRow([
      index,
      s.timestamp,
      s.avgRSSI,
      s.maxRSSI,
      s.minRSSI,
      s.errorMetres === null || s.errorMetres === undefined
        ? ''
        : s.errorMetres,
    ])
  );
  return [header, ...rows].join('\n');
}

/**
 * One row per grid cell, with the transmitter coordinates that produced it.
 * This is the full spatial dataset, not the aggregate.
 */
function heatmapToCsv(frame) {
  // The header and the rows must agree on order. Rows are built per source as
  // [x, y], so the header has to interleave the same way - grouping all the
  // x columns first silently pairs each cell with the wrong coordinate.
  const header = csvRow([
    'x_m',
    'y_m',
    'rssi_dbm',
    ...frame.sources.flatMap((s) => [`${s.id}_x_m`, `${s.id}_y_m`]),
  ]);

  const rows = frame.heatmap.map((cell) =>
    csvRow([
      cell.x,
      cell.y,
      cell.rssi,
      ...frame.sources.flatMap((s) => [s.x, s.y]),
    ])
  );
  return [header, ...rows].join('\n');
}

/** Per-receiver readings behind the position estimate. */
function readingsToCsv(tracking) {
  if (!tracking)
    return csvRow(['receiver', 'rssi_dbm', 'wall_loss_db', 'range_m']);
  const header = csvRow(['receiver', 'rssi_dbm', 'wall_loss_db', 'range_m']);
  const rows = tracking.readings.map((r) =>
    csvRow([r.id, r.rssi, r.wallLoss, r.range === null ? '' : r.range])
  );
  return [header, ...rows].join('\n');
}

module.exports = { csvField, csvRow, seriesToCsv, heatmapToCsv, readingsToCsv };
