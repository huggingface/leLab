import { expect, test, vi } from "vitest";

import { mergeLocalDatasets } from "./replayApi";

test("posts the selected local datasets and output name", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ success: true, repo_id: "local/combined", num_episodes: 4, total_frames: 120 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );

  await expect(mergeLocalDatasets("http://localhost:8000", fetcher, ["local/one", "local/two"], "combined"))
    .resolves.toEqual({ success: true, repo_id: "local/combined", num_episodes: 4, total_frames: 120 });

  expect(fetcher).toHaveBeenCalledWith("http://localhost:8000/datasets/merge", {
    method: "POST",
    signal: undefined,
    body: JSON.stringify({ source_repo_ids: ["local/one", "local/two"], output_name: "combined" }),
  });
});
