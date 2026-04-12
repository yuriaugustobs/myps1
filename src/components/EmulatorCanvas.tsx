"use client";

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
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
    const romLoadedRef = useRef(false);

    useImperativeHandle(ref, () => ({
      injectP2Input(msg: InputMessage) {
        try {
          if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage({
              type: 'p2-input',
              buttons: msg.buttons,
              axisX: msg.axisX,
              axisY: msg.axisY,
            }, '*');
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
      if (guestMode || !romFile || !containerRef.current || romLoadedRef.current) return;
      romLoadedRef.current = true;
      
      const container = containerRef.current;
      
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
      iframe.allow = 'autoplay; fullscreen';
      iframeRef.current = iframe;
      container.appendChild(iframe);

      const emitLoad = () => {
        const win = iframe.contentWindow;
        if (!win) return;
        
        console.log('[RetroLink] EmulatorJS loaded, sending ROM...');
        
        const sendRom = () => {
          try {
            const emu = (win as unknown as { EJS?: { emu?: { loadROM?: (f: File) => void } } }).EJS?.emu;
            if (emu?.loadROM) {
              emu.loadROM(romFile);
              console.log('[RetroLink] ROM loaded successfully');
            } else {
              setTimeout(sendRom, 500);
            }
          } catch (e) {
            console.log('[RetroLink] Waiting for emulator to be ready...');
            setTimeout(sendRom, 500);
          }
        };

        setTimeout(sendRom, 2000);

        // Input handling - send to emulator
        const handleKey = (down: boolean) => (e: KeyboardEvent) => {
          const bit = KB_MAP_P1[e.code];
          if (bit === undefined) return;
          if (down) p1ButtonsRef.current |= bit;
          else p1ButtonsRef.current &= ~bit;
          
          try {
            win.postMessage({
              type: 'p1-input',
              buttons: p1ButtonsRef.current,
            }, '*');
          } catch { /* cross-origin */ }
          
          onP1Input?.(p1ButtonsRef.current, 0, 0);
        };

        win.addEventListener('keydown', handleKey(true));
        win.addEventListener('keyup', handleKey(false));
      };

      iframe.onload = emitLoad;

      // Generate base64 ROM for embedding
      const reader = new FileReader();
      reader.onload = () => {
        const romBase64 = reader.result as string;
        
        iframe.srcdoc = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
              #game { width: 100%; height: 100%; }
              .loading { 
                position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                color: #8b5cf6; font-family: monospace; font-size: 14px;
              }
            </style>
          </head>
          <body>
            <div id="game"></div>
            <div class="loading" id="loading">Carregando EmulatorJS...</div>
            <script>
              window.EJS_player = '#game';
              window.EJS_core = 'psx';
              window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
              window.EJS_gameUrl = '${romBase64}';
              window.EJS_autoStart = true;
              window.EJS_biosUrl = '';
              window.EJS_debug = false;
            </script>
            <script src="https://cdn.emulatorjs.org/stable/data/loader.js"></script>
            <script>
              // Listen for input messages from parent
              window.addEventListener('message', function(e) {
                if (e.data.type === 'p1-input' && window.EJS && window.EJS.emulator) {
                  // Map our button format to EmulatorJS format
                  const btn = e.data.buttons;
                  const emu = window.EJS.emulator;
                  // EmulatorJS uses different button mapping
                  if (emu && emu.queues) {
                    // Send input using simulateInput if available
                    if (emu.simulateInput) {
                      // Map: cross=0, square=1, select=2, start=3, up=4, right=5, down=6, left=7, circle=8, triangle=9, l1=10, r1=11
                      const map = {
                        0x4000: 0, // cross
                        0x8000: 1, // square
                        0x0001: 2, // select
                        0x0008: 3, // start
                        0x0010: 4, // up
                        0x0020: 5, // right
                        0x0040: 6, // down
                        0x0080: 7, // left
                        0x2000: 8, // circle
                        0x1000: 9, // triangle
                        0x0400: 10, // l1
                        0x0800: 11, // r1
                        0x0100: 12, // l2
                        0x0200: 13, // r2
                      };
                      Object.keys(map).forEach(k => {
                        if (btn & parseInt(k)) {
                          emu.simulateInput(map[k], 1);
                        }
                      });
                    }
                  }
                }
                if (e.data.type === 'p2-input' && window.EJS && window.EJS.emulator) {
                  const btn = e.data.buttons;
                  const emu = window.EJS.emulator;
                  if (emu && emu.simulateInput) {
                    const map = {
                      0x4000: 0,
                      0x8000: 1,
                      0x0001: 2,
                      0x0008: 3,
                      0x0010: 4,
                      0x0020: 5,
                      0x0040: 6,
                      0x0080: 7,
                      0x2000: 8,
                      0x1000: 9,
                      0x0400: 10,
                      0x0800: 11,
                    };
                    Object.keys(map).forEach(k => {
                      if (btn & parseInt(k)) {
                        emu.simulateInput(map[k], 1);
                      }
                    });
                  }
                }
              });
              
              // Hide loading when emulator starts
              const observer = new MutationObserver(function() {
                const canvas = document.querySelector('canvas');
                const loading = document.getElementById('loading');
                if (canvas && loading) {
                  loading.style.display = 'none';
                  observer.disconnect();
                }
              });
              observer.observe(document.body, { childList: true, subtree: true });
            </script>
          </body>
          </html>
        `;
        
        console.log('[RetroLink] Iframe created with EmulatorJS PS1');
      };
      
      reader.readAsDataURL(romFile);
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