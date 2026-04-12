/**
 * In-memory signaling store for WebRTC P2P negotiation.
 * Stores pending messages (offer, answer, ICE candidates) per room.
 * SSE listeners are registered per room + role, and flushed when new messages arrive.
 */

export type SignalRole = "host" | "guest";

export interface SignalMessage {
  from: SignalRole;
  type: "offer" | "answer" | "ice";
  payload: unknown;
  ts: number;
}

interface RoomState {
  messages: SignalMessage[];
  /** SSE response controllers waiting for messages */
  listeners: Map<string, ReadableStreamDefaultController<Uint8Array>>;
}

// Global singleton – persists across hot reloads in dev via module cache
const store: Map<string, RoomState> = (
  globalThis as unknown as {
    __signalStore?: Map<string, RoomState>;
  }
).__signalStore ??
  (() => {
    const m = new Map<string, RoomState>();
    (
      globalThis as unknown as {
        __signalStore?: Map<string, RoomState>;
      }
    ).__signalStore = m;
    return m;
  })();

export function getRoom(roomId: string): RoomState {
  if (!store.has(roomId)) {
    store.set(roomId, { messages: [], listeners: new Map() });
  }
  return store.get(roomId)!;
}

export function pushMessage(roomId: string, msg: SignalMessage): void {
  const room = getRoom(roomId);
  room.messages.push(msg);
  // Notify all SSE listeners
  for (const [, ctrl] of room.listeners) {
    try {
      const data = `data: ${JSON.stringify(msg)}\n\n`;
      ctrl.enqueue(new TextEncoder().encode(data));
    } catch {
      // listener already closed
    }
  }
}

export function getMessages(
  roomId: string,
  since: number,
  forRole: SignalRole
): SignalMessage[] {
  const room = getRoom(roomId);
  // Return messages sent TO this role (i.e. FROM the opposite role), newer than `since`
  const opposite: SignalRole = forRole === "host" ? "guest" : "host";
  return room.messages.filter((m) => m.from === opposite && m.ts > since);
}

export function addListener(
  roomId: string,
  listenerId: string,
  ctrl: ReadableStreamDefaultController<Uint8Array>
): void {
  getRoom(roomId).listeners.set(listenerId, ctrl);
}

export function removeListener(roomId: string, listenerId: string): void {
  store.get(roomId)?.listeners.delete(listenerId);
}
