// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useRobots } from "./useRobots";
const mocks = vi.hoisted(() => ({ fetcher: vi.fn(), toast: vi.fn() }));
vi.mock("@/contexts/ApiContext", () => ({ useApi: () => ({ baseUrl: "http://test", fetchWithHeaders: mocks.fetcher }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("react-router-dom", () => ({ useLocation: () => ({ key: "initial" }) }));
let root: Root;
let current: ReturnType<typeof useRobots>;
function Probe() { current = useRobots(); return null; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); mocks.fetcher.mockReset(); mocks.toast.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(() => act(() => root.unmount()));
test("profile reload keeps valid robots when another robot has an invalid saved rotation", async () => {
  const camera = { id: "wrist", name: "wrist", device_id: "usb", type: "opencv", width: 640, height: 480 };
  const robot = { leader_port: "leader", follower_port: "follower", leader_config: "leader.json", follower_config: "follower.json", is_clean: true };
  mocks.fetcher.mockResolvedValue(new Response(JSON.stringify({ robots: [
    { ...robot, name: "old", cameras: [camera] },
    { ...robot, name: "rotated", cameras: [{ ...camera, rotation: 180 }] },
    { ...robot, name: "invalid", cameras: [{ ...camera, rotation: 45 }] },
  ] })));
  await act(async () => root.render(<Probe />));
  expect(current.records.old.cameras[0].rotation).toBe(0);
  expect(current.records.rotated.cameras[0].rotation).toBe(180);
  expect(current.records.invalid.cameras[0].rotation).toBe(45);
  expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Invalid camera rotation", variant: "destructive" }));
});
