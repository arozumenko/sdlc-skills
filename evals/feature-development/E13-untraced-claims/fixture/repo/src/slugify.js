// URL slugs for article titles (T-9).
export const MAX_LENGTH = 64;

export function slugify(title) {
  return String(title)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
