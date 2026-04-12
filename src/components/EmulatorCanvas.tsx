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
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const p1ButtonsRef = useRef(0);

    useImperativeHandle(ref, () => ({
      injectP2Input(msg: InputMessage) {
        try {
          if (iframeRef.current?.contentWindow) {
            const emu = iframeRef.current.contentWindow.document.querySelector('wasmpsx-player') as HTMLElement | null;
            if (emu?.setAttribute && msg.buttons) {
              const pad = 0x10000 | msg.buttons;
              emu.setAttribute('pad', pad.toString(16));
            } else if (emu?.setAttribute) {
              emu.setAttribute('pad', '10000');
            }
          }
        } catch { /* cross-origin */ }
      },
      getCanvas() {
        try {
          return iframeRef.current?.contentWindow?.document.querySelector('canvas') ?? null;
        } catch { return null; }
      },
    }));

    useEffect(() => {
      if (guestMode || !romFile || !containerRef.current) return;
      
      const container = containerRef.current;
      
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
      iframe.allow = 'autoplay; fullscreen';
      iframeRef.current = iframe;
      container.appendChild(iframe);

      const emitLoad = () => {
        const win = iframe.contentWindow;
        if (!win) return;
        
        const sendRom = () => {
          try {
            const emu = win.document.querySelector('wasmpsx-player');
            if (emu && typeof (emu as unknown as { readFile?: (f: File) => void }).readFile === 'function') {
              (emu as unknown as { readFile: (f: File) => void }).readFile(romFile);
              console.log('[RetroLink] ROM sent to emulator');
            } else {
              setTimeout(sendRom, 200);
            }
          } catch (e) {
            console.log('[RetroLink] Waiting for emulator...');
            setTimeout(sendRom, 200);
          }
        };

        setTimeout(sendRom, 1500);

        const handleKey = (down: boolean) => (e: KeyboardEvent) => {
          const bit = KB_MAP_P1[e.code];
          if (bit === undefined) return;
          if (down) p1ButtonsRef.current |= bit;
          else p1ButtonsRef.current &= ~bit;
          
          try {
            const emu = win.document.querySelector('wasmpsx-player') as HTMLElement | null;
            if (emu?.setAttribute) {
              const pad = 0x10000 | p1ButtonsRef.current;
              emu.setAttribute('pad', pad.toString(16));
            }
          } catch { /* cross-origin */ }
          
          onP1Input?.(p1ButtonsRef.current, 0, 0);
        };

        win.addEventListener('keydown', handleKey(true));
        win.addEventListener('keyup', handleKey(false));
      };

      iframe.onload = emitLoad;

      iframe.srcdoc = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
            wasmpsx-player { width: 100%; height: 100%; display: block; }
          </style>
        </head>
        <body>
          <wasmpsx-player id="emu"></wasmpsx-player>
          <script src="/emu/wasmpsx.min.js"></script>
        </body>
        </html>
      `;

      console.log('[RetroLink] Iframe created with emulator');
    }, [romFile, guestMode, onP1Input]);

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
        className="w-full h-full bg-black relative"
        style={{ minHeight: '480px' }}
      />
    );
  }
);

export default EmulatorCanvas;