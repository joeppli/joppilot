/**
 * Entry-gate and session-exit copy, kept OUT of the components.
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

  localHeading: 'Developer',
  localAction: 'Local development mode',
  localHint: 'Connects to the services running on this machine.',

  simulatedNotice: 'Demo mode shows simulated data only.',
  demoBadge: 'DEMO — simulated vehicle',

  // Leaving a session — the label names what actually happens, which differs
  // per mode: an operator is signed out of their account, a demo visitor just
  // closes a simulator that was never an account.
  exitOperator: 'Sign out',
  exitDemo: 'Exit demo',
  exitLocal: 'Exit',
  exitAria: 'Leave this session and return to the sign-in screen',
} as const;
