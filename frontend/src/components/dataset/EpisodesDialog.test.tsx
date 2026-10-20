// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";

import { parseEpisodeList } from "@/lib/datasetApi";

import EpisodesDialog from "./EpisodesDialog";

test("parses episode lists and ranges", () => {
  expect(parseEpisodeList("3, 1, 5-7, 3", 10)).toEqual([1, 3, 5, 6, 7]);
  expect(parseEpisodeList(" 2 - 4 ,", 10)).toEqual([2, 3, 4]);
  expect(parseEpisodeList("", 10)).toBeNull();
  expect(parseEpisodeList("10", 10)).toBeNull();
  expect(parseEpisodeList("4-2", 10)).toBeNull();
  expect(parseEpisodeList("1, x", 10)).toBeNull();
});

test("opens on the browsed episode and refuses to move every episode", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const moved: [number[], string][] = [];

  try {
    await act(async () => {
      root.render(
        <EpisodesDialog
          mode="move"
          repoId="local/demo"
          totalEpisodes={2}
          currentEpisode={1}
          open
          onOpenChange={() => {}}
          onSubmit={async (indices, name) => {
            moved.push([indices, name!]);
          }}
        />,
      );
    });

    const episodes = document.getElementById("episode-selection") as HTMLInputElement;
    const name = document.getElementById("moved-dataset-name") as HTMLInputElement;
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

    expect(episodes.value).toBe("1");
    expect(moveButton().disabled).toBe(true);

    await type(name, "rejected takes");
    expect(name.value).toBe("rejected_takes");
    expect(moveButton().disabled).toBe(false);

    await type(episodes, "0-1");
    expect(document.body.textContent).toContain("At least one episode must stay in the dataset.");
    expect(moveButton().disabled).toBe(true);

    await type(episodes, "1");
    await act(async () => moveButton().click());
    expect(moved).toEqual([[[1], "rejected_takes"]]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

test("delete mode has no name field and deletes the selected episodes", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const deleted: [number[], string | null][] = [];

  try {
    await act(async () => {
      root.render(
        <EpisodesDialog
          mode="delete"
          repoId="local/demo"
          totalEpisodes={3}
          currentEpisode={2}
          open
          onOpenChange={() => {}}
          onSubmit={async (indices, name) => {
            deleted.push([indices, name]);
          }}
        />,
      );
    });

    expect(document.getElementById("moved-dataset-name")).toBeNull();
    const deleteButton = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Delete "),
    ) as HTMLButtonElement;
    expect(deleteButton.textContent).toBe("Delete 1 episode");
    await act(async () => deleteButton.click());
    expect(deleted).toEqual([[[2], null]]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
