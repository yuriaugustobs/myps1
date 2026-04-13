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

    async function start() {
      setStatus("connecting");

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

      // ICE trickle
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) signal("ice", candidate.toJSON());
      };

      if (role === "host") {
        // ── HOST ──────────────────────────────────────────────
        // Wait for video stream first before setting up anything else
        let streamAdded = false;
        
        const waitForStreamAndSetup = async () => {
          if (!getVideoStream) return;
          
          console.log('[RetroLink] Waiting for stream...');
          let attempts = 0;
          while (!streamAdded && attempts < 30) {
            const stream = getVideoStream();
            if (stream && stream.getTracks().length > 0) {
              stream.getTracks().forEach((t) => pc.addTrack(t, stream));
              streamAdded = true;
              console.log('[RetroLink] Stream added to peer connection');
              break;
            }
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
          }
          
          // Now create offer
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await signal("offer", offer);
          console.log('[RetroLink] Offer sent');
        };

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

        // Start waiting for stream
        waitForStreamAndSetup();
      } else {
        // ── GUEST ─────────────────────────────────────────────
        // Receive remote stream
        pc.ontrack = (e) => {
          if (onRemoteStream && e.streams[0]) {
            onRemoteStream(e.streams[0]);
          }
        };

        // Receive data channel for sending inputs
        pc.ondatachannel = (e) => {
          dcRef.current = e.channel;
        };
      }

      // ── SSE listener ─────────────────────────────────────────
      const sse = new EventSource(
        `/api/signal/${roomId}?role=${role}&since=${sinceRef.current}`
      );
      sseRef.current = sse;

      sse.onmessage = async (e) => {
        if (cleanedUp.current) return;
        interface SigMsg {
          type: "offer" | "answer" | "ice";
          payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
        }
        const msg: SigMsg = JSON.parse(e.data);
        sinceRef.current = Date.now();

        try {
          if (msg.type === "offer" && role === "guest") {
            await pc.setRemoteDescription(
              new RTCSessionDescription(
                msg.payload as RTCSessionDescriptionInit
              )
            );
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await signal("answer", answer);
          } else if (msg.type === "answer" && role === "host") {
            await pc.setRemoteDescription(
              new RTCSessionDescription(
                msg.payload as RTCSessionDescriptionInit
              )
            );
          } else if (msg.type === "ice") {
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
