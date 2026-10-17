/** Dollars big, cents small: "$1,250.<small>00</small>". */
export function Money({ cents, className }: { cents: number; className?: string }) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = String(abs % 100).padStart(2, "0");
  return (
    <span className={className}>
      {negative ? "−" : ""}${dollars}
      <small>.{rest}</small>
    </span>
  );
}

export function money(cents: number) {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
