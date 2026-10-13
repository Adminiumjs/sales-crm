/** A person's first name and initials, for a chip and an avatar. */
export const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
