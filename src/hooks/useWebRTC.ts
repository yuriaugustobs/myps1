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
  const cleanedUp = useRef(false);
  const offerSentRef = useRef(false);

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
    cleanedUp.current = false;
    offerSentRef.current = false;

    async function start() {
      if (role === "host") {
        // ── HOST: Wait for stream, then create PC ─────────────────────
        let stream: MediaStream | null = null;
        let attempts = 0;
        
        log("Waiting for video stream...");
        while (!stream && attempts < 60) {
          stream = getVideoStream?.() ?? null;
          if (stream && stream.getTracks().length > 0) {
            log(`Stream ready with ${stream.getTracks().length} tracks`);
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
          attempts++;
        }

        if (!stream || stream.getTracks().length === 0) {
          log("ERROR: No stream after timeout");
          setStatus("error");
          return;
        }

        // Create peer connection
        log("Creating RTCPeerConnection...");
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        pc.onconnectionstatechange = () => {
          if (cleanedUp.current) return;
          const s = pc.connectionState;
          log(`Connection state: ${s}`);
          if (s === "connected") setStatus("connected");
          else if (s === "disconnected" || s === "failed" || s === "closed") {
            setStatus("disconnected");
          }
        };

        pc.onicecandidate = ({ candidate }) => {
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
        await pc.setLocalDescription(offer);
        log("Offer created, POSTing...");
        await signal("offer", offer);
        offerSentRef.current = true;
        log("Offer sent successfully!");
        setStatus("waiting-answer");
      } else {
        // ── GUEST: Create PC, wait for offer ─────────────────────────
        log("Creating RTCPeerConnection as guest...");
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        pc.onconnectionstatechange = () => {
          if (cleanedUp.current) return;
          const s = pc.connectionState;
          log(`Connection state: ${s}`);
          if (s === "connected") setStatus("connected");
          else if (s === "disconnected" || s === "failed" || s === "closed") {
            setStatus("disconnected");
          }
        };

        pc.onicecandidate = ({ candidate }) => {
          if (candidate) {
            log("Sending ICE candidate");
            signal("ice", candidate.toJSON());
          }
        };

        pc.ontrack = (e) => {
          log(`[GUEST] Received remote track, streams: ${e.streams.length}, track: ${e.track?.kind} ${e.track?.label}`);
          if (onRemoteStream && e.streams[0]) {
            log(`[GUEST] Calling onRemoteStream with stream having ${e.streams[0].getTracks().length} tracks`);
            onRemoteStream(e.streams[0]);
          }
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
      sseRef.current = sse;

      sse.onopen = () => {
        log("SSE connected");
      };

      sse.onmessage = async (e) => {
        if (cleanedUp.current) return;
        
        interface SigMsg {
          type: "offer" | "answer" | "ice";
          from: string;
          ts: number;
          payload: unknown;
        }
        
        const msg: SigMsg = JSON.parse(e.data);
        log(`SSE msg: type=${msg.type}, from=${msg.from}, ts=${msg.ts}`);
        sinceRef.current = Date.now();

        const pc = pcRef.current;
        if (!pc) {
          log("No PC, skipping message");
          return;
        }

        try {
          if (msg.type === "offer" && role === "guest") {
            log(`Received offer, signalingState=${pc.signalingState}`);
            
            if (pc.signalingState !== "stable") {
              log(`Wrong state ${pc.signalingState}, ignoring`);
              return;
            }

            log("Setting remote description (offer)...");
            await pc.setRemoteDescription(
              new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit)
            );
            log("Creating answer...");
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            log("POSTing answer...");
            await signal("answer", answer);
            log("Answer sent!");
            
          } else if (msg.type === "answer" && role === "host") {
            log(`Received answer, signalingState=${pc.signalingState}`);
            
            // Allow both "have-local-offer" and "stable" states
            // Also check if already have remote description set
            if (pc.signalingState === "stable" && pc.remoteDescription) {
              log("Already have remote description, ignoring duplicate answer");
              return;
            }
            if (pc.signalingState !== "have-local-offer" && pc.signalingState !== "stable") {
              log(`Wrong state ${pc.signalingState}, ignoring`);
              return;
            }

            log("Setting remote description (answer)...");
            await pc.setRemoteDescription(
              new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit)
            );
            log("Remote description set successfully!");
            
          } else if (msg.type === "ice") {
            log(`Received ICE, signalingState=${pc.signalingState}`);
            
            if (pc.signalingState === "closed") {
              log("PC closed, ignoring ICE");
              return;
            }

            await pc.addIceCandidate(
              new RTCIceCandidate(msg.payload as RTCIceCandidateInit)
            );
            log("ICE candidate added");
          }
        } catch (err) {
          log(`ERROR: ${err}`);
          console.error("WebRTC error:", err);
          setStatus("error");
        }
      };

      sse.onerror = (e) => {
        log(`SSE error: ${e}`);
        if (!cleanedUp.current) setStatus("error");
      };
    }

    start().catch((err) => {
      log(`Start error: ${err}`);
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
