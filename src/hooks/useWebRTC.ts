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
  const seenMsgIdsRef = useRef<Set<number>>(new Set());
  const cleanedUp = useRef(false);
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
    cleanedUp.current = false;
    offerSentRef.current = false;
    guestRemoteStreamRef.current = null;
    seenMsgIdsRef.current = new Set();

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
      sseRef.current = sse;

      sse.onopen = () => {
        log("SSE connected");
      };

      sse.onmessage = async (e) => {
        if (cleanedUp.current) return;
        
        interface SigMsg {
          id: number;
          type: "offer" | "answer" | "ice";
          from: string;
          ts: number;
          payload: unknown;
        }
        
        const msg: SigMsg = JSON.parse(e.data);
        if (seenMsgIdsRef.current.has(msg.id)) {
          log(`SSE duplicate ignored: id=${msg.id}, type=${msg.type}, from=${msg.from}`);
          return;
        }
        seenMsgIdsRef.current.add(msg.id);
        log(`SSE msg: id=${msg.id}, type=${msg.type}, from=${msg.from}, ts=${msg.ts}`);
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
            log("Creating answer...");
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            log("POSTing answer...");
            await signal("answer", answer);
            log("Answer sent!");
            
          } else if (msg.type === "answer" && role === "host") {
            log(`Received answer, signalingState=${pc.signalingState}`);
            
            // ALWAYS check if remote description already set first (ignore duplicates)
            if (pc.remoteDescription && pc.remoteDescription.type === "answer") {
              log("Already have remote answer set, ignoring duplicate");
              return;
            }
            
            // Now try to set it (works for both have-local-offer and stable)
            try {
              log("Setting remote description (answer)...");
              await pc.setRemoteDescription(
                new RTCSessionDescription(msg.payload as RTCSessionDescriptionInit)
              );
              log("Remote description set successfully!");
            } catch (err) {
              // If it fails, it's probably already set - that's OK
              log(`Error setting remote desc (may already be set): ${err}`);
            }
            
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
