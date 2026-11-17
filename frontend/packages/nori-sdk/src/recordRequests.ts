/** Correlated, retried recording RPCs. Late replies cannot complete another verb. */
export class RecordRequests<T extends { ok: boolean; error?: string }> {
  private seq = 0;
  private prefix = `record-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private pending: {
    id: string;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
    retry: ReturnType<typeof setInterval>;
  } | null = null;

  constructor(private send: (frame: Record<string, unknown>) => boolean) {}

  request(action: string, payload: Record<string, unknown> = {}, timeoutMs = 10000): Promise<T> {
    if (this.pending) return Promise.reject(new Error("Another recording request is in progress"));
    const id = `${this.prefix}-${++this.seq}`;
    const frame = { ...payload, type: "record", action, request_id: id };
    return new Promise<T>((resolve, reject) => {
      const fail = (message: string) => {
        if (this.pending?.id !== id) return;
        this.clear();
        reject(new Error(message));
      };
      this.pending = {
        id, resolve, reject,
        timeout: setTimeout(() => fail("Recording request timed out; reconnect to recover its result"), timeoutMs),
        retry: setInterval(() => {
          if (!this.send(frame)) fail("Recording connection lost; reconnect to recover its result");
        }, 750),
      };
      if (!this.send(frame)) fail("Recording connection unavailable");
    });
  }

  owns(id: string): boolean { return this.pending?.id === id; }

  accept(id: string, result: T): void {
    if (!this.pending || !this.owns(id)) return;
    const { resolve, reject } = this.pending;
    this.clear();
    if (result.ok) resolve(result);
    else reject(new Error(result.error || "Recording request refused"));
  }

  close(): void {
    const waiter = this.pending;
    this.clear();
    waiter?.reject(new Error("Recording session closed; reconnect to recover its result"));
  }

  private clear(): void {
    if (this.pending) {
      clearTimeout(this.pending.timeout);
      clearInterval(this.pending.retry);
      this.pending = null;
    }
  }
}

/** One-shot read-only status discovery. Legacy replies never acknowledge mutations. */
export class RecordStatusProbe<T extends { ok: boolean; error?: string }> {
  private pending: {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(private send: () => boolean) {}

  request(timeoutMs = 1500): Promise<T> {
    if (this.pending) return this.pending.promise;
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    this.pending = { promise, resolve, reject,
      timer: setTimeout(() => this.fail("Recorder status unavailable; check the robot connection"), timeoutMs) };
    if (!this.send()) this.fail("Recording connection unavailable");
    return promise;
  }

  accept(status: T): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    if (status.ok) pending.resolve(status);
    else pending.reject(new Error(status.error || "Recorder unavailable"));
  }

  close(): void { this.fail("Recording connection closed"); }

  private fail(message: string): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    pending.reject(new Error(message));
  }
}
