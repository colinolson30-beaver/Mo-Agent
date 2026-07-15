"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useFleet } from "@/lib/store";
import { TICKETS } from "@/lib/tickets";
import type { Plan } from "@/lib/sim/types";

interface BlastRadius {
  device_count: number;
  group_count: number;
  groups: string[];
  share_of_district: string;
  est_bandwidth_gb: number;
}

type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string }
  | { kind: "event"; text: string }
  | { kind: "plan"; plan: Plan; blast: BlastRadius; rollout: string; offlineQueued: number; resolved?: "approved" | "cancelled" | "auto-approved" }
  | { kind: "refusal"; action: string; blast: BlastRadius; elevationText: string };

const TOOL_LABELS: Record<string, string> = {
  search_devices: "searching the fleet",
  list_groups: "listing groups",
  get_device: "looking up device",
  get_command_status: "checking rollout status",
  install_app: "planning app install",
  create_blacklist: "creating URL blocklist",
  push_content_filter: "planning content filter push",
  push_profile: "planning profile push",
  lock_device: "planning remote lock",
  send_message: "planning message",
  erase_device: "planning erase",
};

// ---- Minimal markdown: **bold**, `code`, bullet lists, paragraphs ----

function inline(text: string, keyBase: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <b key={`${keyBase}-${i}`}>{part.slice(2, -2)}</b>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={`${keyBase}-${i}`}>{part.slice(1, -1)}</code>;
    return <Fragment key={`${keyBase}-${i}`}>{part}</Fragment>;
  });
}

function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), `p${blocks.length}`)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={`u${blocks.length}`}>
          {list.map((li, i) => <li key={i}>{inline(li, `li${i}`)}</li>)}
        </ul>,
      );
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-•*]\s+(.*)/);
    if (bullet) {
      flushPara();
      list.push(bullet[1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.replace(/^#+\s*/, ""));
    }
  }
  flushPara();
  flushList();
  return <>{blocks}</>;
}

export default function Chat() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const announcedPlans = useRef(new Set<string>());
  const autoApproved = useRef(new Set<string>());
  const plans = useFleet((s) => s.plans);
  const pendingPrompt = useFleet((s) => s.pendingPrompt);
  const setPendingPrompt = useFleet((s) => s.setPendingPrompt);
  const autopilot = useFleet((s) => s.autopilot);
  const activeTicketId = useFleet((s) => s.activeTicketId);
  const setActiveTicketId = useFleet((s) => s.setActiveTicketId);
  const ticketStatuses = useFleet((s) => s.ticketStatuses);
  const setTicketStatus = useFleet((s) => s.setTicketStatus);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  // Surface rollout completion (incl. failures) as a callout row.
  useEffect(() => {
    for (const p of Object.values(plans)) {
      if (p.status === "completed" && p.resultSummary && !announcedPlans.current.has(p.id)) {
        announcedPlans.current.add(p.id);
        setItems((prev) => [...prev, { kind: "event", text: `Rollout "${p.label}" finished: ${p.resultSummary}` }]);
      }
    }
  }, [plans]);

  const history = (list: ChatItem[]) =>
    list
      .filter((i) => i.kind === "user" || i.kind === "event" || (i.kind === "assistant" && i.text.trim()))
      .map((i) => ({
        role: i.kind === "assistant" ? ("assistant" as const) : i.kind === "event" ? ("event" as const) : ("user" as const),
        content: (i as { text: string }).text,
      }));

  useEffect(() => {
    if (pendingPrompt && !busy) {
      setPendingPrompt(null);
      send(pendingPrompt);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || busy) return;
    if (!overrideText) setInput("");
    setBusy(true);

    const base: ChatItem[] = [...items, { kind: "user", text }];
    setItems(base);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history(base) }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setItems((prev) => [...prev, { kind: "event", text: `Error: ${err.error ?? res.statusText}` }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let openAssistant = false;

      const handle = (obj: Record<string, unknown>) => {
        if (obj.type === "delta") {
          const t = obj.text as string;
          setItems((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (openAssistant && last?.kind === "assistant") {
              next[next.length - 1] = { kind: "assistant", text: last.text + t };
            } else {
              next.push({ kind: "assistant", text: t });
            }
            return next;
          });
          openAssistant = true;
        } else if (obj.type === "tool") {
          openAssistant = false;
          setItems((prev) => [...prev, { kind: "tool", name: obj.name as string }]);
        } else if (obj.type === "plan") {
          openAssistant = false;
          setItems((prev) => [...prev, {
            kind: "plan",
            plan: obj.plan as Plan,
            blast: obj.blast_radius as BlastRadius,
            rollout: obj.rollout as string,
            offlineQueued: (obj.offline_queued as number) ?? 0,
          }]);
        } else if (obj.type === "refusal") {
          openAssistant = false;
          setItems((prev) => [...prev, {
            kind: "refusal",
            action: obj.action as string,
            blast: obj.blast_radius as BlastRadius,
            elevationText: obj.elevation_text as string,
          }]);
        } else if (obj.type === "turn") {
          openAssistant = false;
        } else if (obj.type === "error") {
          setItems((prev) => [...prev, { kind: "event", text: `Error: ${obj.message}` }]);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) handle(JSON.parse(line));
        }
      }
    } catch (err) {
      setItems((prev) => [...prev, { kind: "event", text: `Error: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (idx: number, planId: string, decision: "approve" | "cancel", auto = false) => {
    const res = await fetch("/api/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan_id: planId, decision }),
    });
    const result = await res.json();
    setItems((prev) => {
      const next = [...prev];
      const item = next[idx];
      if (item?.kind === "plan") {
        next[idx] = { ...item, resolved: auto ? "auto-approved" : decision === "approve" ? "approved" : "cancelled" };
      }
      next.push({ kind: "event", text: (auto ? "Autopilot: " : "") + result.message });
      return next;
    });
  };

  // ---- Full autopilot ----

  // 1. Approve any pending plan card. Items are append-only, so an item's
  //    index is still valid when the timeout fires.
  useEffect(() => {
    if (!autopilot) return;
    items.forEach((item, idx) => {
      if (item.kind !== "plan" || item.resolved || autoApproved.current.has(item.plan.id)) return;
      autoApproved.current.add(item.plan.id);
      // Brief pause so the audience sees the plan before it's approved.
      setTimeout(() => decide(idx, item.plan.id, "approve", true), 900);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autopilot, items]);

  // 2. Close out the active ticket once its chat turn is done and any plan it
  //    produced has been decided. A policy refusal marks the ticket blocked
  //    instead — autopilot never overrides the guardrail. Runs in manual mode
  //    too, so hand-approved tickets also flip to Resolved.
  useEffect(() => {
    if (busy || activeTicketId == null) return;
    const lastUser = items.reduce((acc, it, i) => (it.kind === "user" ? i : acc), -1);
    if (lastUser < 0) return;
    const turn = items.slice(lastUser + 1);
    if (turn.some((it) => it.kind === "plan" && !it.resolved)) return; // awaiting a decision
    setTicketStatus(activeTicketId, turn.some((it) => it.kind === "refusal") ? "blocked" : "resolved");
    setActiveTicketId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, items, activeTicketId]);

  // 3. Feed the next open ticket into the chat once the previous one is done.
  useEffect(() => {
    if (!autopilot || busy || activeTicketId != null || pendingPrompt) return;
    const next = TICKETS.find((t) => ticketStatuses[t.id] === "open");
    if (!next) return;
    const timer = setTimeout(() => {
      setTicketStatus(next.id, "in-progress");
      setActiveTicketId(next.id);
      setPendingPrompt(next.prompt);
    }, 1100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autopilot, busy, activeTicketId, pendingPrompt, ticketStatuses]);

  const lastToolIdx = items.reduce((acc, it, i) => (it.kind === "tool" ? i : acc), -1);

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {items.length === 0 && (
          <div className="suggestions">
            Try asking:<br />
            &ldquo;Which devices haven&rsquo;t checked in since spring break?&rdquo;<br />
            &ldquo;Push Chrome to the 6th grade carts&rdquo;<br />
            &ldquo;Wipe every device in the district&rdquo;
          </div>
        )}
        {busy && items[items.length - 1]?.kind === "user" && (
          <div className="typing-indicator">
            <span /><span /><span />
          </div>
        )}
        {items.map((item, i) => {
          switch (item.kind) {
            case "user":
              return <div key={i} className="msg user">{item.text}</div>;
            case "assistant":
              return <div key={i} className="msg assistant"><Markdown text={item.text} /></div>;
            case "event": {
              const isDanger = /^error|failed/i.test(item.text) || item.text.includes("FAILED");
              return (
                <div key={i} className={`callout${isDanger ? " danger" : ""}`}>
                  <span className="icon">{isDanger ? "⚠" : "✓"}</span>
                  <span>{item.text}</span>
                </div>
              );
            }
            case "tool":
              return (
                <div key={i} className="tool-note">
                  {busy && i === lastToolIdx ? <span className="spinner" /> : <span className="tool-check">✓</span>}
                  {TOOL_LABELS[item.name] ?? item.name}…
                </div>
              );
            case "refusal":
              return (
                <div key={i} className="refusal-card">
                  <h4>Refused by policy: {item.action.replace(/_/g, " ")}</h4>
                  <div className="body">
                    Blast radius: <b>{item.blast.device_count} devices</b> across {item.blast.group_count} groups ({item.blast.share_of_district} of the district) — highlighted on the board.
                  </div>
                  <p>{item.elevationText}</p>
                </div>
              );
            case "plan":
              return (
                <div key={i} className="plan-card">
                  <h4>
                    {item.plan.label}
                    {!item.resolved && <span className="pill warn">Awaiting approval</span>}
                  </h4>
                  <ul>
                    <li><b>{item.blast.device_count} devices</b> in {item.blast.group_count} group{item.blast.group_count === 1 ? "" : "s"}: {item.blast.groups.join(", ")}</li>
                    <li>Est. bandwidth ~{item.blast.est_bandwidth_gb} GB · {item.rollout}</li>
                    {typeof item.plan.payload?.remove_after_hours === "number" && (
                      <li>Timed deploy: auto-removes after {String(item.plan.payload.remove_after_hours)}h (compressed demo clock)</li>
                    )}
                    {item.offlineQueued > 0 && <li>{item.offlineQueued} offline device{item.offlineQueued === 1 ? "" : "s"} queued for next check-in</li>}
                  </ul>
                  {item.resolved ? (
                    <div className={`resolved${item.resolved === "auto-approved" ? " auto" : ""}`}>
                      {item.resolved === "auto-approved" ? "✓ Auto-approved — Full Autopilot" : item.resolved === "approved" ? "✓ Approved" : "✕ Cancelled"}
                    </div>
                  ) : (
                    <div className="buttons">
                      <button className="btn-primary" onClick={() => decide(i, item.plan.id, "approve")}>
                        Approve — {item.blast.device_count} devices
                      </button>
                      <button className="btn-secondary" onClick={() => decide(i, item.plan.id, "cancel")}>Cancel</button>
                    </div>
                  )}
                </div>
              );
          }
        })}
      </div>
      <div className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(undefined)}
          placeholder="Ask about or command your fleet…"
          disabled={busy}
        />
        <button onClick={() => send(undefined)} disabled={busy || !input.trim()} aria-label="Send">➤</button>
      </div>
    </div>
  );
}
