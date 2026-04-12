import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RetroLink — Emulação PS1 Multiplayer P2P",
  description:
    "Jogue títulos multiplayer local da PS1 com amigos de qualquer lugar do mundo via WebRTC P2P.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        <Script src="/emu/wasmpsx.min.js" strategy="afterInteractive" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0d0d0d] text-neutral-200`}
      >
        {children}
      </body>
    </html>
  );
}
