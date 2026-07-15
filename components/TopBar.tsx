"use client";

import { useFleet } from "@/lib/store";

export default function TopBar() {
  const stats = useFleet((s) => s.stats);

  const debugWave = async () => {
    await fetch("/api/debug/wave", { method: "POST" });
  };

  return (
    <div className="topbar">
      <div className="brand">
        ▦ <span>FleetPilot</span>
        <small>Maplewood School District</small>
      </div>
      <div className="stat"><b>{stats.total}</b><label>devices</label></div>
      <div className="stat"><b>{stats.online}</b><label>online</label></div>
      <div className="stat pending"><b>{stats.pendingCommands}</b><label>pending</label></div>
      <div className="stat failed"><b>{stats.failed}</b><label>failed</label></div>
      {/* Hidden-in-plain-sight debug button: tunes the wave with zero AI */}
      <button className="debug-btn" onClick={debugWave} title="Trigger a demo wave with no AI involved">
        ◉ wave
      </button>
    </div>
  );
}
