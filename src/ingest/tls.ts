/**
 * lands.nuca.gov.eg sits behind a firewall that resets Node's default TLS handshake (which offers TLS 1.3) from
 * some networks, GitHub's runners included, while a handshake capped at TLS 1.2 is accepted everywhere; the server
 * speaks TLS 1.2 only anyway. Importing this module caps the process-wide default. Override with OFFICIAL_TLS_MAX.
 */
import tls from "node:tls";

const max = process.env.OFFICIAL_TLS_MAX;
if (max !== "default") tls.DEFAULT_MAX_VERSION = (max as typeof tls.DEFAULT_MAX_VERSION) || "TLSv1.2";

export const TLS_MAX_VERSION = tls.DEFAULT_MAX_VERSION;
