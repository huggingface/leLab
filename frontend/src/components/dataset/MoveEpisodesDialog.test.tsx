// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";

import type { DatasetItem, MoveDestination } from "@/lib/replayApi";

import { parseEpisodeList } from "@/lib/datasetApi";

import MoveEpisodesDialog from "./MoveEpisodesDialog";

test("parses episode lists and ranges", () => {
  expect(parseEpisodeList("3, 1, 5-7, 3", 10)).toEqual([1, 3, 5, 6, 7]);
  expect(parseEpisodeList(" 2 - 4 ,", 10)).toEqual([2, 3, 4]);
  expect(parseEpisodeList("", 10)).toBeNull();
  expect(parseEpisodeList("10", 10)).toBeNull();
  expect(parseEpisodeList("4-2", 10)).toBeNull();
  expect(parseEpisodeList("1, x", 10)).toBeNull();
});

const DATASETS: DatasetItem[] = [
  { repo_id: "local/demo", source: "local", last_modified: "", private: false },
  { repo_id: "local/target", source: "local", last_modified: "", private: false },
];

test("opens on the browsed episode and refuses to move every episode", async () => {
  Object.assign(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  Element.prototype.scrollIntoView = () => {};
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const moved: [number[], MoveDestination][] = [];

  try {
    await act(async () => {
      root.render(
        <MoveEpisodesDialog
          datasets={DATASETS}
          repoId="local/demo"
          totalEpisodes={2}
          currentEpisode={1}
          open
          onOpenChange={() => {}}
          onMove={async (indices, destination) => {
            moved.push([indices, destination]);
          }}
        />,
      );
    });

    const episodes = document.getElementById("move-episodes") as HTMLInputElement;
    const moveButton = () =>
      [...document.body.querySelectorAll("button")].find((b) =>
        b.textContent?.startsWith("Move "),
      ) as HTMLButtonElement;
    const type = async (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const openPicker = async () => {
      const trigger = [...document.body.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Select or create a dataset") || b.textContent?.startsWith("local/"),
      ) as HTMLButtonElement;
      await act(async () => {
        trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
        trigger.click();
      });
    };

    expect(episodes.value).toBe("1");
    expect(moveButton().disabled).toBe(true);

    // The source never shows up as a destination.
    await openPicker();
    const items = [...document.body.querySelectorAll("[cmdk-item]")].map((i) => i.textContent);
    expect(items).toEqual(["local/target"]);

    // Create a new dataset by typing a name in the shared picker.
    const search = document.body.querySelector("[cmdk-input]") as HTMLInputElement;
    await type(search, "rejected takes");
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(document.body.textContent).toContain("Saved locally as local/rejected_takes");
    expect(moveButton().disabled).toBe(false);

    await type(episodes, "0-1");
    expect(document.body.textContent).toContain("At least one episode must stay in the dataset.");
    expect(moveButton().disabled).toBe(true);

    await type(episodes, "1");
    await act(async () => moveButton().click());
    expect(moved).toEqual([[[1], { newName: "rejected_takes" }]]);

    // Pick an existing dataset instead.
    await openPicker();
    const target = [...document.body.querySelectorAll("[cmdk-item]")].find(
      (i) => i.textContent === "local/target",
    ) as HTMLElement;
    await act(async () => target.click());
    expect(document.body.textContent).toContain("Merged into local/target");
    await act(async () => moveButton().click());
    expect(moved[1]).toEqual([[1], { existingRepoId: "local/target" }]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
