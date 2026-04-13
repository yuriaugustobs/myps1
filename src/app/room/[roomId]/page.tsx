"use client";

import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebRTC, type InputMessage, type RTCRole } from "@/hooks/useWebRTC";
import type { EmulatorHandle } from "@/components/EmulatorCanvas";

// Load emulator only client-side (uses canvas/WASM)
const EmulatorCanvas = dynamic(() => import("@/components/EmulatorCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full bg-black text-neutral-500 text-sm">
      Carregando emulador…
    </div>
  ),
});

type Phase =
  | "load-rom"    // host: pick ROM
  | "playing"     // host: emulator running
  | "guest-wait"  // guest: waiting for stream
  | "guest-play"; // guest: stream received

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const searchParams = useSearchParams();
  const roleParam = searchParams.get("role") as RTCRole | null;

  // Determine role: if ?role=host → host, otherwise guest
  const role: RTCRole = roleParam === "host" ? "host" : "guest";

  const [phase, setPhase] = useState<Phase>(() =>
    role === "guest" ? "guest-wait" : "load-rom"
  );

  const [romFile, setRomFile] = useState<File | null>(null);
  const [biosFile, setBiosFile] = useState<File | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [webrtcLogs, setWebrtcLogs] = useState<string[]>([]);

  const emuRef = useRef<EmulatorHandle>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString();
    setWebrtcLogs(prev => [...prev.slice(-19), `${time} ${msg}`]);
  }, []);

  // Sync hostCanvasRef from EmulatorHandle - poll for canvas since iframe takes time to load
  const getVideoStream = useCallback(() => {
    if (emuRef.current) {
      return emuRef.current.getVideoStream();
    }
    return null;
  }, []);

  // ── Input state ───────────────────────────────────────────
  const [p2InputMsg, setP2InputMsg] = useState<InputMessage | null>(null);

  const onGuestInput = useCallback((msg: InputMessage) => {
    setP2InputMsg(msg);
    emuRef.current?.injectP2Input(msg);
  }, []);

  const handleRemoteStream = useCallback((stream: MediaStream) => {
    setRemoteStream(stream);
    setPhase("guest-play");
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
      remoteVideoRef.current.play().catch(() => {
        // Autoplay can be delayed by browser policies; user interaction usually resolves it.
      });
    }
  }, []);

  useEffect(() => {
    if (!remoteStream || !remoteVideoRef.current) return;
    if (remoteVideoRef.current.srcObject !== remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    remoteVideoRef.current.play().catch(() => {
      // Keep silent; play will retry on interaction/metadata.
    });
  }, [remoteStream, phase]);

  // WebRTC hook — always called unconditionally at top level
  const { sendInput: sendInputToHost } = useWebRTC({
    roomId,
    role,
    getVideoStream: role === "host" ? getVideoStream : undefined,
    onRemoteStream: role === "guest" ? handleRemoteStream : undefined,
    onGuestInput: role === "host" ? onGuestInput : undefined,
    onStatusChange: addLog,
  });

  // ── Invite link ───────────────────────────────────────────
  const [inviteUrl, setInviteUrl] = useState("");
  useEffect(() => {
    setInviteUrl(`${window.location.origin}/room/${roomId}`);
  }, [roomId]);

  function copyInvite() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── ROM drop / pick ───────────────────────────────────────
  function handleRomFile(file: File) {
    setRomFile(file);
    setPhase("playing");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleRomFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleRomFile(file);
  }

  function handleBiosInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setBiosFile(file);
  }

  // Guest input → send via DataChannel to host
  const handleGuestInput = useCallback(
    (buttons: number, axisX: number, axisY: number) => {
      sendInputToHost({ type: "input", player: 2, buttons, axisX, axisY });
    },
    [sendInputToHost]
  );

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-[#0d0d0d] text-neutral-200">
      {/* Topbar */}
      <header className="border-b border-[#2a2a2a] px-4 py-3 flex items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-[#8b5cf6]"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"
              />
            </svg>
            <span className="font-bold tracking-widest text-xs uppercase">
              <span className="text-white">RETRO</span>
              <span className="text-[#8b5cf6]">LINK</span>
            </span>
          </Link>

          <span className="text-neutral-600 text-xs">|</span>
          <span className="text-neutral-500 text-xs font-mono">
            Sala: {roomId}
          </span>

          <span
            className={`text-xs px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
              role === "host"
                ? "bg-[#8b5cf6]/20 text-[#a78bfa]"
                : "bg-emerald-900/30 text-emerald-400"
            }`}
          >
            {role === "host" ? "Player 1 · Host" : "Player 2 · Guest"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {role === "host" && phase === "playing" && (
            <label className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-300 transition-colors px-3 py-1.5 border border-[#2a2a2a] rounded-lg">
              Trocar ROM
              <input
                type="file"
                accept=".bin,.cue,.iso,.pbp,.chd,.img"
                className="hidden"
                onChange={handleFileInput}
              />
            </label>
          )}

          {role === "host" && (
            <button
              onClick={copyInvite}
              className="flex items-center gap-2 text-xs px-3 py-1.5 border border-[#2a2a2a] rounded-lg hover:border-[#8b5cf6] hover:text-[#a78bfa] transition-colors"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
              {copied ? "Copiado!" : "Copiar convite"}
            </button>
          )}
        </div>
      </header>

      {/* Main area */}
      <main className="flex-1 flex">
        {/* ── HOST: load ROM ──────────────────────────────────── */}
        {role === "host" && phase === "load-rom" && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="w-full max-w-lg">
              <h1 className="text-2xl font-black uppercase tracking-tight text-white mb-2">
                Carregar Jogo
              </h1>
              <p className="text-sm text-neutral-400 mb-6">
                Selecione a ROM da PS1 para iniciar. O Player 2 receberá o
                vídeo automaticamente — sem precisar ter a ROM.
              </p>

              {/* Invite link box */}
              <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl p-4 mb-6">
                <p className="text-xs text-neutral-500 mb-2">
                  Sala criada! Envie este link para o Player 2:
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    className="flex-1 bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs font-mono text-neutral-400 outline-none"
                  />
                  <button
                    onClick={copyInvite}
                    className="px-3 py-2 bg-[#8b5cf6] hover:bg-[#7c3aed] transition-colors rounded-lg text-xs font-bold text-white"
                  >
                    {copied ? "✓" : "Copiar"}
                  </button>
                </div>
              </div>

              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                className={`border-2 border-dashed rounded-xl flex flex-col items-center justify-center py-14 mb-4 gap-3 transition-colors cursor-pointer ${
                  dragging
                    ? "border-[#8b5cf6] bg-[#8b5cf6]/10"
                    : "border-[#2a2a2a] hover:border-[#444] bg-[#161616]"
                }`}
              >
                <svg
                  className="w-10 h-10 text-neutral-600"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
                <p className="text-sm font-medium text-neutral-400">
                  Arraste a ROM aqui
                </p>
                <p className="text-xs text-neutral-600">
                  .bin .cue .iso .pbp .chd
                </p>
              </div>

              <label className="block w-full">
                <span className="block w-full text-center bg-[#8b5cf6] hover:bg-[#7c3aed] transition-colors rounded-xl py-3 text-sm font-bold uppercase tracking-widest text-white cursor-pointer">
                  Selecionar ROM
                </span>
                <input
                  type="file"
                  accept=".bin,.cue,.iso,.pbp,.chd,.img"
                  className="hidden"
                  onChange={handleFileInput}
                />
              </label>

              {/* BIOS optional */}
              <label className="mt-3 flex items-center gap-3 border border-[#2a2a2a] rounded-xl px-4 py-3 cursor-pointer hover:border-[#444] transition-colors bg-[#161616]">
                <svg
                  className="w-5 h-5 text-neutral-600 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 9a3 3 0 115.12 2.122c-.427.427-.877.96-1.12 1.878m0 2h.01"
                  />
                </svg>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-400">
                    BIOS PS1 (opcional)
                  </p>
                  <p className="text-xs text-[#8b5cf6] truncate">
                    {biosFile ? biosFile.name : "scph5501.bin recomendada"}
                  </p>
                </div>
                <input
                  type="file"
                  accept=".bin"
                  className="hidden"
                  onChange={handleBiosInput}
                />
              </label>
            </div>
          </div>
        )}

        {/* ── HOST: playing ───────────────────────────────────── */}
        {role === "host" && phase === "playing" && (
          <div className="flex-1 flex flex-col md:flex-row gap-0">
            {/* Canvas area */}
            <div className="flex-1 bg-black flex items-center justify-center relative min-h-[300px]">
              <div className="w-full h-full">
                <EmulatorCanvas
                  ref={emuRef}
                  romFile={romFile}
                  biosFile={biosFile}
                  guestMode={false}
                />
              </div>
            </div>

            {/* Sidebar */}
            <div className="w-full md:w-64 border-t md:border-t-0 md:border-l border-[#2a2a2a] bg-[#161616] p-4 space-y-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-1">
                  Jogo
                </p>
                <p className="text-sm text-neutral-300 truncate">
                  {romFile?.name ?? "—"}
                </p>
              </div>

              {p2InputMsg && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-1">
                    Player 2
                  </p>
                  <p className="text-xs text-emerald-400 font-mono">
                    conectado · btns:{" "}
                    <span className="text-white">
                      {p2InputMsg.buttons.toString(16).padStart(4, "0")}
                    </span>
                  </p>
                </div>
              )}

              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-2">
                  Convite
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={inviteUrl}
                    className="flex-1 min-w-0 bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-xs font-mono text-neutral-500 outline-none"
                  />
                  <button
                    onClick={copyInvite}
                    className="px-2 py-1.5 bg-[#8b5cf6] hover:bg-[#7c3aed] transition-colors rounded-lg text-xs font-bold text-white"
                  >
                    {copied ? "✓" : "📋"}
                  </button>
                </div>
              </div>

              <div className="border border-[#2a2a2a] rounded-lg p-3 text-xs text-neutral-500 space-y-1">
                <p className="font-semibold text-neutral-400">Controles P1</p>
                <p>Setas → D-pad</p>
                <p>Z/X → ×/○ &nbsp; A/S → □/△</p>
                <p>Q/W → L1/R1 &nbsp; E/R → L2/R2</p>
                <p>Enter → Start</p>
              </div>

              {webrtcLogs.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-2">
                    Logs
                  </p>
                  <div className="bg-black border border-[#2a2a2a] rounded-lg p-2 text-[10px] font-mono text-neutral-400 max-h-32 overflow-y-auto">
                    {webrtcLogs.map((log, i) => (
                      <div key={i} className="whitespace-pre-wrap break-all">{log}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── GUEST: waiting ──────────────────────────────────── */}
        {role === "guest" && phase === "guest-wait" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
            <div className="w-16 h-16 rounded-full border-4 border-[#8b5cf6] border-t-transparent animate-spin" />
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight text-white mb-2">
                Aguardando Host
              </h2>
              <p className="text-sm text-neutral-400">
                Conectando ao Player 1…
                <br />
                O jogo aparecerá aqui automaticamente.
              </p>
            </div>
            <div className="bg-[#161616] border border-[#2a2a2a] rounded-xl px-6 py-4 text-sm text-neutral-400 max-w-sm">
              <p className="font-semibold text-neutral-200 mb-1">
                Você é o Player 2
              </p>
              <p>
                Você não precisa ter nenhuma ROM. O Host transmite o jogo
                direto para você via P2P.
              </p>
            </div>
          </div>
        )}

        {/* ── GUEST: playing (remote stream) ──────────────────── */}
        {role === "guest" && phase === "guest-play" && (
          <div className="flex-1 flex flex-col md:flex-row gap-0">
            {/* Video from host */}
            <div className="flex-1 bg-black flex items-center justify-center relative min-h-[300px]">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain"
              />
              <GuestInputCapturer onInput={handleGuestInput} />
            </div>

            {/* Sidebar */}
            <div className="w-full md:w-56 border-t md:border-t-0 md:border-l border-[#2a2a2a] bg-[#161616] p-4 space-y-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-500 mb-1">
                  Conectado
                </p>
                <p className="text-xs text-neutral-400">
                  Recebendo stream do Host
                </p>
              </div>

              <div className="border border-[#2a2a2a] rounded-lg p-3 text-xs text-neutral-500 space-y-1">
                <p className="font-semibold text-neutral-400">Controles P2</p>
                <p>IJKL → D-pad</p>
                <p>Num0/. → ×/○</p>
                <p>Num1/2 → □/△</p>
                <p>Num4/5 → L1/R1</p>
                <p>NumEnter → Start</p>
                <p className="text-neutral-600 mt-1">ou gamepad</p>
              </div>

              {webrtcLogs.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-2">
                    Logs
                  </p>
                  <div className="bg-black border border-[#2a2a2a] rounded-lg p-2 text-[10px] font-mono text-neutral-400 max-h-32 overflow-y-auto">
                    {webrtcLogs.map((log, i) => (
                      <div key={i} className="whitespace-pre-wrap break-all">{log}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/** Invisible overlay that captures keyboard/gamepad inputs for guest */
function GuestInputCapturer({
  onInput,
}: {
  onInput: (buttons: number, axisX: number, axisY: number) => void;
}) {
  const buttonsRef = useRef(0);

  const PS1_BTN_MAP = [
    0x4000, // CROSS
    0x2000, // CIRCLE
    0x8000, // SQUARE
    0x1000, // TRIANGLE
    0x0400, // L1
    0x0800, // R1
    0x0100, // L2
    0x0200, // R2
    0x0001, // SELECT
    0x0008, // START
    0x0002, // L3
    0x0004, // R3
  ];

  const KEY_MAP: Record<string, number> = {
    // Arrow keys / WASD for P2 using arrow scheme
    ArrowUp: 0x0010,
    ArrowDown: 0x0040,
    ArrowLeft: 0x0080,
    ArrowRight: 0x0020,
    // IJKL for P2
    KeyI: 0x0010,
    KeyK: 0x0040,
    KeyJ: 0x0080,
    KeyL: 0x0020,
    // Actions
    Numpad0: 0x4000,
    NumpadDecimal: 0x2000,
    Numpad1: 0x8000,
    Numpad2: 0x1000,
    Numpad4: 0x0400,
    Numpad5: 0x0800,
    Numpad6: 0x0100,
    Numpad7: 0x0200,
    NumpadEnter: 0x0008,
    NumpadSubtract: 0x0001,
    // Fallback ZXAS
    KeyZ: 0x4000,
    KeyX: 0x2000,
    KeyA: 0x8000,
    KeyS: 0x1000,
    Enter: 0x0008,
  };

  useEffect(() => {
    const handleKey = (down: boolean) => (e: KeyboardEvent) => {
      const bit = KEY_MAP[e.code];
      if (bit === undefined) return;
      if (down) buttonsRef.current |= bit;
      else buttonsRef.current &= ~bit;
      onInput(buttonsRef.current, 0, 0);
    };
    window.addEventListener("keydown", handleKey(true));
    window.addEventListener("keyup", handleKey(false));
    return () => {
      window.removeEventListener("keydown", handleKey(true));
      window.removeEventListener("keyup", handleKey(false));
    };
  }, [onInput]); // eslint-disable-line react-hooks/exhaustive-deps

  // Gamepad polling
  useEffect(() => {
    let raf: number;
    function poll() {
      const gamepads = navigator.getGamepads?.() ?? [];
      const gp = gamepads[0];
      if (gp) {
        let buttons = 0;
        gp.buttons.forEach((b, i) => {
          if (b.pressed && PS1_BTN_MAP[i]) buttons |= PS1_BTN_MAP[i];
        });
        if ((gp.axes[1] ?? 0) < -0.5) buttons |= 0x0010;
        if ((gp.axes[1] ?? 0) > 0.5) buttons |= 0x0040;
        if ((gp.axes[0] ?? 0) < -0.5) buttons |= 0x0080;
        if ((gp.axes[0] ?? 0) > 0.5) buttons |= 0x0020;
        const axisX = Math.round((gp.axes[0] ?? 0) * 127);
        const axisY = Math.round((gp.axes[1] ?? 0) * 127);
        onInput(buttons, axisX, axisY);
      }
      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [onInput]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
