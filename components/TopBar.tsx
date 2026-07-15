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
        <span className="mark">▦</span>
        <span className="name">FleetPilot</span>
        <small>Maplewood School District</small>
      </div>
      <div className="stat"><label>Devices</label><b>{stats.total}</b></div>
      <div className="stat"><label>Online</label><b>{stats.online}</b></div>
      <div className={`stat pending${stats.pendingCommands > 0 ? " nonzero" : ""}`}>
        <label>Pending</label><b>{stats.pendingCommands}</b>
      </div>
      <div className={`stat failed${stats.failed > 0 ? " nonzero" : ""}`}>
        <label>Failed</label><b>{stats.failed}</b>
      </div>
      {/* Demo wave: runs the full rollout choreography with no AI involved */}
      <button className="debug-btn" onClick={debugWave} title="Trigger a demo wave with no AI involved">
        Demo wave
      </button>
    </div>
  );
}
