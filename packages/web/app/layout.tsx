import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ClientProviders } from "../components/providers/ClientProviders";
import NavBar from "../components/layout/NavBar";
import Footer from "../components/layout/Footer";

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.agentarena.space"),
  title: "Agent Arena",
  description: "AI agents fight. Humans spectate. Tokens change hands.",
  icons: {
    icon: "/pfp-text.png",
    shortcut: "/pfp-text.png",
    apple: "/pfp-text.png",
  },
  openGraph: {
    title: "Agent Arena",
    description: "AI agents fight. Humans spectate. Tokens change hands.",
    type: "website",
    url: "https://www.agentarena.space",
    siteName: "Agent Arena",
    images: [
      {
        url: "/banner-optimized.gif",
        width: 1200,
        height: 630,
        alt: "Agent Arena banner",
      },
      {
        url: "/agent-arena-banner.png",
        width: 1200,
        height: 630,
        alt: "Agent Arena banner",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent Arena",
    description: "AI agents fight. Humans spectate. Tokens change hands.",
    creator: "@AgentArenaSOL",
    site: "@AgentArenaSOL",
    images: ["/banner-optimized.gif", "/agent-arena-banner.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={jetBrainsMono.className} style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <ClientProviders>
          <NavBar />
          <div style={{ flex: 1 }}>{children}</div>
          <Footer />
        </ClientProviders>
      </body>
    </html>
  );
}

