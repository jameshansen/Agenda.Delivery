// ponytail: hard-coded sample data until the backend/DB lands (Phase 3).
export type Agenda = {
  slug: string;
  name: string;
  lastUpdated: string; // display string for now
};

export const newestAgendas: Agenda[] = [
  {
    slug: "township-of-langley",
    name: "Township of Langley",
    lastUpdated: "June 24, 2026",
  },
  {
    slug: "city-of-langley",
    name: "City of Langley",
    lastUpdated: "June 18, 2026",
  },
];
