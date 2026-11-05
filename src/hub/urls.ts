import { networkInterfaces } from "node:os";

export function hubUrls(host: string, port: number, interfaces = networkInterfaces()): string[] {
  const addresses = new Set<string>();
  if (host === "0.0.0.0" || host === "::") {
    addresses.add("localhost");
    for (const network of Object.values(interfaces)) {
      for (const address of network ?? []) {
        if (address.internal) continue;
        if (address.family === "IPv4" || (host === "::" && address.family === "IPv6" && address.scopeid === 0)) {
          addresses.add(address.address);
        }
      }
    }
  } else {
    addresses.add(host);
  }
  return [...addresses].map((address) => `http://${address.includes(":") ? `[${address}]` : address}:${port}`);
}
