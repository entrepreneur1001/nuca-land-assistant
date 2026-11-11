/**
 * Fetch for lands.nuca.gov.eg that also accepts specific certificates the site serves after they expired.
 *
 * The site's certificate (*.nuca.gov.eg, DigiCert/Thawte) expired on 2026-11-10 23:59:59 GMT and NUCA kept serving it,
 * which failed every sync. A connection is accepted when Node's normal verification passes, or when the server's leaf
 * certificate is exactly one of the pinned ones (SHA-256 fingerprint). The pinned certificate was checked by hand to
 * chain to a trusted root as of 2026-11-10 (`openssl verify -attime`), with its expiry the only fault. Once NUCA
 * renews, the normal check passes and the pin no longer matters; drop it then. We only read public pages.
 *
 * OFFICIAL_PINNED_CERTS overrides the list (comma-separated fingerprints, as Node prints them); "none" disables it.
 */
import type tls from "node:tls";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import "./tls";

const DEFAULT_PINS = [
  // *.nuca.gov.eg, valid 2026-04-26 → 2026-11-10 23:59:59 GMT
  "21:39:E8:CC:9A:E3:FC:AF:F8:E7:09:07:3B:5F:A5:BE:36:E8:3C:22:BB:7F:1E:EE:8A:64:E6:5B:D3:0A:AC:60",
];

const env = process.env.OFFICIAL_PINNED_CERTS;
export const PINNED_CERTS = new Set(env === "none" ? [] : (env ? env.split(",") : DEFAULT_PINS).map((s) => s.trim().toUpperCase()).filter(Boolean));

/** Accept the TLS socket? Normal verification, or a pinned leaf certificate. */
export function acceptSocket(s: Pick<tls.TLSSocket, "authorized" | "authorizationError" | "getPeerCertificate">): boolean {
  if (s.authorized) return true;
  const fp = s.getPeerCertificate()?.fingerprint256?.toUpperCase();
  return !!fp && PINNED_CERTS.has(fp);
}

// Verification is still done by Node; we only decide afterwards instead of letting it reject the handshake.
const connect = buildConnector({ rejectUnauthorized: false });
const agent = new Agent({
  connect(opts, cb) {
    connect(opts, (err, socket) => {
      if (err || !socket) return cb(err ?? new Error("TLS connect failed"), null);
      const s = socket as tls.TLSSocket;
      if (acceptSocket(s)) return cb(null, s);
      const reason = String(s.authorizationError ?? "certificate not trusted");
      s.destroy();
      const e = new Error(`TLS: ${reason} (and not a pinned certificate)`) as Error & { code?: string };
      e.code = reason;
      cb(e, null);
    });
  },
});

/** Drop-in for `fetch` towards the official site. */
export const officialFetch: typeof fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
  undiciFetch(input as never, { ...(init as object), dispatcher: agent } as never)) as unknown as typeof fetch;
