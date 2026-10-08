// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";

import MergeDatasetsDialog from "./MergeDatasetsDialog";

test("opens with the browsed local dataset retained as the first merge source", async () => {
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

  try {
    await act(async () => {
      root.render(
        <MergeDatasetsDialog
          datasets={[
            { repo_id: "local/browsed", source: "local", last_modified: "", private: false },
            { repo_id: "local/additional", source: "local", last_modified: "", private: false },
          ]}
          selectedRepoId="local/browsed"
          open
          onOpenChange={() => {}}
          onMerge={async () => {}}
        />,
      );
    });

    expect(document.body.textContent).toContain("local/browsed is included");
    expect(document.body.textContent).not.toContain("local/additional");
    expect(document.body.textContent).toContain("Select at least one additional dataset.");
    const mergeButton = [...document.body.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Merge datasets"),
    ) as HTMLButtonElement;
    expect(mergeButton.disabled).toBe(true);

    const addButton = [...document.body.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add dataset"),
    ) as HTMLButtonElement;
    await act(async () => {
      addButton.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      addButton.click();
    });
    expect(document.body.querySelector("[cmdk-input]")).not.toBeNull();
    expect(document.body.textContent).toContain("local/additional");
    expect(document.body.textContent).not.toContain("Create new dataset");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
