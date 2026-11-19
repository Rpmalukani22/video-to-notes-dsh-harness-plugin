import { IResourcePool, PooledResource } from '../../application/ports/Interfaces.js';

/**
 * Counting semaphore resource pool. Callers `acquire()` a lease and must call
 * `release()` exactly once; the lease also exposes a `release` convenience.
 */
export class SimpleResourcePool<T> implements IResourcePool<T> {
  private readonly _capacity: number;
  private readonly _idle: T[];
  private _inUse = 0;
  private readonly _waiters: Array<(lease: PooledResource<T>) => void> = [];
  private readonly _create: () => T | Promise<T>;
  private readonly _destroy: ((resource: T) => void | Promise<void>) | undefined;

  constructor(
    capacity: number,
    options: { create: () => T | Promise<T>; destroy?: (resource: T) => void | Promise<void>; initial?: T[] }
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Resource pool capacity must be a positive integer');
    }
    this._capacity = capacity;
    this._create = options.create;
    this._destroy = options.destroy;
    this._idle = [...(options.initial ?? [])];
    this._inUse = 0;
  }

  async acquire(): Promise<PooledResource<T>> {
    if (this._idle.length > 0) {
      const resource = this._idle.pop() as T;
      this._inUse += 1;
      return this.lease(resource);
    }

    if (this._inUse < this._capacity) {
      this._inUse += 1;
      try {
        const resource = await this._create();
        return this.lease(resource);
      } catch (error) {
        this._inUse -= 1;
        this.drainWaiters();
        throw error;
      }
    }

    return new Promise<PooledResource<T>>(resolve => {
      this._waiters.push(resolve);
    });
  }

  release(lease: PooledResource<T>): void {
    this.releaseResource(lease.resource);
  }

  stats(): { available: number; inUse: number; waiting: number } {
    return {
      available: this._capacity - this._inUse,
      inUse: this._inUse,
      waiting: this._waiters.length,
    };
  }

  /** Release every idle resource (best effort). */
  async dispose(): Promise<void> {
    while (this._idle.length > 0) {
      const resource = this._idle.pop() as T;
      await this._destroy?.(resource);
    }
  }

  private lease(resource: T): PooledResource<T> {
    let released = false;
    const lease: PooledResource<T> = {
      resource,
      release: () => {
        if (released) return;
        released = true;
        this.releaseResource(resource);
      },
    };
    return lease;
  }

  private releaseResource(resource: T): void {
    this._inUse = Math.max(0, this._inUse - 1);
    const waiter = this._waiters.shift();
    if (waiter) {
      this._inUse += 1;
      waiter(this.lease(resource));
      return;
    }
    this._idle.push(resource);
  }

  private drainWaiters(): void {
    while (this._waiters.length > 0 && this._inUse < this._capacity) {
      const waiter = this._waiters.shift();
      if (!waiter) break;
      void this.acquire().then(waiter);
    }
  }
}
