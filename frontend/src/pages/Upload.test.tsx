// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";

import Upload from "./Upload";

const { fetchWithHeaders, toast } = vi.hoisted(() => ({
  fetchWithHeaders: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/contexts/ApiContext", () => ({
  useApi: () => ({ baseUrl: "http://api", fetchWithHeaders }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

test.each([false, true])("opens the uploaded Hub dataset (private: %s)", async (isPrivate) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const datasetInfo = { dataset_repo_id: "local/sushi2", single_task: "pick", num_episodes: 2 };
  let completeUpload!: (response: Response) => void;
  const pendingUpload = new Promise<Response>((resolve) => {
    completeUpload = resolve;
  });
  fetchWithHeaders.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith("/dataset-info")) {
      return Response.json({ ...datasetInfo, success: true });
    }
    if (url.endsWith("/upload-dataset")) {
      return pendingUpload;
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const button = (text: string) =>
    [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);

  try {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[{ pathname: "/upload", state: { datasetInfo } }]}>
          <Upload />
        </MemoryRouter>,
      );
    });
    if (isPrivate) {
      await act(async () => host.querySelector<HTMLButtonElement>("#private")?.click());
    }
    const upload = button("Upload to HuggingFace Hub");
    expect(upload).toBeDefined();
    await act(async () => upload?.click());
    const [, options] = fetchWithHeaders.mock.calls.find(([url]) => url.endsWith("/upload-dataset"))!;
    expect(JSON.parse(options.body)).toMatchObject({ dataset_repo_id: "local/sushi2", private: isPrivate });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("#private")?.click();
      completeUpload(Response.json({ success: true, hub_repo_id: "alice/sushi2" }));
    });

    const view = button("View on HuggingFace Hub");
    expect(view).toBeDefined();
    await act(async () => view?.click());
    const target = new URL(String(open.mock.calls[0]?.[0]));
    expect(target.pathname).toBe(isPrivate ? "/login" : "/spaces/lerobot/visualize_dataset");
    const viewer = isPrivate ? new URL(target.searchParams.get("next")!, target.origin) : target;
    expect(viewer.searchParams.get("path")).toBe("/alice/sushi2");
  } finally {
    act(() => root.unmount());
    host.remove();
    open.mockRestore();
  }
});
