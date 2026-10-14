import type { RetryConfig } from "@workspace/protocol";

/** Exponential backoff policy for external CLI/agent calls. */
export class RetryPolicy {
  attempts: number;
  baseSeconds: number;
  maxSeconds: number;
  jitterSeconds: number;

  constructor(cfg?: Partial<RetryConfig>) {
    this.attempts = Math.max(1, Math.floor(cfg?.attempts ?? 3));
    this.baseSeconds = Math.max(0, cfg?.base_seconds ?? 2);
    this.maxSeconds = Math.max(0, cfg?.max_seconds ?? 30);
    this.jitterSeconds = Math.max(0, cfg?.jitter_seconds ?? 0.5);
  }

  /** Seconds to wait before the next attempt (1-based attempt number). */
  delay(attempt: number, randomFn: () => number = Math.random): number {
    return (
      Math.min(this.maxSeconds, this.baseSeconds * Math.pow(2, attempt - 1)) +
      this.jitterSeconds * randomFn()
    );
  }
}
