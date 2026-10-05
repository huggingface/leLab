// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import RecordingCameraFeed from "./RecordingCameraFeed";
import { recordingCameraWindows } from "@/lib/cameraConfig";

test("recording feeds use each camera's output ratio without rotating corrected backend frames", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const windows = recordingCameraWindows(["front", "wrist"], {
    front: { type: "opencv", width: 640, height: 480, rotation: 0 },
    wrist: { type: "opencv", width: 640, height: 480, rotation: 90 },
  }, { w: 1000, h: 600 });
  const container = document.createElement("div"), root = createRoot(container);
  act(() => root.render(<>{Object.entries(windows).map(([name, dimensions]) => (
    <RecordingCameraFeed key={name} name={name} baseUrl="http://test" live {...dimensions} />
  ))}</>));
  const images = Array.from(container.querySelectorAll("img"));
  expect(images).toHaveLength(2);
  expect(parseFloat(images[0].parentElement!.style.width) / parseFloat(images[0].parentElement!.style.height)).toBeCloseTo(4 / 3, 2);
  expect(parseFloat(images[1].parentElement!.style.width) / parseFloat(images[1].parentElement!.style.height)).toBeCloseTo(3 / 4, 2);
  for (const image of images) {
    expect(image.className).toContain("object-contain");
    expect(image.style.transform).toBe("");
  }
  act(() => root.unmount());
});
