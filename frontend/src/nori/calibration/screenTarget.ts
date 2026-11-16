/** Physical geometry contract for nori_ws#52. Only the ruler check establishes screen scale. */
export const TARGET_PATH = "/nori/calibration-target";
export const PROFILE_STORAGE_KEY = "nori:screen-target-profile:v1";
export const REFERENCE_MM = 40;
// Generic starting line length only; this is not a physical screen measurement.
export const INITIAL_SCREEN_SCALE = 96 / 25.4;
export const INNER_COLUMNS = 9;
export const INNER_ROWS = 7;
export const SQUARE_COLUMNS = INNER_COLUMNS + 1;
export const SQUARE_ROWS = INNER_ROWS + 1;
export const BORDER_SQUARES = 1;
export const VIEW_MARGIN_PX = 16;
export const TARGET_VALUES_HEIGHT_PX = 72;
export interface GridSize { columns: number; rows: number }
const DEFAULT_GRID: GridSize = { columns: INNER_COLUMNS, rows: INNER_ROWS };

export type CameraRole = "front" | "overhead";

export interface ScreenEnvironment {
  screenWidth: number;
  screenHeight: number;
  dpr: number;
  zoom: number;
  orientation: string;
}

export interface VerifiedScreenProfile {
  version: 1;
  cssPixelsPerMm: number;
  verifiedAt: string;
  environment: ScreenEnvironment;
}

export function isTargetPath(path: string): boolean {
  return path.replace(/\/+$/, "") === TARGET_PATH;
}

export function validEnvironment(e: ScreenEnvironment): boolean {
  return !!e && [e.screenWidth, e.screenHeight, e.dpr, e.zoom].every(n => Number.isFinite(n) && n > 0)
    && typeof e.orientation === "string" && e.orientation.length > 0;
}

export function sameEnvironment(a: ScreenEnvironment, b: ScreenEnvironment): boolean {
  return validEnvironment(a) && validEnvironment(b)
    && a.screenWidth === b.screenWidth && a.screenHeight === b.screenHeight
    && Math.abs(a.dpr - b.dpr) < 0.0001 && Math.abs(a.zoom - b.zoom) < 0.005
    && a.orientation === b.orientation;
}

export function readSavedProfile(raw: string | null, environment: ScreenEnvironment): VerifiedScreenProfile | null {
  try {
    const p = JSON.parse(raw ?? "null") as VerifiedScreenProfile | null;
    if (!p || p.version !== 1
      || !Number.isFinite(p.cssPixelsPerMm) || p.cssPixelsPerMm < 1 || p.cssPixelsPerMm > 30
      || typeof p.verifiedAt !== "string" || !Number.isFinite(Date.parse(p.verifiedAt))
      || !sameEnvironment(p.environment, environment)) return null;
    // Keep existing ruler measurements, without retaining legacy phone-model labels.
    return { version: 1, cssPixelsPerMm: p.cssPixelsPerMm, verifiedAt: p.verifiedAt, environment: p.environment };
  } catch { return null; }
}

export function boardGeometry(requestedSquareMm: number, scale: number, dpr: number, grid: GridSize = DEFAULT_GRID) {
  if (![requestedSquareMm, scale, dpr].every(n => Number.isFinite(n) && n > 0)
    || requestedSquareMm > 20 || scale > 30 || dpr > 16) throw new Error("Invalid screen target dimensions");
  if (![grid.columns, grid.rows].every(n => Number.isInteger(n) && n >= 3 && n <= 100))
    throw new Error("Invalid checkerboard corner counts");
  // One whole number of backing pixels per cell, identical on X/Y. Never stretch to fit.
  const squareDevicePixels = Math.max(1, Math.round(requestedSquareMm * scale * dpr));
  const squareCssPixels = squareDevicePixels / dpr;
  const actualSquareMm = squareCssPixels / scale;
  const squareColumns = grid.columns + 1, squareRows = grid.rows + 1;
  const outerColumns = squareColumns + 2 * BORDER_SQUARES;
  const outerRows = squareRows + 2 * BORDER_SQUARES;
  return {
    innerColumns: grid.columns, innerRows: grid.rows, squareColumns, squareRows, outerColumns, outerRows,
    squareDevicePixels, squareCssPixels, actualSquareMm,
    widthDevicePixels: outerColumns * squareDevicePixels,
    heightDevicePixels: outerRows * squareDevicePixels,
    widthCssPixels: outerColumns * squareCssPixels,
    heightCssPixels: outerRows * squareCssPixels,
    outerWidthMm: outerColumns * actualSquareMm,
    outerHeightMm: outerRows * actualSquareMm,
  };
}
export type BoardGeometry = ReturnType<typeof boardGeometry>;

/** Fill available space by adding whole cells. Freeze this geometry for each display run. */
export function fitBoardGeometry(requestedSquareMm: number, scale: number, dpr: number, width: number, height: number): BoardGeometry | null {
  const cell = boardGeometry(requestedSquareMm, scale, dpr).squareCssPixels;
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) return null;
  let columns = Math.min(60, Math.floor((width - 2 * VIEW_MARGIN_PX) / cell) - 2 * BORDER_SQUARES);
  let rows = Math.min(60, Math.floor((height - 2 * VIEW_MARGIN_PX) / cell) - 2 * BORDER_SQUARES);
  if (columns < 4 || rows < 4) return null;
  // Opposite parity gives distinguishable board axes without shrinking the square edge.
  if (columns % 2 === rows % 2) {
    if (rows > 4) rows--; else columns--;
  }
  if (columns < 4 || rows < 4) return null;
  const g = boardGeometry(requestedSquareMm, scale, dpr, { columns: columns - 1, rows: rows - 1 });
  return boardFits(g, width, height) ? g : null;
}

/** The coordinate is a backing-pixel cell, including the uninterrupted outer white border. */
export function blackCell(column: number, row: number, grid: GridSize = DEFAULT_GRID): boolean {
  return column >= BORDER_SQUARES && column < BORDER_SQUARES + grid.columns + 1
    && row >= BORDER_SQUARES && row < BORDER_SQUARES + grid.rows + 1
    && (column + row) % 2 === 0;
}

export function boardFits(g: BoardGeometry, width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height)
    && g.widthCssPixels + 2 * VIEW_MARGIN_PX <= width && g.heightCssPixels + 2 * VIEW_MARGIN_PX <= height;
}

export function targetManifest(profile: VerifiedScreenProfile, requestedSquareMm: number, role: CameraRole,
  environment: ScreenEnvironment, targetId: string, grid: GridSize = DEFAULT_GRID) {
  if (!readSavedProfile(JSON.stringify(profile), environment) || Math.abs(environment.zoom - 1) >= 0.005)
    throw new Error("Verify screen size at normal zoom before exporting a target");
  if (role !== "front" && role !== "overhead") throw new Error("Unsupported camera role");
  const g = boardGeometry(requestedSquareMm, profile.cssPixelsPerMm, environment.dpr, grid);
  return {
    schema_version: 1,
    artifact_type: "nori_screen_checkerboard",
    target_id: targetId,
    camera_role: role,
    pattern: "checkerboard",
    inner_corners: { columns: g.innerColumns, rows: g.innerRows },
    squares: { columns: g.squareColumns, rows: g.squareRows },
    border_squares: BORDER_SQUARES,
    square_size_m: g.actualSquareMm / 1000,
    requested_square_size_m: requestedSquareMm / 1000,
    pattern_size_m: { width: g.squareColumns * g.actualSquareMm / 1000, height: g.squareRows * g.actualSquareMm / 1000 },
    outer_size_m: { width: g.outerWidthMm / 1000, height: g.outerHeightMm / 1000 },
    render: { square_device_pixels: g.squareDevicePixels, canvas_width: g.widthDevicePixels, canvas_height: g.heightDevicePixels },
    screen: {
      css_pixels_per_mm: profile.cssPixelsPerMm,
      verified_at: profile.verifiedAt,
      verification: { method: "operator_ruler_check", horizontal_mm: REFERENCE_MM, vertical_mm: REFERENCE_MM },
      environment,
    },
    status: "target_only_camera_calibration_not_performed",
  };
}

export function calibrationToolValues(manifest: ReturnType<typeof targetManifest>) {
  const size = `${manifest.inner_corners.columns}x${manifest.inner_corners.rows}`;
  const square = String(manifest.square_size_m);
  return {
    size, square,
    defaultCameraName: `${manifest.camera_role}_camera`,
    imageTopic: `/camera/${manifest.camera_role}/image_decoded`,
    boardArguments: `--size ${size} --square ${square}`,
  };
}
