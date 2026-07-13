/**
 * Live telemetry over IoT Core WSS (M3-4b) — the `OPC → IoT` edge of the
 * architecture container diagram, as a React hook.
 *
 * Lifecycle: sign-in (Hosted UI, PKCE) → Identity Pool credentials → presigned
 * WSS connect → subscribe to the vehicle's down-path topics. The presigned URL
 * lives 60 s, so RECONNECTS ARE MANUAL: on close we re-presign (refreshing the
 * AWS credentials once they near expiry) and dial again after a short backoff.
 *
 * Read-only by policy: this path can never publish (see aws/iot.ts) — it feeds
 * the SAME state setters the local Socket.IO path feeds, nothing else.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MqttClient } from 'mqtt';
import type { AwsConfig } from './config';
import { completeLoginIfRedirected, getTokens, login, logout } from './auth';
import { AwsIdentity, connectIot, getIdentity } from './iot';

export type CloudState = 'off' | 'signed-out' | 'connecting' | 'live' | 'error';

export interface CloudHandlers {
  onTelemetry: (payload: unknown) => void;
  onHeartbeat: (payload: unknown) => void;
  onProposal: (payload: unknown) => void;
  onStatus: (payload: unknown) => void;
}

const RECONNECT_MS = 3000;

export function useCloudTelemetry(
  cfg: AwsConfig | null,
  vehicleId: string,
  handlers: CloudHandlers,
): { state: CloudState; signIn: () => void; signOut: () => void } {
  const [state, setState] = useState<CloudState>(cfg ? 'signed-out' : 'off');
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const clientRef = useRef<MqttClient | null>(null);
  const identityRef = useRef<AwsIdentity | null>(null);
  const idTokenRef = useRef<string | null>(null);
  // Generation token — THE StrictMode/teardown guard. React dev double-mounts
  // effects; a stale async dial that resumes after cleanup must not spawn a
  // second MQTT client: two clients share ONE identity id, and AWS IoT kicks
  // the older connection whenever the newer lands — a same-tab self-kicking
  // loop that presents as the badge flapping LIVE ↔ connecting. Every dial
  // captures the generation at start and aborts after each await if it moved.
  const genRef = useRef(0);
  // Consecutive failed dials: a broker that keeps closing the socket (e.g.
  // the DEV-23 IoT policy not attached yet) must surface as an ERROR, not an
  // eternal "connecting" — retrying continues either way.
  const failsRef = useRef(0);

  const dial = useCallback(async () => {
    if (!cfg) return;
    const idToken = idTokenRef.current;
    if (!idToken) return;
    const gen = genRef.current;
    setState('connecting');
    try {
      // Refresh AWS credentials when absent or within 5 min of expiry.
      if (!identityRef.current || Date.now() > identityRef.current.expiresAt - 300_000) {
        identityRef.current = await getIdentity(cfg, idToken);
      }
      if (gen !== genRef.current) return; // superseded while awaiting creds
      const client = await connectIot(cfg, identityRef.current);
      if (gen !== genRef.current) { client.end(true); return; } // superseded
      // Never two live clients from this tab (same clientId = mutual kick).
      clientRef.current?.end(true);
      clientRef.current = client;

      client.on('connect', () => {
        const base = `joppilot/v1/vehicles/${vehicleId}`;
        client.subscribe(
          [`${base}/telemetry`, `${base}/heartbeat`, `${base}/maneuver/proposal`, `${base}/maneuver/status`],
          { qos: 0 },
          (err) => {
            if (gen !== genRef.current) return;
            if (!err) failsRef.current = 0;
            setState(err ? 'error' : 'live');
          },
        );
      });
      client.on('message', (topic, message) => {
        try {
          const msg = JSON.parse(message.toString());
          if (topic.endsWith('/telemetry')) handlersRef.current.onTelemetry(msg);
          else if (topic.endsWith('/heartbeat')) handlersRef.current.onHeartbeat(msg);
          else if (topic.endsWith('/maneuver/proposal')) handlersRef.current.onProposal(msg);
          else if (topic.endsWith('/maneuver/status')) handlersRef.current.onStatus(msg);
        } catch {
          /* non-JSON — drop */
        }
      });
      client.on('close', () => {
        if (clientRef.current === client) clientRef.current = null;
        if (gen !== genRef.current) return; // torn down / superseded: no redial
        failsRef.current += 1;
        // 5 straight failures = something is wrong (missing IoT policy,
        // clock skew, …) — show error while continuing to retry.
        setState(failsRef.current >= 5 ? 'error' : 'connecting');
        // Fresh signature every attempt — a replayed URL is dead after 60 s.
        setTimeout(() => { if (gen === genRef.current) void dial(); }, RECONNECT_MS);
      });
      client.on('error', () => client.end(true));
    } catch (e) {
      if (gen !== genRef.current) return;
      console.error('IoT WSS connect failed', e);
      setState('error');
      setTimeout(() => { if (gen === genRef.current) void dial(); }, RECONNECT_MS * 2);
    }
  }, [cfg, vehicleId]);

  // Boot: finish a pending Hosted-UI redirect, then connect if signed in.
  useEffect(() => {
    if (!cfg) return;
    const gen = ++genRef.current; // invalidate any dial from a previous mount
    void (async () => {
      const tokens = (await completeLoginIfRedirected(cfg)) ?? getTokens();
      if (gen !== genRef.current) return;
      if (tokens) {
        idTokenRef.current = tokens.idToken;
        void dial();
      } else {
        setState('signed-out');
      }
    })();
    return () => {
      genRef.current++; // kills in-flight dials and pending redials
      clientRef.current?.end(true);
      clientRef.current = null;
    };
  }, [cfg, dial]);

  const signIn = useCallback(() => {
    if (cfg) void login(cfg);
  }, [cfg]);

  const signOut = useCallback(() => {
    if (!cfg) return;
    genRef.current++; // stop redials before the logout redirect
    clientRef.current?.end(true);
    logout(cfg);
  }, [cfg]);

  return { state, signIn, signOut };
}
