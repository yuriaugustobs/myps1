"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RTCRole = "host" | "guest";
export type ConnectionStatus =
  | "idle"
  | "waiting-guest"
  | "connecting"
  | "waiting-answer"
  | "connected"
  | "disconnected"
  | "error";

export interface InputMessage {
  type: "input";
  player: 2;
  buttons: number;
  axisX: number;
  axisY: number;
}

interface UseWebRTCOptions {
  roomId: string;
  role: RTCRole;
  getVideoStream?: () => MediaStream | null;
  onRemoteStream?: (stream: MediaStream) => void;
  onGuestInput?: (msg: InputMessage) => void;
  onStatusChange?: (status: string) => void;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export function useWebRTC({
  roomId,
  role,
  getVideoStream,
  onRemoteStream,
  onGuestInput,
  onStatusChange,
}: UseWebRTCOptions) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const sinceRef = useRef<number>(0);
  const runIdRef = useRef(0);
  const seenMsgIdsRef = useRef<Set<number>>(new Set());
  const offerSentRef = useRef(false);
  const guestRemoteStreamRef = useRef<MediaStream | null>(null);

  const log = useCallback((msg: string, ...args: unknown[]) => {
    const prefix = role === "host" ? "[Host]" : "[Guest]";
    console.log(`${prefix} ${msg}`, ...args);
    onStatusChange?.(`${prefix} ${msg}`);
  }, [role, onStatusChange]);

  const signal = useCallback(
    async (type: "offer" | "answer" | "ice", payload: unknown): Promise<void> => {
      log(`POSTing ${type}`);
      const res = await fetch(`/api/signal/${roomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, type, payload }),
      });
      if (!res.ok) {
        log(`Failed to POST ${type}:`, res.status);
      }
    },
    [roomId, role, log]
  );

  const sendInput = useCallback((msg: InputMessage) => {
    if (dcRef.current?.readyState === "open") {
      dcRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    const runId = ++runIdRef.current;
    let disposed = false;
    let localPc: RTCPeerConnection | null = null;
    let localSse: EventSource | null = null;
    let localPollTimer: number | null = null;
    let usingPolling = false;

    const isActive = () => !disposed && runId === runIdRef.current;

    // Defensively close any previous resources before starting a new run.
    sseRef.current?.close();
    pcRef.current?.close();
    sseRef.current = null;
    pcRef.current = null;
    dcRef.current = null;

    offerSentRef.current = false;
    guestRemoteStreamRef.current = null;
    seenMsgIdsRef.current = new Set();

    interface SigMsg {
      id: number;
      type: "offer" | "answer" | "ice";
      from: string;
      ts: number;
      payload: unknown;
    }

    const handleSignalMessage = async (msg: SigMsg, source: "sse" | "poll") => {
      if (seenMsgIdsRef.current.has(msg.id)) {
        log(`${source.toUpperCase()} duplicate ignored: id=${msg.id}, type=${msg.type}, from=${msg.from}`);
        return;
      }
      seenMsgIdsRef.current.add(msg.id);
      log(`${source.toUpperCase()} msg: id=${msg.id}, type=${msg.type}, from=${msg.from}, ts=${msg.ts}`);
      sinceRef.current = Math.max(sinceRef.current, msg.id);

      const pc = pcRef.current;
      if (!pc) {
        log("No PC, skipping message");
        return;
      }

      try {
        if (msg.type === "offer" && role === "guest") {
          log(`Received offer, signalingState=${pc.signalingState}`);

          const incomingOffer = msg.payload as RTCSessionDescriptionInit;
          if (
            pc.remoteDescription?.type === "offer" &&
            pc.remoteDescription.sdp === incomingOffer.sdp &&
            pc.localDescription?.type === "answer"
          ) {
            log("Duplicate offer with same SDP ignored");
            return;
          }

          if (pc.signalingState !== "stable") {
            log(`Wrong state ${pc.signalingState}, ignoring`);
            return;
          }

          log("Setting remote description (offer)...");
          await pc.setRemoteDescription(
            new RTCSessionDescription(incomingOffer)
          );
          if (!isActive()) return;
          log("Creating answer...");
          const answer = await pc.createAnswer();
          if (!isActive()) return;
          await pc.setLocalDescription(answer);
          if (!isActive()) return;
          log("POSTing answer...");
          await signal("answer", answer);
          if (!isActive()) return;
          log("Answer sent!");
        } else if (msg.type === "answer" && role === "host") {
          log(`Received answer, signalingState=${pc.signalingState}`);

          if (pc.remoteDescription && pc.remoteDescription.type === "answer") {
            log("Already have remote answer set, ignoring duplicate");
            return;
          }

          try {
            log("Setting remote description (answer)...");
            await pc.setRemoteDescription(
              new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit)
            );
            if (!isActive()) return;
            log("Remote description set successfully!");
          } catch (err) {
            log(`Error setting remote desc (may already be set): ${err}`);
          }
        } else if (msg.type === "ice") {
          log(`Received ICE, signalingState=${pc.signalingState}`);

          if (pc.iceConnectionState === "closed") {
            log("PC closed, ignoring ICE");
            return;
          }

          await pc.addIceCandidate(
            new RTCIceCandidate(msg.payload as RTCIceCandidateInit)
          );
          if (!isActive()) return;
          log("ICE candidate added");
        }
      } catch (err) {
        log(`ERROR: ${err}`);
        console.error("WebRTC error:", err);
        setStatus("error");
      }
    };

    const startPolling = () => {
      if (!isActive() || usingPolling) return;
      usingPolling = true;
      log("SSE unavailable, switching to polling fallback");

      localSse?.close();
      if (sseRef.current === localSse) {
        sseRef.current = null;
      }
      localSse = null;

      const pollOnce = async () => {
        if (!isActive()) return;
        try {
          const res = await fetch(
            `/api/signal/${roomId}?role=${role}&since=${sinceRef.current}&poll=1`,
            { cache: "no-store" }
          );
          if (!res.ok) {
            log(`Polling failed with status ${res.status}`);
            return;
          }
          const data = (await res.json()) as { messages?: SigMsg[] };
          for (const msg of data.messages ?? []) {
            if (!isActive()) return;
            await handleSignalMessage(msg, "poll");
          }
        } catch (err) {
          log(`Polling error: ${err}`);
        }
      };

      void pollOnce();
      localPollTimer = window.setInterval(() => {
        void pollOnce();
      }, 700);
    };

    async function start() {
      if (role === "host") {
        // ── HOST: Wait for stream, then create PC ─────────────────────
        let stream: MediaStream | null = null;
        let attempts = 0;
        
        log("Waiting for video stream...");
        while (!stream && attempts < 60) {
          if (!isActive()) return;
          stream = getVideoStream?.() ?? null;
          if (stream && stream.getTracks().length > 0) {
            log(`Stream ready with ${stream.getTracks().length} tracks`);
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
          attempts++;
        }

        if (!stream || stream.getTracks().length === 0) {
          if (!isActive()) return;
          log("ERROR: No stream after timeout");
          setStatus("error");
          return;
        }

        // Create peer connection
        log("Creating RTCPeerConnection...");
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        localPc = pc;
        pcRef.current = pc;

        pc.onconnectionstatechange = () => {
          if (!isActive()) return;
          const s = pc.connectionState;
          log(`Connection state: ${s}`);
          if (s === "connected") setStatus("connected");
          else if (s === "disconnected" || s === "failed" || s === "closed") {
            setStatus("disconnected");
          }
        };

        pc.onicecandidate = ({ candidate }) => {
          if (!isActive()) return;
          if (candidate) {
            log("Sending ICE candidate");
            signal("ice", candidate.toJSON());
          }
        };

        // Add video track
        stream.getTracks().forEach((t) => {
          log(`Adding track: ${t.kind}, ${t.label}`);
          pc.addTrack(t, stream!);
        });
        log("Video track added to PC");

        // Also listen for remote tracks (in case host wants to receive from guest)
        pc.ontrack = (e) => {
          log(`[HOST] Received remote track, streams: ${e.streams.length}, track: ${e.track?.label}`);
        };

        // Data channel for P2 inputs
        const dc = pc.createDataChannel("inputs");
        dcRef.current = dc;
        dc.onopen = () => log("Data channel opened");
        dc.onmessage = (e) => {
          log("Received input from guest:", e.data);
          if (onGuestInput) {
            try {
              onGuestInput(JSON.parse(e.data) as InputMessage);
            } catch {/* ignore */}
          }
        };

        // Create and send offer
        log("Creating offer...");
        const offer = await pc.createOffer();
        if (!isActive()) return;
        await pc.setLocalDescription(offer);
        if (!isActive()) return;
        log("Offer created, POSTing...");
        await signal("offer", offer);
        if (!isActive()) return;
        offerSentRef.current = true;
        log("Offer sent successfully!");
        setStatus("waiting-answer");
      } else {
        // ── GUEST: Create PC, wait for offer ─────────────────────────
        log("Creating RTCPeerConnection as guest...");
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        localPc = pc;
        pcRef.current = pc;

        pc.onconnectionstatechange = () => {
          if (!isActive()) return;
          const s = pc.connectionState;
          log(`Connection state: ${s}`);
          if (s === "connected") setStatus("connected");
          else if (s === "disconnected" || s === "failed" || s === "closed") {
            setStatus("disconnected");
          }
        };

        pc.onicecandidate = ({ candidate }) => {
          if (!isActive()) return;
          if (candidate) {
            log("Sending ICE candidate");
            signal("ice", candidate.toJSON());
          }
        };

        pc.ontrack = (e) => {
          log(`[GUEST] Received remote track, streams: ${e.streams.length}, track: ${e.track?.kind} ${e.track?.label}`);
          if (!onRemoteStream) return;

          let stream = e.streams[0];
          if (!stream) {
            if (!guestRemoteStreamRef.current) {
              guestRemoteStreamRef.current = new MediaStream();
            }
            guestRemoteStreamRef.current.addTrack(e.track);
            stream = guestRemoteStreamRef.current;
          }

          log(`[GUEST] Calling onRemoteStream with stream having ${stream.getTracks().length} tracks`);
          onRemoteStream(stream);
        };

        pc.ondatachannel = (e) => {
          log("Received data channel");
          dcRef.current = e.channel;
        };

        setStatus("waiting-guest");
        log("Waiting for offer from host...");
      }

      // ── SSE listener ─────────────────────────────────────────────
      log(`Connecting to SSE /api/signal/${roomId}?role=${role}`);
      const sse = new EventSource(
        `/api/signal/${roomId}?role=${role}&since=${sinceRef.current}`
      );
      localSse = sse;
      sseRef.current = sse;

      sse.onopen = () => {
        if (!isActive()) return;
        log("SSE connected");
      };

      sse.onmessage = async (e) => {
        if (!isActive()) return;
        const msg = JSON.parse(e.data) as SigMsg;
        await handleSignalMessage(msg, "sse");
      };

      sse.onerror = (e) => {
        if (!isActive()) return;
        log(`SSE error: ${e}`);
        startPolling();
      };
    }

    start().catch((err) => {
      log(`Start error: ${err}`);
      setStatus("error");
    });

    return () => {
      disposed = true;
      if (localPollTimer !== null) {
        window.clearInterval(localPollTimer);
      }
      localSse?.close();
      localPc?.close();
      if (pcRef.current === localPc) {
        pcRef.current = null;
      }
      if (sseRef.current === localSse) {
        sseRef.current = null;
      }
      dcRef.current = null;
    };
  }, [roomId, role]); // eslint-disable-line react-hooks/exhaustive-deps

  return { status, sendInput };
}
