# Active Context: RetroLink — PS1 Netplay P2P

## Current State

**Project Status**: ✅ Fully functional with real WASM PS1 emulator integrated

RetroLink is a PS1 multiplayer-over-internet app. Architecture:
- **Host (Player 1)**: Loads ROM locally, runs emulator, streams canvas via WebRTC to guest
- **Guest (Player 2)**: Opens invite link, receives video stream, sends inputs via DataChannel
- **Only 1 ROM needed** — on the host machine only

## Recently Completed

- [x] Integrate actual PS1 WASM emulator (WASMpsx) in `/public/emu/`
- [x] Updated `EmulatorCanvas.tsx` to use wasmpsx-player web component
- [x] Added wasmpsx.min.js script to layout.tsx
- [x] Landing page (`/`) — matches RetroLink design (dark, purple accents, feature badges, how-it-works)
- [x] Signaling server (`/api/signal/[roomId]`) — SSE-based in-memory WebRTC signaling
- [x] `useWebRTC` hook — handles offer/answer/ICE, canvas stream capture, DataChannel
- [x] `EmulatorCanvas` component — PS1 input mapping (keyboard + gamepad P1/P2)
- [x] Room page (`/room/[roomId]`) — full Host/Guest flow:
  - Host: create room → load ROM → emulator runs → sidebar with invite link
  - Guest: open link → wait screen → stream auto-connects → receive video + send inputs
  - "Trocar ROM" button while playing
  - Both flows work regardless of order (ROM first or room first)
- [x] Fixed signaling relay bug in SSE push path:
  - Listeners are now role-aware (`host` / `guest`) in `signal-store`
  - Real-time pushes now go only to the opposite role (no self-delivery of ICE/SDP)
  - `since` cursor in `useWebRTC` now tracks `msg.ts` (prevents message loss on reconnect)
- [x] Fixed guest black-screen race in remote video attach:
  - Guest now persists incoming MediaStream in room state before switching phase
  - Video element attaches stream after mount and retries `play()`
  - `useWebRTC` guest `ontrack` now has fallback when `e.streams[0]` is empty

## Current Structure

| File/Directory | Purpose | Status |
|---|---|---|
| `src/app/page.tsx` | Landing page | ✅ Done |
| `src/app/room/[roomId]/page.tsx` | Game room (host + guest) | ✅ Done |
| `src/app/api/signal/[roomId]/route.ts` | WebRTC signaling SSE | ✅ Done |
| `src/hooks/useWebRTC.ts` | WebRTC P2P hook | ✅ Done |
| `src/components/EmulatorCanvas.tsx` | Emulator canvas + input | ✅ Done |
| `src/lib/signal-store.ts` | In-memory signaling store | ✅ Done |

## Architecture Details

### WebRTC Flow
1. Host creates `RTCPeerConnection`, sets up DataChannel for inputs, captures canvas via `captureStream(30)`
2. Host creates offer → POSTs to `/api/signal/[roomId]`
3. Guest opens SSE stream → receives offer → creates answer → POSTs back
4. ICE candidates exchanged via same SSE endpoint
5. Guest receives remote track → displays in `<video>` element
6. Guest keyboard/gamepad events → DataChannel → Host injects as P2 inputs

### Emulator Integration Hook
`EmulatorCanvas` tries `window.__retrolink_loadEmu({ canvas, rom, bios })` at startup.
- If the function exists (WASM loaded in `/public/emu/`), real emulation runs
- If not, a test pattern is drawn on the canvas (shows the stream still works)

To integrate a real PS1 WASM emulator:
1. Place WASM files in `/public/emu/`
2. Define `window.__retrolink_loadEmu` in a script that returns `{ destroy, setP2Input }`

### Input Mapping
- **P1 (Host keyboard)**: Arrow keys = D-pad, Z/X = ×/○, A/S = □/△, Q/W = L1/R1, E/R = L2/R2, Enter = Start
- **P2 (Guest keyboard)**: Same arrows/ZXAS + IJKL D-pad + numpad scheme
- **Gamepad**: Standard mapping supported for both players

## Pending / Next Steps

- [ ] Validate relay behavior in multi-tab and reconnect scenarios (host/guest reload)
- [ ] Add TURN server config for NAT traversal in production
- [ ] Add audio streaming (AudioContext → MediaStream track)
- [ ] Persist room state (currently in-memory, resets on server restart)
- [ ] Add connection status indicator in game room UI

## Session History

| Date | Changes |
|------|---------|
| 2026-04-12 | Initial full implementation: landing page, signaling API, WebRTC hook, emulator canvas, room page |
| 2026-04-13 | Fix WebRTC timing - wait for stream before creating peer connection (was getting "signalingState closed" errors) |
| 2026-04-12 | Fix SSE relay routing: avoid delivering own ICE/SDP to same role; use `msg.ts` for `since` cursor |
