"use client";

import { useFleet } from "@/lib/store";

export default function TopBar() {
  const stats = useFleet((s) => s.stats);
  const autopilot = useFleet((s) => s.autopilot);
  const setAutopilot = useFleet((s) => s.setAutopilot);

  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-logo">Mo</div>
        <span className="name">Mo</span>
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
      <button
        className={`autopilot-toggle${autopilot ? " on" : ""}`}
        onClick={() => setAutopilot(!autopilot)}
        title="When on, Mo works the ticket queue and approves plans automatically"
      >
        <span className="track"><span className="knob" /></span>
        Full Autopilot{autopilot ? " · On" : ""}
      </button>
    </div>
  );
}
