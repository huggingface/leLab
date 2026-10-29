// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";

import EpisodeTaskDialog from "./EpisodeTaskDialog";

test("saves the task for the browsed episode or for every episode", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const saved: [string, number | null][] = [];

  try {
    await act(async () => {
      root.render(
        <EpisodeTaskDialog
          repoId="local/demo"
          episodeIndex={3}
          currentTask="pick the cube"
          totalEpisodes={5}
          open
          onOpenChange={() => {}}
          onSave={async (task, episodeIndex) => {
            saved.push([task, episodeIndex]);
          }}
        />,
      );
    });

    const input = document.getElementById("episode-task") as HTMLInputElement;
    const saveButton = () =>
      [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent === "Save task",
      ) as HTMLButtonElement;
    const type = async (value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    expect(input.value).toBe("pick the cube");

    await type("  ");
    expect(saveButton().disabled).toBe(true);

    await type(" pick the bowl ");
    await act(async () => saveButton().click());
    expect(saved).toEqual([["pick the bowl", 3]]);

    await act(async () => (document.getElementById("episode-task-all") as HTMLButtonElement).click());
    await act(async () => saveButton().click());
    expect(saved.at(-1)).toEqual(["pick the bowl", null]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
