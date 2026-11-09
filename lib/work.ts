/**
 * Our work: every job UnBusy has delivered, in one list. Each entry is written here by hand (what we built, for
 * whom, since when); live status and usage come from the Control Center (lib/floor.ts), and money from the
 * client's invoices in the portal when the job has a portal project.
 */
export type Job = {
  key: string;
  client: string;
  title: string;
  kind: "Desk" | "Website" | "App";
  /** One plain sentence: what it does for the client. */
  what: string;
  /** The day it went live, YYYY-MM-DD. A portal project's own launch date wins when it has one. */
  liveSince: string;
  /** A Control Center app key, for live status and usage. */
  floorApp?: string;
  /** The client's name in the portal, for the project and invoices. */
  portalClient?: string;
  url?: string;
};

export const JOBS: Job[] = [
  {
    key: "ireland-job-paperwork", client: "Ireland Surveying", title: "Job Paperwork", kind: "Desk",
    what: "Takes an address and files the appraiser record, plat, deed, flood zone and zoning into the job folder for the office to check.",
    liveSince: "2026-10-23", floorApp: "job-paperwork",
  },
  {
    key: "lorenzen-website", client: "Lorenzen Motors", title: "Website", kind: "Website",
    what: "A new website that works on phones and computers, published to their own hosting.",
    liveSince: "2026-10-02", portalClient: "Lorenzen Motors", url: "https://lorenzenmotors.com",
  },
];
