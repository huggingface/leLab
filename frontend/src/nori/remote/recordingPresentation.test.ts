import { describe, expect, it } from "vitest";
import type { RawBundleEntry } from "@/nori/api/client";
import { groupRecordings, recordingOutcome, recordingName } from "./recordingPresentation";

function take(id: string, collection: string | null, at = "2026-11-19T12:00:00Z"): RawBundleEntry {
  return { session_id: id, label: `Pick cube · ${id}`, created_at: at, status: "PROMOTED",
    hf_path_prefix: "test", episode_count: 1, frame_count: 10, finalized_at: at, failure_reason: null,
    recording_metadata: collection === null ? null : {
      collection_id: collection, episode_id: id, task: "Pick cube", outcome: "success", recorded_at: at,
    } };
}

describe("recording presentation", () => {
  it("groups distinct take names by identity across long pauses and renames", () => {
    const first = take("one", "group-a");
    const second = take("two", "group-a", "2026-11-20T12:00:00Z");
    second.label = "My custom take name";
    const groups = groupRecordings([second, first]);
    expect(groups).toHaveLength(1);
    expect(groups[0].bundles.map((b) => b.session_id)).toEqual(["one", "two"]);
  });
  it("keeps simultaneous sessions with the same prompt separate", () => {
    const groups = groupRecordings([take("one", "group-a"), take("two", "group-b")]);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).not.toBe(groups[1].label);
  });
  it("orders by capture time rather than delayed registration", () => {
    const first = take("one", "group-a");
    first.created_at = "2026-11-22T12:00:00Z";
    expect(groupRecordings([take("two", "group-b", "2026-11-20T12:00:00Z"), first])[0].bundles[0].session_id).toBe("two");
  });
  it("retains label/time grouping for old recordings", () => {
    const first = take("one", null);
    const second = take("two", null);
    const later = take("three", null, "2026-11-20T12:00:00Z");
    first.label = second.label = later.label = "Old prompt";
    expect(groupRecordings([first, second, later]).map((g) => g.bundles.length)).toEqual([1, 2]);
  });
  it("keeps task failure separate from upload failure", () => {
    const failedTask = take("one", "group-a");
    failedTask.recording_metadata!.outcome = "failure";
    expect(recordingOutcome(failedTask)).toBe("Task failed");
    failedTask.recording_metadata = null;
    failedTask.status = "PROMOTION_FAILED";
    expect(recordingOutcome(failedTask)).toBeNull();
  });
  it("groups older callers by task even when the new shipper gives each take a unique label", () => {
    const first = take("one", "");
    const second = take("two", "");
    const groups = groupRecordings([first, second]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Pick cube");
    expect(groups[0].bundles).toHaveLength(2);
  });
  it("keeps old Lab's grouping labels while updated Lab displays distinct names", () => {
    const first = take("one", "group-a");
    const second = take("two", "group-a");
    first.label = second.label = "Pick cube";
    first.recording_metadata!.display_name = "Group A · Pick cube · one";
    second.recording_metadata!.display_name = "Group A · Pick cube · two";
    expect(first.label).toBe(second.label);
    expect(recordingName(first)).not.toBe(recordingName(second));
    expect(groupRecordings([first, second])).toHaveLength(1);
  });
  it("uses stable upload IDs when an older backend omits new metadata", () => {
    const first = take("old-one", null);
    const second = take("old-two", null);
    first.label = second.label = "Old prompt";
    expect(recordingName(first)).not.toBe(recordingName(second));
    expect(recordingOutcome(first)).toBeNull();
    expect(groupRecordings([first, second])).toHaveLength(1);
  });
  it("preserves an owner's edited upload name", () => {
    const named = take("one", "group-a");
    named.label = "My named take";
    named.recording_metadata!.display_name = "Automatic take name";
    expect(recordingName(named)).toBe("My named take");
  });
});
