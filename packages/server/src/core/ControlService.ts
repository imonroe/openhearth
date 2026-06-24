/**
 * ControlService — the client-agnostic control protocol core (PRD §11).
 *
 * Holds the authoritative {@link StateSnapshot}, applies validated commands via
 * the shared pure reducer, and broadcasts `state_changed` events to every
 * connected client. The same command path is reachable over WebSocket
 * (`/api/v1/control/ws`) and the REST mirror (`POST /api/v1/control/command`),
 * so a simple client can drive the UI without a socket.
 */
import {
  INITIAL_STATE,
  applyCommand,
  makeStateEvent,
  type CommandMessage,
  type EventMessage,
  type StateSnapshot,
} from '@openhearth/shared';

/** A connected client that receives broadcast events (e.g. a WS socket). */
export interface ControlSubscriber {
  send: (event: EventMessage) => void;
}

export class ControlService {
  private state: StateSnapshot = INITIAL_STATE;
  private readonly subscribers = new Set<ControlSubscriber>();

  /** Current authoritative state snapshot. */
  getState(): StateSnapshot {
    return this.state;
  }

  /**
   * Apply a validated command and broadcast the resulting state to all
   * subscribers. Returns the new state. The command is assumed already schema-
   * validated by the caller (route layer).
   */
  dispatch(command: CommandMessage): StateSnapshot {
    this.state = applyCommand(this.state, command);
    const event = makeStateEvent(this.state);
    for (const subscriber of this.subscribers) {
      try {
        subscriber.send(event);
      } catch {
        // A dead/again-closing socket shouldn't break the broadcast loop.
        this.subscribers.delete(subscriber);
      }
    }
    return this.state;
  }

  /** Register a subscriber; returns an unsubscribe function. */
  subscribe(subscriber: ControlSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /** Number of active subscribers (for diagnostics/tests). */
  get subscriberCount(): number {
    return this.subscribers.size;
  }
}
