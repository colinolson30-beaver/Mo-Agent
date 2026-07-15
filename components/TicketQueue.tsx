"use client";

import { useState } from "react";
import { useFleet } from "@/lib/store";

interface Ticket {
  id: number;
  title: string;
  submitter: string;
  priority: "high" | "medium" | "low";
  prompt: string;
}

const TICKETS: Ticket[] = [
  {
    id: 1,
    title: "Devices offline since spring break",
    submitter: "Lincoln Middle · IT",
    priority: "high",
    prompt: "Which devices haven't checked in since spring break?",
  },
  {
    id: 2,
    title: "Chrome missing on 6th grade MacBooks",
    submitter: "Maplewood Elementary · Mrs. Torres",
    priority: "high",
    prompt: "Push Google Chrome to the 6th grade carts",
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
  },
  {
    id: 5,
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

  const openCount = Object.values(statuses).filter((s) => s === "open").length;

  const handle = (ticket: Ticket) => {
    setStatuses((prev) => ({ ...prev, [ticket.id]: "in-progress" }));
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
          return (
            <div key={ticket.id} className={`ticket-card status-${status}`}>
              <div className="ticket-top">
                <div className={`ticket-priority-dot priority-${ticket.priority}`} />
                <div className="ticket-title">{ticket.title}</div>
              </div>
              <div className="ticket-meta">{ticket.submitter}</div>
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
