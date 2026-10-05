// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import InferenceModal from "./InferenceModal";
import { RobotRecord } from "@/hooks/useRobots";
const mocks = vi.hoisted(() => ({ fetcher: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));
const available = [
  { index: 1, name: "top", deviceId: "usb-top", available: true },
  { index: 2, name: "wrist", deviceId: "usb-wrist", available: true },
  { index: 3, name: "manual", deviceId: "usb-manual", available: true },
];
vi.mock("@/contexts/ApiContext", () => ({ useApi: () => ({ baseUrl: "http://test", fetchWithHeaders: mocks.fetcher }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/hooks/useAvailableCameras", () => ({ useAvailableCameras: () => ({ cameras: available }) }));
vi.mock("@/hooks/useCameraStream", () => ({ useCameraStream: () => ({ videoRef: React.createRef<HTMLVideoElement>(), hasError: false }) }));
// Use native selectors to test modal state changes without Radix popup event details.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: { value: string; onValueChange: (value: string) => void; disabled: boolean; children: React.ReactNode }) => (
    <select value={value ?? ""} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}><option value="" />{children}</select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
const robot: RobotRecord = {
  name: "so101", leader_port: "leader", follower_port: "follower", leader_config: "leader.json", follower_config: "follower.json", is_clean: true,
  cameras: [
    { id: "wrist", name: "wrist", type: "opencv", device_id: "usb-wrist", camera_index: 1, width: 640, height: 480, rotation: 90 },
    { id: "top", name: "top", type: "opencv", device_id: "usb-top", camera_index: 2, width: 640, height: 480, rotation: 180 },
  ],
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); root = createRoot(container);
  mocks.fetcher.mockReset(); mocks.navigate.mockReset(); mocks.toast.mockReset();
  mocks.fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(
    url.endsWith("/checkpoints") ? { checkpoints: [{ step: 10, source: "local", ref: "checkpoint" }] }
      : url.endsWith("/policy-config") ? { policy_type: "act", requires_task: false, image_features: { wrist: { width: 480, height: 640 }, top: { width: 640, height: 480 } } }
      : { message: "Started", log_path: "rollout.log" },
  )));
});
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); });
const rotations = () => Array.from(container.querySelectorAll("select")).filter((select) => Array.from(select.options).some((option) => option.text.includes("clockwise")));
const bindings = () => Array.from(container.querySelectorAll("select")).filter((select) => Array.from(select.options).some((option) => option.text.includes("#")));
function change(select: HTMLSelectElement, value: string) {
  act(() => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function render(record = robot) {
  await act(async () => root.render(<InferenceModal open onOpenChange={vi.fn()} robot={record} jobId="job" initialStep={10} />));
}
async function start() {
  vi.useFakeTimers();
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("Start Inference"))!;
  await act(async () => { button.click(); await vi.advanceTimersByTimeAsync(300); });
  const call = mocks.fetcher.mock.calls.find(([url]) => url.endsWith("/start-inference"));
  return call ? JSON.parse(call[1].body) : null;
}

test("camera reassignment carries physical rotation and sends native dimensions to inference", async () => {
  await render();
  expect(bindings().map((select) => select.value)).toEqual(["2", "1"]);
  expect(rotations().map((select) => select.value)).toEqual(["90", "180"]);
  change(bindings()[0], "1"); change(bindings()[1], "2");
  expect(rotations().map((select) => select.value)).toEqual(["180", "90"]);
  change(rotations()[0], "270");
  const request = await start();
  expect(request.cameras.wrist).toMatchObject({ camera_index: 1, rotation: 270, width: 640, height: 480 });
  expect(request.cameras.top).toMatchObject({ camera_index: 2, rotation: 90, width: 480, height: 640 });
  expect(mocks.navigate).toHaveBeenCalledWith("/inference");
});

test("an unsaved camera permits a manual rotation with a training-data reminder", async () => {
  await render(); change(bindings()[0], "3");
  expect(rotations()[0].value).toBe("0");
  change(rotations()[0], "90");
  expect(container.textContent).toContain("Use the same rotation as the training data");
  const request = await start();
  expect(request.cameras.wrist).toMatchObject({ camera_index: 3, rotation: 90, width: 640, height: 480 });
});

test("an invalid saved rotation blocks inference and gives a visible correction instruction", async () => {
  await render({ ...robot, cameras: [{ ...robot.cameras[0], rotation: 45 as never }] });
  expect(container.textContent).toContain("Correct the camera settings in Calibration");
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("Start Inference"))! as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(await start()).toBeNull();
});
