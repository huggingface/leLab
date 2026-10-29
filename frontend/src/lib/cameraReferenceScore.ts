/**
 * How closely a live camera frame matches its saved reference frame, computed in
 * the browser from the preview's own pixels (the backend never opens a camera).
 * Ported from teleop-setup-align (https://github.com/ravediamond/teleop-setup-align),
 * where both scores were tuned on a two-camera SO-101 rig.
 */

/** RGBA pixels, as returned by `CanvasRenderingContext2D.getImageData`. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Alignment at or above this reads as lined up (green halo). */
export const ALIGNED_SCORE = 90;
/** Lighting match bands: at or above GOOD is green, at or above FAIR is amber, else red. */
export const LIGHTING_GOOD = 85;
export const LIGHTING_FAIR = 60;

// OpenCV's default for a 9x9 Gaussian: sigma = 0.3 * ((ksize - 1) / 2 - 1) + 0.8.
const KERNEL = (() => {
  const sigma = 1.7;
  const k = Array.from({ length: 9 }, (_, i) => Math.exp(-((i - 4) ** 2) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0);
  return k.map((v) => v / sum);
})();

function gray({ data, width, height }: Pixels): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return out;
}

// Mirror without repeating the edge pixel, like OpenCV's BORDER_REFLECT_101.
function reflect(i: number, n: number): number {
  if (n === 1) return 0;
  while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i;
  return i;
}

function blur(src: Float32Array, width: number, height: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = 0; k < 9; k++) s += KERNEL[k] * src[row + reflect(x + k - 4, width)];
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = 0; k < 9; k++) s += KERNEL[k] * tmp[reflect(y + k - 4, height) * width + x];
      out[y * width + x] = s;
    }
  }
  return out;
}

/** Blurred grayscale of a frame, the input `alignmentScore` compares. Cache it for the reference. */
export function alignmentInput(frame: Pixels): Float32Array {
  return blur(gray(frame), frame.width, frame.height);
}

/**
 * 0-100: how well the live framing and arm pose line up with the reference.
 *
 * Normalized cross-correlation subtracts each image's own mean, so an overall
 * brightness change (the lighting score's job) barely moves it; only a shift in
 * what's in frame does. The 9x9 blur first turns NCC's cliff at a 1-2 px shift into
 * a graduated curve (on 640x480: ~99 with sensor noise only, ~93 at 10 px, ~73 at
 * 40 px, ~46 at 80 px), which a person nudging a camera by hand can follow.
 * Returns null when the two frames differ in size.
 */
export function alignmentScore(live: Float32Array, reference: Float32Array): number | null {
  if (live.length !== reference.length || live.length === 0) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < live.length; i++) {
    ma += live[i];
    mb += reference[i];
  }
  ma /= live.length;
  mb /= live.length;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < live.length; i++) {
    const a = live[i] - ma;
    const b = reference[i] - mb;
    ab += a * b;
    aa += a * a;
    bb += b * b;
  }
  const denom = Math.sqrt(aa * bb);
  return denom ? Math.max(0, ab / denom) * 100 : 0;
}

export interface LightingSignature {
  brightness: number;
  /** Each channel's share of total brightness, as [r, g, b]. */
  colorBalance: [number, number, number];
}

/**
 * Mean brightness plus color balance. Auto-exposure renormalizes brightness, so two
 * differently lit scenes (curtains open vs closed) can average out the same; it
 * doesn't correct color temperature, which the per-channel shares still catch.
 */
export function lightingSignature({ data }: Pixels): LightingSignature {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = data.length / 4;
  for (let p = 0; p < data.length; p += 4) {
    r += data[p];
    g += data[p + 1];
    b += data[p + 2];
  }
  r /= n;
  g /= n;
  b /= n;
  const total = r + g + b || 1;
  return { brightness: 0.299 * r + 0.587 * g + 0.114 * b, colorBalance: [r / total, g / total, b / total] };
}

export interface LightingMatch {
  /** 0-100. */
  match: number;
  /** Percent change in mean brightness from the reference. */
  brightnessDiff: number;
  /** Color-balance shift, on the same percent scale. */
  colorDiff: number;
}

// Real lighting changes on the rig only gave single-digit percent diffs even when
// clearly visible, so the worst diff is amplified to move the match visibly.
const LIGHTING_GAIN = 4;

/**
 * Which signal moves depends on the camera (closing curtains moved one camera's
 * brightness 3% -> 6% and another's color 0.3% -> 6.1%), so the score uses the
 * larger of the two rather than diluting it with an average.
 */
export function lightingMatch(live: LightingSignature, reference: LightingSignature): LightingMatch {
  const pct = (a: number, b: number) => (b ? (Math.abs(a - b) / b) * 100 : a === b ? 0 : 100);
  const brightnessDiff = pct(live.brightness, reference.brightness);
  const colorDiff = live.colorBalance.reduce((s, v, i) => s + Math.abs(v - reference.colorBalance[i]), 0) * 100;
  const worst = Math.max(brightnessDiff, colorDiff);
  return { match: Math.max(0, 100 - LIGHTING_GAIN * worst), brightnessDiff, colorDiff };
}
