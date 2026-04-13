import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  pushMessage,
  getMessages,
  addListener,
  removeListener,
  type SignalRole,
  type SignalMessage,
  type SignalMessageInput,
} from "@/lib/signal-store";

type Params = { params: Promise<{ roomId: string }> };

/**
 * POST /api/signal/[roomId]
 * Body: { role: "host"|"guest", type: "offer"|"answer"|"ice", payload: any }
 * Pushes a signaling message and notifies SSE listeners.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { roomId } = await params;
  const body = await req.json();
  const { role, type, payload } = body as {
    role: SignalRole;
    type: SignalMessage["type"];
    payload: unknown;
  };

  if (!role || !type || payload === undefined) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const msg: SignalMessageInput = { from: role, type, payload, ts: Date.now() };
  pushMessage(roomId, msg);
  return NextResponse.json({ ok: true });
}

/**
 * GET /api/signal/[roomId]?role=host|guest&since=messageId
 * Returns an SSE stream that delivers signaling messages for this role.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { roomId } = await params;
  const url = new URL(req.url);
  const role = url.searchParams.get("role") as SignalRole | null;
  const sinceParam = parseInt(url.searchParams.get("since") ?? "0", 10);
  const since = Number.isFinite(sinceParam) ? sinceParam : 0;

  if (!role || (role !== "host" && role !== "guest")) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const listenerId = uuidv4();

  // Send buffered messages first, then stream new ones
  const buffered = getMessages(roomId, since, role);

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      // Flush already-buffered messages immediately
      for (const msg of buffered) {
        ctrl.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(msg)}\n\n`)
        );
      }
      // Register for future pushes
      addListener(roomId, listenerId, role, ctrl);
    },
    cancel() {
      removeListener(roomId, listenerId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
