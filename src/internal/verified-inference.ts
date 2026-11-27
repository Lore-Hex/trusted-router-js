import type { AttestationPolicy } from "../attestation.js";
import { isRecord } from "./records.js";

export function needsVerifiedInference(base: string, body: unknown): boolean {
  if (new URL(base).hostname.toLowerCase().split(".").some(label => label === "trusted" || label === "confidential")) return true;
  if (typeof body === "string") {
    try { body = JSON.parse(body) as unknown; } catch { return false; }
  }
  if (!isRecord(body)) return false;
  const floor = isRecord(body.provider) ? body.provider.min_privacy : null;
  if (typeof floor === "string" && ["trusted","confidential","e2e","e2ee","max","maximum"].includes(floor.trim().toLowerCase())) return true;
  const fallbacks: unknown[] = Array.isArray(body.models) ? body.models : [];
  return [body.model, ...fallbacks].some(
    id => typeof id === "string" && /^(trustedrouter|nyte)\/(trusted|confidential|e2e)(:|$)/i.test(id.trim()),
  );
}

export async function verifiedInference(url: string, init: RequestInit, policy: AttestationPolicy, verify?: typeof import("../session.js").verifyGatewaySession): Promise<Response> {
  const target = new URL(url);
  const pins = policy.imageDigests?.length ? policy.imageDigests : [policy.imageDigest];
  if (target.protocol !== "https:" || target.username || target.password || policy.allowDebug ||
      !pins.every(pin => typeof pin === "string" && /^sha256:[a-f0-9]{64}$/.test(pin))) {
    throw new Error("Verified inference requires HTTPS and non-debug sha256 image pins.");
  }
  if (init.body != null && typeof init.body !== "string") throw new Error("Unsupported verified request body.");
  // Resolve Node-only modules at runtime, just as an application importing
  // the public /session subpath would. Ordinary browser clients need none.
  const [sessionModule, httpsModule, streamModule] = ["@lore-hex/trusted-router/session", "node:https", "node:stream"] as const;
  const [{ verifyGatewaySession }, https, { Readable }] = await Promise.all([
    import(sessionModule) as Promise<typeof import("../session.js")>,
    import(httpsModule) as Promise<typeof import("node:https")>,
    import(streamModule) as Promise<typeof import("node:stream")>,
  ]);
  init.signal?.throwIfAborted();
  const {socket} = await (verify ?? verifyGatewaySession)({baseUrl: target.origin, policy});
  try {
    init.signal?.throwIfAborted();
    if (socket.readableLength !== 0) throw new Error("Unexpected bytes after attestation.");
    // A private, one-shot agent can supply only this verified socket; no
    // global pool, proxy, redirect or replacement connection is allowed.
    const agent = new https.Agent({keepAlive: false});
    let used = false;
    agent.createConnection = () => {
      if (used || socket.destroyed) throw new Error("Verified session is no longer available.");
      used = true;
      return socket;
    };
    const headers = new Headers(init.headers);
    headers.set("host", target.host);
    return await new Promise<Response>((resolve,reject) => {
      const req = https.request(target, {agent, method:init.method ?? "GET", headers:Object.fromEntries(headers), ...(init.signal ? {signal:init.signal} : {})}, res => {
        const responseHeaders = new Headers();
        for (let i=0; i<res.rawHeaders.length; i+=2) responseHeaders.append(res.rawHeaders[i]!, res.rawHeaders[i+1]!);
        const status = res.statusCode ?? 502;
        const empty = init.method === "HEAD" || [204,205,304].includes(status);
        if (empty) res.resume();
        try {
          resolve(new Response(empty ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, {status, headers:responseHeaders}));
        } catch (error) { res.destroy(); reject(error); }
      });
      // The attestation reader paused the socket after its exact frame.
      // Resume only once Node's HTTP response parser owns that socket.
      req.once("socket", assigned => assigned.resume());
      req.on("error", reject);
      req.end(init.body ?? undefined);
    });
  } catch (error) { socket.destroy(); throw error; }
}
