/**
 * Reading HTTP requests
 * Auto-generated - DO NOT EDIT
 */

/**
 * The cookies of a request, by name: from a Cookie header (`name=value; name=value`),
 * or a list of `name=value` entries. Of two cookies with one name, the first is kept:
 * it is the more specific.
 */
export function parseCookies(cookie: string | string[] | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of [cookie ?? []].flat().join('; ').split(';')) {
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator).trim();
    if (separator < 0 || !name || cookies.has(name)) continue;

    let value = pair.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}
