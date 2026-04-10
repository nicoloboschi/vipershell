export type Subscriber<T> = (msg: T) => void;

export class PubSub<T> {
  private channels = new Map<string, Set<Subscriber<T>>>();

  subscribe(channel: string, fn: Subscriber<T>): () => void {
    if (!this.channels.has(channel)) this.channels.set(channel, new Set());
    this.channels.get(channel)!.add(fn);
    return () => this.unsubscribe(channel, fn);
  }

  unsubscribe(channel: string, fn: Subscriber<T>): void {
    const set = this.channels.get(channel);
    if (set) {
      set.delete(fn);
      if (set.size === 0) this.channels.delete(channel);
    }
  }

  publish(channel: string, msg: T): void {
    this.channels.get(channel)?.forEach(fn => {
      try { fn(msg); } catch { /* ignore */ }
    });
  }

  channelSize(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }

  channelStats(): { channel: string; subscribers: number }[] {
    return [...this.channels.entries()].map(([channel, subs]) => ({
      channel,
      subscribers: subs.size,
    }));
  }
}
