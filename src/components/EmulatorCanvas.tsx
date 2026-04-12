"use client";

import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from "react";
import type { InputMessage } from "@/hooks/useWebRTC";

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
  onP1Input?: (buttons: number, axisX: number, axisY: number) => void;
  guestMode?: boolean;
}

const EmulatorCanvas = forwardRef<EmulatorHandle, EmulatorCanvasProps>(
  function EmulatorCanvas({ romFile, biosFile, onP1Input, guestMode }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const p1ButtonsRef = useRef(0);
    const emuReadyRef = useRef(false);
    const [isLoading, setIsLoading] = useState(true);

    useImperativeHandle(ref, () => ({
      injectP2Input(msg: InputMessage) {
        const emu = containerRef.current?.querySelector('wasmpsx-player') as HTMLElement & { setAttribute?: (k: string, v: string) => void } | null;
        if (emu?.setAttribute && msg.buttons) {
          const pad = 0x10000 | msg.buttons;
          emu.setAttribute('pad', pad.toString(16));
        } else if (emu?.setAttribute) {
          emu.setAttribute('pad', '10000');
        }
      },
      getCanvas() {
        return containerRef.current?.querySelector('canvas') ?? null;
      },
    }));

    useEffect(() => {
      if (guestMode || !containerRef.current) return;
      
      const container = containerRef.current;
      
      // Create the wasmpsx-player element if it doesn't exist
      let player = container.querySelector('wasmpsx-player');
      if (!player) {
        player = document.createElement('wasmpsx-player');
        (player as HTMLElement).id = 'wasmpsx-emulator';
        (player as HTMLElement).style.width = '100%';
        (player as HTMLElement).style.height = '100%';
        (player as HTMLElement).style.display = 'block';
        container.appendChild(player);
      }

      const checkEmulator = () => {
        const emu = container.querySelector('wasmpsx-player');
        if (emu && typeof (emu as HTMLElement & { readFile?: (f: File) => void }).readFile === 'function') {
          emuReadyRef.current = true;
          setIsLoading(false);
        } else {
          setTimeout(checkEmulator, 200);
        }
      };
      
      checkEmulator();
    }, [guestMode]);

    useEffect(() => {
      if (guestMode || !romFile || !emuReadyRef.current) return;

      const emu = containerRef.current?.querySelector('wasmpsx-player') as HTMLElement & { readFile?: (f: File) => void } | null;
      if (emu?.readFile) {
        try {
          emu.readFile(romFile);
        } catch (err) {
          console.error('Failed to load ROM:', err);
        }
      }
    }, [romFile, guestMode]);

    useEffect(() => {
      if (guestMode) return;

      const handleKey = (down: boolean) => (e: KeyboardEvent) => {
        const bit = KB_MAP_P1[e.code];
        if (bit === undefined) return;
        if (down) p1ButtonsRef.current |= bit;
        else p1ButtonsRef.current &= ~bit;
        
        const emu = containerRef.current?.querySelector('wasmpsx-player') as HTMLElement & { setAttribute?: (k: string, v: string) => void } | null;
        if (emu?.setAttribute) {
          const pad = 0x10000 | p1ButtonsRef.current;
          emu.setAttribute('pad', pad.toString(16));
        }
        
        onP1Input?.(p1ButtonsRef.current, 0, 0);
      };

      window.addEventListener('keydown', handleKey(true));
      window.addEventListener('keyup', handleKey(false));
      return () => {
        window.removeEventListener('keydown', handleKey(true));
        window.removeEventListener('keyup', handleKey(false));
      };
    }, [guestMode, onP1Input]);

    useEffect(() => {
      if (guestMode) return;
      let raf: number;

      function poll() {
        const gamepads = navigator.getGamepads?.() ?? [];
        const gp = gamepads[0];
        if (gp) {
          let buttons = 0;
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
          ];
          gp.buttons.forEach((b, i) => {
            if (b.pressed && btnMap[i]) buttons |= btnMap[i];
          });
          if ((gp.axes[1] ?? 0) < -0.5) buttons |= PS1_BUTTONS.UP;
          if ((gp.axes[1] ?? 0) > 0.5) buttons |= PS1_BUTTONS.DOWN;
          if ((gp.axes[0] ?? 0) < -0.5) buttons |= PS1_BUTTONS.LEFT;
          if ((gp.axes[0] ?? 0) > 0.5) buttons |= PS1_BUTTONS.RIGHT;
          
          const emu = containerRef.current?.querySelector('wasmpsx-player') as HTMLElement & { setAttribute?: (k: string, v: string) => void } | null;
          if (emu?.setAttribute) {
            const pad = 0x10000 | buttons;
            emu.setAttribute('pad', pad.toString(16));
          }
          
          p1ButtonsRef.current = buttons;
          onP1Input?.(buttons, Math.round((gp.axes[0] ?? 0) * 127), Math.round((gp.axes[1] ?? 0) * 127));
        }
        raf = requestAnimationFrame(poll);
      }

      raf = requestAnimationFrame(poll);
      return () => cancelAnimationFrame(raf);
    }, [guestMode, onP1Input]);

    useEffect(() => {
      if (!guestMode) return;
      let buttons = 0;

      const handleKey = (down: boolean) => (e: KeyboardEvent) => {
        const bit = KB_MAP_P2[e.code] ?? KB_MAP_P1[e.code];
        if (bit === undefined) return;
        if (down) buttons |= bit;
        else buttons &= ~bit;
        onP1Input?.(buttons, 0, 0);
      };

      window.addEventListener('keydown', handleKey(true));
      window.addEventListener('keyup', handleKey(false));
      return () => {
        window.removeEventListener('keydown', handleKey(true));
        window.removeEventListener('keyup', handleKey(false));
      };
    }, [guestMode, onP1Input]);

    if (guestMode) {
      return (
        <div className="w-full h-full bg-black flex items-center justify-center">
          <div className="text-neutral-500 text-sm">Aguardando stream do Host...</div>
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        className="w-full h-full bg-black flex items-center justify-center"
        style={{ minHeight: '480px' }}
      >
        {/* wasmpsx-player will be created by the external script */}
        <div className="text-neutral-500 text-sm">Carregando emulador...</div>
      </div>
    );
  }
);

export default EmulatorCanvas;