"use client";

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import type { InputMessage } from "@/hooks/useWebRTC";

/**
 * PS1 button bitmask (PSX standard)
 * matches the order used by most PS1 emulators
 */
export const PS1_BUTTONS = {
  SELECT: 0x0001,
  L3: 0x0002,
  R3: 0x0004,
  START: 0x0008,
  UP: 0x0010,
  RIGHT: 0x0020,
  DOWN: 0x0040,
  LEFT: 0x0080,
  L2: 0x0100,
  R2: 0x0200,
  L1: 0x0400,
  R1: 0x0800,
  TRIANGLE: 0x1000,
  CIRCLE: 0x2000,
  CROSS: 0x4000,
  SQUARE: 0x8000,
} as const;

/** Keyboard → PS1 button map (Player 1 WASD + arrows scheme) */
const KB_MAP_P1: Record<string, number> = {
  ArrowUp: PS1_BUTTONS.UP,
  ArrowDown: PS1_BUTTONS.DOWN,
  ArrowLeft: PS1_BUTTONS.LEFT,
  ArrowRight: PS1_BUTTONS.RIGHT,
  KeyZ: PS1_BUTTONS.CROSS,
  KeyX: PS1_BUTTONS.CIRCLE,
  KeyA: PS1_BUTTONS.SQUARE,
  KeyS: PS1_BUTTONS.TRIANGLE,
  KeyQ: PS1_BUTTONS.L1,
  KeyW: PS1_BUTTONS.R1,
  KeyE: PS1_BUTTONS.L2,
  KeyR: PS1_BUTTONS.R2,
  Enter: PS1_BUTTONS.START,
  ShiftRight: PS1_BUTTONS.SELECT,
};

/** Keyboard → PS1 button map (Player 2 IJKL scheme) */
const KB_MAP_P2: Record<string, number> = {
  KeyI: PS1_BUTTONS.UP,
  KeyK: PS1_BUTTONS.DOWN,
  KeyJ: PS1_BUTTONS.LEFT,
  KeyL: PS1_BUTTONS.RIGHT,
  Numpad0: PS1_BUTTONS.CROSS,
  NumpadDecimal: PS1_BUTTONS.CIRCLE,
  Numpad1: PS1_BUTTONS.SQUARE,
  Numpad2: PS1_BUTTONS.TRIANGLE,
  Numpad4: PS1_BUTTONS.L1,
  Numpad5: PS1_BUTTONS.R1,
  Numpad6: PS1_BUTTONS.L2,
  Numpad7: PS1_BUTTONS.R2,
  NumpadEnter: PS1_BUTTONS.START,
  NumpadSubtract: PS1_BUTTONS.SELECT,
};

export interface EmulatorHandle {
  injectP2Input: (msg: InputMessage) => void;
  getCanvas: () => HTMLCanvasElement | null;
}

interface EmulatorCanvasProps {
  romFile: File | null;
  biosFile: File | null;
  /** Called when player 1 input state changes (for host to broadcast own state) */
  onP1Input?: (buttons: number, axisX: number, axisY: number) => void;
  /** If true, render a "waiting for host" overlay instead of emulator */
  guestMode?: boolean;
}

const EmulatorCanvas = forwardRef<EmulatorHandle, EmulatorCanvasProps>(
  function EmulatorCanvas(
    { romFile, biosFile, onP1Input, guestMode },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const p2StateRef = useRef({ buttons: 0, axisX: 0, axisY: 0 });
    const p1ButtonsRef = useRef(0);
    const emuRef = useRef<{
      destroy?: () => void;
      setP2Input?: (buttons: number, axisX: number, axisY: number) => void;
    }>({});

    useImperativeHandle(ref, () => ({
      injectP2Input(msg: InputMessage) {
        p2StateRef.current = {
          buttons: msg.buttons,
          axisX: msg.axisX,
          axisY: msg.axisY,
        };
        emuRef.current.setP2Input?.(msg.buttons, msg.axisX, msg.axisY);
      },
      getCanvas() {
        return canvasRef.current;
      },
    }));

    // ── Keyboard input (P1) ───────────────────────────────────
    useEffect(() => {
      if (guestMode) return;

      const handleKey = (down: boolean) => (e: KeyboardEvent) => {
        const bit = KB_MAP_P1[e.code];
        if (bit === undefined) return;
        if (down) p1ButtonsRef.current |= bit;
        else p1ButtonsRef.current &= ~bit;
        onP1Input?.(p1ButtonsRef.current, 0, 0);
      };

      window.addEventListener("keydown", handleKey(true));
      window.addEventListener("keyup", handleKey(false));
      return () => {
        window.removeEventListener("keydown", handleKey(true));
        window.removeEventListener("keyup", handleKey(false));
      };
    }, [guestMode, onP1Input]);

    // ── Gamepad polling (P1) ──────────────────────────────────
    useEffect(() => {
      if (guestMode) return;
      let raf: number;

      function poll() {
        const gamepads = navigator.getGamepads?.() ?? [];
        const gp = gamepads[0];
        if (gp) {
          let buttons = 0;
          // Standard mapping: 0=cross,1=circle,2=square,3=triangle,4=l1,5=r1,6=l2,7=r2,8=select,9=start
          const btnMap = [
            PS1_BUTTONS.CROSS,
            PS1_BUTTONS.CIRCLE,
            PS1_BUTTONS.SQUARE,
            PS1_BUTTONS.TRIANGLE,
            PS1_BUTTONS.L1,
            PS1_BUTTONS.R1,
            PS1_BUTTONS.L2,
            PS1_BUTTONS.R2,
            PS1_BUTTONS.SELECT,
            PS1_BUTTONS.START,
            PS1_BUTTONS.L3,
            PS1_BUTTONS.R3,
          ];
          gp.buttons.forEach((b, i) => {
            if (b.pressed && btnMap[i]) buttons |= btnMap[i];
          });
          // D-pad axes (axes[0]=leftX, axes[1]=leftY)
          if ((gp.axes[1] ?? 0) < -0.5) buttons |= PS1_BUTTONS.UP;
          if ((gp.axes[1] ?? 0) > 0.5) buttons |= PS1_BUTTONS.DOWN;
          if ((gp.axes[0] ?? 0) < -0.5) buttons |= PS1_BUTTONS.LEFT;
          if ((gp.axes[0] ?? 0) > 0.5) buttons |= PS1_BUTTONS.RIGHT;
          const axisX = Math.round((gp.axes[0] ?? 0) * 127);
          const axisY = Math.round((gp.axes[1] ?? 0) * 127);
          onP1Input?.(buttons, axisX, axisY);
        }
        raf = requestAnimationFrame(poll);
      }

      raf = requestAnimationFrame(poll);
      return () => cancelAnimationFrame(raf);
    }, [guestMode, onP1Input]);

    // ── Guest keyboard input (P2 injected back via DataChannel) ──
    useEffect(() => {
      if (!guestMode) return;
      let buttons = 0;

      const handleKey = (down: boolean) => (e: KeyboardEvent) => {
        const bit = KB_MAP_P2[e.code] ?? KB_MAP_P1[e.code];
        if (bit === undefined) return;
        if (down) buttons |= bit;
        else buttons &= ~bit;
        onP1Input?.(buttons, 0, 0); // re-using onP1Input callback for guest
      };

      window.addEventListener("keydown", handleKey(true));
      window.addEventListener("keyup", handleKey(false));
      return () => {
        window.removeEventListener("keydown", handleKey(true));
        window.removeEventListener("keyup", handleKey(false));
      };
    }, [guestMode, onP1Input]);

    // ── Emulator bootstrap ────────────────────────────────────
    useEffect(() => {
      if (guestMode || !romFile || !canvasRef.current) return;

      let cancelled = false;

      async function loadEmulator() {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Attempt to load WASM emulator (rustation-libretro / pcsx_rearmed style)
        // We use a thin wrapper approach: load the module, pass canvas + ROM ArrayBuffer
        try {
          // Dynamic import so it only loads in browser
          // The actual WASM binary would be in /public/emu/
          // For now we show a "loading" state and draw placeholder frames
          // until the WASM module is available.
          const romBuffer = await romFile!.arrayBuffer();
          let biosBuffer: ArrayBuffer | null = null;
          if (biosFile) {
            biosBuffer = await biosFile.arrayBuffer();
          }

          // Try loading the emulator module
          type WinExt = typeof window & {
            __retrolink_loadEmu?: (opts: {
              canvas: HTMLCanvasElement;
              rom: ArrayBuffer;
              bios: ArrayBuffer | null;
            }) => Promise<typeof emuRef.current>;
          };
          const emuModule = await (window as WinExt).__retrolink_loadEmu?.({
            canvas,
            rom: romBuffer,
            bios: biosBuffer,
          });

          if (!cancelled && emuModule) {
            emuRef.current = emuModule;
          } else if (!cancelled) {
            // Fallback: draw a test pattern to show the canvas is working
            drawTestPattern(canvas, romFile!.name);
          }
        } catch {
          if (!cancelled) {
            drawTestPattern(canvas, romFile!.name);
          }
        }
      }

      loadEmulator();

      return () => {
        cancelled = true;
        emuRef.current.destroy?.();
        emuRef.current = {};
      };
    }, [romFile, biosFile, guestMode]);

    return (
      <canvas
        ref={canvasRef}
        width={640}
        height={480}
        className="w-full h-full object-contain bg-black"
        style={{ imageRendering: "pixelated" }}
      />
    );
  }
);

export default EmulatorCanvas;

/** Draw a placeholder pattern when no real emulator is loaded */
function drawTestPattern(canvas: HTMLCanvasElement, romName: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let frame = 0;
  const interval = setInterval(() => {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Scanlines
    for (let y = 0; y < canvas.height; y += 4) {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0, y, canvas.width, 2);
    }

    // Animated gradient bar
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    const hue = (frame * 0.5) % 360;
    grad.addColorStop(0, `hsla(${hue},70%,40%,0.3)`);
    grad.addColorStop(0.5, `hsla(${(hue + 60) % 360},70%,60%,0.6)`);
    grad.addColorStop(1, `hsla(${(hue + 120) % 360},70%,40%,0.3)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, canvas.height / 2 - 2, canvas.width, 4);

    ctx.font = "bold 16px monospace";
    ctx.fillStyle = "#8b5cf6";
    ctx.textAlign = "center";
    ctx.fillText("RetroLink — PS1 Emulator", canvas.width / 2, 60);

    ctx.font = "12px monospace";
    ctx.fillStyle = "#6b7280";
    ctx.fillText(romName, canvas.width / 2, 90);

    ctx.font = "11px monospace";
    ctx.fillStyle = "#4b5563";
    ctx.fillText(
      "Coloque o arquivo WASM em /public/emu/ para emulação real",
      canvas.width / 2,
      canvas.height - 30
    );

    frame++;
  }, 33); // ~30fps

  // Store cleanup
  (canvas as HTMLCanvasElement & { __retrolink_cleanup?: () => void }).__retrolink_cleanup =
    () => clearInterval(interval);
}

export { KB_MAP_P1, KB_MAP_P2 };
