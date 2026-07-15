"use client";

import { memo, useMemo } from "react";
import { useFleet } from "@/lib/store";
import type { Device, Group } from "@/lib/sim/types";

const COMPACT_THRESHOLD = 40; // groups larger than this render dot-only chips

type HighlightKind = "info" | "plan" | "danger" | "none";

function tileClass(d: Device, hl: HighlightKind | null, compact: boolean): string {
  const classes = ["tile"];
  if (compact) classes.push("compact");
  const cmd = d.activeCommand;
  if (cmd && cmd.state !== "done" && cmd.state !== "failed") classes.push("pending");
  else if (cmd?.state === "done") classes.push("done");
  else if (cmd?.state === "failed") classes.push("failed");
  else if (d.status === "offline") classes.push("offline");
  else if (d.locked) classes.push("locked");
  else classes.push("online");
  if (hl && hl !== "none") classes.push(`hl-${hl}`);
  return classes.join(" ");
}

const Tile = memo(function Tile({ device, hl, compact }: { device: Device; hl: HighlightKind | null; compact: boolean }) {
  return (
    <div
      className={tileClass(device, hl, compact)}
      title={`${device.name} · ${device.room} · ${device.status}${device.contentFilter ? ` · ${device.contentFilter.name} (${device.contentFilter.urlCount} URLs blocked)` : ""}${device.activeCommand ? ` · ${device.activeCommand.label}: ${device.activeCommand.state}` : ""}`}
    >
      {!compact && device.name.slice(device.group.length + 1)}
      <span className="dot" />
      {device.contentFilter && !compact && <span className="shield">⛨</span>}
    </div>
  );
});

const GroupCard = memo(function GroupCard({ group, devices, highlightIds, highlightKind }: {
  group: Group;
  devices: Record<string, Device>;
  highlightIds: Set<string>;
  highlightKind: HighlightKind;
}) {
  const compact = group.deviceIds.length > COMPACT_THRESHOLD;

  let online = 0, offline = 0, updating = 0, failed = 0, filtered = 0;
  for (const id of group.deviceIds) {
    const d = devices[id];
    if (!d) continue;
    const cmd = d.activeCommand;
    if (cmd && cmd.state !== "done" && cmd.state !== "failed") updating++;
    if (cmd?.state === "failed") failed++;
    if (d.status === "online") online++;
    else offline++;
    if (d.contentFilter) filtered++;
  }

  return (
    <div className={`cart-card${compact ? " wide" : ""}`}>
      <div className="cart-head">
        <span className="cart-name">{group.name}</span>
        <span className="cart-meta">{group.room} · {group.deviceIds.length} devices</span>
        <span className="pills">
          {online > 0 && <span className="pill ok">{online} online</span>}
          {offline > 0 && <span className="pill off">{offline} offline</span>}
          {updating > 0 && <span className="pill warn">{updating} updating</span>}
          {failed > 0 && <span className="pill bad">{failed} failed</span>}
          {filtered > 0 && <span className="pill filter">⛨ {filtered} filtered</span>}
        </span>
      </div>
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

function Skeleton() {
  return (
    <div className="school">
      <h2>Loading fleet…</h2>
      <div className="school-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="skel-card" key={i}>
            <div className="skel-line" style={{ width: "45%" }} />
            <div className="skel-line" style={{ width: "80%" }} />
            <div className="skel-line" style={{ width: "65%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

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

  if (groups.length === 0) {
    return (
      <div className="fleet">
        <Skeleton />
      </div>
    );
  }

  return (
    <div className="fleet">
      {bySchool.map(([school, schoolGroups]) => {
        const total = schoolGroups.reduce((n, g) => n + g.deviceIds.length, 0);
        return (
          <div className="school" key={school}>
            <h2>
              {school}
              <span>{total} devices</span>
            </h2>
            <div className="school-grid">
              {schoolGroups.map((g) => (
                <GroupCard key={g.name} group={g} devices={devices} highlightIds={highlightIds} highlightKind={highlight.kind} />
              ))}
            </div>
          </div>
        );
      })}
      <div className="legend">
        <span><i style={{ background: "var(--success)" }} />Online</span>
        <span><i style={{ background: "transparent", border: "1.5px solid var(--text-tertiary)" }} />Offline</span>
        <span><i style={{ background: "var(--warning)" }} />Updating</span>
        <span><i style={{ background: "var(--danger)" }} />Failed</span>
        <span><i style={{ background: "var(--accent)" }} />⛨ Content filtered</span>
      </div>
    </div>
  );
}
