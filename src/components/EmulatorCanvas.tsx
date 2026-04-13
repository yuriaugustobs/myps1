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

export interface EmulatorHandle {
  injectP2Input: (msg: InputMessage) => void;
  getVideoStream: () => MediaStream | null;
}

interface EmulatorCanvasProps {
  romFile: File | null;
  biosFile: File | null;
  onP1Input?: (buttons: number, axisX: number, axisY: number) => void;
  guestMode?: boolean;
}

const EmulatorCanvas = forwardRef<EmulatorHandle, EmulatorCanvasProps>(
  function EmulatorCanvas({ romFile, onP1Input, guestMode }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const p1ButtonsRef = useRef(0);
    const streamRef = useRef<MediaStream | null>(null);
    const loadedRef = useRef(false);
    const emulatorRef = useRef<{ simulateInput?: (btn: number, val: number) => void } | null>(null);

    useImperativeHandle(ref, () => ({
      injectP2Input(msg: InputMessage) {
        const emu = emulatorRef.current;
        if (emu?.simulateInput) {
          const btn = msg.buttons;
          const map: Record<number, number> = {
            16384: 0, 32768: 1, 1: 2, 8: 3, 16: 4, 32: 5, 64: 6, 128: 7,
            8192: 8, 4096: 9, 1024: 10, 2048: 11
          };
          for (const [key, val] of Object.entries(map)) {
            emu.simulateInput(val, (btn & parseInt(key)) ? 1 : 0);
          }
        }
      },
      getVideoStream() {
        return streamRef.current;
      },
    }));

    useEffect(() => {
      if (guestMode || !romFile || !containerRef.current || loadedRef.current) return;
      loadedRef.current = true;

      const container = containerRef.current;
      const reader = new FileReader();

      reader.onload = function() {
        const arrayBuffer = reader.result as ArrayBuffer;
        const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);

        const div = document.createElement('div');
        div.id = 'game';
        div.style.cssText = 'width:100%;height:100%;';
        
        const loading = document.createElement('div');
        loading.className = 'loading';
        loading.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#8b5cf6;font-family:monospace;';
        loading.innerHTML = '<div style="border:3px solid #333;border-top:3px solid #8b5cf6;border-radius:50%;width:30px;height:30px;animation:spin 1s linear infinite;margin:0 auto 15px;"></div>Carregando...';
        
        container.appendChild(div);
        container.appendChild(loading);

        const script1 = document.createElement('script');
        script1.textContent = 'window.EJS_player = "#game"; window.EJS_core = "psx"; window.EJS_pathtodata = "https://cdn.emulatorjs.org/stable/data/"; window.EJS_gameUrl = "' + url + '"; window.EJS_autoStart = true; window.EJS_biosUrl = ""; window.EJS_language = "en";';
        
        const script2 = document.createElement('script');
        script2.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
        
        const captureScript = document.createElement('script');
        captureScript.textContent = `
          window.getEmulatorStream = function() { return window.__emuStream || null; };
          setTimeout(function() {
            var canvas = document.querySelector("canvas");
            console.log("Canvas found:", !!canvas);
            if (canvas) {
              try {
                var stream = canvas.captureStream(15);
                console.log("Stream created:", !!stream);
                window.__emuStream = stream;
                var loading = document.querySelector(".loading");
                if (loading) loading.style.display = "none";
                console.log("Stream captured and stored in window");
              } catch(e) { 
                console.error("Capture error:", e); 
              }
            }
          }, 5000);
          
          var observer = new MutationObserver(function() {
            var canvas = document.querySelector("canvas");
            if (canvas && !window.__emuStream) {
              try {
                var stream = canvas.captureStream(15);
                window.__emuStream = stream;
                console.log("Stream captured via observer");
                var loading = document.querySelector(".loading");
                if (loading) loading.style.display = "none";
              } catch(e) { console.error(e); }
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        `;

        container.appendChild(script1);
        container.appendChild(script2);
        container.appendChild(captureScript);

        const pollInterval = setInterval(function() {
          const stream = (window as unknown as { getEmulatorStream?: () => MediaStream | null }).getEmulatorStream?.();
          if (stream && stream.getTracks().length > 0 && !streamRef.current) {
            streamRef.current = stream;
            console.log('Stream ready for WebRTC - React side, tracks:', stream.getTracks().length);
            clearInterval(pollInterval);
          }
        }, 500);
      };

      reader.readAsArrayBuffer(romFile);
    }, [romFile, guestMode]);

    useEffect(() => {
      if (guestMode) return;

      const handleKey = (down: boolean) => (e: KeyboardEvent) => {
        const bit = KB_MAP_P1[e.code];
        if (bit === undefined) return;
        if (down) p1ButtonsRef.current |= bit;
        else p1ButtonsRef.current &= ~bit;

        onP1Input?.(p1ButtonsRef.current, 0, 0);
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
        className="w-full h-full bg-black relative"
        style={{ minHeight: '480px' }}
      />
    );
  }
);

export default EmulatorCanvas;