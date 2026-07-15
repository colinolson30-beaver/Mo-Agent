export interface Ticket {
  id: number;
  title: string;
  submitter: string;
  priority: "high" | "medium" | "low";
  prompt: string;
  groupKeys?: string[]; // fleet groups to count devices from
}

export type TicketStatus = "open" | "in-progress" | "resolved" | "blocked";

export const TICKETS: Ticket[] = [
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
