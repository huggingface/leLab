// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

import DeleteDatasetDialog from "./DeleteDatasetDialog";

const fetchWithHeaders = vi.fn(async (_url: string, _init: { body: string }) => ({ ok: true, json: async () => ({ success: true }) }));

vi.mock("@/contexts/ApiContext", () => ({
  useApi: () => ({ baseUrl: "http://api", fetchWithHeaders }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));

const render = async (onHub: boolean, onDeleted = () => {}) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <DeleteDatasetDialog
        repoId="me/demo"
        onHub={onHub}
        open
        onOpenChange={() => {}}
        onDeleted={onDeleted}
      />,
    );
  });
  return root;
};

const deleteButton = () =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === "Delete")!;

test("a local-only dataset offers no Hub checkbox and deletes locally", async () => {
  fetchWithHeaders.mockClear();
  const onDeleted = vi.fn();
  const root = await render(false, onDeleted);
  expect(document.body.textContent).not.toContain("Also delete this dataset from the HuggingFace Hub");

  await act(async () => deleteButton().click());

  expect(JSON.parse(fetchWithHeaders.mock.calls[0][1].body)).toEqual({
    dataset_repo_id: "me/demo",
    delete_from_hub: false,
  });
  expect(onDeleted).toHaveBeenCalled();
  act(() => root.unmount());
});

test("deleting from the Hub stays disabled until the repo id is typed", async () => {
  const root = await render(true);
  const checkbox = document.querySelector<HTMLButtonElement>("#delete-from-hub")!;
  await act(async () => checkbox.click());
  expect(deleteButton().disabled).toBe(true);

  const input = document.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "me/demo");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(deleteButton().disabled).toBe(false);
  act(() => root.unmount());
});
