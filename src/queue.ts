export class SerialQueue {
  private pending: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.pending.then(
      () => task(),
      () => task(),
    );
    this.pending = result.catch(() => {});
    return result;
  }
}

// Thread creation queue
export const threadCreationQueue = new SerialQueue();

export class Queue {
  private running: boolean;
  private queue: Array<() => Promise<void>>;

  constructor() {
    this.running = false;
    this.queue = [];
  }

  add(fn: () => Promise<void>) {
    const promise = new Promise<void>((resolve) => {
      this.queue.push(async () => {
        await Promise.resolve(fn());
        resolve();
      });

      if (!this.running) this.next();
    });

    return promise;
  }

  next() {
    this.running = true;

    if (this.queue.length === 0) {
      this.running = false;
      return;
    }

    const fn = this.queue.shift();
    if (fn) {
      new Promise((resolve) => {
        // Either fn() completes or the timeout of 10sec is reached
        fn().then(resolve);
        setTimeout(resolve, 10000);
      }).then(() => this.next());
    }
  }
}

export const messageQueue = new Queue();
