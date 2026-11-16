import { describe, expect, it } from "vitest";
import {
  blackCell, boardFits, boardGeometry, calibrationToolValues, fitBoardGeometry, INITIAL_SCREEN_SCALE, isTargetPath, readSavedProfile,
  sameEnvironment, targetManifest, TARGET_VALUES_HEIGHT_PX, type ScreenEnvironment, type VerifiedScreenProfile,
} from "./screenTarget";

const environment: ScreenEnvironment = { screenWidth: 915, screenHeight: 412, dpr: 2.625, zoom: 1, orientation: "landscape-primary" };
const profile: VerifiedScreenProfile = {
  version: 1, cssPixelsPerMm: 6.2,
  environment, verifiedAt: "2026-11-13T12:00:00Z",
};

describe("screen checkerboard physical geometry", () => {
  it("requires ruler verification rather than a phone model or generic starting scale", () => {
    expect(readSavedProfile(JSON.stringify({ cssPixelsPerMm: INITIAL_SCREEN_SCALE, environment }), environment)).toBeNull();
    expect(readSavedProfile(JSON.stringify({ phone: "pixel-6" }), environment)).toBeNull();
    expect(readSavedProfile(JSON.stringify(profile), environment)).toEqual(profile);
  });
  it("retains legacy ruler measurements without carrying a phone-model claim into new records", () => {
    const restored = readSavedProfile(JSON.stringify({ ...profile, phone: "pixel-6" }), environment)!;
    expect(restored).toEqual(profile);
    expect(restored).not.toHaveProperty("phone");
    expect(targetManifest(restored, 6, "overhead", environment, "generic-target").screen).not.toHaveProperty("phone_profile");
  });
  it("exports the actual rounded cell spacing, in metres, rather than requested spacing", () => {
    const g = boardGeometry(5, profile.cssPixelsPerMm, environment.dpr);
    const m = targetManifest(profile, 5, "overhead", environment, "test-target");
    expect(Number.isInteger(g.squareDevicePixels)).toBe(true);
    expect(g.widthDevicePixels).toBe(g.squareDevicePixels * 12);
    expect(g.heightDevicePixels).toBe(g.squareDevicePixels * 10);
    expect(m.square_size_m).toBe(g.squareDevicePixels / environment.dpr / profile.cssPixelsPerMm / 1000);
    expect(m.square_size_m).not.toBe(m.requested_square_size_m);
    expect(m.inner_corners).toEqual({ columns: 9, rows: 7 });
    expect(m.status).toBe("target_only_camera_calibration_not_performed");
  });
  it("contains ten by eight alternating squares and a complete white border", () => {
    for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) {
      if (x === 0 || y === 0 || x === 11 || y === 9) expect(blackCell(x, y)).toBe(false);
      else { expect(blackCell(x, y)).toBe((x + y) % 2 === 0); }
    }
    expect(blackCell(1, 1)).toBe(true);
  });
  it("rejects stale, corrupt and unsupported saved profiles", () => {
    for (const change of [{ dpr: 3 }, { zoom: 1.1 }, { screenWidth: 412 }, { orientation: "portrait-primary" }]) {
      expect(readSavedProfile(JSON.stringify(profile), { ...environment, ...change })).toBeNull();
    }
    for (const raw of ["oops", "{}", "null", JSON.stringify({ ...profile, cssPixelsPerMm: 0 }), JSON.stringify({ ...profile, version: 2 }), JSON.stringify({ ...profile, verifiedAt: "bad" })]) {
      expect(readSavedProfile(raw, environment)).toBeNull();
    }
  });
  it("does not export a guessed profile or a zoomed target", () => {
    expect(() => targetManifest({ ...profile, verifiedAt: "" }, 5, "front", environment, "id")).toThrow();
    const zoomed = { ...environment, zoom: 1.2 };
    expect(() => targetManifest({ ...profile, environment: zoomed }, 5, "front", zoomed, "id")).toThrow();
  });
  it("never silently shrinks a board to fit a small viewport", () => {
    const g = boardGeometry(6, profile.cssPixelsPerMm, environment.dpr);
    expect(boardFits(g, 915, 200)).toBe(false);
    expect(boardFits(g, 915, 412)).toBe(true);
    expect(boardFits(g, NaN, 412)).toBe(false);
    expect(g.actualSquareMm).toBeGreaterThan(5.9);
  });
  it("rejects non-finite and non-positive physical dimensions", () => {
    for (const n of [0, -1, NaN, Infinity]) expect(() => boardGeometry(n, 6, 2)).toThrow();
    expect(() => boardGeometry(5, 0, 2)).toThrow();
  });
  it("detects physical mapping changes while tolerating floating-point noise", () => {
    expect(sameEnvironment(environment, { ...environment, dpr: 2.625000001 })).toBe(true);
    expect(sameEnvironment(environment, { ...environment, zoom: 1.01 })).toBe(false);
  });
  it("recognizes only the standalone route", () => {
    expect(isTargetPath("/nori/calibration-target/")).toBe(true);
    expect(isTargetPath("/nori/calibration-target-extra")).toBe(false);
  });
  it("uses a much wider phone grid without changing the measured square spacing", () => {
    const fixed = boardGeometry(5, profile.cssPixelsPerMm, environment.dpr);
    const fitted = fitBoardGeometry(5, profile.cssPixelsPerMm, environment.dpr, 915, 412)!;
    expect(fitted.squareDevicePixels).toBe(fixed.squareDevicePixels);
    expect(fitted.actualSquareMm).toBe(fixed.actualSquareMm);
    expect(fitted.widthCssPixels).toBeGreaterThan(915 * .9);
    expect(fitted.innerColumns).toBeGreaterThan(fixed.innerColumns);
    expect(boardFits(fitted, 915, 412)).toBe(true);
    expect(fitted.squareColumns % 2).not.toBe(fitted.squareRows % 2);
    const grid = { columns: fitted.innerColumns, rows: fitted.innerRows };
    for (let y = 0; y < fitted.outerRows; y++) for (let x = 0; x < fitted.outerColumns; x++) {
      const border = x === 0 || y === 0 || x === fitted.outerColumns - 1 || y === fitted.outerRows - 1;
      expect(blackCell(x, y, grid)).toBe(!border && (x + y) % 2 === 0);
    }
  });
  it("records the exact displayed grid and supplies matching calibration tool inputs", () => {
    for (const role of ["front", "overhead"] as const) {
      const fitted = fitBoardGeometry(8, profile.cssPixelsPerMm, environment.dpr, 915, 412)!;
      const grid = { columns: fitted.innerColumns, rows: fitted.innerRows };
      const manifest = targetManifest(profile, 8, role, environment, "wide-target", grid);
      const values = calibrationToolValues(manifest);
      expect(manifest.inner_corners).toEqual(grid);
      expect(manifest.render.canvas_width).toBe(fitted.widthDevicePixels);
      expect(manifest.render.canvas_height).toBe(fitted.heightDevicePixels);
      expect(manifest.pattern_size_m.width).toBe(fitted.squareColumns * fitted.actualSquareMm / 1000);
      expect(values.size).toBe(`${grid.columns}x${grid.rows}`);
      expect(Number(values.square)).toBe(fitted.actualSquareMm / 1000);
      expect(values.defaultCameraName).toBe(`${role}_camera`);
      expect(values.imageTopic).toBe(`/camera/${role}/image_decoded`);
      expect(values.boardArguments).toBe(`--size ${values.size} --square ${values.square}`);
    }
  });
  it("selects a fresh grid only for a new display and refuses views too small for useful corners", () => {
    const large = fitBoardGeometry(5, 6, 2, 915, 412)!;
    const smaller = fitBoardGeometry(5, 6, 2, 700, 300)!;
    expect(smaller.innerColumns).toBeLessThan(large.innerColumns);
    expect(smaller.innerRows).toBeLessThan(large.innerRows);
    expect(boardFits(large, 700, 300)).toBe(false);
    expect(fitBoardGeometry(5, 6, 2, 150, 150)).toBeNull();
    expect(fitBoardGeometry(5, 6, 2, NaN, 412)).toBeNull();
    expect(fitBoardGeometry(5, 6, 2, 915, Infinity)).toBeNull();
    for (const grid of [{ columns: 2, rows: 7 }, { columns: 4.5, rows: 7 }, { columns: 9, rows: 101 }]) {
      expect(() => boardGeometry(5, 6, 2, grid)).toThrow();
    }
  });
  it("fits the complete white border above the tool-value strip without changing square size", () => {
    const width = 915, height = 412;
    const areaHeight = height - TARGET_VALUES_HEIGHT_PX;
    const full = fitBoardGeometry(5, profile.cssPixelsPerMm, environment.dpr, width, height)!;
    const withValues = fitBoardGeometry(5, profile.cssPixelsPerMm, environment.dpr, width, areaHeight)!;
    expect(withValues.squareDevicePixels).toBe(full.squareDevicePixels);
    expect(withValues.widthCssPixels).toBeGreaterThan(width * .9);
    expect(withValues.heightCssPixels + TARGET_VALUES_HEIGHT_PX + 32).toBeLessThanOrEqual(height);
    expect(withValues.innerRows).toBeLessThan(full.innerRows);
    expect(boardFits(withValues, width, areaHeight)).toBe(true);
    expect(boardFits(withValues, width, areaHeight - 100)).toBe(false);
  });
});
