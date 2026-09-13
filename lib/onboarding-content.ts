/**
 * What the welcome flow asks. Plain data, so questions can be tuned without
 * touching the flow or the database (answers are stored as JSON by id).
 * Kept free of framework imports so it's testable and shareable.
 */

export type Question = {
  id: string;
  label: string;
  help?: string;
  type: "text" | "textarea" | "choice" | "multi" | "links";
  options?: string[];
  placeholder?: string;
  required?: boolean;
};

const CORE: Question[] = [
  {
    id: "goal",
    label: "In one sentence, what should this project do for your business?",
    type: "textarea",
    placeholder: "e.g. Let new patients book online so our front desk stops playing phone tag",
    required: true,
  },
  {
    id: "success",
    label: "Picture 90 days after launch. What's different?",
    help: "More bookings, fewer spreadsheets, happier customers. Whatever you'd celebrate.",
    type: "textarea",
  },
  { id: "audience", label: "Who will use it?", type: "textarea", placeholder: "Your customers, your team, both? Tell us about them." },
  { id: "mustHaves", label: "Must-haves for launch", help: "One per line.", type: "textarea" },
  { id: "niceToHaves", label: "Nice-to-haves (if time allows)", help: "One per line.", type: "textarea" },
  {
    id: "inspiration",
    label: "Websites or apps you love, and why",
    help: "One link per line, add a few words about what you like.",
    type: "links",
    placeholder: "https://example.com - love how simple checkout is",
  },
  {
    id: "deadline",
    label: "Is there a date this has to be live by?",
    type: "choice",
    options: ["No hard date, sooner is better", "Yes, a real deadline", "We're flexible"],
  },
  { id: "deadlineWhy", label: "If there's a deadline, what's driving it?", type: "text", placeholder: "e.g. Grand opening on March 1" },
];

const BY_KIND: Record<string, Question[]> = {
  website: [
    {
      id: "pages",
      label: "Which pages do you picture?",
      type: "multi",
      options: ["Home", "About", "Services", "Pricing", "Booking", "Shop", "Blog / news", "Careers", "FAQ", "Contact"],
    },
    {
      id: "features",
      label: "Anything it needs to do?",
      type: "multi",
      options: ["Online booking", "Contact / quote forms", "Take payments", "Newsletter signup", "Live chat", "Multiple languages", "Client login"],
    },
    { id: "existingSite", label: "Current website, if you have one", type: "text", placeholder: "https://" },
    { id: "content", label: "Is your text and photography ready?", type: "choice", options: ["Yes, it's ready", "Some of it", "We'd like help with it"] },
  ],
  "web-app": [
    { id: "users", label: "Who logs in, and what can each type of user do?", type: "textarea" },
    {
      id: "coreFlow",
      label: "Walk us through the one thing a user absolutely must be able to do",
      type: "textarea",
      placeholder: "A customer signs up, picks a plan, and…",
      required: true,
    },
    {
      id: "integrations",
      label: "What should it connect to?",
      type: "multi",
      options: ["Stripe / payments", "QuickBooks", "Google Workspace", "Microsoft 365", "Text messages", "Email marketing", "Zapier", "Something else"],
    },
    { id: "dataToday", label: "Where does this information live today?", type: "choice", options: ["Spreadsheets", "Another app", "Paper / email", "Starting fresh"] },
  ],
  portal: [
    { id: "portalUsers", label: "Who are the customers that will log in?", type: "textarea" },
    {
      id: "portalActions",
      label: "What should they be able to do in it?",
      type: "multi",
      options: ["See status of their work or orders", "Upload and download files", "Pay invoices", "Book appointments", "Message your team", "Sign documents", "See reports"],
    },
    { id: "volume", label: "Roughly how many customers would use it?", type: "choice", options: ["Under 50", "50 to 500", "500+"] },
  ],
  dashboard: [
    {
      id: "metrics",
      label: "The 5 numbers you'd want to see first thing every morning",
      type: "textarea",
      required: true,
      placeholder: "Bookings today\nRevenue this week by location\n…",
    },
    {
      id: "sources",
      label: "Where do those numbers come from today?",
      type: "multi",
      options: ["Square", "Shopify", "Stripe", "QuickBooks", "Google Analytics", "Google Ads", "Meta Ads", "Mindbody", "Acuity", "HubSpot", "Spreadsheets", "Something else"],
    },
    { id: "viewers", label: "Who looks at it, and how often?", type: "textarea" },
    { id: "locations", label: "How many locations, crews or teams should it cover?", type: "text" },
  ],
  "internal-tool": [
    {
      id: "process",
      label: "What process should this replace? Walk us through how it works today.",
      type: "textarea",
      required: true,
    },
    { id: "toolsToday", label: "Which tools or spreadsheets are involved now?", type: "text" },
    { id: "teamSize", label: "How many people would use it?", type: "choice", options: ["1 to 5", "6 to 25", "26+"] },
  ],
  other: [{ id: "describe", label: "Tell us about it in your own words", type: "textarea", required: true }],
};

export function questionsFor(kind: string) {
  return [...CORE, ...(BY_KIND[kind] ?? BY_KIND.other)];
}

export type AccessItem = { id: string; label: string; why: string };

const ACCESS_COMMON: AccessItem[] = [
  { id: "domain", label: "Your domain name (GoDaddy, Namecheap, Squarespace Domains…)", why: "So we can point your address at the new product when it launches." },
  { id: "email", label: "Your business email (Google Workspace or Microsoft 365)", why: "So emails from the product come from your real address and land in inboxes." },
];

const ACCESS_BY_KIND: Record<string, AccessItem[]> = {
  website: [
    { id: "currentSite", label: "Your current website or website builder", why: "So we can move content and keep your search rankings." },
    { id: "googleBusiness", label: "Google Business Profile", why: "So your hours, links and reviews match the new site." },
    { id: "analytics", label: "Google Analytics / Search Console", why: "So we can measure results from day one." },
  ],
  "web-app": [
    { id: "payments", label: "Payment processor (Stripe, Square…)", why: "So payments go straight to your account." },
    { id: "existingTools", label: "The software you use today for this work", why: "So we can bring your data across and connect things up." },
  ],
  portal: [
    { id: "payments", label: "Payment processor (Stripe, Square…)", why: "So customers can pay you inside the portal." },
    { id: "existingTools", label: "Where your customer records live today", why: "So your customers are already set up on day one." },
  ],
  dashboard: [
    { id: "dataSources", label: "Each tool your numbers come from", why: "So the dashboard updates itself, no exports." },
    { id: "adsAccounts", label: "Ad accounts (Google Ads, Meta)", why: "So marketing results sit next to revenue." },
  ],
  "internal-tool": [{ id: "existingTools", label: "The spreadsheets and tools you use today", why: "So nothing gets lost moving over." }],
  other: [{ id: "existingTools", label: "Any tools or accounts involved", why: "So we can connect everything properly." }],
};

export function accessFor(kind: string) {
  return [...ACCESS_COMMON, ...(ACCESS_BY_KIND[kind] ?? ACCESS_BY_KIND.other)];
}

export const ACCESS_STATUS = {
  done: "Shared",
  help: "I need help",
  na: "Not needed",
} as const;

export const TONE_WORDS = [
  "Friendly", "Premium", "Bold", "Calm", "Playful", "Trustworthy", "Modern",
  "Classic", "Warm", "Minimal", "Energetic", "Professional", "Local", "Luxury",
];

export const CONTACT_METHODS = ["Email", "Text", "Phone call"];
export const BEST_TIMES = ["Mornings", "Afternoons", "Evenings"];

/** "a line\n\nanother" → ["a line", "another"] */
export function lines(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value;
  return (value ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Pulls a display name out of an email domain for a placeholder client name. */
export function companyFromEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const free = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "me.com", "proton.me", "protonmail.com", "live.com", "msn.com"];
  if (!domain || free.includes(domain)) return null;
  const base = domain.split(".")[0] ?? "";
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
