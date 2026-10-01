const { loadEnv, numEnv } = require('./env');

loadEnv();

const CONFIG = {
  ROOM_WIDTH: numEnv('ROOM_WIDTH', 20),
  ROOM_HEIGHT: numEnv('ROOM_HEIGHT', 15),
  GRID_RESOLUTION: numEnv('GRID_RESOLUTION', 1),
  UPDATE_RATE: numEnv('UPDATE_RATE', 500),
  HISTORY_CAPACITY: numEnv('HISTORY_CAPACITY', 240),
  MIN_RSSI: numEnv('MIN_RSSI', -100),
  MAX_RSSI: numEnv('MAX_RSSI', -20),

  // A cell counts as a hotspot above this RSSI. Kept here so the threshold is
  // not a magic number buried in the heatmap code.
  HOTSPOT_THRESHOLD: numEnv('HOTSPOT_THRESHOLD', -40),
  PORT: numEnv('PORT', 3000),
  HOST: process.env.HOST || '127.0.0.1',

  // Optional shared secret for the reading endpoints. Empty means open. A
  // local deployment has no reason to set one; a public one does, because
  // without it anyone can overwrite the measured map.
  READINGS_TOKEN: process.env.READINGS_TOKEN || '',

  // Public demo hardening. Off by default, so a local install behaves exactly as
  // before and nothing here changes the single-user case.
  DEMO_MODE: process.env.DEMO_MODE === '1',
  // Commands per second, per client, in demo mode.
  DEMO_RATE_LIMIT: numEnv('DEMO_RATE_LIMIT', 20),
  DEMO_MAX_CLIENTS: numEnv('DEMO_MAX_CLIENTS', 50),
  // Empty means no Origin check. Set it to a comma-separated allowlist in front
  // of a hosted copy so a page on another site cannot drive the socket.
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // Reset the room after this long with no commands, so the next visitor gets
  // the defaults rather than whatever the last one left behind.
  DEMO_IDLE_RESET_MS: numEnv('DEMO_IDLE_RESET_MS', 10 * 60 * 1000),
};

const RF_SOURCES = [
  { id: 'TX-1', name: 'Router A', txPower: 20, x: 2, y: 13, vx: 0, vy: 0 },
  { id: 'TX-2', name: 'Router B', txPower: 15, x: 18, y: 13, vx: 0, vy: 0 },
  {
    id: 'TX-3',
    name: 'Mobile Device',
    txPower: 10,
    x: 10,
    y: 7,
    vx: 0.15,
    vy: 0.1,
  },
  {
    id: 'TX-4',
    name: 'BLE Beacon',
    txPower: 5,
    x: 5,
    y: 5,
    vx: 0.08,
    vy: -0.12,
  },
];

const RECEIVER_NODES = [
  { id: 'RX-1', x: 2, y: 2 },
  { id: 'RX-2', x: 18, y: 2 },
  { id: 'RX-3', x: 10, y: 13 },
  { id: 'RX-4', x: 10, y: 2 },
];

module.exports = { CONFIG, RF_SOURCES, RECEIVER_NODES };
