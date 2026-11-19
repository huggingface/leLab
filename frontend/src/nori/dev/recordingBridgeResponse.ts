/** Error handling for the local test bridge, including empty proxy failures. */
export class RecordingBridgeError extends Error {}

export async function readRecordingBridgeResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new RecordingBridgeError(`Connection to 0000 is unavailable (HTTP ${response.status}). Reconnecting…`);
  }
  const text = await response.text();
  if (!text.trim()) {
    throw new RecordingBridgeError("0000 returned no response. Reconnecting…");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RecordingBridgeError("0000 returned an incomplete response. Reconnecting…");
  }
}

export async function requestRecordingBridge<T>(url: string, options: RequestInit = {}): Promise<T> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 6000);
  try {
    const response = await fetch(url, { ...options, signal: timeout.signal });
    return await readRecordingBridgeResponse<T>(response);
  } catch (error) {
    if (error instanceof RecordingBridgeError) throw error;
    throw new RecordingBridgeError(timeout.signal.aborted
      ? "0000 did not respond in time. Reconnecting…"
      : "Connection to 0000 was lost. Reconnecting…");
  } finally {
    clearTimeout(timer);
  }
}
