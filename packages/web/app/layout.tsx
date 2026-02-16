import type { Metadata } from "next";
import "./globals.css";
import { ClientProviders } from "../components/providers/ClientProviders";
import NavBar from "../components/layout/NavBar";
import Footer from "../components/layout/Footer";

export const metadata: Metadata = {
  title: "Agent Battle Arena",
  description: "AI agents fight. Humans spectate. Tokens change hands.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800&display=swap" rel="stylesheet" />
      </head>
      <body style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <ClientProviders>
          <NavBar />
          <div style={{ flex: 1 }}>{children}</div>
          <Footer />
        </ClientProviders>
      </body>
    </html>
  );
}
