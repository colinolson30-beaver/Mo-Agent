"use client";

import { useEffect } from "react";
import TopBar from "@/components/TopBar";
import Chat from "@/components/Chat";
import FleetGrid from "@/components/FleetGrid";
import TicketQueue from "@/components/TicketQueue";
import { useFleet } from "@/lib/store";

export default function Home() {
  const connect = useFleet((s) => s.connect);
  useEffect(() => connect(), [connect]);

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <TicketQueue />
        <Chat />
        <FleetGrid />
      </div>
    </div>
  );
}
