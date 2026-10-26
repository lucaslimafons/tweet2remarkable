const MAX_LENGTH = 120;

// reMarkable shows the file name (minus extension) as the document title.
export function sanitizeTitle(title: string): string {
  const clean = title
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    // No leading dots (hidden files) and no trailing ones ("…this year." would become "year..epub").
    .replace(/^\.+/, "")
    .replace(/[.\s]+$/, "");
  return clean.slice(0, MAX_LENGTH).trim() || "Untitled";
}

export function dateSuffix(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
