/**
 * Worker pool for limiting concurrent encoding tasks.
 * Reuses existing WorkerBridge instances with queue management.
 */

import WorkerBridge from '../../worker-bridge';

export interface WorkerPoolConfig {
  maxConcurrent: number;
}

export type TaskId = number;

export interface Task<T> {
  id: TaskId;
  execute: (workerBridge: WorkerBridge) => Promise<T>;
  signal?: AbortSignal;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: Error) => void;
}

const DEFAULT_CONFIG: WorkerPoolConfig = {
  maxConcurrent: 4,
};

export class WorkerPool {
  private config: WorkerPoolConfig;
  private workerBridges: WorkerBridge[] = [];
  private taskQueue: Task<unknown>[] = [];
  private activeWorkers: Set<number> = new Set();
  private nextTaskId: TaskId = 0;

  constructor(config: Partial<WorkerPoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeWorkers();
  }

  private initializeWorkers(): void {
    for (let i = 0; i < this.config.maxConcurrent; i++) {
      this.workerBridges.push(new WorkerBridge());
    }
  }

  private getAvailableWorkerIndex(): number | null {
    for (let i = 0; i < this.workerBridges.length; i++) {
      if (!this.activeWorkers.has(i)) {
        return i;
      }
    }
    return null;
  }

  private async processNextTask(): Promise<void> {
    const workerIndex = this.getAvailableWorkerIndex();
    if (workerIndex === null) return;

    const task = this.taskQueue.shift();
    if (!task) return;

    if (task.signal?.aborted) {
      task.reject(new DOMException('AbortError', 'AbortError'));
      return;
    }

    this.activeWorkers.add(workerIndex);
    const workerBridge = this.workerBridges[workerIndex];

    try {
      const result = await task.execute(workerBridge);
      task.resolve(result);
    } catch (error) {
      task.reject(error as Error);
    } finally {
      this.activeWorkers.delete(workerIndex);
      this.processNextTask();
    }
  }

  /**
   * Submit a task to the worker pool.
   * Tasks are executed in FIFO order when workers become available.
   */
  submit<T>(
    execute: (workerBridge: WorkerBridge) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const task: Task<T> = {
        id: this.nextTaskId++,
        execute,
        signal,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      if (signal?.aborted) {
        reject(new DOMException('AbortError', 'AbortError'));
        return;
      }

      this.taskQueue.push(task as Task<unknown>);
      this.processNextTask();
    });
  }

  /**
   * Execute multiple tasks concurrently, up to maxConcurrent.
   */
  async map<T, R>(
    items: T[],
    mapper: (item: T, workerBridge: WorkerBridge) => Promise<R>,
    signal?: AbortSignal,
  ): Promise<R[]> {
    const promises = items.map((item) =>
      this.submit((bridge) => mapper(item, bridge), signal),
    );
    return Promise.all(promises);
  }

  /**
   * Get the current queue length.
   */
  getQueueLength(): number {
    return this.taskQueue.length;
  }

  /**
   * Get the number of active workers.
   */
  getActiveWorkerCount(): number {
    return this.activeWorkers.size;
  }

  /**
   * Get total worker count.
   */
  getWorkerCount(): number {
    return this.workerBridges.length;
  }
}

export const defaultWorkerPool = new WorkerPool({ maxConcurrent: 4 });
