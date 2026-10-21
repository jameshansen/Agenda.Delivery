// Server-only. User-supplied webhook and SMTP hosts are reached from inside
// the Docker network, where Postgres, Redis, the agents and the browser all
// listen, so they must resolve to the public internet. Mirrors public_host
// in agents/base/agenda_shared/mailer.py.
import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";

const internal = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["224.0.0.0", 3],
] as const) internal.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["::ffff:0:0", 96]] as const) {
  internal.addSubnet(net, bits, "ipv6");
}

/** True when every address `host` resolves to is on the public internet. */
export async function isPublicHost(host: string): Promise<boolean> {
  if (!host) return false;
  try {
    const addrs = await lookup(host, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => !internal.check(a.address, a.family === 6 ? "ipv6" : "ipv4"));
  } catch {
    return false;
  }
}
