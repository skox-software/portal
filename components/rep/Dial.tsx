const PHONE = "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2";
const MAIL = "M4 6h16v12H4zM4 7l8 6 8-6";

export function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
export const PHONE_ICON = PHONE;
export const MAIL_ICON = MAIL;

export function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** One-tap call and email, straight from the list. */
export function Dial({ phone, email, name }: { phone: string | null; email: string | null; name: string }) {
  if (!phone && !email) return <span className="rp-dial" />;
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
    </span>
  );
}
