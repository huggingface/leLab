import { expect, test } from "vitest";

import { Pixels, alignmentInput, alignmentScore, lightingMatch, lightingSignature } from "./cameraReferenceScore";

const W = 160;
const H = 120;

// A synthetic scene: a smooth pattern plus a bright block, optionally shifted, brightened or warmed.
function scene({ dx = 0, gain = 1, warm = 0 } = {}): Pixels {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x0 = 0; x0 < W; x0++) {
      const x = x0 - dx;
      const block = x >= 40 && x < 80 && y >= 30 && y < 70 ? 80 : 0;
      const f = 128 + 60 * Math.sin(x / 9) * Math.cos(y / 7) + block;
      const p = (y * W + x0) * 4;
      data[p] = Math.round(f * gain * (1 + warm));
      data[p + 1] = Math.round((0.8 * f + 20) * gain);
      data[p + 2] = Math.round((0.6 * f + 40) * gain * (1 - warm));
      data[p + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

const align = (live: Pixels, ref: Pixels) => alignmentScore(alignmentInput(live), alignmentInput(ref));
const light = (live: Pixels, ref: Pixels) => lightingMatch(lightingSignature(live), lightingSignature(ref));

// Expected values come from teleop-setup-align's OpenCV implementation on the same scenes.
test("alignment matches the OpenCV reference: falls with a shift, ignores a brightness change", () => {
  const ref = scene();
  expect(align(scene(), ref)).toBeCloseTo(100, 1);
  expect(align(scene({ dx: 5 }), ref)).toBeCloseTo(86.87, 0);
  expect(align(scene({ dx: 20 }), ref)).toBe(0);
  expect(align(scene({ gain: 1.1 }), ref)).toBeGreaterThan(99.5);
});

test("frames of different sizes have no alignment score", () => {
  const small = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };
  expect(align(small, scene())).toBeNull();
});

test("lighting matches the OpenCV reference: a brighter or warmer scene lowers the match", () => {
  const ref = scene();
  expect(light(scene(), ref).match).toBe(100);
  const brighter = light(scene({ gain: 1.1 }), ref);
  expect(brighter.brightnessDiff).toBeCloseTo(9.92, 1);
  expect(brighter.match).toBeCloseTo(60.3, 0);
  const warmer = light(scene({ warm: 0.05 }), ref);
  expect(warmer.colorDiff).toBeCloseTo(3.33, 1);
  expect(warmer.match).toBeCloseTo(86.7, 0);
});
