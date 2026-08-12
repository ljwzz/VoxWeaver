export const STARTUP_WINDOW_CONFIG = Object.freeze({
  width: 700,
  height: 450,
  resizable: false,
  maximizable: false,
  fullscreenable: false,
} as const);

export const PROJECT_WINDOW_CONFIG = Object.freeze({
  width: 1440,
  height: 900,
  minWidth: 840,
  minHeight: 560,
} as const);
