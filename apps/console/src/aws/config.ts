/**
 * Cloud (AWS) mode configuration — M3-4b live WSS telemetry.
 *
 * All values come from `apps/console/.env.local` (git-ignored), filled from
 * the terraform outputs (see .env.example). Cloud mode is ON only when every
 * value is present; otherwise the console stays a pure localhost client and
 * nothing AWS-related loads or runs.
 */
export interface AwsConfig {
  region: string;
  /** Hosted-UI domain host, e.g. joppilot-dev-<acct>.auth.eu-central-1.amazoncognito.com */
  cognitoDomain: string;
  userPoolId: string;
  clientId: string;
  identityPoolId: string;
  /** IoT ATS data endpoint host, e.g. xxxx-ats.iot.eu-central-1.amazonaws.com */
  iotEndpoint: string;
  /**
   * API Gateway invoke URL (M3-4c). OPTIONAL and separate from the required
   * set above: with only the 6 core values the console is a live-telemetry
   * VIEWER (M3-4b, read-only WSS). Setting this ALSO routes commands
   * (take-control / drive / E-STOP / maneuver) to the cloud command service
   * through the API Gateway with the Cognito Bearer token — so the browser
   * console can DRIVE, not just watch. Absent → commands stay on the local
   * command service (localhost:4000), preserving the M3-4b behaviour exactly.
   */
  apiEndpoint?: string;
}

const env = import.meta.env;

const raw = {
  region: env.VITE_AWS_REGION as string | undefined,
  cognitoDomain: env.VITE_COGNITO_DOMAIN as string | undefined,
  userPoolId: env.VITE_COGNITO_USER_POOL_ID as string | undefined,
  clientId: env.VITE_COGNITO_CLIENT_ID as string | undefined,
  identityPoolId: env.VITE_IDENTITY_POOL_ID as string | undefined,
  iotEndpoint: env.VITE_AWS_IOT_ENDPOINT as string | undefined,
};

// Cloud (viewer) mode needs the 6 core values; apiEndpoint is an optional
// upgrade to command-capable and is NOT part of this gate.
export const awsConfig: AwsConfig | null = Object.values(raw).every(
  (v) => typeof v === 'string' && v.length > 0,
)
  ? {
      ...(raw as AwsConfig),
      apiEndpoint: ((env.VITE_AWS_API_ENDPOINT as string | undefined) || '').replace(/\/$/, '') || undefined,
    }
  : null;

export const cloudModeAvailable = awsConfig !== null;
/** True when the cloud console can also SEND commands (apiEndpoint set). */
export const cloudCommandsAvailable = !!awsConfig?.apiEndpoint;
