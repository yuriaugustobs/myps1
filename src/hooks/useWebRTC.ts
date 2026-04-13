"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RTCRole = "host" | "guest";
export type ConnectionStatus =
  | "idle"
  | "connecting"
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
  /** Host only: function to get video stream from emulator */
  getVideoStream?: () => MediaStream | null;
  /** Called on guest when remote stream arrives */
  onRemoteStream?: (stream: MediaStream) => void;
  /** Called on host when guest sends input */
  onGuestInput?: (msg: InputMessage) => void;
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
}: UseWebRTCOptions) {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const sinceRef = useRef<number>(0);
  const cleanedUp = useRef(false);
  const processedRef = useRef<Set<number>>(new Set());

  const signal = useCallback(
    async (
      type: "offer" | "answer" | "ice",
      payload: unknown
    ): Promise<void> => {
      await fetch(`/api/signal/${roomId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, type, payload }),
      });
    },
    [roomId, role]
  );

  /** Send guest input over data channel */
  const sendInput = useCallback((msg: InputMessage) => {
    if (dcRef.current?.readyState === "open") {
      dcRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    cleanedUp.current = false;
    processedRef.current.clear();

    async function start() {
      setStatus("connecting");

      if (role === "host") {
        // ── HOST ──────────────────────────────────────────────
        // Wait for video stream BEFORE creating peer connection
        let stream: MediaStream | null = null;
        let attempts = 0;
        
        console.log('[RetroLink] Waiting for stream before creating PC...');
        while (!stream && attempts < 60) {
          stream = getVideoStream?.() ?? null;
          if (stream && stream.getTracks().length > 0) {
            console.log('[RetroLink] Stream ready, creating peer connection');
            break;
          }
          await new Promise(r => setTimeout(r, 500));
          attempts++;
        }

        if (!stream || stream.getTracks().length === 0) {
          console.error('[RetroLink] No stream available after timeout');
          setStatus("error");
          return;
        }

        // Only now create peer connection
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        pc.onconnectionstatechange = () => {
          if (cleanedUp.current) return;
          const s = pc.connectionState;
          if (s === "connected") setStatus("connected");
          else if (s === "disconnected" || s === "failed" || s === "closed") {
            setStatus("disconnected");
          }
        };

        pc.onicecandidate = ({ candidate }) => {
          if (candidate) signal("ice", candidate.toJSON());
        };

        // Add tracks to the already-ready peer connection
        stream.getTracks().forEach((t) => pc.addTrack(t, stream!));
        console.log('[RetroLink] Stream added to peer connection');

        // Data channel for receiving guest inputs
        const dc = pc.createDataChannel("inputs");
        dcRef.current = dc;
        dc.onmessage = (e) => {
          if (onGuestInput) {
            try {
              onGuestInput(JSON.parse(e.data) as InputMessage);
            } catch {
              /* ignore */
            }
          }
        };

        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await signal("offer", offer);
        console.log('[RetroLink] Offer sent');
      } else {
        // ── GUEST ─────────────────────────────────────────────
        // Guest creates PC immediately and waits for offer
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        pc.onconnectionstatechange = () => {
          if (cleanedUp.current) return;
          const s = pc.connectionState;
          if (s === "connected") setStatus("connected");
          else if (s === "disconnected" || s === "failed" || s === "closed") {
            setStatus("disconnected");
          }
        };

        pc.onicecandidate = ({ candidate }) => {
          if (candidate) signal("ice", candidate.toJSON());
        };

        pc.ontrack = (e) => {
          if (onRemoteStream && e.streams[0]) {
            onRemoteStream(e.streams[0]);
          }
        };

        pc.ondatachannel = (e) => {
          dcRef.current = e.channel;
        };
      }

      // ── SSE listener (both roles) ───────────────────────────
      const sse = new EventSource(
        `/api/signal/${roomId}?role=${role}&since=${sinceRef.current}`
      );
      sseRef.current = sse;

      sse.onmessage = async (e) => {
        if (cleanedUp.current) return;
        interface SigMsg {
          type: "offer" | "answer" | "ice";
          ts: number;
          payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
        }
        const msg: SigMsg = JSON.parse(e.data);
        sinceRef.current = Date.now();

        // Deduplicate by timestamp
        const msgKey = msg.ts;
        if (processedRef.current.has(msgKey)) {
          console.log('[RetroLink] Duplicate message, skipping');
          return;
        }
        processedRef.current.add(msgKey);

        const pc = pcRef.current;
        if (!pc) return;

        try {
          if (msg.type === "offer" && role === "guest") {
            // Check if we can set remote description
            if (pc.signalingState === "have-local-offer") {
              console.log('[RetroLink] Guest: already have local offer, ignoring duplicate');
              return;
            }
            await pc.setRemoteDescription(
              new RTCSessionDescription(
                msg.payload as RTCSessionDescriptionInit
              )
            );
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await signal("answer", answer);
          } else if (msg.type === "answer" && role === "host") {
            // Check if we can set remote description
            if (pc.signalingState !== "have-local-offer") {
              console.log('[RetroLink] Host: not in have-local-offer state, ignoring');
              return;
            }
            await pc.setRemoteDescription(
              new RTCSessionDescription(
                msg.payload as RTCSessionDescriptionInit
              )
            );
          } else if (msg.type === "ice") {
            if (pc.signalingState === "closed") {
              console.log('[RetroLink] PC closed, ignoring ICE candidate');
              return;
            }
            await pc.addIceCandidate(
              new RTCIceCandidate(msg.payload as RTCIceCandidateInit)
            );
          }
        } catch (err) {
          console.error("WebRTC signaling error", err);
          setStatus("error");
        }
      };

      sse.onerror = () => {
        if (!cleanedUp.current) setStatus("error");
      };
    }

    start().catch((err) => {
      console.error("WebRTC start error", err);
      setStatus("error");
    });

    return () => {
      cleanedUp.current = true;
      sseRef.current?.close();
      pcRef.current?.close();
    };
  }, [roomId, role]); // eslint-disable-line react-hooks/exhaustive-deps

  return { status, sendInput };
}
