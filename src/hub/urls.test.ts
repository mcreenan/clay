import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vite-plus/test";
import { hubUrls } from "./urls";

const interfaces: Record<string, NetworkInterfaceInfo[] | undefined> = {
  lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true, netmask: "255.0.0.0", mac: "", cidr: "127.0.0.1/8" }],
  en0: [
    {
      address: "192.168.1.42",
      family: "IPv4",
      internal: false,
      netmask: "255.255.255.0",
      mac: "",
      cidr: "192.168.1.42/24",
    },
    { address: "fe80::1", family: "IPv6", internal: false, scopeid: 4, netmask: "", mac: "", cidr: "fe80::1/64" },
    {
      address: "2001:db8::1",
      family: "IPv6",
      internal: false,
      scopeid: 0,
      netmask: "",
      mac: "",
      cidr: "2001:db8::1/64",
    },
  ],
  en1: [
    {
      address: "192.168.1.42",
      family: "IPv4",
      internal: false,
      netmask: "255.255.255.0",
      mac: "",
      cidr: "192.168.1.42/24",
    },
    { address: "10.0.0.7", family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "", cidr: "10.0.0.7/24" },
  ],
  inactive: undefined,
};

describe("hub startup URLs", () => {
  it("lists localhost and each distinct IPv4 network address for the default listener", () => {
    expect(hubUrls("0.0.0.0", 5318, interfaces)).toEqual([
      "http://localhost:5318",
      "http://192.168.1.42:5318",
      "http://10.0.0.7:5318",
    ]);
  });

  it("uses the actual port and works without a network connection", () => {
    expect(hubUrls("0.0.0.0", 61234, { lo0: interfaces.lo0 })).toEqual(["http://localhost:61234"]);
  });

  it.each(["127.0.0.1", "192.168.1.42", "hub.local"])("advertises only the configured host %s", (host) => {
    expect(hubUrls(host, 5318, interfaces)).toEqual([`http://${host}:5318`]);
  });

  it("puts an explicit IPv6 address in brackets", () => {
    expect(hubUrls("::1", 5318, interfaces)).toEqual(["http://[::1]:5318"]);
  });

  it("includes unscoped IPv6 addresses only for the dual-stack listener", () => {
    expect(hubUrls("::", 5318, interfaces)).toEqual([
      "http://localhost:5318",
      "http://192.168.1.42:5318",
      "http://[2001:db8::1]:5318",
      "http://10.0.0.7:5318",
    ]);
  });
});
