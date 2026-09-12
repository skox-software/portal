/** Shows the ?error= or ?notice= message a server action redirected back with. */
export function Notice({ error, notice }: { error?: string; notice?: string }) {
  if (error) {
    return (
      <p className="notice notice-error" role="alert">
        {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p className="notice notice-ok" role="status">
        {notice}
      </p>
    );
  }
  return null;
}

export function readMessage(value: string | string[] | undefined) {
  return typeof value === "string" ? value.slice(0, 300) : undefined;
}
