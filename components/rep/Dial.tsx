const PHONE = "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2";
const MAIL = "M4 6h16v12H4zM4 7l8 6 8-6";
const CAL = "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 2v4M16 2v4";

export function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
export const PHONE_ICON = PHONE;
export const MAIL_ICON = MAIL;
export const CAL_ICON = CAL;

export function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** One-tap call and email, straight from the list. */
export function Dial({ phone, email, name, bookHref }: { phone: string | null; email: string | null; name: string; bookHref?: string }) {
  if (!phone && !email && !bookHref) return <span className="rp-dial" />;
  return (
    <span className="rp-dial">
      {phone && (
        <a href={telHref(phone)} aria-label={`Call ${name}`} title={phone}>
          <Icon d={PHONE} />
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} aria-label={`Email ${name}`} title={email}>
          <Icon d={MAIL} />
        </a>
      )}
      {bookHref && (
        <a href={bookHref} aria-label={`Book a scope call with ${name}`} title="Book the scope call" data-book="">
          <Icon d={CAL} />
        </a>
      )}
    </span>
  );
}
