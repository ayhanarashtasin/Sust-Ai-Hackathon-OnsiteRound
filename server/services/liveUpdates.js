import { EventEmitter } from 'node:events';

export const liveUpdates = new EventEmitter();

export function notifyDataUpdate() {
  liveUpdates.emit('data-updated');
}
