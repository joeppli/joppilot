/**
 * Console chrome copy — the entry gate, the session badges and the status
 * labels — kept OUT of the components.
 *
 * LNG-01/02 [M] require German (de-CH) alongside English, and the i18n
 * infrastructure (react-i18next, key-based, ICU) is its own scheduled piece of
 * work. Until it lands, keeping every user-visible string in one keyed object
 * means the switch is a mechanical swap of this module — not a rewrite of the
 * components that read it. Do NOT inline user-visible text in the entry gate.
 */
export const entryStrings = {
  productName: 'Joppilot',
  tagline: 'Remote supervision & fleet management',

  operatorHeading: 'Operator access',
  operatorHint:
    'Sign in with your Joppilot operator account. Multi-factor authentication is required.',
  operatorAction: 'Authenticate access',
  operatorUnavailable:
    'Operator sign-in is unavailable on this deployment — the cloud environment is not configured.',

  demoHeading: 'No account?',
  demoAction: 'Access via demo mode',
  demoHint:
    'Explore the console with a simulated vehicle. No account, no sign-up, and no connection to any real vehicle.',

  demoBadge: 'DEMO — simulated vehicle',

  // Sidebar connection status. Demo mode gets its OWN label: the footer of a
  // demo session used to read "Live telemetry" next to a green dot, which is
  // the one claim this console must never make about invented numbers. (The
  // dot is decoration — the label carries the meaning, per ACC-03.)
  telemetryLive: 'Live telemetry',
  telemetrySimulated: 'Simulated telemetry',
  telemetryConnecting: 'Connecting…',
  telemetryOffline: 'Offline',

  // Operator session on a deployment built without an API Gateway URL: the
  // console can show live telemetry but has nowhere to send a command.
  commandsDisabledTitle: 'Commands are disabled on this deployment',
  commandsDisabledBody:
    'No command endpoint is configured for this build, so control actions cannot be sent. Telemetry is unaffected — this session is view-only.',

  // Leaving a session — the label names what actually happens, which differs
  // per mode: an operator is signed out of their account, a demo visitor just
  // closes a simulator that was never an account.
  exitOperator: 'Sign out',
  exitDemo: 'Exit demo',
  exitLocal: 'Exit',
  exitAria: 'Leave this session and return to the sign-in screen',
} as const;
