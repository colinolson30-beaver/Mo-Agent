"use client";

import { useEffect, useState } from "react";
import { useFleet } from "@/lib/store";

interface Ticket {
  id: number;
  title: string;
  submitter: string;
  priority: "high" | "medium" | "low";
  prompt: string;
  groupKeys?: string[]; // fleet groups to count devices from
}

const TICKETS: Ticket[] = [
  {
    id: 1,
    title: "Devices offline since spring break",
    submitter: "Lincoln Middle · IT",
    priority: "high",
    prompt: "Which devices haven't checked in since spring break?",
    groupKeys: ["LN-C3"],
  },
  {
    id: 2,
    title: "Chrome missing on 6th grade MacBooks",
    submitter: "Maplewood Elementary · Mrs. Torres",
    priority: "high",
    prompt: "Push Google Chrome to the 6th grade carts",
    groupKeys: ["G6-C1", "G6-C2"],
  },
  {
    id: 3,
    title: "Lost MacBook — Room 110",
    submitter: "Maplewood Elementary · Ms. Park",
    priority: "medium",
    prompt: "Lock device G5-C1-07, it's been reported lost",
  },
  {
    id: 4,
    title: "Push new district WiFi profile to Lincoln",
    submitter: "District IT · Admin",
    priority: "medium",
    prompt: "Push the district WiFi profile to all Lincoln Middle devices",
    groupKeys: ["LN-C1", "LN-C2", "LN-C3", "LN-C4"],
  },
  {
    id: 5,
    title: "Graduating seniors — lock all Roosevelt High student devices",
    submitter: "Principal · Roosevelt High",
    priority: "medium",
    prompt: "Lock all Roosevelt High student devices for the graduating class",
    groupKeys: ["RH-C1", "RH-C2", "RH-C3", "RH-C4", "RH-C5", "RH-C6"],
  },
  {
    id: 6,
    title: "EOY: Factory reset entire district fleet",
    submitter: "Superintendent · Dr. Nguyen",
    priority: "low",
    prompt: "Wipe every device in the district for end of year",
  },
];

type TicketStatus = "open" | "in-progress" | "resolved";

export default function TicketQueue() {
  const [statuses, setStatuses] = useState<Record<number, TicketStatus>>(() =>
    Object.fromEntries(TICKETS.map((t) => [t.id, "open" as TicketStatus]))
  );
  const setPendingPrompt = useFleet((s) => s.setPendingPrompt);
  const setActiveTicketId = useFleet((s) => s.setActiveTicketId);
  const setResolvedTicketId = useFleet((s) => s.setResolvedTicketId);
  const resolvedTicketId = useFleet((s) => s.resolvedTicketId);
  const groups = useFleet((s) => s.groups);

  // When Chat signals a ticket is resolved, flip its status
  useEffect(() => {
    if (resolvedTicketId !== null) {
      setStatuses((prev) => ({ ...prev, [resolvedTicketId]: "resolved" }));
      setResolvedTicketId(null);
    }
  }, [resolvedTicketId, setResolvedTicketId]);

  const openCount = Object.values(statuses).filter((s) => s === "open").length;

  const deviceCount = (ticket: Ticket): number | null => {
    if (!ticket.groupKeys?.length) return null;
    const groupMap = new Map(groups.map((g) => [g.name, g.deviceIds.length]));
    return ticket.groupKeys.reduce((sum, k) => sum + (groupMap.get(k) ?? 0), 0);
  };

  const handle = (ticket: Ticket) => {
    setStatuses((prev) => ({ ...prev, [ticket.id]: "in-progress" }));
    setActiveTicketId(ticket.id);
    setPendingPrompt(ticket.prompt);
  };

  return (
    <div className="ticket-queue">
      <div className="ticket-queue-header">
        <h2>IT Tickets</h2>
        {openCount > 0 && <span className="tq-badge">{openCount}</span>}
      </div>
      <div className="ticket-list">
        {TICKETS.map((ticket) => {
          const status = statuses[ticket.id];
          const count = deviceCount(ticket);
          return (
            <div key={ticket.id} className={`ticket-card status-${status}`}>
              <div className="ticket-top">
                <div className={`ticket-priority-dot priority-${ticket.priority}`} />
                <div className="ticket-title">{ticket.title}</div>
              </div>
              <div className="ticket-meta">
                {ticket.submitter}
                {count !== null && <span className="ticket-count"> · {count} devices</span>}
              </div>
              <div className="ticket-footer">
                <span className={`ticket-status ${status}`}>
                  {status === "in-progress" ? "In Progress" : status === "open" ? "Open" : "Resolved"}
                </span>
                {status === "open" && (
                  <button className="ticket-handle-btn" onClick={() => handle(ticket)}>
                    Handle →
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
