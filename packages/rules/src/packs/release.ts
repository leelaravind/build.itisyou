/**
 * Accessibility, deployment, production verification, operations, documentation and governance.
 *
 * Contract: gap-spec §14 asks for at least 10 accessibility, 20 deployment/release, 15 production
 * verification, 10 operations/maintenance, 10 documentation/handover and 15 change-control rules.
 *
 * These are the rules about the part of a system's life that is longer than the project. Most of them
 * exist because something that was true in staging stopped being true in production, or because
 * knowledge that lived in one person's head left with them.
 */

import { defineRule, type Rule } from '../schema.ts';

const ACTIVE = '2026-01-01';
const WEB = [
  'PUBLIC_WEB_APP',
  'SAAS_WEB_APP',
  'ECOMMERCE',
  'AI_ENABLED_WEB_APP',
  'INTERNAL_BUSINESS_APP',
];
const SERVICES = [...WEB, 'API_BACKEND_PLATFORM'];

export const RELEASE_RULES: readonly Rule[] = [
  /* ----------------------------------------------------------- Accessibility */

  defineRule({
    id: 'A11Y-CONTRAST-001',
    version: '1.0.0',
    title: 'Text contrast is measured, not judged by eye',
    description: 'Body text at 4.5:1, large text and interface boundaries at 3:1.',
    category: 'ACCESSIBILITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'contrast-ratios',
        title: 'Every text and boundary colour meets its ratio',
        description: 'Computed from the actual token values rather than assessed visually.',
        priority: 'MUST',
        verification: 'A test computing contrast for every colour pairing in the design system.',
      },
    ],
    emittedTests: [
      {
        key: 'contrast-test',
        title: 'Contrast ratio test',
        kind: 'ACCESSIBILITY',
        verifies: 'contrast-ratios',
      },
    ],
    rationale:
      'Contrast judged by eye is judged on one screen, at one brightness, by someone with that person’s vision. Computing it removes all three variables.',
    remediation:
      'Compute contrast for every pairing in the palette and fail the build on a shortfall.',
    references: ['WCAG 2.2 §1.4.3 Contrast (Minimum)', 'WCAG 2.2 §1.4.11 Non-text Contrast'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'A11Y-FOCUS-001',
    version: '1.0.0',
    title: 'Focus is always visible',
    description: 'Removing the focus outline without replacing it makes keyboard use impossible.',
    category: 'ACCESSIBILITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'visible-focus',
        title: 'Every focusable element shows where focus is',
        description: 'With sufficient contrast against both the element and its background.',
        priority: 'MUST',
        verification: 'A test that tabs through each page and asserts a visible indicator.',
      },
    ],
    emittedTests: [
      {
        key: 'focus-visible-test',
        title: 'Focus visibility test',
        kind: 'ACCESSIBILITY',
        verifies: 'visible-focus',
      },
    ],
    rationale:
      'Without a focus indicator a keyboard user cannot tell where they are, which makes the page unusable rather than merely awkward.',
    remediation: 'Keep a visible focus style on every interactive element and test it.',
    references: ['WCAG 2.2 §2.4.7 Focus Visible', 'WCAG 2.2 §2.4.11 Focus Not Obscured'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'A11Y-TARGET-001',
    version: '1.0.0',
    title: 'Touch targets are at least 24 by 24 pixels',
    description: 'Smaller targets exclude people with limited fine motor control.',
    category: 'ACCESSIBILITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: [...WEB, 'MOBILE_APP'],
    emittedRequirements: [
      {
        key: 'target-size',
        title: 'Interactive targets meet the minimum size',
        description: 'Including icon-only buttons, which are the usual offenders.',
        priority: 'MUST',
        verification: 'An automated check of interactive element dimensions.',
      },
    ],
    rationale:
      'Small targets are hardest for exactly the people who most need the interface to be forgiving, and icon buttons are almost always the smallest thing on the page.',
    remediation: 'Enforce a minimum hit area, padding out where the visual is smaller.',
    references: ['WCAG 2.2 §2.5.8 Target Size (Minimum)'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'A11Y-REFLOW-001',
    version: '1.0.0',
    title: 'Content reflows at 320 pixels without horizontal scrolling',
    description: 'Equivalent to 400% zoom on a desktop screen.',
    category: 'ACCESSIBILITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'reflow',
        title: 'No horizontal scrolling at 320 pixels wide',
        description: 'Wide content scrolls within its own container instead.',
        priority: 'MUST',
        verification: 'A test at 320 pixels asserting no page-level horizontal scroll.',
      },
    ],
    emittedTests: [
      {
        key: 'reflow-test',
        title: 'Reflow test at 320 pixels',
        kind: 'ACCESSIBILITY',
        verifies: 'reflow',
      },
    ],
    rationale:
      'Someone using large zoom to read is forced into two-dimensional scrolling, which makes continuous reading impractical.',
    remediation: 'Confine wide content to scrollable containers and test the page at 320 pixels.',
    references: ['WCAG 2.2 §1.4.10 Reflow'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'A11Y-SEMANTIC-001',
    version: '1.0.0',
    title: 'Structure is expressed semantically',
    description: 'Headings, landmarks, lists and buttons rather than styled containers.',
    category: 'ACCESSIBILITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'semantic-structure',
        title: 'Pages use real headings, landmarks and controls',
        description: 'One main landmark, non-skipping heading levels, real buttons and links.',
        priority: 'MUST',
        verification: 'Automated structure checks plus a screen-reader walkthrough.',
      },
    ],
    rationale:
      'Screen-reader navigation is built entirely on structure. A page of styled containers is a single undifferentiated block to anyone not looking at it.',
    remediation: 'Use semantic elements and check heading order and landmarks.',
    references: ['WCAG 2.2 §1.3.1 Info and Relationships'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'A11Y-STATUS-001',
    version: '1.0.0',
    title: 'Status is never conveyed by colour alone',
    description: 'An icon or a word alongside the colour.',
    category: 'ACCESSIBILITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'not-colour-alone',
        title: 'Every status carries a non-colour signal',
        description: 'A label, an icon, or both.',
        priority: 'MUST',
        verification: 'A test asserting each status renders text or an icon as well as colour.',
      },
    ],
    rationale:
      'Around one in twelve men has some colour vision deficiency, and red-green is the pairing most commonly used for pass and fail.',
    remediation: 'Pair every colour signal with an icon or a label.',
    references: ['WCAG 2.2 §1.4.1 Use of Color'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'A11Y-FORM-001',
    version: '1.0.0',
    title: 'Every form control has a programmatic label',
    description: 'Placeholder text is not a label.',
    category: 'ACCESSIBILITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'form-labels',
        title: 'Controls are labelled programmatically',
        description: 'And errors are associated with the field they concern.',
        priority: 'MUST',
        verification: 'Automated checks for label association on every control.',
      },
    ],
    rationale:
      'A placeholder disappears when typing starts, so anyone who loses their place has no way to recover what the field was for.',
    remediation: 'Give each control a real label and associate error messages with it.',
    references: ['WCAG 2.2 §3.3.2 Labels or Instructions'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'A11Y-ERROR-001',
    version: '1.0.0',
    title: 'Errors are announced, not only shown',
    description:
      'A validation message that appears visually leaves a screen-reader user with a form that did nothing.',
    category: 'ACCESSIBILITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'announced-errors',
        title: 'Validation messages are in a live region',
        description: 'And say what to do, not only what was wrong.',
        priority: 'MUST',
        verification:
          'A test asserting the error carries an alert role and is associated with its field.',
      },
    ],
    rationale:
      'Without an announcement the form appears to have silently ignored the submission, which is indistinguishable from a broken page.',
    remediation: 'Put validation messages in a live region and link them to their fields.',
    references: ['WCAG 2.2 §3.3.1 Error Identification'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'A11Y-MOTION-001',
    version: '1.0.0',
    title: 'Reduced-motion preferences are respected',
    description: 'Animation can cause nausea and migraine, not merely annoyance.',
    category: 'ACCESSIBILITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: [...WEB, 'MOBILE_APP'],
    emittedRequirements: [
      {
        key: 'reduced-motion',
        title: 'Animation is suppressed when the user asks for it',
        description: 'Including parallax, auto-play and large transitions.',
        priority: 'MUST',
        verification: 'A test with the reduced-motion preference set.',
      },
    ],
    rationale:
      'For people with vestibular disorders, motion is a physical symptom rather than a preference, and the operating system already knows their answer.',
    remediation: 'Honour the reduced-motion media query throughout.',
    references: ['WCAG 2.2 §2.3.3 Animation from Interactions'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'A11Y-MANUAL-001',
    version: '1.0.0',
    title: 'A person tests with a screen reader',
    description: 'Automated tools find a minority of real problems.',
    category: 'ACCESSIBILITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: WEB,
    emittedTasks: [
      {
        key: 'screen-reader-walkthrough',
        title: 'Walk the critical journeys with a screen reader',
        phaseKey: 'verify',
      },
    ],
    emittedGates: [
      {
        gateKey: 'TESTING',
        criterion: 'Critical journeys have been walked with a screen reader.',
        blocking: true,
      },
    ],
    rationale:
      'Automated checks verify the markup is well-formed. Whether the resulting experience is usable is a question only a person can answer.',
    remediation: 'Walk each critical journey with a screen reader and record what was found.',
    references: ['WCAG-EM: Website Accessibility Conformance Evaluation Methodology'],
    activeFrom: ACTIVE,
  }),

  /* -------------------------------------------------------------- Deployment */

  defineRule({
    id: 'DEP-PIPE-001',
    version: '1.0.0',
    title: 'Deployment is automated and repeatable',
    description: 'Manual deployment is different every time, and differs most under pressure.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'automated-deploy',
        title: 'Deployment runs from a pipeline',
        description: 'The same steps in the same order every time.',
        priority: 'MUST',
        verification: 'A deployment pipeline that has been used for the last release.',
      },
    ],
    emittedGates: [
      { gateKey: 'RELEASE_READINESS', criterion: 'Deployment is automated.', blocking: true },
    ],
    rationale:
      'Manual deployments are performed by whoever is available, from memory, usually late — which is exactly when steps get skipped.',
    remediation: 'Automate the deployment and use it for every release.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-ROLLBACK-001',
    version: '1.0.0',
    title: 'A rollback plan exists and has been tried',
    description: 'An untested rollback is a hypothesis about a rollback.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      { gateKey: 'RELEASE_READINESS', criterion: 'A rollback has been rehearsed.', blocking: true },
    ],
    rationale:
      'The moment rollback is needed is the worst possible moment to find out it does not work, and the pressure guarantees mistakes.',
    remediation: 'Rehearse the rollback in a lower environment and record the result.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-MIGRATE-001',
    version: '1.0.0',
    title: 'Data migrations have a reverse path or an accepted risk',
    description: 'Code rolls back cleanly; data does not.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'reversible-migrations',
        title: 'Each migration has a reverse or a recorded acceptance',
        description: 'A destructive migration makes the whole release one-way.',
        priority: 'MUST',
        verification: 'A reverse migration, or a signed acceptance of the risk.',
      },
    ],
    rationale:
      'A release with an irreversible migration cannot be rolled back at all, which changes the risk of the entire deployment.',
    remediation: 'Write reverse migrations, or accept the one-way risk explicitly.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-ZERO-001',
    version: '1.0.0',
    title: 'Deployments should not require downtime',
    description: 'Downtime deployments happen at night, which is when people make mistakes.',
    category: 'DEPLOYMENT',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: SERVICES,
    emittedRequirements: [
      {
        key: 'zero-downtime',
        title: 'Releases can be made during working hours',
        description: 'Rolling deployment with backwards-compatible migrations.',
        priority: 'SHOULD',
        verification: 'A deployment performed with no service interruption.',
      },
    ],
    rationale:
      'Deployments requiring downtime get batched into rare, large releases, which is the riskiest possible shape — and then performed by tired people.',
    remediation: 'Make migrations backwards compatible so releases can roll.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-STAGE-001',
    version: '1.0.0',
    title: 'Releases go through a staging environment first',
    description: 'Configured as closely to production as is affordable.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'RELEASE_READINESS',
        criterion: 'The release was verified in staging.',
        blocking: true,
      },
    ],
    rationale: 'The first time a release meets real configuration should not be in front of users.',
    remediation: 'Deploy to staging and verify there before production.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-ARTIFACT-001',
    version: '1.0.0',
    title: 'The artefact that was tested is the artefact that ships',
    description: 'Build once, promote the same build.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'promote-artifact',
        title: 'One build is promoted through environments',
        description: 'Rather than rebuilt per environment.',
        priority: 'MUST',
        verification: 'The pipeline promotes rather than rebuilds.',
      },
    ],
    rationale:
      'Rebuilding per environment means the tested artefact and the shipped artefact are different, and the difference is invisible.',
    remediation: 'Build once and promote the artefact.',
    references: ['Twelve-Factor App: Build, release, run'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-NOTES-001',
    version: '1.0.0',
    title: 'Release notes say what changed',
    description: 'Including what to watch and what to do if it goes wrong.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      { gateKey: 'RELEASE_READINESS', criterion: 'Release notes exist.', blocking: true },
    ],
    rationale:
      'When something breaks after a release, the first question is what changed. Without notes, answering it means reading commits under pressure.',
    remediation: 'Write release notes covering changes, risks and rollback.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-APPROVE-001',
    version: '1.0.0',
    title: 'Production deployment is authorised by a person',
    description: 'And the record shows who.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'RELEASE_READINESS',
        criterion: 'The release is approved and attributed.',
        blocking: true,
      },
    ],
    rationale:
      'Accountability for a release has to rest somewhere identifiable, or nobody is in a position to say no.',
    remediation: 'Require a recorded approval before production deployment.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-WINDOW-001',
    version: '1.0.0',
    title: 'Do not deploy when nobody is available to respond',
    description: 'Friday evening deployments are discovered on Monday.',
    category: 'DEPLOYMENT',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      { key: 'deployment-window', title: 'Agree a deployment window', phaseKey: 'release' },
    ],
    rationale:
      'The value of a fast rollback depends entirely on someone being there to trigger it.',
    remediation: 'Deploy when the people who can respond are available.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-SECRET-001',
    version: '1.0.0',
    title: 'Deployment credentials are scoped to what they deploy',
    description: 'A pipeline credential with broad access is a broad exposure.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedRequirements: [
      {
        key: 'scoped-deploy-credentials',
        title: 'Pipeline credentials are least-privilege',
        description: 'Separate credentials per environment.',
        priority: 'MUST',
        verification: 'A review of pipeline credential permissions.',
      },
    ],
    rationale:
      'A single credential that can deploy everywhere turns any pipeline compromise into a compromise of every environment at once.',
    remediation: 'Issue per-environment credentials with the minimum permissions.',
    references: ['OWASP Top 10 CI/CD Security Risks CICD-SEC-2'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-HEALTH-001',
    version: '1.0.0',
    title: 'Health checks test dependencies, not just the process',
    description: 'A process that is running and cannot reach its database is not healthy.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: SERVICES,
    emittedRequirements: [
      {
        key: 'meaningful-health-check',
        title: 'The health check verifies critical dependencies',
        description: 'And is used by the deployment to decide whether to proceed.',
        priority: 'MUST',
        verification: 'A test asserting the health check fails when a dependency is unavailable.',
      },
    ],
    rationale:
      'A health check that only reports the process is alive will report healthy throughout a total outage.',
    remediation: 'Check critical dependencies in the health endpoint.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-CANARY-001',
    version: '1.0.0',
    title: 'Significant changes go out gradually where possible',
    description: 'A staged rollout limits the population affected by a mistake.',
    category: 'DEPLOYMENT',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: ['SAAS_WEB_APP', 'PUBLIC_WEB_APP', 'ECOMMERCE', 'MOBILE_APP'],
    emittedTasks: [
      {
        key: 'staged-rollout',
        title: 'Plan a staged rollout for significant changes',
        phaseKey: 'release',
      },
    ],
    rationale:
      'A defect reaching everyone simultaneously is a defect with no containment. Gradual rollout converts an incident into a rollback.',
    remediation: 'Roll out to a small proportion first and watch before proceeding.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-FLAG-001',
    version: '1.0.0',
    title: 'Feature flags have an owner and a removal date',
    description: 'Flags that outlive their purpose become permanent untested branches.',
    category: 'DEPLOYMENT',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'flag-lifecycle',
        title: 'Give each feature flag an owner and removal date',
        phaseKey: 'build',
      },
    ],
    rationale:
      'Every flag doubles the paths through the code, and old flags produce combinations nobody has ever run.',
    remediation: 'Record an owner and a removal date for each flag, and remove them.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-DNS-001',
    version: '1.0.0',
    title: 'DNS and certificates are prepared before release day',
    description: 'Propagation and issuance both take time you do not control.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: WEB,
    emittedTasks: [
      { key: 'prepare-dns', title: 'Prepare DNS and certificates in advance', phaseKey: 'release' },
    ],
    rationale:
      'DNS propagation and certificate issuance are external processes with their own timings, and both are on the critical path on release day.',
    remediation: 'Configure DNS and obtain certificates well before the release.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-CERT-001',
    version: '1.0.0',
    title: 'Certificate renewal is automated and monitored',
    description: 'Expiry is the most predictable outage there is.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: WEB,
    emittedRequirements: [
      {
        key: 'cert-renewal',
        title: 'Certificates renew automatically, with an alert on failure',
        description: 'Alerting well before expiry.',
        priority: 'MUST',
        verification: 'A configured renewal process and an expiry alert.',
      },
    ],
    rationale:
      'Certificate expiry causes a total outage at a precisely known future time, and it still happens regularly because the renewal was manual.',
    remediation: 'Automate renewal and alert if it has not happened.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-ROLLFORWARD-001',
    version: '1.0.0',
    title: 'Decide in advance whether the response is rollback or roll forward',
    description: 'Deciding during the incident wastes the time the incident allows.',
    category: 'DEPLOYMENT',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'incident-response-strategy',
        title: 'Agree the rollback or roll-forward policy',
        phaseKey: 'release',
      },
    ],
    rationale:
      'The decision depends on migration reversibility and deployment speed, both of which are known in advance and neither of which is easy to assess mid-incident.',
    remediation: 'Agree the policy before the release.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-CONFIG-001',
    version: '1.0.0',
    title: 'Configuration differences between environments are documented',
    description: 'Undocumented drift is why it worked in staging.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'config-inventory',
        title: 'Every environment’s configuration is recorded',
        description: 'And the differences between them are deliberate.',
        priority: 'MUST',
        verification: 'A configuration inventory per environment.',
      },
    ],
    rationale:
      '"It worked in staging" is almost always a configuration difference nobody had written down.',
    remediation: 'Record configuration per environment and review the differences.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-BACKUP-001',
    version: '1.0.0',
    title: 'Take a backup before a risky deployment',
    description: 'Especially one with a destructive migration.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'pre-deploy-backup',
        title: 'Back up before deployments with data changes',
        phaseKey: 'release',
      },
    ],
    rationale:
      'The nightly backup may be twenty-three hours old. A pre-deployment backup bounds the loss to the deployment itself.',
    remediation: 'Take and verify a backup immediately before data-changing deployments.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-STORE-001',
    version: '1.0.0',
    title: 'App store review is an external dependency with a timetable',
    description: 'It cannot be accelerated and can reject.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'PROJECT_TYPE_PACK',
    projectTypeScope: ['MOBILE_APP'],
    emittedRisks: [
      {
        key: 'store-review-delay',
        title: 'Store review can delay or block a release',
        description: 'Rejection requires resubmission and a further wait.',
        likelihood: 'MEDIUM',
        impact: 'HIGH',
      },
    ],
    emittedTasks: [
      {
        key: 'plan-store-submission',
        title: 'Plan for store review time and rejection',
        phaseKey: 'release',
      },
    ],
    rationale:
      'A hard launch date with store review on the critical path depends on a third party with no obligation to your schedule.',
    remediation: 'Submit early and plan for at least one rejection cycle.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DEP-VERIFY-001',
    version: '1.0.0',
    title: 'Every deployment is verified from outside',
    description: 'The pipeline reporting success is not verification.',
    category: 'DEPLOYMENT',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: WEB,
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'The deployment was verified from outside the network.',
        blocking: true,
      },
    ],
    rationale:
      'A successful deployment and a working system are different claims, and everything between them — DNS, certificates, proxies, firewalls — is invisible to the pipeline.',
    remediation: 'Verify the public hostname from outside after every deployment.',
    activeFrom: ACTIVE,
  }),

  /* ------------------------------------------------ Production verification */

  defineRule({
    id: 'PRD-AVAIL-001',
    version: '1.0.0',
    title: 'Availability is checked from outside the network',
    description: 'An internal check does not traverse the firewall, the proxy or the DNS.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: WEB,
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'The system is reachable externally.',
        blocking: true,
      },
    ],
    rationale:
      'Most post-release outages are in the path between the internet and the application, which is exactly the part an internal check skips.',
    remediation: 'Check availability from outside your own network.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-TLS-001',
    version: '1.0.0',
    title: 'TLS is verified on the real hostname',
    description: 'Certificate chain, hostname match and redirect behaviour.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: WEB,
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'TLS is correct on the production hostname.',
        blocking: true,
      },
    ],
    rationale:
      'Certificate problems appear only against the real hostname, which by definition staging does not have.',
    remediation: 'Verify the certificate chain and redirects against the production hostname.',
    references: ['Mozilla TLS Observatory guidance'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-HEADER-001',
    version: '1.0.0',
    title: 'Security headers are verified on the live response',
    description: 'Proxies and CDNs frequently strip or replace them.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: WEB,
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'Security headers are present in production.',
        blocking: true,
      },
    ],
    rationale:
      'The application is not the last thing to touch the response, so a header asserted in a test says nothing about what a browser receives.',
    remediation: 'Fetch the live response and assert each header.',
    references: ['OWASP Secure Headers Project'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-JOURNEY-001',
    version: '1.0.0',
    title: 'Critical journeys are walked in production',
    description: 'Individually healthy components can still add up to a broken journey.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: WEB,
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'Critical journeys pass in production.',
        blocking: true,
      },
    ],
    rationale:
      'Component health checks pass while the thing users do is broken, because the breakage is in the composition.',
    remediation: 'Run the critical journeys against production after release.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-AUTH-001',
    version: '1.0.0',
    title: 'Authentication is verified in production',
    description: 'Identity providers are configured per environment and frequently differ.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'Sign-in works in production.',
        blocking: true,
      },
    ],
    rationale:
      'Redirect URIs, client identifiers and callback hostnames are per-environment, and a mistake produces a total inability to sign in.',
    remediation: 'Sign in on production as part of release verification.',
    references: ['OWASP ASVS v4 §2.1 Password Security', 'OWASP ASVS v4 §14.1 Build and Deploy'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-MONITOR-001',
    version: '1.0.0',
    title: 'Monitoring is confirmed to be receiving data',
    description: 'Configured and receiving are different states.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'Monitoring is receiving data.',
        blocking: true,
      },
    ],
    rationale:
      'Monitoring that was configured but is not receiving anything looks identical to a system with no problems.',
    remediation: 'Confirm metrics are arriving after the release.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-LOG-001',
    version: '1.0.0',
    title: 'Logs are confirmed to be arriving where someone can read them',
    description: 'Including that they contain what is needed to diagnose a problem.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'Logs are reaching their destination.',
        blocking: true,
      },
    ],
    rationale:
      'The first incident is a bad time to discover that log shipping was never configured in this environment.',
    remediation: 'Trigger a known log line and confirm it arrives.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-ALERT-001',
    version: '1.0.0',
    title: 'At least one alert is fired deliberately to prove the path works',
    description: 'An alert nobody has ever received is an untested pipeline.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'OPERATIONAL_READINESS',
        criterion: 'An alert has been fired and received.',
        blocking: true,
      },
    ],
    rationale:
      'Alerting has several links — detection, routing, delivery — and any one of them being wrong produces silence, which is indistinguishable from health.',
    remediation: 'Fire a test alert and confirm a person received it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-BACKUP-001',
    version: '1.0.0',
    title: 'The first production backup is verified by restoring it',
    description: 'A backup that has never been restored is a belief.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'A production backup has been restored and checked.',
        blocking: true,
      },
    ],
    rationale:
      'Backups fail silently for years. The restore is the part that reveals whether they were ever working.',
    remediation:
      'Restore the first production backup into a scratch environment and check the content.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-PERF-001',
    version: '1.0.0',
    title: 'Performance is measured in production, not inferred from staging',
    description: 'Data volume, network path and real usage all differ.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    conditions: [{ subject: 'INTAKE', key: 'performance.expectation', operator: 'IS_ANSWERED' }],
    requiredInputs: ['performance.expectation'],
    emittedTasks: [
      {
        key: 'measure-production-performance',
        title: 'Measure performance in production',
        phaseKey: 'operate',
      },
    ],
    rationale:
      'Staging has less data, fewer users and a different network. Performance measured there answers a different question.',
    remediation: 'Measure real user performance after release.',
    references: ['Web Vitals: field data'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-IDENTITY-001',
    version: '1.0.0',
    title: 'Confirm which build is actually running',
    description: 'The deployment reported success; what is serving may be older.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'build-identity',
        title: 'The running build identifies itself',
        description: 'A version endpoint or header naming the commit.',
        priority: 'MUST',
        verification: 'A check that the reported version matches what was deployed.',
      },
    ],
    rationale:
      'Cached layers, failed instances and partial rollouts all produce a system serving something other than what was deployed, and nothing reports it.',
    remediation: 'Expose the build identity and verify it after deployment.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-DATA-001',
    version: '1.0.0',
    title: 'Confirm the production database is the production database',
    description: 'Pointing at the wrong one is a configuration error with severe consequences.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedTasks: [
      {
        key: 'verify-database-target',
        title: 'Verify the connected database',
        phaseKey: 'release',
      },
    ],
    rationale:
      'A production deployment connected to a staging database silently loses every write, and a staging deployment connected to production silently corrupts real data.',
    remediation: 'Assert the connected database identity at startup.',
    references: [
      'OWASP ASVS v4 §14.1.1 Build Process',
      'UK GDPR Article 5(1)(f) Integrity and confidentiality',
    ],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-SAFARI-001',
    version: '1.0.0',
    title: 'Verify on a real browser over HTTPS, including Safari',
    description: 'Cookie behaviour differs between engines and between HTTP and HTTPS.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: WEB,
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'The journey has been verified on Safari over HTTPS.',
        blocking: true,
      },
    ],
    rationale:
      'Cookie attribute handling differs between engines, and some differences only appear over plain HTTP or only over HTTPS — so a local run cannot settle it.',
    remediation: 'Walk the authenticated journey on Safari against the production hostname.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-ERROR-001',
    version: '1.0.0',
    title: 'Confirm errors reach the error tracker',
    description: 'Including that they carry enough context to act on.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'verify-error-reporting',
        title: 'Trigger a test error and confirm it is reported',
        phaseKey: 'release',
      },
    ],
    rationale:
      'Error reporting configured but not working produces a quiet dashboard, which reads as a healthy system.',
    remediation: 'Trigger a harmless error in production and confirm it appears with its context.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'PRD-ROLLBACK-001',
    version: '1.0.0',
    title: 'Confirm rollback works from the current production state',
    description: 'A rollback rehearsed in staging is evidence about staging.',
    category: 'PRODUCTION_VERIFICATION',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'verify-production-rollback',
        title: 'Confirm the rollback path from production',
        phaseKey: 'release',
      },
    ],
    rationale:
      'Production has data and configuration that staging does not, and both are what make a rollback difficult.',
    remediation: 'Confirm the rollback path is viable from the current production state.',
    activeFrom: ACTIVE,
  }),

  /* -------------------------------------------------------------- Operations */

  defineRule({
    id: 'OPS-OWNER-001',
    version: '1.0.0',
    title: 'Someone owns the system after launch',
    description: 'Named, and aware that they own it.',
    category: 'OPERATIONS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      { gateKey: 'OPERATIONAL_READINESS', criterion: 'An owner is named.', blocking: true },
    ],
    rationale:
      'Systems with no owner decay silently. Certificates lapse, dependencies age, and nobody is watching because nobody was asked to.',
    remediation: 'Name the owner and confirm they accept it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'OPS-ALERT-001',
    version: '1.0.0',
    title: 'Alerts go to a person, not to an inbox nobody reads',
    description: 'And there are few enough of them to be read.',
    category: 'OPERATIONS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'actionable-alerts',
        title: 'Every alert is actionable and routed to someone',
        description: 'An alert requiring no action should not be an alert.',
        priority: 'MUST',
        verification: 'A list of alerts with their routing and the expected action.',
      },
    ],
    rationale:
      'Alert fatigue is the standard failure: enough noise and the real one is dismissed with the rest.',
    remediation: 'Route each alert to a person and delete the ones that need no action.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'OPS-RUNBOOK-001',
    version: '1.0.0',
    title: 'Common failures have runbooks',
    description: 'Written before the incident, by whoever understands the system.',
    category: 'OPERATIONS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'write-runbooks',
        title: 'Write runbooks for the likely failures',
        phaseKey: 'operate',
      },
    ],
    rationale:
      'During an incident nobody has time to work out what to do, and the person on call may not be the person who built it.',
    remediation: 'Write a short runbook for each likely failure.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'OPS-MAINT-001',
    version: '1.0.0',
    title: 'Recurring maintenance is scheduled, not remembered',
    description: 'Certificate renewal, dependency updates, log rotation, backup checks.',
    category: 'OPERATIONS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      { key: 'schedule-maintenance', title: 'Schedule recurring maintenance', phaseKey: 'operate' },
    ],
    rationale:
      'Maintenance that depends on someone remembering is maintenance that stops when that person is busy, and the consequences arrive months later.',
    remediation: 'Put recurring maintenance on a schedule with an owner.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'OPS-DEP-001',
    version: '1.0.0',
    title: 'Dependencies are updated regularly, not in one large jump',
    description: 'Small frequent updates are far cheaper than an annual migration.',
    category: 'OPERATIONS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'regular-dependency-updates',
        title: 'Update dependencies on a regular cadence',
        phaseKey: 'operate',
      },
    ],
    rationale:
      'Deferred updates compound. A year of them arrives as a single change with many breaking APIs and no way to bisect a failure.',
    remediation: 'Update dependencies on a regular cadence.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'OPS-INCIDENT-001',
    version: '1.0.0',
    title: 'There is a defined incident process',
    description: 'Who is contacted, who decides, and how it ends.',
    category: 'OPERATIONS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'OPERATIONAL_READINESS',
        criterion: 'An incident process exists.',
        blocking: true,
      },
    ],
    rationale: 'Working out who does what during an outage consumes the time the outage costs.',
    remediation: 'Write down the escalation path and who decides.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'OPS-POSTMORTEM-001',
    version: '1.0.0',
    title: 'Incidents produce a blameless review',
    description: 'What happened, why it was possible, and what changes.',
    category: 'OPERATIONS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      { key: 'incident-review', title: 'Review each significant incident', phaseKey: 'operate' },
    ],
    rationale:
      'Without a review the same incident recurs. With a blaming one, people stop reporting the near misses that would have prevented it.',
    remediation: 'Review each significant incident, focusing on conditions rather than people.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'OPS-CAPACITY-001',
    version: '1.0.0',
    title: 'Capacity is watched before it is exhausted',
    description: 'Disk, connections, quotas and rate limits.',
    category: 'OPERATIONS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'capacity-alerts',
        title: 'Resource limits alert before they are reached',
        description: 'With enough warning to act rather than react.',
        priority: 'SHOULD',
        verification: 'Configured alerts at a threshold below the limit.',
      },
    ],
    rationale: 'A full disk is a total outage that was entirely predictable a week earlier.',
    remediation: 'Alert at a threshold that leaves time to respond.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'OPS-DEBT-001',
    version: '1.0.0',
    title: 'Technical debt is recorded where it will be seen',
    description: 'Debt in someone’s head is invisible to whoever inherits the system.',
    category: 'OPERATIONS',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      { key: 'record-debt', title: 'Record technical debt in the backlog', phaseKey: 'operate' },
    ],
    rationale:
      'Unrecorded debt appears to the next team as an inexplicable slowdown rather than as a known trade.',
    remediation: 'Record debt as backlog items with the cost of leaving it.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'OPS-LIMIT-001',
    version: '1.0.0',
    title: 'Known limitations are written down for the people who inherit them',
    description: 'What the system does not do, and what it assumes.',
    category: 'OPERATIONS',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      { gateKey: 'COMPLETION', criterion: 'Known limitations are recorded.', blocking: false },
    ],
    rationale:
      'Limitations known only to the original team become defects to the next one, who spend time investigating deliberate decisions.',
    remediation: 'Write down what the system does not handle and why.',
    activeFrom: ACTIVE,
  }),

  /* ----------------------------------------------------------- Documentation */

  defineRule({
    id: 'DOC-README-001',
    version: '1.0.0',
    title: 'Someone new can run the system from the documentation alone',
    description: 'Tested by having someone follow it.',
    category: 'DOCUMENTATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'setup-docs',
        title: 'Setup instructions work from a clean machine',
        description: 'Verified by someone who has not done it before.',
        priority: 'MUST',
        verification: 'A new person follows the instructions successfully.',
      },
    ],
    rationale:
      'Setup documentation written by someone who already has everything installed omits exactly the steps that block a newcomer.',
    remediation: 'Have someone new follow the instructions and fix what they hit.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DOC-DECISION-001',
    version: '1.0.0',
    title: 'The reasoning is documented, not only the outcome',
    description: 'Code says what; it rarely says why.',
    category: 'DOCUMENTATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'COMPLETION',
        criterion: 'Significant decisions and their reasoning are documented.',
        blocking: true,
      },
    ],
    rationale:
      'Without the reasoning, the next person either preserves a constraint that no longer applies or removes one that still does.',
    remediation: 'Record why each significant decision was made.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DOC-OPS-001',
    version: '1.0.0',
    title: 'Operational documentation covers running it, not building it',
    description: 'Deploying, monitoring, restoring and responding.',
    category: 'DOCUMENTATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'OPERATIONAL_READINESS',
        criterion: 'Operational documentation exists.',
        blocking: true,
      },
    ],
    rationale:
      'Documentation is usually written for developers, and the people running the system afterwards need a different set of answers.',
    remediation: 'Write documentation for the operator, not only the developer.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DOC-API-001',
    version: '1.0.0',
    title: 'API documentation is generated from the implementation',
    description: 'Hand-written API docs drift within weeks.',
    category: 'DOCUMENTATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    projectTypeScope: ['API_BACKEND_PLATFORM'],
    emittedRequirements: [
      {
        key: 'generated-api-docs',
        title: 'API documentation is generated and verified against behaviour',
        description: 'So it cannot describe an endpoint that no longer works that way.',
        priority: 'MUST',
        verification: 'Contract tests validating responses against the published schema.',
      },
    ],
    rationale:
      'Documentation that drifts is worse than none, because consumers build against it and the failure surfaces in their system.',
    remediation: 'Generate the documentation and validate responses against it in CI.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DOC-DIAGRAM-001',
    version: '1.0.0',
    title: 'A diagram of the system exists and is current',
    description: 'Components, data flow and trust boundaries.',
    category: 'DOCUMENTATION',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      { key: 'system-diagram', title: 'Draw and maintain a system diagram', phaseKey: 'design' },
    ],
    rationale:
      'A diagram conveys the shape of a system in seconds, and reading the code to reconstruct it takes days.',
    remediation: 'Keep one diagram current rather than several that are not.',
    references: ['C4 model'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DOC-CURRENT-001',
    version: '1.0.0',
    title: 'Documentation that cannot be kept current should be deleted',
    description: 'Wrong documentation is worse than absent documentation.',
    category: 'DOCUMENTATION',
    severity: 'ADVISORY',
    source: 'RECOMMENDED_DEFAULT',
    emittedTasks: [
      {
        key: 'prune-stale-docs',
        title: 'Remove documentation that has gone stale',
        phaseKey: 'operate',
      },
    ],
    rationale:
      'People trust documentation. Stale documentation converts that trust into wasted time and wrong decisions.',
    remediation: 'Delete what cannot be maintained; generate what can.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DOC-HANDOVER-001',
    version: '1.0.0',
    title: 'Handover includes access, not only documents',
    description: 'Accounts, credentials, domains, certificates and billing.',
    category: 'DOCUMENTATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'COMPLETION',
        criterion: 'Access and ownership have been transferred.',
        blocking: true,
      },
    ],
    rationale:
      'A handover where the original team still holds the only administrative access is not a handover, and it is discovered when they are no longer available.',
    remediation:
      'Transfer every account, domain and billing relationship, and confirm the new owner can use them.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DOC-SEARCH-001',
    version: '1.0.0',
    title: 'Documentation lives where people will look for it',
    description: 'Not in a personal drive or a chat thread.',
    category: 'DOCUMENTATION',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'centralise-docs',
        title: 'Put documentation somewhere findable',
        phaseKey: 'release',
      },
    ],
    rationale:
      'Documentation nobody can find is documentation that does not exist, and it takes the same effort to write.',
    remediation: 'Keep documentation with the code or in one known place.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DOC-ASSUME-001',
    version: '1.0.0',
    title: 'Handover documentation lists the assumptions the system rests on',
    description: 'The next team cannot see them in the code.',
    category: 'DOCUMENTATION',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'COMPLETION',
        criterion: 'The assumptions the system rests on are documented.',
        blocking: false,
      },
    ],
    rationale:
      'Assumptions are invisible in code and become invalid silently. The next team then makes a reasonable change that breaks something for reasons nobody can explain.',
    remediation: 'List the assumptions and what would happen if each stopped holding.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'DOC-EVIDENCE-001',
    version: '1.0.0',
    title: 'Compliance evidence is collected as it is produced',
    description: 'Assembling it retrospectively is harder and less convincing.',
    category: 'DOCUMENTATION',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'compliance.regimes', operator: 'IS_ANSWERED' }],
    requiredInputs: ['compliance.regimes'],
    emittedTasks: [
      {
        key: 'collect-evidence-continuously',
        title: 'Collect compliance evidence as work is done',
        phaseKey: 'build',
      },
    ],
    rationale:
      'Evidence gathered months later is incomplete and cannot demonstrate that the control was operating at the time — which is the actual question.',
    remediation: 'Capture evidence at the moment the control operates.',
    references: ['ISO/IEC 27001:2022 §9.1 Monitoring and measurement'],
    activeFrom: ACTIVE,
  }),

  /* -------------------------------------------------------------- Governance */

  defineRule({
    id: 'GOV-CHANGE-001',
    version: '1.0.0',
    title: 'Post-baseline changes go through change control',
    description: 'Otherwise the baseline stops describing the project.',
    category: 'GOVERNANCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    lifecycleScope: ['APPROVED', 'IN_PROGRESS', 'VERIFYING', 'RELEASE_READY'],
    emittedGates: [
      {
        gateKey: 'COMPLETION',
        criterion: 'Post-baseline changes were controlled.',
        blocking: true,
      },
    ],
    rationale:
      'Uncontrolled change means nobody can say at the end whether the project delivered what was agreed.',
    remediation: 'Route changes through a recorded request with an impact assessment.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-CHANGE-002',
    version: '1.0.0',
    title: 'A change request states its impact before approval',
    description: 'On scope, schedule, budget and risk.',
    category: 'GOVERNANCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'change-impact',
        title: 'Change requests carry an impact assessment',
        description: 'What else moves if this is approved.',
        priority: 'MUST',
        verification: 'Each approved change has a recorded impact.',
      },
    ],
    rationale:
      'Approving a change without its impact is approving an unknown, and the impacts accumulate into an overrun nobody chose.',
    remediation: 'Assess and record impact before approval.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-APPROVE-001',
    version: '1.0.0',
    title: 'Approvals are attributable to a person',
    description: 'Not to a group, a role or a shared account.',
    category: 'GOVERNANCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'attributable-approval',
        title: 'Every approval records who gave it and when',
        description: 'And what exactly they were approving.',
        priority: 'MUST',
        verification: 'Approval records with identity and timestamp.',
      },
    ],
    rationale:
      'An approval attributed to a group is attributed to nobody, and cannot be relied on afterwards.',
    remediation: 'Record the individual, the timestamp and the exact version approved.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-SOD-001',
    version: '1.0.0',
    title: 'The same person does not both request and approve',
    description: 'Self-approval removes the control entirely.',
    category: 'GOVERNANCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'separation-of-duties',
        title: 'Approval requires someone other than the requester',
        description: 'Enforced, not merely expected.',
        priority: 'MUST',
        verification: 'A test that a requester cannot approve their own request.',
      },
    ],
    rationale:
      'Self-approval turns a control into a formality, and it is the first thing to happen when the approver is unavailable.',
    remediation: 'Enforce a different approver in the system.',
    references: ['ISO/IEC 27001:2022 Annex A 5.3 Segregation of duties'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-BASELINE-001',
    version: '1.0.0',
    title: 'A baseline is immutable',
    description: 'An editable baseline is a claim about the past rather than a record of it.',
    category: 'GOVERNANCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'immutable-baseline',
        title: 'Baselines cannot be modified after they are taken',
        description:
          'Enforced by the storage layer, with a checksum that makes tampering detectable.',
        priority: 'MUST',
        verification: 'A test attempting to modify a baseline and asserting refusal.',
      },
    ],
    rationale:
      'The whole point of a baseline is to be the fixed thing to compare against. If it can change, it compares to itself.',
    remediation: 'Make baselines append-only and checksum them.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-AUDIT-001',
    version: '1.0.0',
    title: 'Governance decisions are recorded in an append-only log',
    description: 'Approvals, exceptions, waivers and baselines.',
    category: 'GOVERNANCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'governance-audit-trail',
        title: 'An unmodifiable record of governance decisions',
        description: 'Who, what, when and why.',
        priority: 'MUST',
        verification: 'A test asserting the log cannot be edited.',
      },
    ],
    rationale:
      'A governance record that can be edited is a record of what people currently wish had been decided.',
    remediation: 'Store governance decisions append-only.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-EXCEPTION-001',
    version: '1.0.0',
    title: 'Every exception has an owner, a reason and an expiry',
    description: 'An exception without an expiry becomes the standard.',
    category: 'GOVERNANCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'time-limited-exceptions',
        title: 'Exceptions expire and are reviewed',
        description: 'With a named owner and a stated reason.',
        priority: 'MUST',
        verification: 'An exception register with owners and expiry dates.',
      },
    ],
    rationale:
      'Undated exceptions accumulate until the exception is the norm, and nobody can tell which reasons still apply.',
    remediation: 'Give each exception an owner, a reason and a review date.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-GATE-001',
    version: '1.0.0',
    title: 'A gate override is a decision, recorded as one',
    description: 'Overriding silently means the gate was decoration.',
    category: 'GOVERNANCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'recorded-overrides',
        title: 'Gate overrides are attributed and justified',
        description: 'Recorded against the gate they overrode.',
        priority: 'MUST',
        verification: 'Override records with identity, reason and timestamp.',
      },
    ],
    rationale:
      'Gates that can be bypassed without a record provide the appearance of control and none of the substance.',
    remediation: 'Require a recorded justification for every override.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-ROLE-001',
    version: '1.0.0',
    title: 'Permissions are granted by role, and roles are reviewed',
    description: 'Accumulated individual grants become invisible privilege.',
    category: 'GOVERNANCE',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedTasks: [
      { key: 'review-access', title: 'Review who has access, periodically', phaseKey: 'operate' },
    ],
    rationale:
      'Access granted for a temporary reason is rarely revoked, and after a few years the permission set describes nobody’s actual job.',
    remediation: 'Grant by role and review the grants on a schedule.',
    references: ['ISO/IEC 27001:2022 Annex A 5.18 Access rights'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-VENDOR-001',
    version: '1.0.0',
    title: 'Third-party services are assessed before they hold data',
    description: 'Their security posture becomes part of yours.',
    category: 'GOVERNANCE',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditionMode: 'ALL',
    conditions: [
      { subject: 'INTAKE', key: 'integrations.thirdParties', operator: 'IS_ANSWERED' },
      {
        subject: 'INTAKE',
        key: 'data.types',
        operator: 'INCLUDES_ANY',
        value: ['Personal data', 'Health data', 'Payment card data', 'Financial data'],
      },
    ],
    requiredInputs: ['integrations.thirdParties', 'data.types'],
    emittedTasks: [
      {
        key: 'vendor-assessment',
        title: 'Assess third parties that will hold data',
        phaseKey: 'design',
      },
    ],
    rationale:
      'A breach at a processor is a breach you are accountable for, and the obligations do not transfer with the data.',
    remediation: 'Assess and contract with each processor before sending them data.',
    references: ['UK GDPR Article 28 Processor'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-DECISION-001',
    version: '1.0.0',
    title: 'Decisions record who was entitled to make them',
    description: 'A decision taken by the wrong person is not a decision.',
    category: 'GOVERNANCE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      { key: 'define-decision-rights', title: 'Define who decides what', phaseKey: 'discovery' },
    ],
    rationale:
      'Undefined decision rights produce decisions that get reopened, usually late and by someone senior who was not consulted.',
    remediation: 'Record who decides for each kind of decision.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-REPORT-001',
    version: '1.0.0',
    title: 'Status reporting distinguishes measured from estimated',
    description: 'A percentage complete with no basis is a feeling.',
    category: 'GOVERNANCE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      {
        key: 'evidence-based-reporting',
        title: 'Base status reporting on evidence',
        phaseKey: 'build',
      },
    ],
    rationale:
      'Reported progress that is not derived from completed work drifts optimistic, and the correction arrives all at once near the end.',
    remediation: 'Derive status from finished items rather than from judgement.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-ESCALATE-001',
    version: '1.0.0',
    title: 'There is a defined way to escalate a blocked decision',
    description: 'Blocked decisions are the most common cause of quiet delay.',
    category: 'GOVERNANCE',
    severity: 'RECOMMENDED',
    source: 'ORGANIZATION_POLICY',
    emittedTasks: [
      { key: 'define-escalation', title: 'Define the escalation path', phaseKey: 'discovery' },
    ],
    rationale:
      'Without a path, a blocked decision waits for someone to happen to notice, and the delay is invisible in any report.',
    remediation: 'Agree who to escalate to and after how long.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-CLOSE-001',
    version: '1.0.0',
    title: 'A project is closed deliberately',
    description: 'Requirements dispositioned, ownership transferred, debt recorded.',
    category: 'GOVERNANCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      { gateKey: 'COMPLETION', criterion: 'Closure activities are complete.', blocking: true },
    ],
    rationale:
      'Projects that fade out rather than close leave obligations attached to people who have moved on, and nobody knows what was outstanding.',
    remediation: 'Complete closure explicitly and record what remains.',
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'GOV-ARCHIVE-001',
    version: '1.0.0',
    title: 'An archived project is read-only but restorable',
    description: 'Archiving is not deletion, and a one-way door discourages archiving.',
    category: 'GOVERNANCE',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedRequirements: [
      {
        key: 'archive-restore',
        title: 'Archived projects cannot be changed but can be restored',
        description: 'With the restoration recorded.',
        priority: 'MUST',
        verification: 'Tests for refusal of writes and for successful restoration.',
      },
    ],
    rationale:
      'If archiving is irreversible people avoid it, and the system fills with finished projects that look active.',
    remediation: 'Make archived projects read-only and restoration a recorded action.',
    activeFrom: ACTIVE,
  }),
];
