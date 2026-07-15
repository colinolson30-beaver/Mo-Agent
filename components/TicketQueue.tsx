"use client";

import { useFleet } from "@/lib/store";
import { TICKETS, type Ticket } from "@/lib/tickets";

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  "in-progress": "In Progress",
  resolved: "Resolved",
  blocked: "Blocked",
};

export default function TicketQueue() {
  const statuses = useFleet((s) => s.ticketStatuses);
  const autopilot = useFleet((s) => s.autopilot);
  const setPendingPrompt = useFleet((s) => s.setPendingPrompt);
  const setTicketStatus = useFleet((s) => s.setTicketStatus);
  const setActiveTicketId = useFleet((s) => s.setActiveTicketId);

  const openCount = Object.values(statuses).filter((s) => s === "open").length;

  const handle = (ticket: Ticket) => {
    setTicketStatus(ticket.id, "in-progress");
    setActiveTicketId(ticket.id);
    setPendingPrompt(ticket.prompt);
  };

  return (
    <div className="ticket-queue">
      <div className="ticket-queue-header">
        <h2>IT Tickets</h2>
        {autopilot && <span className="tq-autopilot">Autopilot</span>}
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
                <span className={`ticket-status ${status}`}>{STATUS_LABELS[status]}</span>
                {status === "open" && !autopilot && (
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
