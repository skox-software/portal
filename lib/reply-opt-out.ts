/** Only inspect the newly authored reply, never our quoted unsubscribe footer. */
export function replyText(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*>/.test(line)) break;
    if (/^\s*On\b/i.test(line) && /wrote:\s*$/im.test(lines.slice(i, i + 5).join("\n"))) break;
    if (/^\s*(-{2,}\s*(Original|Forwarded) Message|_{5,}|Begin forwarded message:)/i.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && lines.slice(i + 1, i + 5).some(l => /^\s*(Sent|Date|To):/i.test(l))) break;
    if (/^\s*--\s*$/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Explicit English opt-outs. Ambiguous replies remain in the Inbox for review. */
export function isOptOutReply(subject: string, text: string) {
  const authored = replyText(text).replace(/[’‘]/g, "'").toLowerCase();
  const directSubject = subject.replace(/^(\s*re\s*:\s*)+/gi, "").trim();
  if (/^(unsubscribe|remove me|stop emailing me|opt out)[.!\s]*$/i.test(directSubject)) return true;
  return authored.split(/[\n.!?]+/).some(sentence => {
    const s = sentence.trim();
    // Don't interpret a request to stay subscribed as an opt-out.
    if (/\b(don't|do not|never)\s+(unsubscribe|remove|opt)\b/.test(s)) return false;
    return /\b(unsubscribe\s+me|remove\s+(me|my (email|address))\s+(from|off)|take\s+me\s+off|stop\s+(emailing|contacting|sending)|do not\s+(email|contact)|don't\s+(email|contact)|no\s+thanks|no\s+thank\s+you|not\s+interested|opt[ -]out)\b/.test(s)
      || /^(please\s+)?(unsubscribe|remove me|stop)(\s+please)?[,;\s]*$/.test(s);
  });
}
