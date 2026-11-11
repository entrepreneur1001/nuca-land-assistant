import { describe, expect, it } from "vitest";
import { PINNED_CERTS, acceptSocket } from "@/ingest/official-tls";

const sock = (authorized: boolean, fingerprint256: string | undefined, authorizationError = "CERT_HAS_EXPIRED") =>
  ({ authorized, authorizationError, getPeerCertificate: () => ({ fingerprint256 }) }) as unknown as Parameters<typeof acceptSocket>[0];

describe("official site TLS pin", () => {
  const pinned = [...PINNED_CERTS][0];
  it("accepts a normally verified certificate", () => {
    expect(acceptSocket(sock(true, "AA:BB"))).toBe(true);
  });
  it("accepts the pinned expired certificate, in any letter case", () => {
    expect(pinned).toMatch(/^21:39:E8/);
    expect(acceptSocket(sock(false, pinned))).toBe(true);
    expect(acceptSocket(sock(false, pinned.toLowerCase()))).toBe(true);
  });
  it("rejects any other unverified certificate (expired, self-signed, wrong host)", () => {
    expect(acceptSocket(sock(false, "00:11:22"))).toBe(false);
    expect(acceptSocket(sock(false, "00:11:22", "DEPTH_ZERO_SELF_SIGNED_CERT"))).toBe(false);
    expect(acceptSocket(sock(false, undefined))).toBe(false);
  });
});
