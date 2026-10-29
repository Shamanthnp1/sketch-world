// The Client_Key (Requirements 11.1, 11.6): the key of the rate limits and of the Client_Cap.
import { expect, it } from "vitest";
import { clientKey, ipv6Key, NO_IP } from "../../worker/limits/client";

const from = (ip?: string) => clientKey(new Request("https://example.com/", { headers: ip === undefined ? {} : { "CF-Connecting-IP": ip } }));

it("keys an IPv4 client by its address, and a request without CF-Connecting-IP as no-ip", () => {
  expect(from("203.0.113.7")).toBe("203.0.113.7");
  expect(from(" 198.51.100.1 ")).toBe("198.51.100.1");
  expect(from()).toBe(NO_IP);
  expect(from("")).toBe(NO_IP);
  expect(NO_IP).toBe("no-ip");
});

it.each<[string, string, string]>([
  ["a full address", "2001:0db8:0001:0002:0003:0004:0005:0006", "2001:db8:1:2::/64"],
  ["a compressed address", "2001:db8:1:2::7", "2001:db8:1:2::/64"],
  ["`::` inside the prefix", "2001:db8::1", "2001:db8:0:0::/64"],
  ["`::` at the end", "2001:db8:1::", "2001:db8:1:0::/64"],
  ["`::` for one hextet", "2001:db8:1:2:3:4:5::", "2001:db8:1:2::/64"],
  ["the unspecified address `::`", "::", "0:0:0:0::/64"],
  ["the loopback `::1`", "::1", "0:0:0:0::/64"],
  ["mixed case", "2001:DB8:aBcD:EF01::1", "2001:db8:abcd:ef01::/64"],
  ["a zone id", "fe80::1%eth0", "fe80:0:0:0::/64"],
  ["an embedded IPv4 (NAT64)", "64:ff9b::192.0.2.33", "64:ff9b:0:0::/64"],
  ["an embedded IPv4 in a full address", "2001:db8:1:2:3:4:192.0.2.1", "2001:db8:1:2::/64"],
  ["an IPv4-mapped address, which is the IPv4 client", "::ffff:192.0.2.1", "192.0.2.1"],
])("keys %s by its /64: %s → %s", (_, ip, key) => {
  expect(from(ip)).toBe(key);
});

it("gives every address in one /64 the same key, and other /64s their own", () => {
  const keys = ["2001:db8:1:2::1", "2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2:abcd::9"].map(from);
  expect(new Set(keys)).toEqual(new Set(["2001:db8:1:2::/64"]));
  expect(from("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
  expect(from("2001:db8:2:2::1")).toBe("2001:db8:2:2::/64");
});

it.each(["1:2:3:4:5:6:7:8:9", "1::2::3", "1:2:3:4:5:6:7:8::", "12345::", "g::1", ":::", "::1.2.3.256", "1.2.3.4::"])(
  "reads %s as not an IPv6 address; clientKey then keys it as itself",
  (ip) => {
    expect(ipv6Key(ip)).toBeNull();
    expect(from(ip)).toBe(ip.toLowerCase());
  },
);
