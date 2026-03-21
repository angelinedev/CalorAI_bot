import { EventEmitter } from 'node:events';

export class EventBus {
  constructor() {
    this.emitter = new EventEmitter();
  }

  publish(event) {
    this.emitter.emit('event', event);
  }

  subscribe(listener) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
