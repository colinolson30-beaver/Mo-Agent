"use client";

import { memo, useMemo } from "react";
import { useFleet } from "@/lib/store";
import type { Device, Group } from "@/lib/sim/types";

const COMPACT_THRESHOLD = 40; // groups larger than this render dot-only tiles

function tileClass(d: Device, hl: "info" | "plan" | "danger" | null, compact: boolean): string {
  const classes = ["tile"];
  if (compact) classes.push("compact");
  const cmd = d.activeCommand;
  if (cmd && cmd.state !== "done" && cmd.state !== "failed") classes.push("pending");
  else if (cmd?.state === "done") classes.push("done");
  else if (cmd?.state === "failed") classes.push("failed");
  else if (d.status === "offline") classes.push("offline");
  else if (d.locked) classes.push("locked");
  if (hl) classes.push(`hl-${hl}`);
  return classes.join(" ");
}

const Tile = memo(function Tile({ device, hl, compact }: { device: Device; hl: "info" | "plan" | "danger" | null; compact: boolean }) {
  return (
    <div className={tileClass(device, hl, compact)} title={`${device.name} · ${device.room} · ${device.status}${device.activeCommand ? ` · ${device.activeCommand.label}: ${device.activeCommand.state}` : ""}`}>
      {!compact && device.name.slice(device.group.length + 1)}
      <span className="dot" />
    </div>
  );
});

const GroupBlock = memo(function GroupBlock({ group, devices, highlightIds, highlightKind }: {
  group: Group;
  devices: Record<string, Device>;
  highlightIds: Set<string>;
  highlightKind: "info" | "plan" | "danger" | "none";
}) {
  const compact = group.deviceIds.length > COMPACT_THRESHOLD;
  const offline = group.deviceIds.filter((id) => devices[id]?.status === "offline").length;
  return (
    <div className="group">
      <h3>
        {group.name} <small>· {group.room} · {group.deviceIds.length} devices{offline ? ` · ${offline} offline` : ""}</small>
      </h3>
      <div className="tiles">
        {group.deviceIds.map((id) => {
          const d = devices[id];
          if (!d) return null;
          const hl = highlightKind !== "none" && highlightIds.has(id) ? highlightKind : null;
          return <Tile key={id} device={d} hl={hl} compact={compact} />;
        })}
      </div>
    </div>
  );
});

export default function FleetGrid() {
  const devices = useFleet((s) => s.devices);
  const groups = useFleet((s) => s.groups);
  const highlight = useFleet((s) => s.highlight);

  const highlightIds = useMemo(() => new Set(highlight.deviceIds), [highlight]);

  const bySchool = useMemo(() => {
    const map = new Map<string, Group[]>();
    for (const g of groups) {
      const list = map.get(g.school) ?? [];
      list.push(g);
      map.set(g.school, list);
    }
    return [...map.entries()];
  }, [groups]);

  return (
    <div className="fleet">
      {bySchool.map(([school, schoolGroups]) => (
        <div className="school" key={school}>
          <h2>{school}</h2>
          {schoolGroups.map((g) => (
            <GroupBlock key={g.name} group={g} devices={devices} highlightIds={highlightIds} highlightKind={highlight.kind} />
          ))}
        </div>
      ))}
      <div className="legend">
        <span><i style={{ background: "#3b4658" }} />idle</span>
        <span><i style={{ background: "transparent", border: "1px solid #4a5670" }} />offline</span>
        <span><i style={{ background: "var(--amber)" }} />command pending</span>
        <span><i style={{ background: "var(--green)" }} />success</span>
        <span><i style={{ background: "var(--red)" }} />failed</span>
      </div>
    </div>
  );
}
