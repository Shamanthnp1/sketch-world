// The Client_Key: who a request counts against, for the rate limits (rate.ts) and the Client_Cap (cost.ts),
// Requirements 11.1 and 11.6. Cloudflare sets CF-Connecting-IP, so a client cannot choose it. An IPv6 client
// usually holds a whole /64 and can use a new address in it for each request, so IPv6 counts by its /64.

/** Stands in for the IP when CF-Connecting-IP is missing, which only happens off Cloudflare (local dev). */
export const NO_IP = "no-ip";

/** The IPv4 address as sent, an IPv6 address's /64 such as `2001:db8:1:2::/64`, or `no-ip`. */
export function clientKey(req: Request): string {
  const ip = req.headers.get("CF-Connecting-IP")?.trim();
  if (!ip) return NO_IP;
  // Text that is not an IPv6 address (only possible off Cloudflare) keys as itself.
  return ip.includes(":") ? (ipv6Key(ip) ?? ip.toLowerCase()) : ip;
}

/**
 * The first 4 hextets of an IPv6 address after expanding `::`, in lowercase hex without leading zeros, then `::/64`.
 * A zone id (`%eth0`) is dropped. An IPv4-mapped address (`::ffff:a.b.c.d`) is an IPv4 client, so it keys as
 * `a.b.c.d`. null if the text is not an IPv6 address.
 */
export function ipv6Key(ip: string): string | null {
  const halves = ip.replace(/%.*$/, "").toLowerCase().split("::");
  if (halves.length > 2) return null;
  const head = hextets(halves[0]!, halves.length === 1), tail = halves.length === 2 ? hextets(halves[1]!, true) : [];
  if (!head || !tail) return null;
  const gap = 8 - head.length - tail.length;    // the zero hextets `::` stands for: at least 1
  if (halves.length === 2 ? gap < 1 : gap !== 0) return null;
  const h = [...head, ...new Array<number>(gap).fill(0), ...tail];
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return [h[6]! >> 8, h[6]! & 255, h[7]! >> 8, h[7]! & 255].join(".");
  return `${h.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64`;
}

// One side of `::` as numbers. If `last`, its last group may be an embedded IPv4 address, which is 2 hextets.
function hextets(part: string, last: boolean): number[] | null {
  if (part === "") return [];
  const groups = part.split(":"), out: number[] = [];
  for (const [i, g] of groups.entries()) {
    const v4 = last && i === groups.length - 1 ? /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(g) : null;
    if (v4) {
      const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
      if (Math.max(a, b, c, d) > 255) return null;
      out.push((a << 8) | b, (c << 8) | d);
    } else if (/^[0-9a-f]{1,4}$/.test(g)) out.push(parseInt(g, 16));
    else return null;
  }
  return out;
}
