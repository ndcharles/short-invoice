/** Two-letter avatar from the profile name ("Nd Charles" -> "NC", "ndcharles" -> "ND"). */
export function initials(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? 'NC').slice(0, 2);
  return letters.toUpperCase() || 'NC';
}
