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

  // ── Demo scope (B1) ──
  // A demo visitor must never click into a screen that cannot work without a
  // backend. The pages are removed from the demo's navigation rather than left
  // as nine identical "coming soon" cards; this line keeps the SCOPE visible
  // without turning it into nine dead ends.
  demoScopeNote:
    'Fleet-management modules (inspections, service, parts, reports) are part of the product, not of this demo.',
  notInDemo: 'Not in demo',
  demoMissionUnavailable:
    'Mission planning and the pre-departure checklist run on the fleet backend, which a demo session never contacts. Everything else on this page comes from the simulated vehicle.',

  // ── Maneuver proposals (ICD §6) ──
  // {option} is always the option's DESCRIPTION, never its id: the operator —
  // and whoever reads the audit trail later — needs "Wait and retry after 60s",
  // not "opt-3f2a91c4-b".
  proposalTimedOut: 'Decision window closed — safe default applied: {option}',
  proposalDecided: 'Decision recorded: {option}',
  proposalRejected: 'Proposal rejected — the vehicle holds position',
  proposalCancelled: 'Proposal withdrawn by the vehicle',
  maneuverHeading: 'Maneuver proposal',
  maneuverProposed: 'Proposed maneuver — approve',
  maneuverSafeDefault: 'Safe default on timeout',
  maneuverReject: 'Reject proposal',
  maneuverApproveAction: 'Approve proposed maneuver',
  maneuverAlternativeAction: 'Select alternative',
  maneuverOptionAria: '{action}: {description}. Expected: {expected}',
  proposalResult: 'Last proposal: {result}',
  proposalNeedsControl:
    'Take control to decide. If the window closes first, the vehicle applies the safe default on its own (ICD §6).',

  // Leaving a session — the label names what actually happens, which differs
  // per mode: an operator is signed out of their account, a demo visitor just
  // closes a simulator that was never an account.
  exitOperator: 'Sign out',
  exitDemo: 'Exit demo',
  exitLocal: 'Exit',
  exitAria: 'Leave this session and return to the sign-in screen',
} as const;

/**
 * Minimal `{placeholder}` interpolation.
 *
 * Deliberately the same shape react-i18next/ICU will take over (LNG-01/02): a
 * keyed template plus a variables object, never a string concatenated at the
 * call site — a translator needs the whole sentence, with the placeholder
 * wherever their grammar puts it.
 */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
