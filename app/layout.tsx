import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FleetPilot — Maplewood School District",
  description: "Conversational fleet ops for K-12 MacBook fleets",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
