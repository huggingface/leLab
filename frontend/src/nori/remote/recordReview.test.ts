import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteTeleop } from "@nori/sdk";
import { RecordRequests, RecordStatusProbe } from "../../../packages/nori-sdk/src/recordRequests";

afterEach(() => vi.useRealTimers());

describe("recording acknowledgements", () => {
  it("retries the same request ID and ignores a late reply to a different verb", async () => {
    vi.useFakeTimers();
    const sent: Record<string, unknown>[] = [];
    const rpc = new RecordRequests<{ ok: boolean }>((frame) => { sent.push(frame); return true; });
    const first = rpc.request("episode_keep", { episode_id: "one" }, 100);
    const timedOut = expect(first).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(100);
    await timedOut;
    const second = rpc.request("episode_reject", { episode_id: "two" });
    rpc.accept(String(sent[0].request_id), { ok: true });
    expect(rpc.owns(String(sent[1].request_id))).toBe(true);
    await vi.advanceTimersByTimeAsync(750);
    expect(sent[2]).toEqual(sent[1]);
    rpc.accept(String(sent[1].request_id), { ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports refusal, failed sends, and disconnects instead of claiming success", async () => {
    const rpc = new RecordRequests<{ ok: boolean; error?: string }>(() => true);
    const pending = rpc.request("episode_reject");
    rpc.close();
    await expect(pending).rejects.toThrow(/session closed/);
    await expect(new RecordRequests(() => false).request("episode_reject"))
      .rejects.toThrow(/unavailable/);
  });

  it("SDK sends stable episode identity and only resolves its matching reply", async () => {
    const t = new RemoteTeleop({ arm: "right", onLog: () => {} } as never);
    const sent: Record<string, unknown>[] = [];
    const raw = t as unknown as {
      dcSend: (frame: Record<string, unknown>) => boolean;
      ingestRecordStatus: (frame: Record<string, unknown>) => void;
    };
    raw.dcSend = (frame) => { sent.push(frame); return true; };
    const pending = t.recordConfirmed("episode_reject", { episodeId: "episode-one" });
    expect(sent[0]).toMatchObject({ action: "episode_reject", episode_id: "episode-one" });
    raw.ingestRecordStatus({ type: "record_status", ok: true, request_id: "old", recording: true });
    expect(t.recordState()).toBeNull();
    raw.ingestRecordStatus({ type: "record_status", request_id: sent[0].request_id,
      ok: false, recording: false, error: "delete failed" });
    await expect(pending).rejects.toThrow("delete failed");
  });
});

describe("legacy-compatible recorder discovery", () => {
  it("shares a one-shot probe and accepts a legacy reply without a request ID", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => true);
    const probe = new RecordStatusProbe<{ ok: boolean; reviewSupported?: boolean }>(send);
    const first = probe.request();
    expect(probe.request()).toBe(first);
    expect(send).toHaveBeenCalledTimes(1);
    probe.accept({ ok: true });
    await expect(first).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("silence is a short read-only connection error, not unsupported review or an uncertain mutation", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => true);
    const probe = new RecordStatusProbe(send);
    const pending = probe.request();
    const refused = expect(pending).rejects.toThrow("Recorder status unavailable; check the robot connection");
    await vi.advanceTimersByTimeAsync(1500);
    await refused;
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates recorder refusal, send failure and disconnect, then permits a fresh probe", async () => {
    const probe = new RecordStatusProbe(() => true);
    const refused = probe.request();
    probe.accept({ ok: false, error: "recorder unreachable" });
    await expect(refused).rejects.toThrow("recorder unreachable");
    const closed = probe.request();
    probe.close();
    await expect(closed).rejects.toThrow("connection closed");
    await expect(new RecordStatusProbe(() => false).request()).rejects.toThrow("connection unavailable");
    const recovered = probe.request();
    probe.accept({ ok: true });
    await expect(recovered).resolves.toEqual({ ok: true });
  });

  it("SDK separates uncorrelated discovery from matching mutation replies", async () => {
    const t = new RemoteTeleop({ arm: "right", onLog: () => {} } as never);
    const frames: Record<string, unknown>[] = [];
    const raw = t as unknown as {
      dcSend: (frame: Record<string, unknown>) => boolean;
      ingestRecordStatus: (frame: Record<string, unknown>) => void;
    };
    raw.dcSend = (frame) => { frames.push(frame); return true; };
    let mutationFinished = false;
    const mutation = t.recordConfirmed("episode_keep", { episodeId: "held-take" })
      .then((result) => { mutationFinished = true; return result; });
    const discovery = t.recordStatus();
    expect(frames[1]).toEqual({ type: "record", action: "status" });
    raw.ingestRecordStatus({ type: "record_status", ok: true, recording: false });
    await expect(discovery).resolves.toMatchObject({ ok: true, reviewSupported: false });
    expect(mutationFinished).toBe(false);
    raw.ingestRecordStatus({ type: "record_status", ok: true, recording: false,
      request_id: frames[0].request_id });
    await expect(mutation).resolves.toMatchObject({ ok: true });
  });
});
