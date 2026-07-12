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
  const stoppedRef = useRef(false);

  const dial = useCallback(async () => {
    if (!cfg || stoppedRef.current) return;
    const idToken = idTokenRef.current;
    if (!idToken) return;
    setState('connecting');
    try {
      // Refresh AWS credentials when absent or within 5 min of expiry.
      if (!identityRef.current || Date.now() > identityRef.current.expiresAt - 300_000) {
        identityRef.current = await getIdentity(cfg, idToken);
      }
      const client = await connectIot(cfg, identityRef.current);
      clientRef.current = client;

      client.on('connect', () => {
        const base = `joppilot/v1/vehicles/${vehicleId}`;
        client.subscribe(
          [`${base}/telemetry`, `${base}/heartbeat`, `${base}/maneuver/proposal`, `${base}/maneuver/status`],
          { qos: 0 },
          (err) => setState(err ? 'error' : 'live'),
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
        clientRef.current = null;
        if (!stoppedRef.current) {
          setState('connecting');
          // Fresh signature every attempt — a replayed URL is dead after 60 s.
          setTimeout(() => void dial(), RECONNECT_MS);
        }
      });
      client.on('error', () => client.end(true));
    } catch (e) {
      console.error('IoT WSS connect failed', e);
      setState('error');
      setTimeout(() => void dial(), RECONNECT_MS * 2);
    }
  }, [cfg, vehicleId]);

  // Boot: finish a pending Hosted-UI redirect, then connect if signed in.
  useEffect(() => {
    if (!cfg) return;
    stoppedRef.current = false;
    void (async () => {
      const tokens = (await completeLoginIfRedirected(cfg)) ?? getTokens();
      if (tokens) {
        idTokenRef.current = tokens.idToken;
        void dial();
      } else {
        setState('signed-out');
      }
    })();
    return () => {
      stoppedRef.current = true;
      clientRef.current?.end(true);
      clientRef.current = null;
    };
  }, [cfg, dial]);

  const signIn = useCallback(() => {
    if (cfg) void login(cfg);
  }, [cfg]);

  const signOut = useCallback(() => {
    if (!cfg) return;
    stoppedRef.current = true;
    clientRef.current?.end(true);
    logout(cfg);
  }, [cfg]);

  return { state, signIn, signOut };
}
