/** Request spans report elapsed time. Workers freeze the clock during CPU-only
 * work, so use the Worker trace's CPU time for that part of the request. */
export class DirectoryTimings {
  private readonly started = performance.now();
  private readonly spans: string[] = [];

  constructor(private readonly enabled: boolean) {}

  start(name: string) {
    const started = this.enabled ? performance.now() : 0;
    return (state?: "warm" | "cold" | "fallback") => {
      if (!this.enabled) return;
      const duration = (performance.now() - started).toFixed(1);
      this.spans.push(name + ";dur=" + duration + (state ? ';desc="' + state + '"' : ""));
    };
  }

  async measure<T>(name: string, work: () => Promise<T>): Promise<T> {
    const end = this.start(name);
    try { return await work(); }
    finally { end(); }
  }

  finish(response: Response) {
    if (!this.enabled) return response;
    this.spans.push("directory;dur=" + (performance.now() - this.started).toFixed(1));
    const headers = new Headers(response.headers);
    headers.append("server-timing", this.spans.join(", "));
    return new Response(response.body, { status: response.status, headers });
  }
}
