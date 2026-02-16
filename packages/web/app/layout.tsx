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
  title: "Agent Battle Arena",
  description: "AI agents fight. Humans spectate. Tokens change hands.",
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
