/**
 * In-memory signaling store for WebRTC P2P negotiation.
 * Stores pending messages (offer, answer, ICE candidates) per room.
 * SSE listeners are registered per room + role, and flushed when new messages arrive.
 */

export type SignalRole = "host" | "guest";

export interface SignalMessage {
  id: number;
  from: SignalRole;
  type: "offer" | "answer" | "ice";
  payload: unknown;
  ts: number;
}

export type SignalMessageInput = Omit<SignalMessage, "id">;

interface RoomState {
  messages: SignalMessage[];
  nextMessageId: number;
  /** SSE response controllers waiting for messages */
  listeners: Map<
    string,
    {
      role: SignalRole;
      ctrl: ReadableStreamDefaultController<Uint8Array>;
    }
  >;
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
    store.set(roomId, { messages: [], nextMessageId: 1, listeners: new Map() });
  }
  return store.get(roomId)!;
}

export function pushMessage(roomId: string, msg: SignalMessageInput): SignalMessage {
  const room = getRoom(roomId);
  const fullMsg: SignalMessage = {
    ...msg,
    id: room.nextMessageId++,
  };
  room.messages.push(fullMsg);
  // Notify only listeners of the opposite role.
  for (const [, listener] of room.listeners) {
    try {
      if (listener.role === fullMsg.from) continue;
      const data = `data: ${JSON.stringify(fullMsg)}\n\n`;
      listener.ctrl.enqueue(new TextEncoder().encode(data));
    } catch {
      // listener already closed
    }
  }
  return fullMsg;
}

export function getMessages(
  roomId: string,
  sinceId: number,
  forRole: SignalRole
): SignalMessage[] {
  const room = getRoom(roomId);
  // Return messages sent TO this role (i.e. FROM the opposite role), newer than `since`
  const opposite: SignalRole = forRole === "host" ? "guest" : "host";
  return room.messages.filter((m) => m.from === opposite && m.id > sinceId);
}

export function addListener(
  roomId: string,
  listenerId: string,
  role: SignalRole,
  ctrl: ReadableStreamDefaultController<Uint8Array>
): void {
  getRoom(roomId).listeners.set(listenerId, { role, ctrl });
}

export function removeListener(roomId: string, listenerId: string): void {
  store.get(roomId)?.listeners.delete(listenerId);
}
