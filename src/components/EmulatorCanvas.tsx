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
  getVideoStream: () => MediaStream | null;
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
    const streamRef = useRef<MediaStream | null>(null);

    useImperativeHandle(ref, () => ({
      injectP2Input(msg: InputMessage) {
        try {
          if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage({
              type: 'p2-input',
              buttons: msg.buttons,
            }, '*');
          }
        } catch { /* cross-origin */ }
      },
      getVideoStream() {
        return streamRef.current;
      },
    }));

    useEffect(() => {
      // Listen for video track messages from iframe
      const handleMessage = (event: MessageEvent) => {
        if (event.data.type === 'video-track' && event.data.track) {
          const track = event.data.track as MediaStreamTrack;
          if (!streamRef.current) {
            streamRef.current = new MediaStream([track]);
          } else {
            streamRef.current.addTrack(track);
          }
        }
      };
      
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }, []);

    useEffect(() => {
      if (guestMode || !romFile || !containerRef.current || romLoadedRef.current) return;
      romLoadedRef.current = true;
      
      const container = containerRef.current;
      
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
      iframe.allow = 'autoplay; fullscreen';
      iframeRef.current = iframe;
      container.appendChild(iframe);

      // Expose getCanvas method for parent to capture stream
      iframe.onload = () => {
        const win = iframe.contentWindow;
        if (!win) return;
        
        console.log('[RetroLink] EmulatorJS iframe loaded');
        
        // Input handling
        const handleKey = (down: boolean) => (e: KeyboardEvent) => {
          const bit = KB_MAP_P1[e.code];
          if (bit === undefined) return;
          if (down) p1ButtonsRef.current |= bit;
          else p1ButtonsRef.current &= ~bit;
          
          try {
            win.postMessage({ type: 'p1-input', buttons: p1ButtonsRef.current }, '*');
          } catch { /* cross-origin */ }
          
          onP1Input?.(p1ButtonsRef.current, 0, 0);
        };

        win.addEventListener('keydown', handleKey(true));
        win.addEventListener('keyup', handleKey(false));
      };

      // Read ROM as array buffer and create blob URL for the iframe
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
        const blobUrl = URL.createObjectURL(blob);
        
        console.log('[RetroLink] ROM blob URL created');
        
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
                color: #8b5cf6; font-family: monospace; font-size: 14px; text-align: center;
                z-index: 10;
              }
              .spinner {
                border: 3px solid #333; border-top: 3px solid #8b5cf6;
                border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite;
                margin: 0 auto 15px;
              }
              @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
          </head>
          <body>
            <div id="game"></div>
            <div class="loading" id="loading">
              <div class="spinner"></div>
              Carregando emulador...
            </div>
            <script>
              window.EJS_player = '#game';
              window.EJS_core = 'psx';
              window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
              window.EJS_gameUrl = '${blobUrl}';
              window.EJS_autoStart = true;
              window.EJS_biosUrl = '';
              window.EJS_language = 'en';
            </script>
            <script src="https://cdn.emulatorjs.org/stable/data/loader.js"></script>
            <script>
              // Setup canvas stream capture and send to parent
              let canvasStream = null;
              
              const startCapture = () => {
                const canvas = document.querySelector('canvas');
                if (!canvas) {
                  setTimeout(startCapture, 500);
                  return;
                }
                
                try {
                  canvasStream = canvas.captureStream(30);
                  console.log('[RetroLink] Canvas capture started');
                  
                  // Send stream tracks to parent
                  canvasStream.getTracks().forEach(track => {
                    parent.postMessage({ type: 'video-track', track: track }, '*');
                  });
                  
                  // Also send the canvas element reference for capture
                  const loading = document.getElementById('loading');
                  if (loading) loading.style.display = 'none';
                  console.log('[RetroLink] Emulator started successfully');
                } catch (e) {
                  console.error('[RetroLink] Capture failed:', e);
                  setTimeout(startCapture, 500);
                }
              };
              
              // Start capture when emulator loads
              setTimeout(startCapture, 3000);
              
              // Also observe for canvas creation
              const observer = new MutationObserver(function() {
                const canvas = document.querySelector('canvas');
                if (canvas && !canvasStream) {
                  startCapture();
                  observer.disconnect();
                }
              });
              observer.observe(document.body, { childList: true, subtree: true });
              
              // Input handling
              window.addEventListener('message', function(e) {
                if (!window.EJS || !window.EJS.emulator) return;
                const emu = window.EJS.emulator;
                if (!emu || !emu.simulateInput) return;
                
                const btn = e.data.buttons || 0;
                const map = {
                  0x4000: 0, 0x8000: 1, 0x0001: 2, 0x0008: 3,
                  0x0010: 4, 0x0020: 5, 0x0040: 6, 0x0080: 7,
                  0x2000: 8, 0x1000: 9, 0x0400: 10, 0x0800: 11
                };
                
                if (e.data.type === 'p1-input') {
                  for (const [key, val] of Object.entries(map)) {
                    emu.simulateInput(val, (btn & parseInt(key)) ? 1 : 0);
                  }
                }
                if (e.data.type === 'p2-input') {
                  for (const [key, val] of Object.entries(map)) {
                    emu.simulateInput(val, (btn & parseInt(key)) ? 1 : 0);
                  }
                }
              });
            </script>
          </body>
          </html>
        `;
      };
      
      reader.readAsArrayBuffer(romFile);
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