/**
 * IoT Core live-telemetry client (M3-4b): Cognito Identity Pool credentials →
 * SigV4-presigned wss://…/mqtt URL → mqtt.js over WebSocket.
 *
 * READ-ONLY by IAM/IoT policy: the viewer role can only Subscribe/Receive on
 * the vehicle down-path topics (telemetry · heartbeat · maneuver/proposal ·
 * maneuver/status) — publishing is denied at the broker, so commands can only
 * ever flow through API Gateway → Gate 1. The MQTT client id is the caller's
 * own Cognito identity id (the IAM policy pins iot:Connect to it), so two
 * operators can never kick each other's connection.
 *
 * DEV-23: the identity must ALSO have the console-viewer IoT policy attached
 * (one-time per operator, see README) — without it IoT closes the socket
 * right after connect even though the URL signature is valid.
 */
import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
} from '@aws-sdk/client-cognito-identity';
import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import mqtt, { MqttClient } from 'mqtt';
import type { AwsConfig } from './config';

export interface AwsIdentity {
  identityId: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: number; // epoch ms
}

/** Exchange the Cognito ID token for short-lived AWS credentials. */
export async function getIdentity(cfg: AwsConfig, idToken: string): Promise<AwsIdentity> {
  const client = new CognitoIdentityClient({ region: cfg.region });
  const logins = { [`cognito-idp.${cfg.region}.amazonaws.com/${cfg.userPoolId}`]: idToken };
  const { IdentityId } = await client.send(
    new GetIdCommand({ IdentityPoolId: cfg.identityPoolId, Logins: logins }),
  );
  if (!IdentityId) throw new Error('Cognito GetId returned no identity');
  const { Credentials } = await client.send(
    new GetCredentialsForIdentityCommand({ IdentityId, Logins: logins }),
  );
  if (!Credentials?.AccessKeyId || !Credentials.SecretKey || !Credentials.SessionToken) {
    throw new Error('Cognito returned incomplete credentials');
  }
  return {
    identityId: IdentityId,
    accessKeyId: Credentials.AccessKeyId,
    secretAccessKey: Credentials.SecretKey,
    sessionToken: Credentials.SessionToken,
    expiresAt: Credentials.Expiration ? Credentials.Expiration.getTime() : Date.now() + 3600_000,
  };
}

/** SigV4-presign the IoT WebSocket URL (service: iotdevicegateway).
 *
 *  IoT-specific quirk (per the IoT developer guide and the v2 device SDK):
 *  with TEMPORARY credentials the session token must NOT be part of the
 *  canonical request — sign with access key + secret only, then APPEND
 *  X-Amz-Security-Token to the query AFTER the signature is computed.
 *  Including it in the signed query (the S3-style default of
 *  @smithy/signature-v4) makes the device gateway reject the handshake. */
export async function presignWssUrl(cfg: AwsConfig, id: AwsIdentity): Promise<string> {
  const signer = new SignatureV4({
    credentials: {
      accessKeyId: id.accessKeyId,
      secretAccessKey: id.secretAccessKey,
      // sessionToken deliberately OMITTED — appended unsigned below.
    },
    region: cfg.region,
    service: 'iotdevicegateway',
    sha256: Sha256,
    applyChecksum: false,
  });
  const request = new HttpRequest({
    method: 'GET',
    protocol: 'wss:',
    hostname: cfg.iotEndpoint,
    path: '/mqtt',
    headers: { host: cfg.iotEndpoint },
  });
  const signed = await signer.presign(request, { expiresIn: 60 });
  const qs = Object.entries(signed.query ?? {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `wss://${cfg.iotEndpoint}${signed.path}?${qs}`
    + `&X-Amz-Security-Token=${encodeURIComponent(id.sessionToken)}`;
}

/**
 * Connect to IoT Core over WSS. Reconnects are managed by the CALLER
 * (`reconnectPeriod: 0`): a presigned URL expires in 60 s, so mqtt.js's
 * built-in reconnect would replay a dead signature forever — on 'close' the
 * caller re-presigns (and refreshes credentials when needed) and dials again.
 */
export async function connectIot(cfg: AwsConfig, id: AwsIdentity): Promise<MqttClient> {
  const url = await presignWssUrl(cfg, id);
  return mqtt.connect(url, {
    clientId: id.identityId, // IAM pins iot:Connect to exactly this
    protocolVersion: 4,
    keepalive: 30,
    reconnectPeriod: 0,
    connectTimeout: 10_000,
    clean: true,
  });
}
