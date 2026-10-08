// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";

import EditDataset from "./EditDataset";

const datasets = [
  { repo_id: "me/local", source: "local", last_modified: "", private: false },
  { repo_id: "me/pushed", source: "both", last_modified: "", private: false },
];

vi.mock("@/hooks/useDatasets", () => ({
  useDatasets: () => ({ datasets, loading: false, refresh: () => {} }),
}));
vi.mock("@/hooks/useEpisodes", () => ({
  useEpisodes: () => ({ data: null, loading: false, error: null }),
  useEpisodeDetail: () => ({ detail: null, loading: false, error: null }),
}));
vi.mock("@/hooks/useRobots", () => ({ useRobots: () => ({ selectedRecord: null }) }));
vi.mock("@/hooks/useRecording", () => ({
  useRecording: () => ({ openForNew: () => {}, openToAppend: () => {}, modalProps: {} }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@/contexts/ApiContext", () => ({
  useApi: () => ({ baseUrl: "http://api", fetchWithHeaders: vi.fn() }),
}));
vi.mock("@/components/landing/RecordingModal", () => ({ default: () => null }));

const renderAt = async (repoId: string) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/edit-dataset?dataset=${encodeURIComponent(repoId)}`]}>
        <EditDataset />
      </MemoryRouter>,
    );
  });
  return { host, root };
};

const buttonTexts = (host: HTMLElement) =>
  [...host.querySelectorAll("button, a")].map((e) => e.textContent?.trim());

test("a dataset not on the Hub offers Upload and Delete", async () => {
  const { host, root } = await renderAt("me/local");
  expect(buttonTexts(host)).toContain("Upload");
  expect(host.querySelector('[aria-label="Delete dataset from disk"]')).not.toBeNull();
  expect(host.querySelector('a[href^="https://huggingface.co"]')).toBeNull();
  act(() => root.unmount());
});

test("a dataset already on the Hub links to its Hub page instead of Upload", async () => {
  const { host, root } = await renderAt("me/pushed");
  expect(buttonTexts(host)).not.toContain("Upload");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("https://huggingface.co/datasets/me/pushed");
  expect(host.querySelector('[aria-label="Delete dataset from disk"]')).not.toBeNull();
  act(() => root.unmount());
});
