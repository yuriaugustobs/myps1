"use client";

import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";

export default function Home() {
  const router = useRouter();

  function createRoom() {
    const roomId = uuidv4().slice(0, 8);
    router.push(`/room/${roomId}?role=host`);
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#0d0d0d] text-neutral-200">
      {/* Navbar */}
      <nav className="border-b border-[#2a2a2a] px-6 py-4 flex items-center gap-3">
        <svg
          className="w-6 h-6 text-[#8b5cf6]"
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
        <span className="font-bold tracking-widest text-sm uppercase">
          <span className="text-white">RETRO</span>
          <span className="text-[#8b5cf6]">LINK</span>
        </span>
      </nav>

      <main className="flex-1">
        {/* Hero */}
        <section className="text-center pt-20 pb-14 px-6">
          <h1 className="text-5xl md:text-6xl font-black uppercase tracking-tight leading-tight">
            <span className="text-white">MULTIPLAYER LOCAL</span>
            <br />
            <span className="text-[#8b5cf6]">SEM LIMITES</span>
          </h1>
          <p className="mt-6 text-neutral-400 max-w-xl mx-auto text-base leading-relaxed">
            Jogue títulos multiplayer local da PS1 com amigos de qualquer lugar
            do mundo. Conecte-se via P2P, carregue sua ROM e jogue como se
            estivessem no mesmo sofá.
          </p>
        </section>

        {/* Feature badges */}
        <section className="flex flex-wrap justify-center gap-4 px-6 mb-14">
          {[
            {
              icon: (
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
                    d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
                  />
                </svg>
              ),
              title: "WebRTC P2P",
              desc: "Conexão direta sem servidores. Baixa latência.",
            },
            {
              icon: (
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
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              ),
              title: "Emulação WASM",
              desc: "Emulador PS1 rodando direto no navegador.",
            },
            {
              icon: (
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
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              ),
              title: "Sem uploads",
              desc: "Sua ROM nunca sai do seu computador.",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="border border-[#2a2a2a] rounded-xl px-6 py-5 w-64 bg-[#161616]"
            >
              {f.icon}
              <p className="mt-3 font-semibold text-sm text-neutral-200">
                {f.title}
              </p>
              <p className="mt-1 text-xs text-neutral-500">{f.desc}</p>
            </div>
          ))}
        </section>

        {/* Main panels */}
        <section className="max-w-4xl mx-auto px-6 grid md:grid-cols-2 gap-6 mb-16">
          {/* Load game */}
          <div className="border border-[#2a2a2a] rounded-2xl bg-[#161616] p-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-5">
              Carregar Jogo
            </h2>

            {/* Drop area - decorative only on landing */}
            <div className="border-2 border-dashed border-[#2a2a2a] rounded-xl flex flex-col items-center justify-center py-10 mb-4 gap-3 text-neutral-500">
              <svg
                className="w-10 h-10"
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
              <p className="text-sm font-medium">Arraste a ROM aqui</p>
              <p className="text-xs">
                ou clique para selecionar · .bin .cue .iso .pbp .chd
              </p>
            </div>

            {/* BIOS hint */}
            <div className="border border-[#2a2a2a] rounded-lg px-4 py-3 flex items-center gap-3 mb-5 text-sm text-neutral-500 bg-[#0d0d0d]">
              <svg
                className="w-5 h-5 shrink-0"
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
              <div>
                <p className="font-medium text-neutral-400">BIOS PS1 (opcional)</p>
                <p className="text-xs text-[#8b5cf6]">
                  scph5501.bin recomendada para melhor compatibilidade
                </p>
              </div>
            </div>

            <button
              onClick={createRoom}
              className="w-full bg-[#8b5cf6] hover:bg-[#7c3aed] transition-colors rounded-xl py-3 text-sm font-bold uppercase tracking-widest text-white"
            >
              Selecione uma ROM
            </button>
          </div>

          {/* Connect player */}
          <div className="border border-[#2a2a2a] rounded-2xl bg-[#161616] p-6 flex flex-col">
            <h2 className="text-xs font-bold uppercase tracking-widest text-neutral-400 mb-2">
              Conectar Jogador
            </h2>
            <h3 className="text-2xl font-black uppercase tracking-tight text-white mb-3">
              NETPLAY P2P
            </h3>
            <p className="text-sm text-neutral-400 mb-6 leading-relaxed">
              Crie uma sala e envie o link de convite ao seu amigo. Conexão
              direta P2P.
            </p>

            <button
              onClick={createRoom}
              className="flex items-center justify-center gap-2 w-full bg-[#8b5cf6] hover:bg-[#7c3aed] transition-colors rounded-xl py-3 text-sm font-bold uppercase tracking-widest text-white mb-4"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                />
              </svg>
              Criar Sala
            </button>

            <p className="text-xs text-neutral-500 text-center">
              Quem cria a sala é o{" "}
              <span className="text-white font-semibold">Player 1</span>. Quem
              entra pelo link é o{" "}
              <span className="text-[#8b5cf6] font-semibold">Player 2</span>.
            </p>

            <div className="flex-1" />
          </div>
        </section>

        {/* How it works */}
        <section className="max-w-3xl mx-auto px-6 mb-20">
          <h2 className="text-center text-sm font-bold uppercase tracking-widest text-neutral-400 mb-8">
            Como Funciona
          </h2>
          <ol className="space-y-4">
            {[
              "O Player 1 (Host) carrega a ROM ou cria a sala — em qualquer ordem.",
              "O Player 2 abre o link de convite e clica em \"Entrar\".",
              "Conexão P2P é estabelecida — o jogo do Host é transmitido para o Player 2.",
              "O Player 2 joga usando seu próprio controle. Apenas 1 ROM é necessária!",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-4">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-[#8b5cf6] text-white text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <p className="text-sm text-neutral-400 pt-0.5">{step}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#2a2a2a] px-6 py-5 text-center text-xs text-neutral-600">
        RetroLink — Emulação PS1 no navegador com netplay P2P. Não hospedamos
        ROMs ou BIOS.
      </footer>
    </div>
  );
}
