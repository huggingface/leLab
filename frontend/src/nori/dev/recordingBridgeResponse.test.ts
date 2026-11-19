import { describe, expect, it } from "vitest";
import { readRecordingBridgeResponse } from "./recordingBridgeResponse";

describe("local recording bridge responses", () => {
  it("reports an empty proxy error without trying to parse JSON", async () => {
    await expect(readRecordingBridgeResponse(new Response("", { status: 502 })))
      .rejects.toThrow("Connection to 0000 is unavailable (HTTP 502)");
  });
  it("reports an empty successful response clearly", async () => {
    await expect(readRecordingBridgeResponse(new Response("")))
      .rejects.toThrow("0000 returned no response");
  });
  it("reports truncated JSON without exposing a SyntaxError", async () => {
    await expect(readRecordingBridgeResponse(new Response('{"ready":')))
      .rejects.toThrow("0000 returned an incomplete response");
  });
  it("preserves a valid correlated recorder reply", async () => {
    const reply = [{ type: "record_status", request_id: "test", ok: true }];
    await expect(readRecordingBridgeResponse(Response.json(reply))).resolves.toEqual(reply);
  });
});
