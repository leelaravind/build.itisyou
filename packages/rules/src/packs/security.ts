/**
 * Security rules.
 *
 * Contract: gap-spec §14 asks for at least 35 security rules and adds the instruction that governs
 * this whole catalogue: **"The rules must be meaningful. Do not create artificial rules solely to
 * meet a number."**
 *
 * Every rule below exists because getting it wrong has a specific, describable consequence, and the
 * `rationale` says what that is. A rule whose rationale reduces to "it is best practice" was not
 * written; it was padding, and padding in a security catalogue is worse than an absent rule because
 * it consumes the attention that should go to the real ones.
 *
 * A note on what is deliberately *not* here. There are no rules asserting that a project "is secure",
 * "is compliant", or "has been penetration tested to a standard". The platform records what has been
 * evidenced; it never certifies. A rule that emitted "PCI DSS compliant" would be making a claim on
 * behalf of an assessor who has not looked.
 */

import { defineRule, type Rule } from '../schema.ts';

const ACTIVE = '2026-01-01';

const PUBLIC_TYPES = ['PUBLIC_WEB_APP', 'SAAS_WEB_APP', 'ECOMMERCE', 'AI_ENABLED_WEB_APP'];
const ALL_WEB = [...PUBLIC_TYPES, 'INTERNAL_BUSINESS_APP', 'API_BACKEND_PLATFORM'];

export const SECURITY_RULES: readonly Rule[] = [
  /* ---------------------------------------------------------------- Identity */

  defineRule({
    id: 'SEC-AUTH-001',
    version: '1.0.0',
    title: 'Authentication needs its own verification pack',
    description:
      'A system where users sign in must verify sign-in, session handling, recovery and lockout together, not as separate afterthoughts.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedRequirements: [
      {
        key: 'auth-verified',
        title: 'Authentication behaves correctly under adversarial use',
        description:
          'Sign-in, session lifetime, sign-out, credential recovery and lockout are verified against misuse, not only against the happy path.',
        priority: 'MUST',
        verification: 'An automated authentication test pack covering each of those behaviours.',
      },
    ],
    emittedTests: [
      {
        key: 'auth-pack',
        title: 'Authentication test pack',
        kind: 'SECURITY',
        verifies: 'auth-verified',
      },
    ],
    emittedGates: [
      {
        gateKey: 'SECURITY',
        criterion: 'Authentication has been verified adversarially.',
        blocking: true,
      },
    ],
    rationale:
      'Authentication is where a system decides who someone is. Every access control downstream inherits that decision, so a flaw here is not one vulnerability but the removal of every boundary at once.',
    remediation:
      'Add an authentication test pack covering sign-in, session expiry, sign-out, recovery and lockout, and run it before every release.',
    references: [
      'OWASP ASVS v4 §2 Authentication',
      'OWASP Top 10 A07: Identification and Authentication Failures',
    ],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-AUTHZ-001',
    version: '1.0.0',
    title: 'Object-level authorisation must be tested, not assumed',
    description:
      'Every endpoint that returns or modifies a specific object must be tested with a valid session belonging to someone who does not own it.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedRequirements: [
      {
        key: 'bola-tested',
        title: 'Objects cannot be reached by users who do not own them',
        description:
          'For each object-scoped endpoint, a request from an authenticated user who does not own the object is refused.',
        priority: 'MUST',
        verification:
          'A test per object type that authenticates as a non-owner and asserts the object is not returned.',
      },
    ],
    emittedTests: [
      {
        key: 'bola-pack',
        title: 'Broken object-level authorisation pack',
        kind: 'SECURITY',
        verifies: 'bola-tested',
      },
    ],
    emittedGates: [
      {
        gateKey: 'SECURITY',
        criterion: 'Object-level authorisation is tested per object type.',
        blocking: true,
      },
    ],
    rationale:
      'Broken object-level authorisation is the most commonly exploited serious web vulnerability, and it passes every test that only checks the happy path — the owner sees their own data, so the endpoint looks correct.',
    remediation:
      'For every endpoint taking an object id, add a test that authenticates as a different user and asserts refusal.',
    references: ['OWASP API Security Top 10 API1:2023 Broken Object Level Authorization'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-AUTHZ-002',
    version: '1.0.0',
    title: 'A forbidden object must be indistinguishable from a missing one',
    description:
      'Requests for objects the caller may not see return the same response as requests for objects that do not exist.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedRequirements: [
      {
        key: 'no-existence-oracle',
        title: 'Access refusals do not reveal what exists',
        description:
          'A refused request returns 404, not 403, wherever a 403 would confirm that the object exists.',
        priority: 'MUST',
        verification:
          'A test asserting the status and body are identical for forbidden and non-existent ids.',
      },
    ],
    emittedTests: [
      {
        key: 'existence-oracle',
        title: 'Existence-disclosure test',
        kind: 'SECURITY',
        verifies: 'no-existence-oracle',
      },
    ],
    rationale:
      'A 403 tells an attacker the identifier is real. Enumerating identifiers then reveals the shape and size of the customer base, which is information the system was never asked to publish.',
    remediation: 'Return 404 for objects outside the caller’s scope, and assert it in a test.',
    references: ['OWASP ASVS v4 §4.1 General Access Control Design'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-AUTHZ-003',
    version: '1.0.0',
    title: 'Authorisation happens on the server',
    description:
      'Hiding a control in the interface is presentation, not access control. The check must exist on the server for every action.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ALL_WEB,
    emittedRequirements: [
      {
        key: 'server-side-authz',
        title: 'Every privileged action is checked server-side',
        description:
          'No action relies on the client having hidden a button. Each is authorised where it is executed.',
        priority: 'MUST',
        verification: 'A test that calls each privileged endpoint directly, without the interface.',
      },
    ],
    emittedTests: [
      {
        key: 'direct-endpoint',
        title: 'Direct endpoint authorisation test',
        kind: 'SECURITY',
        verifies: 'server-side-authz',
      },
    ],
    emittedGates: [
      {
        gateKey: 'SECURITY',
        criterion: 'Privileged actions are authorised server-side.',
        blocking: true,
      },
    ],
    rationale:
      'Client-side restrictions are advisory to anyone who opens the network tab. A control that only exists in the interface is a control that exists only for people who were not going to misuse it.',
    remediation:
      'Add a server-side permission check to every privileged handler and test it without the UI.',
    references: ['OWASP ASVS v4 §4.2 Operation Level Access Control'],
    activeFrom: ACTIVE,
  }),

  /* ------------------------------------------------------------ Tenant data */

  defineRule({
    id: 'SEC-TENANT-001',
    version: '1.0.0',
    title: 'Tenant isolation must be tested across tenants, not within one',
    description:
      'A multi-tenant system needs tests that create two tenants and assert neither can see the other’s data through any route.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ['SAAS_WEB_APP'],
    emittedRequirements: [
      {
        key: 'tenant-isolation',
        title: 'No route returns another tenant’s data',
        description:
          'Every query path — list, search, export, report — is exercised from a second tenant and returns nothing belonging to the first.',
        priority: 'MUST',
        verification: 'A cross-tenant test suite covering every read path.',
      },
    ],
    emittedTests: [
      {
        key: 'cross-tenant',
        title: 'Cross-tenant isolation suite',
        kind: 'SECURITY',
        verifies: 'tenant-isolation',
      },
    ],
    emittedGates: [
      {
        gateKey: 'SECURITY',
        criterion: 'Cross-tenant isolation is tested on every read path.',
        blocking: true,
      },
    ],
    emittedRisks: [
      {
        key: 'tenant-leak',
        title: 'A tenant-isolation failure would be existential',
        description:
          'Unlike most defects, one customer seeing another’s data is usually unrecoverable commercially, regardless of how quickly it is fixed.',
        likelihood: 'MEDIUM',
        impact: 'HIGH',
      },
    ],
    rationale:
      'Tenant-isolation defects are invisible in single-tenant testing: every query looks correct because there is only one tenant’s data to return.',
    remediation:
      'Add a test fixture with two populated tenants and assert isolation on every read path, including exports and reports.',
    references: ['OWASP ASVS v4 §4.1.3 Least Privilege'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-TENANT-002',
    version: '1.0.0',
    title: 'Defence in depth below the application layer',
    description:
      'Tenant scoping in application code should be backed by a database-level control, so a query that bypasses the application layer still returns nothing.',
    category: 'SECURITY',
    severity: 'RECOMMENDED',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ['SAAS_WEB_APP'],
    emittedRequirements: [
      {
        key: 'db-level-isolation',
        title: 'Tenant scoping is enforced below the application',
        description:
          'Row-level security or an equivalent control, running as a role that cannot bypass it.',
        priority: 'SHOULD',
        verification:
          'A test that issues a raw query without the application’s scoping and asserts no foreign rows are returned.',
      },
    ],
    emittedTests: [
      {
        key: 'raw-query-isolation',
        title: 'Unscoped query isolation test',
        kind: 'SECURITY',
        verifies: 'db-level-isolation',
      },
    ],
    rationale:
      'Application-level scoping is one forgotten WHERE clause away from failing. A database-level control catches the refactor that drops it — but only if the application does not connect as a superuser or the table owner, both of which bypass row-level security entirely.',
    remediation:
      'Enable row-level security with FORCE, and connect as a role that is neither superuser nor table owner. Test it with a raw query.',
    references: ['PostgreSQL documentation: Row Security Policies'],
    activeFrom: ACTIVE,
  }),

  /* --------------------------------------------------------------- Payments */

  defineRule({
    id: 'SEC-PAY-001',
    version: '1.0.0',
    title: 'Card data should not enter the system at all',
    description:
      'Where payments are taken, the cheapest and strongest control is for card data never to touch the application.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [
      {
        subject: 'INTAKE',
        key: 'data.types',
        operator: 'INCLUDES_ANY',
        value: ['Payment card data'],
      },
    ],
    requiredInputs: ['data.types'],
    emittedRequirements: [
      {
        key: 'no-card-data',
        title: 'Card details never transit or rest in this system',
        description:
          'Payment capture is delegated so that card numbers are never received, logged or stored by the application.',
        priority: 'MUST',
        verification:
          'An architecture record showing the payment path, plus a test asserting no card-shaped value appears in logs or storage.',
      },
    ],
    emittedTests: [
      {
        key: 'card-data-absence',
        title: 'Card data absence test',
        kind: 'SECURITY',
        verifies: 'no-card-data',
      },
    ],
    emittedGates: [
      {
        gateKey: 'SECURITY',
        criterion: 'The payment path keeps card data out of the system.',
        blocking: true,
      },
    ],
    emittedRisks: [
      {
        key: 'pci-scope',
        title: 'Handling card data brings the whole system into scope',
        description:
          'Once card data touches a component, that component and everything connected to it acquires obligations that are expensive to meet and expensive to prove.',
        likelihood: 'HIGH',
        impact: 'HIGH',
      },
    ],
    rationale:
      'Every control required for holding card data is avoided entirely by not holding it. This is one of the rare cases where the secure option is also the cheaper one.',
    remediation:
      'Use a hosted payment form or tokenisation so card numbers never reach your servers. Record the payment path as an architecture decision.',
    references: [
      'PCI DSS v4.0 §3 Protect Stored Account Data',
      'PCI DSS v4.0 SAQ A eligibility criteria',
    ],
    activeFrom: ACTIVE,
  }),

  /* ---------------------------------------------------------- Personal data */

  defineRule({
    id: 'SEC-PRIV-001',
    version: '1.0.0',
    title: 'Personal data needs a lawful basis and a retention limit',
    description:
      'Holding personal data requires knowing why it is held, on what basis, and when it will be deleted.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [
      {
        subject: 'INTAKE',
        key: 'data.types',
        operator: 'INCLUDES_ANY',
        value: [
          'Personal data',
          'Health data',
          'Children’s data',
          'Government or regulated records',
        ],
      },
    ],
    requiredInputs: ['data.types'],
    emittedRequirements: [
      {
        key: 'lawful-basis',
        title: 'Every category of personal data has a recorded basis and retention period',
        description:
          'What is held, why, on what lawful basis, for how long, and how it is deleted when that expires.',
        priority: 'MUST',
        verification:
          'A record of processing that lists each category with its basis and retention period.',
      },
    ],
    emittedTasks: [
      { key: 'record-of-processing', title: 'Write the record of processing', phaseKey: 'design' },
    ],
    emittedGates: [
      {
        gateKey: 'REQUIREMENTS',
        criterion: 'Personal data has a recorded lawful basis and retention period.',
        blocking: true,
      },
    ],
    rationale:
      'Data held without a stated purpose accumulates indefinitely, and the volume is only discovered during a subject access request or a breach — the two moments when it is most costly.',
    remediation:
      'List each category of personal data with its purpose, lawful basis, retention period and deletion mechanism.',
    references: [
      'UK GDPR Article 5(1)(e) Storage limitation',
      'UK GDPR Article 30 Records of processing activities',
    ],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-PRIV-002',
    version: '1.0.0',
    title: 'Subject access and deletion must be possible before launch',
    description:
      'A system holding personal data must be able to produce and delete one person’s data on request.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [
      {
        subject: 'INTAKE',
        key: 'data.types',
        operator: 'INCLUDES_ANY',
        value: ['Personal data', 'Health data'],
      },
    ],
    requiredInputs: ['data.types'],
    emittedRequirements: [
      {
        key: 'subject-rights',
        title: 'One person’s data can be exported and deleted',
        description:
          'Including data held in backups, logs, analytics and any third party the data was sent to.',
        priority: 'MUST',
        verification:
          'A test that creates a subject, exercises export and deletion, and asserts nothing remains.',
      },
    ],
    emittedTests: [
      {
        key: 'subject-rights-test',
        title: 'Subject access and erasure test',
        kind: 'INTEGRATION',
        verifies: 'subject-rights',
      },
    ],
    rationale:
      'Retrofitting deletion is disproportionately hard once data has spread into logs, caches, analytics and third parties. Designed in, it is a query; discovered late, it is an archaeology project.',
    remediation:
      'Implement export and deletion for a single subject, and enumerate every location personal data reaches.',
    references: ['UK GDPR Article 15 Right of access', 'UK GDPR Article 17 Right to erasure'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-PRIV-003',
    version: '1.0.0',
    title: 'Personal data must not reach the logs',
    description:
      'Log output is copied, shipped and retained far more widely than the database, and is rarely covered by the same controls.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [
      {
        subject: 'INTAKE',
        key: 'data.types',
        operator: 'INCLUDES_ANY',
        value: ['Personal data', 'Health data', 'Financial data'],
      },
    ],
    requiredInputs: ['data.types'],
    emittedRequirements: [
      {
        key: 'log-redaction',
        title: 'Logs are redacted centrally, not at each call site',
        description:
          'Sensitive values are removed by the logging layer itself, so a new call site cannot forget.',
        priority: 'MUST',
        verification:
          'A test that logs a structure containing known sensitive values and asserts none appear in the output.',
      },
    ],
    emittedTests: [
      {
        key: 'log-redaction-test',
        title: 'Log redaction test',
        kind: 'UNIT',
        verifies: 'log-redaction',
      },
    ],
    rationale:
      'Redaction applied at each call site fails at the first call site somebody adds in a hurry. Applied centrally, it fails only if the logger itself is bypassed — which is a much smaller thing to check.',
    remediation:
      'Redact inside the logging layer by key name and value shape, and test it with planted values.',
    references: ['OWASP ASVS v4 §7.1 Log Content'],
    activeFrom: ACTIVE,
  }),

  /* ------------------------------------------------------------- Transport */

  defineRule({
    id: 'SEC-TLS-001',
    version: '1.0.0',
    title: 'Everything is served over TLS, and says so',
    description:
      'All traffic uses TLS, plain HTTP redirects to it, and the response asserts strict transport security.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ALL_WEB,
    emittedRequirements: [
      {
        key: 'tls-everywhere',
        title: 'TLS on every route, with HSTS',
        description:
          'Including redirects, static assets, APIs and any subdomain that shares a session cookie.',
        priority: 'MUST',
        verification:
          'A production check asserting the redirect, the certificate and the HSTS header.',
      },
    ],
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'TLS and HSTS are correct on the real hostname.',
        blocking: true,
      },
    ],
    rationale:
      'A single route served over plain HTTP exposes the session cookie for every route, because the cookie travels with the request regardless of which one it is.',
    remediation:
      'Redirect HTTP to HTTPS, set HSTS, and verify on the real hostname rather than in staging.',
    references: ['OWASP ASVS v4 §9.1 Client Communications Security'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-COOKIE-001',
    version: '1.0.0',
    title: 'Session cookies are HttpOnly, Secure and SameSite',
    description:
      'A session cookie readable by JavaScript turns any cross-site scripting flaw into full account takeover.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ALL_WEB,
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedRequirements: [
      {
        key: 'cookie-flags',
        title: 'Session cookies carry HttpOnly, Secure and SameSite',
        description: 'Asserted in a test rather than checked once by hand.',
        priority: 'MUST',
        verification: 'A test that reads the Set-Cookie header and asserts each attribute.',
      },
    ],
    emittedTests: [
      {
        key: 'cookie-flags-test',
        title: 'Session cookie attribute test',
        kind: 'E2E',
        verifies: 'cookie-flags',
      },
    ],
    rationale:
      'HttpOnly is what stops a stored-XSS defect escalating from "content is wrong" to "sessions are stolen". The cost is a single attribute.',
    remediation: 'Set all three attributes and assert them in an end-to-end test.',
    references: ['OWASP ASVS v4 §3.4 Cookie-based Session Management'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-CSP-001',
    version: '1.0.0',
    title: 'A content security policy without unsafe-inline',
    description:
      'Any surface that renders stored content needs a policy that would stop injected script executing.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: PUBLIC_TYPES,
    emittedRequirements: [
      {
        key: 'csp-strict',
        title: 'script-src does not include unsafe-inline',
        description: 'Nonces or hashes, so that injected inline script does not execute.',
        priority: 'MUST',
        verification:
          'A test asserting the policy header and that a planted inline script does not run.',
      },
    ],
    emittedTests: [
      {
        key: 'csp-test',
        title: 'Content security policy test',
        kind: 'E2E',
        verifies: 'csp-strict',
      },
    ],
    rationale:
      'A CSP containing unsafe-inline is a CSP that permits exactly the thing it exists to prevent. It is common because it is what makes the policy easy to adopt.',
    remediation: 'Use a per-request nonce, and assert with a test that inline script is blocked.',
    references: ['OWASP ASVS v4 §14.4.3 Content Security Policy', 'MDN: Content-Security-Policy'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-HEADER-001',
    version: '1.0.0',
    title: 'Security headers are verified in production, not only in code',
    description:
      'Headers set correctly by the application are frequently stripped or overridden by a proxy, CDN or load balancer.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ALL_WEB,
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'Security headers are present on the live hostname.',
        blocking: true,
      },
    ],
    emittedTasks: [
      {
        key: 'verify-headers-production',
        title: 'Check security headers against production',
        phaseKey: 'release',
      },
    ],
    rationale:
      'The application is not the last thing to touch the response. A header asserted in a unit test says nothing about what a browser actually receives.',
    remediation:
      'Fetch the live hostname after release and assert each header on the real response.',
    references: ['OWASP Secure Headers Project'],
    activeFrom: ACTIVE,
  }),

  /* ------------------------------------------------------------ Input paths */

  defineRule({
    id: 'SEC-INPUT-001',
    version: '1.0.0',
    title: 'Untrusted input is validated at the boundary, against a schema',
    description:
      'Every external input is parsed into a known shape before anything reads it, and unknown fields are rejected.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ALL_WEB,
    emittedRequirements: [
      {
        key: 'boundary-validation',
        title: 'Every external input is schema-validated on arrival',
        description:
          'Strict schemas: an unrecognised field is a rejection, not something to ignore.',
        priority: 'MUST',
        verification: 'A test per boundary sending malformed and over-permissive payloads.',
      },
    ],
    emittedTests: [
      {
        key: 'boundary-validation-test',
        title: 'Boundary validation test',
        kind: 'INTEGRATION',
        verifies: 'boundary-validation',
      },
    ],
    rationale:
      'Validation spread through the code means every path has its own idea of what is acceptable, and the weakest one decides. Validation at the boundary means there is one answer.',
    remediation: 'Parse each input into a strict schema at the edge, and reject unknown fields.',
    references: ['OWASP ASVS v4 §5.1 Input Validation'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-INPUT-002',
    version: '1.0.0',
    title: 'Mass assignment must be impossible',
    description:
      'An update endpoint must not write whichever fields the payload happens to contain.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ALL_WEB,
    emittedRequirements: [
      {
        key: 'no-mass-assignment',
        title: 'Update endpoints write only the fields they intend to',
        description:
          'Fields such as role, owner, tenant and price are never writable from a request body.',
        priority: 'MUST',
        verification:
          'A test that posts a privileged field to each update endpoint and asserts it was ignored.',
      },
    ],
    emittedTests: [
      {
        key: 'mass-assignment-test',
        title: 'Mass assignment test',
        kind: 'SECURITY',
        verifies: 'no-mass-assignment',
      },
    ],
    rationale:
      'Spreading a request body into a database update is convenient and grants the caller whatever the model happens to expose — including the field that decides whether they are an administrator.',
    remediation:
      'Pick fields explicitly on write, and test that a privileged field in the body is ignored.',
    references: ['OWASP API Security Top 10 API3:2023 Broken Object Property Level Authorization'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-XSS-001',
    version: '1.0.0',
    title: 'Stored content is the highest-risk surface',
    description:
      'Anywhere one user’s content is rendered to another, output encoding and sanitisation must be verified.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: PUBLIC_TYPES,
    emittedRequirements: [
      {
        key: 'stored-xss',
        title: 'User-supplied content cannot execute when rendered',
        description: 'Verified with payloads, not by inspection.',
        priority: 'MUST',
        verification:
          'A test that stores script-bearing content and asserts it does not execute when displayed.',
      },
    ],
    emittedTests: [
      {
        key: 'stored-xss-test',
        title: 'Stored cross-site scripting test',
        kind: 'SECURITY',
        verifies: 'stored-xss',
      },
    ],
    rationale:
      'Stored XSS has the largest blast radius of any injection: it runs in the session of every user who views the content, including administrators.',
    remediation:
      'Escape on output, sanitise rich text against an allowlist, and test with real payloads.',
    references: ['OWASP ASVS v4 §5.3 Output Encoding and Injection Prevention'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-SQL-001',
    version: '1.0.0',
    title: 'Queries are parameterised, including the dynamic ones',
    description:
      'String-built SQL is the one place where a convenient shortcut and a critical vulnerability are the same line of code.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ALL_WEB,
    emittedRequirements: [
      {
        key: 'parameterised-queries',
        title: 'No query is assembled from unescaped input',
        description:
          'Including sort columns, filters and anything else that looks like structure rather than data.',
        priority: 'MUST',
        verification:
          'A static check plus tests sending injection payloads through each filterable endpoint.',
      },
    ],
    emittedTests: [
      {
        key: 'sql-injection-test',
        title: 'Injection test across filterable endpoints',
        kind: 'SECURITY',
        verifies: 'parameterised-queries',
      },
    ],
    rationale:
      'Ordinary values are usually parameterised. The failures are in the parts that feel structural — ORDER BY, dynamic column names, search expressions — where parameterisation feels impossible and an allowlist is the answer.',
    remediation:
      'Parameterise values; allowlist anything structural. Test with payloads on every filterable field.',
    references: ['OWASP ASVS v4 §5.3.4 SQL Injection'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-SSRF-001',
    version: '1.0.0',
    title: 'User-supplied URLs must not reach internal networks',
    description:
      'Any feature that fetches a URL the user supplies needs an allowlist and a check against private address ranges.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'apis.external', operator: 'IS_ANSWERED' }],
    requiredInputs: ['apis.external'],
    emittedRequirements: [
      {
        key: 'ssrf-controls',
        title: 'Outbound fetches of user-supplied URLs are restricted',
        description:
          'Private ranges, link-local addresses and cloud metadata endpoints are refused, after DNS resolution rather than before.',
        priority: 'MUST',
        verification:
          'A test attempting each blocked range, including via a hostname that resolves to one.',
      },
    ],
    emittedTests: [
      {
        key: 'ssrf-test',
        title: 'Server-side request forgery test',
        kind: 'SECURITY',
        verifies: 'ssrf-controls',
      },
    ],
    rationale:
      'A server fetching an arbitrary URL is a proxy into the internal network from outside it. Cloud metadata endpoints in particular hand out credentials to anyone who can make the request.',
    remediation:
      'Resolve the hostname, check the resolved address against private ranges, and re-check after redirects.',
    references: ['OWASP Top 10 A10:2021 Server-Side Request Forgery'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-UPLOAD-001',
    version: '1.0.0',
    title: 'Uploaded files are untrusted content with a filename attached',
    description:
      'File upload needs type restriction, size limits, randomised storage keys and serving from a separate origin.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ALL_WEB,
    emittedRequirements: [
      {
        key: 'upload-controls',
        title: 'Uploads are type-restricted, size-limited and served safely',
        description:
          'The stored key is generated rather than taken from the filename, and files are served with a content type the server chose.',
        priority: 'MUST',
        verification:
          'Tests covering type mismatch, oversized files, path traversal in the name, and the served content type.',
      },
    ],
    emittedTests: [
      {
        key: 'upload-test',
        title: 'Upload handling test',
        kind: 'SECURITY',
        verifies: 'upload-controls',
      },
    ],
    rationale:
      'A user-supplied filename used as a storage key is path traversal; a user-supplied content type served back is stored XSS. Both are avoided by not trusting either.',
    remediation:
      'Generate storage keys, verify the declared type against the content, cap size, and set the response content type yourself.',
    references: ['OWASP ASVS v4 §12 File and Resources'],
    activeFrom: ACTIVE,
  }),

  /* -------------------------------------------------------------- Secrets */

  defineRule({
    id: 'SEC-SECRET-001',
    version: '1.0.0',
    title: 'Secrets are not in the repository, and that is checked automatically',
    description: 'A secret scanner runs in CI, and the build fails when it finds something.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedRequirements: [
      {
        key: 'secret-scanning',
        title: 'Committed secrets fail the build',
        description: 'Covering source, configuration, fixtures and documentation.',
        priority: 'MUST',
        verification:
          'The scanner is proven to work by planting a credential of each type it claims to detect.',
      },
    ],
    emittedTasks: [
      { key: 'secret-scan-ci', title: 'Add secret scanning to CI', phaseKey: 'build' },
    ],
    emittedGates: [
      {
        gateKey: 'SECURITY',
        criterion: 'A secret scan runs in CI and is proven to detect real credentials.',
        blocking: true,
      },
    ],
    rationale:
      'A committed secret is public from the moment it lands, and rewriting history does not recall it. The window between commit and rotation is the whole exposure.',
    remediation:
      'Add a scanner to CI and verify it by planting one credential of each supported type — a scanner nobody has tested is a scanner that may detect nothing.',
    references: ['OWASP ASVS v4 §14.1 Build and Deploy'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-SECRET-002',
    version: '1.0.0',
    title: 'Secrets must be rotatable without a code change',
    description: 'Configuration comes from the environment, so rotation is an operational act.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedRequirements: [
      {
        key: 'rotatable-secrets',
        title: 'Every secret can be changed without redeploying code',
        description: 'Read from the environment or a secret store, validated at startup.',
        priority: 'MUST',
        verification: 'A record showing where each secret comes from and how it is rotated.',
      },
    ],
    rationale:
      'If rotating a credential requires a code change and a release, it will not be rotated during an incident — which is the only time it truly matters.',
    remediation:
      'Read secrets from the environment, validate them at startup, and document the rotation procedure.',
    references: ['OWASP ASVS v4 §6.4 Secret Management'],
    activeFrom: ACTIVE,
  }),

  /* --------------------------------------------------------- Dependencies */

  defineRule({
    id: 'SEC-DEP-001',
    version: '1.0.0',
    title: 'Dependency vulnerabilities fail the build',
    description:
      'An audit runs in CI at a defined severity threshold and blocks rather than warns.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedRequirements: [
      {
        key: 'dependency-audit',
        title: 'Known-vulnerable dependencies block the build',
        description:
          'With a documented process for accepting a finding, attributed and time-limited.',
        priority: 'MUST',
        verification: 'The audit step is part of CI and its threshold is recorded.',
      },
    ],
    emittedTasks: [
      { key: 'dependency-audit-ci', title: 'Add a dependency audit to CI', phaseKey: 'build' },
    ],
    emittedGates: [
      {
        gateKey: 'SECURITY',
        criterion: 'Dependency audit passes, or findings are formally accepted.',
        blocking: true,
      },
    ],
    rationale:
      'Most compromises arrive through a dependency nobody chose directly. An audit that only warns is an audit whose output nobody reads after the first week.',
    remediation:
      'Run the audit in CI at a threshold you will actually hold, and fail the build on it.',
    references: ['OWASP Top 10 A06:2021 Vulnerable and Outdated Components'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-DEP-002',
    version: '1.0.0',
    title: 'A dependency that is not used should be removed rather than patched',
    description: 'Unused dependencies carry the full risk of used ones and none of the benefit.',
    category: 'SECURITY',
    severity: 'RECOMMENDED',
    source: 'LEGAL_SECURITY',
    emittedTasks: [
      {
        key: 'prune-dependencies',
        title: 'Remove dependencies nothing imports',
        phaseKey: 'build',
      },
    ],
    emittedRisks: [
      {
        key: 'unused-dependency-risk',
        title: 'Unused dependencies widen the attack surface for nothing',
        description:
          'They appear in the lockfile, are installed in every environment, and can be reached by anything that resolves modules dynamically.',
        likelihood: 'MEDIUM',
        impact: 'MEDIUM',
      },
    ],
    rationale:
      'Every declared dependency is installed and present at runtime whether or not anything imports it. Removing one is strictly better than upgrading it.',
    remediation: 'Audit declared dependencies against actual imports and remove what nothing uses.',
    references: ['OWASP Top 10 A06:2021 Vulnerable and Outdated Components'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-DEP-003',
    version: '1.0.0',
    title: 'Dependencies are pinned and the lockfile is committed',
    description: 'Builds resolve the same versions today and in six months.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedRequirements: [
      {
        key: 'locked-dependencies',
        title: 'The dependency tree is reproducible',
        description: 'A committed lockfile, and CI installs from it rather than re-resolving.',
        priority: 'MUST',
        verification: 'CI uses a frozen-lockfile install.',
      },
    ],
    rationale:
      'Without a lockfile, an attacker who compromises any transitive package reaches your next build. With one, they reach the next deliberate upgrade — which someone can review.',
    remediation: 'Commit the lockfile and install with the frozen-lockfile flag in CI.',
    references: ['SLSA v1.0 Build L2: provenance and reproducibility'],
    activeFrom: ACTIVE,
  }),

  /* ------------------------------------------------------------ Rate limits */

  defineRule({
    id: 'SEC-RATE-001',
    version: '1.0.0',
    title: 'Expensive and unauthenticated actions are rate-limited',
    description:
      'Sign-in, registration, password reset, search, export and anything that triggers heavy computation.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: PUBLIC_TYPES,
    emittedRequirements: [
      {
        key: 'rate-limits',
        title: 'Costly and unauthenticated endpoints have limits',
        description:
          'Sized to stop a scripted flood without blocking legitimate use — an over-tight limit is its own outage.',
        priority: 'MUST',
        verification:
          'A test that exceeds the limit and asserts the refusal, and one that asserts normal use is unaffected.',
      },
    ],
    emittedTests: [
      {
        key: 'rate-limit-test',
        title: 'Rate limit test',
        kind: 'INTEGRATION',
        verifies: 'rate-limits',
      },
    ],
    rationale:
      'Unlimited authentication attempts make any weak password reachable. Unlimited expensive endpoints make a denial of service free.',
    remediation:
      'Add limits to authentication, registration, reset, search and export. Test both that the limit works and that ordinary use does not hit it.',
    references: ['OWASP ASVS v4 §2.2.1 Anti-automation'],
    activeFrom: ACTIVE,
  }),

  /* --------------------------------------------------------------- Logging */

  defineRule({
    id: 'SEC-AUDIT-001',
    version: '1.0.0',
    title: 'Security-relevant events are recorded and cannot be edited',
    description:
      'Authentication, authorisation failures, privilege changes and data exports are recorded append-only.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedRequirements: [
      {
        key: 'audit-trail',
        title: 'An append-only record of security-relevant events',
        description: 'Enforced by the storage layer, not by the application choosing not to write.',
        priority: 'MUST',
        verification:
          'A test that attempts to modify and delete an audit record and asserts both are refused.',
      },
    ],
    emittedTests: [
      {
        key: 'audit-immutability',
        title: 'Audit immutability test',
        kind: 'INTEGRATION',
        verifies: 'audit-trail',
      },
    ],
    rationale:
      'An audit trail the application can edit is not an audit trail. "We never call UPDATE on it" is a promise about future code, not a control on current code.',
    remediation:
      'Enforce append-only in the database with a trigger or equivalent, and test that edits are refused.',
    references: ['OWASP ASVS v4 §7.3 Log Protection'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-LOG-001',
    version: '1.0.0',
    title: 'Log values must not be able to forge log entries',
    description:
      'Any value that reaches a log line has newlines and control characters removed first.',
    category: 'SECURITY',
    severity: 'RECOMMENDED',
    source: 'LEGAL_SECURITY',
    emittedRequirements: [
      {
        key: 'log-injection',
        title: 'Untrusted values cannot inject log structure',
        description: 'Control characters stripped, and length capped.',
        priority: 'SHOULD',
        verification:
          'A test logging a value containing a newline and a forged entry, asserting the output stays one record.',
      },
    ],
    emittedTests: [
      {
        key: 'log-injection-test',
        title: 'Log injection test',
        kind: 'UNIT',
        verifies: 'log-injection',
      },
    ],
    rationale:
      'A newline in a logged value creates a second log line that looks exactly like a real one. Anyone reading the log — or any alert built on it — is then reading something an attacker wrote.',
    remediation: 'Strip control characters from logged values, and cap their length.',
    references: ['OWASP ASVS v4 §7.1.1 Log Content'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-ERR-001',
    version: '1.0.0',
    title: 'Error responses must not carry internal detail',
    description:
      'Stack traces, query text and internal identifiers stay in the logs. The response carries a correlation id.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ALL_WEB,
    emittedRequirements: [
      {
        key: 'safe-errors',
        title: 'Responses expose nothing about the internals',
        description:
          'One safe message plus a correlation id that ties it to the full detail in the log.',
        priority: 'MUST',
        verification:
          'A test asserting a triggered error returns no stack trace, query or internal path.',
      },
    ],
    emittedTests: [
      {
        key: 'error-disclosure-test',
        title: 'Error disclosure test',
        kind: 'INTEGRATION',
        verifies: 'safe-errors',
      },
    ],
    rationale:
      'Error output is the most reliable source of internal structure an attacker has, and it is produced by the system voluntarily at exactly the moment something unexpected is happening.',
    remediation: 'Return a safe message and a correlation id; keep detail server-side.',
    references: ['OWASP ASVS v4 §7.4 Error Handling'],
    activeFrom: ACTIVE,
  }),

  /* -------------------------------------------------------- Process and AI */

  defineRule({
    id: 'SEC-THREAT-001',
    version: '1.0.0',
    title: 'A threat model exists before the security work is planned',
    description:
      'What is being protected, from whom, and what would be unacceptable — written down before controls are chosen.',
    category: 'SECURITY',
    severity: 'RECOMMENDED',
    source: 'LEGAL_SECURITY',
    projectTypeScope: PUBLIC_TYPES,
    emittedTasks: [{ key: 'threat-model', title: 'Write the threat model', phaseKey: 'design' }],
    emittedGates: [
      { gateKey: 'ARCHITECTURE', criterion: 'A threat model exists.', blocking: false },
    ],
    rationale:
      'Controls chosen without a threat model tend to cluster around whatever the team already knows how to do, and leave the actual exposure untouched.',
    remediation:
      'Write down the assets, the plausible attackers, the entry points and the unacceptable outcomes.',
    references: ['NCSC: Threat modelling guidance'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-AI-001',
    version: '1.0.0',
    title: 'AI output is untrusted input',
    description:
      'Anything a model produces is validated exactly as strictly as a request from the public internet.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ['AI_ENABLED_WEB_APP'],
    emittedRequirements: [
      {
        key: 'ai-output-validated',
        title: 'Model output is schema-validated before use',
        description:
          'It is never executed, never interpolated into a query or a command, and never rendered as markup.',
        priority: 'MUST',
        verification:
          'A test feeding adversarial model output through the boundary and asserting refusal.',
      },
    ],
    emittedTests: [
      {
        key: 'ai-output-test',
        title: 'Model output validation test',
        kind: 'SECURITY',
        verifies: 'ai-output-validated',
      },
    ],
    rationale:
      'A model’s output is influenced by its input, and its input often includes text from users. Treating output as trusted turns prompt injection into whatever the output is used for.',
    remediation:
      'Validate model output against a strict schema and never execute or render it directly.',
    references: ['OWASP Top 10 for LLM Applications LLM01: Prompt Injection'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-AI-002',
    version: '1.0.0',
    title: 'What is sent to a model leaves the boundary',
    description:
      'Any data included in a prompt has left your control. The user should be told what is going before it goes.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ['AI_ENABLED_WEB_APP'],
    emittedRequirements: [
      {
        key: 'ai-egress-disclosed',
        title: 'Data sent to a model is disclosed and minimised',
        description:
          'Sensitive categories are removed, and what remains is shown before it is sent.',
        priority: 'MUST',
        verification: 'A test asserting sensitive values are absent from the outbound payload.',
      },
    ],
    emittedTests: [
      {
        key: 'ai-egress-test',
        title: 'Prompt egress redaction test',
        kind: 'SECURITY',
        verifies: 'ai-egress-disclosed',
      },
    ],
    rationale:
      'Prompt content may be retained, logged or used for training by the provider. Nothing can be un-sent, so the disclosure has to come before the action rather than after it.',
    remediation:
      'Redact sensitive categories from prompts, and show the user what is leaving before it does.',
    references: ['OWASP Top 10 for LLM Applications LLM06: Sensitive Information Disclosure'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-DEPLOY-001',
    version: '1.0.0',
    title: 'The application does not connect to the database as a superuser',
    description:
      'The application role has the data permissions it needs and no schema or ownership rights.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedRequirements: [
      {
        key: 'least-privilege-db',
        title: 'The database role cannot bypass its own controls',
        description: 'Neither a superuser nor the owner of the tables it queries.',
        priority: 'MUST',
        verification:
          'A check asserting the connected role is not a superuser and does not own the tables.',
      },
    ],
    emittedGates: [
      {
        gateKey: 'PRODUCTION_VERIFICATION',
        criterion: 'The application’s database role is not a superuser or table owner.',
        blocking: true,
      },
    ],
    rationale:
      'A superuser bypasses row-level security unconditionally, and a table owner bypasses its own policies unless FORCE is set. Either way the control is defined and never enforced — which is worse than having none, because it looks like protection.',
    remediation:
      'Create a role that is NOSUPERUSER and does not own the tables, grant only DML, and assert it at deployment.',
    references: [
      'PostgreSQL documentation: Row Security Policies',
      'OWASP ASVS v4 §1.2 Authentication Architecture',
    ],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-CSRF-001',
    version: '1.0.0',
    title: 'State-changing requests need cross-site request protection',
    description:
      'Cookie-authenticated actions that change state must not be triggerable from another origin.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ALL_WEB,
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedRequirements: [
      {
        key: 'csrf-protection',
        title: 'Cross-origin state changes are refused',
        description: 'SameSite cookies plus an origin check or token, verified by test.',
        priority: 'MUST',
        verification:
          'A test issuing a state-changing request from another origin and asserting refusal.',
      },
    ],
    emittedTests: [
      {
        key: 'csrf-test',
        title: 'Cross-site request forgery test',
        kind: 'SECURITY',
        verifies: 'csrf-protection',
      },
    ],
    rationale:
      'The browser attaches the session cookie to a cross-origin request automatically. Without a second signal, any page the user visits can act as them.',
    remediation:
      'Set SameSite on session cookies and verify the origin on state-changing requests.',
    references: ['OWASP ASVS v4 §4.2.2 Cross-Site Request Forgery'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-SESSION-001',
    version: '1.0.0',
    title: 'Sessions expire and can be revoked',
    description: 'A session has a maximum lifetime, an idle timeout, and can be ended server-side.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedRequirements: [
      {
        key: 'session-lifetime',
        title: 'Sessions end, and can be ended',
        description:
          'Absolute and idle limits, plus server-side revocation that takes effect immediately.',
        priority: 'MUST',
        verification: 'Tests for expiry at both limits and for immediate effect of revocation.',
      },
    ],
    emittedTests: [
      {
        key: 'session-lifetime-test',
        title: 'Session lifetime and revocation test',
        kind: 'SECURITY',
        verifies: 'session-lifetime',
      },
    ],
    rationale:
      'A session that cannot be revoked means a compromised credential stays valid until it expires, and the response to an incident becomes "wait".',
    remediation:
      'Add absolute and idle expiry, and server-side revocation. Test that revocation is immediate.',
    references: ['OWASP ASVS v4 §3.3 Session Termination'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-SESSION-002',
    version: '1.0.0',
    title: 'The session identifier changes when privilege changes',
    description: 'A new session identifier is issued on sign-in and on any elevation.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedRequirements: [
      {
        key: 'session-fixation',
        title: 'Session identifiers are regenerated on privilege change',
        description: 'So a pre-authentication identifier cannot become an authenticated one.',
        priority: 'MUST',
        verification: 'A test asserting the identifier differs before and after sign-in.',
      },
    ],
    emittedTests: [
      {
        key: 'session-fixation-test',
        title: 'Session fixation test',
        kind: 'SECURITY',
        verifies: 'session-fixation',
      },
    ],
    rationale:
      'If an attacker can set the session identifier before sign-in and it survives, they hold an authenticated session without ever having credentials.',
    remediation:
      'Regenerate the session identifier on sign-in and on elevation, and assert it in a test.',
    references: ['OWASP ASVS v4 §3.2.1 Session Binding'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-PWD-001',
    version: '1.0.0',
    title: 'Password storage and policy follow current guidance',
    description:
      'A memory-hard hash, a length minimum, a check against known-breached passwords, and no forced periodic rotation.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedRequirements: [
      {
        key: 'password-handling',
        title: 'Passwords are hashed with a memory-hard function and checked against breach lists',
        description: 'Length over composition, and no arbitrary expiry.',
        priority: 'MUST',
        verification:
          'A test asserting the stored form and that a known-breached password is refused.',
      },
    ],
    emittedTests: [
      {
        key: 'password-test',
        title: 'Password storage and policy test',
        kind: 'SECURITY',
        verifies: 'password-handling',
      },
    ],
    rationale:
      'Composition rules and forced rotation both push people towards predictable variations, which measurably weakens passwords. Length and breach-checking do the opposite.',
    remediation:
      'Use argon2 or scrypt, require length rather than character classes, check against a breach corpus, and drop periodic expiry.',
    references: [
      'NIST SP 800-63B §5.1.1 Memorized Secrets',
      'OWASP ASVS v4 §2.1 Password Security',
    ],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-RECOVERY-001',
    version: '1.0.0',
    title: 'Account recovery is as strong as authentication',
    description:
      'Recovery tokens are single-use, short-lived, and do not reveal whether an account exists.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedRequirements: [
      {
        key: 'recovery-strength',
        title: 'Recovery cannot be used to bypass authentication',
        description:
          'Single-use tokens with a short expiry, and an identical response whether or not the account exists.',
        priority: 'MUST',
        verification:
          'Tests for reuse, expiry, and identical responses for known and unknown addresses.',
      },
    ],
    emittedTests: [
      {
        key: 'recovery-test',
        title: 'Account recovery test',
        kind: 'SECURITY',
        verifies: 'recovery-strength',
      },
    ],
    rationale:
      'Recovery is an alternative way in. If it is weaker than the front door, the strength of the front door is irrelevant.',
    remediation:
      'Make tokens single-use and short-lived, and return the same response for every address.',
    references: ['OWASP ASVS v4 §2.5 Credential Recovery'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-ADMIN-001',
    version: '1.0.0',
    title: 'Administrative access is separated and recorded',
    description:
      'Administrative actions require a distinct grant, are logged individually, and are not available by default.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: [...PUBLIC_TYPES, 'INTERNAL_BUSINESS_APP'],
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedRequirements: [
      {
        key: 'admin-separation',
        title: 'Administrative capability is granted explicitly and logged',
        description:
          'Every administrative action is attributable to a person, not to a shared account.',
        priority: 'MUST',
        verification:
          'A test asserting an ordinary user cannot reach administrative endpoints, and that use is logged.',
      },
    ],
    emittedTests: [
      {
        key: 'admin-separation-test',
        title: 'Administrative separation test',
        kind: 'SECURITY',
        verifies: 'admin-separation',
      },
    ],
    rationale:
      'Shared administrative accounts make every action unattributable, which removes both deterrence and the ability to investigate afterwards.',
    remediation:
      'Grant administrative rights per person, log each use, and test that ordinary users are refused.',
    references: ['OWASP ASVS v4 §4.1.5 Access Control Failures'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-BACKUP-001',
    version: '1.0.0',
    title: 'Backups are encrypted and restoring from one has been tried',
    description: 'Backup encryption at rest, and a rehearsed restore whose result was checked.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [{ subject: 'INTAKE', key: 'data.types', operator: 'NOT_IN', value: ['None'] }],
    requiredInputs: ['data.types'],
    emittedRequirements: [
      {
        key: 'backup-restore',
        title: 'Backups are encrypted, and a restore has been performed',
        description: 'The restore is verified against expected content, not merely completed.',
        priority: 'MUST',
        verification: 'A record of a restore rehearsal and what was checked.',
      },
    ],
    emittedGates: [
      {
        gateKey: 'RELEASE_READINESS',
        criterion: 'A restore has been rehearsed and verified.',
        blocking: true,
      },
    ],
    rationale:
      'The failure mode is not the backup — it is the restore. Backups that ran nightly for years and cannot be restored are common, and only discovered when they are needed.',
    remediation:
      'Encrypt backups and rehearse a restore, checking the restored content rather than the exit code.',
    references: ['NCSC: Offline backups in an online world'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-INCIDENT-001',
    version: '1.0.0',
    title: 'There is an agreed way to handle a security incident',
    description:
      'Who is contacted, what is preserved, what is disclosed, and within what timeframe.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [
      {
        subject: 'INTAKE',
        key: 'data.types',
        operator: 'INCLUDES_ANY',
        value: ['Personal data', 'Health data', 'Payment card data', 'Financial data'],
      },
    ],
    requiredInputs: ['data.types'],
    emittedTasks: [
      { key: 'incident-plan', title: 'Write the security incident plan', phaseKey: 'release' },
    ],
    emittedGates: [
      {
        gateKey: 'OPERATIONAL_READINESS',
        criterion: 'A security incident process exists.',
        blocking: true,
      },
    ],
    rationale:
      'Breach notification obligations run to a deadline measured in hours. Working out who decides, during the incident, spends the time the deadline allows.',
    remediation:
      'Write down who is contacted, what evidence is preserved, who decides on disclosure, and the applicable deadline.',
    references: ['UK GDPR Article 33 Notification of a personal data breach'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-MFA-001',
    version: '1.0.0',
    title: 'Multi-factor authentication for privileged accounts',
    description:
      'Accounts that can change other accounts, or reach production, require a second factor.',
    category: 'SECURITY',
    severity: 'RECOMMENDED',
    source: 'LEGAL_SECURITY',
    projectTypeScope: PUBLIC_TYPES,
    conditions: [{ subject: 'INTAKE', key: 'security.authentication', operator: 'IS_TRUE' }],
    requiredInputs: ['security.authentication'],
    emittedRequirements: [
      {
        key: 'mfa-privileged',
        title: 'Privileged accounts require a second factor',
        description:
          'Including deployment and infrastructure access, not only application administrators.',
        priority: 'SHOULD',
        verification:
          'A record of which accounts require it, and a test that a privileged sign-in demands it.',
      },
    ],
    rationale:
      'Credential reuse means an unrelated breach elsewhere becomes access here. A second factor is the single control that most reliably breaks that chain.',
    remediation: 'Require a second factor for administrative and deployment access.',
    references: ['NIST SP 800-63B §4.2 Authenticator Assurance Level 2'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-CRYPTO-001',
    version: '1.0.0',
    title: 'No hand-written cryptography',
    description:
      'Use vetted, current primitives through a maintained library. Do not design a scheme.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedRequirements: [
      {
        key: 'standard-crypto',
        title: 'Cryptography uses standard primitives from a maintained library',
        description:
          'No custom constructions, no deprecated algorithms, no reused initialisation vectors.',
        priority: 'MUST',
        verification: 'A record of which primitives are used and why.',
      },
    ],
    rationale:
      'Cryptographic mistakes do not announce themselves. A scheme with a fatal flaw encrypts, decrypts and passes every functional test.',
    remediation:
      'Use a maintained library’s high-level interfaces, and record which primitives are in use.',
    references: ['OWASP ASVS v4 §6.2 Algorithms'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-SUPPLY-001',
    version: '1.0.0',
    title: 'The build pipeline is a production system',
    description:
      'Anything with deployment credentials is at least as sensitive as what it deploys to.',
    category: 'SECURITY',
    severity: 'RECOMMENDED',
    source: 'LEGAL_SECURITY',
    emittedRequirements: [
      {
        key: 'pipeline-hardening',
        title: 'CI credentials are scoped, and pipeline changes are reviewed',
        description:
          'Third-party actions are pinned, and secrets are not exposed to untrusted pull requests.',
        priority: 'SHOULD',
        verification: 'A review of pipeline permissions and pinned third-party steps.',
      },
    ],
    emittedRisks: [
      {
        key: 'pipeline-compromise',
        title: 'A compromised pipeline can deploy anything',
        description:
          'It holds the credentials and the trust to ship code, which is a strictly larger capability than any single application account.',
        likelihood: 'LOW',
        impact: 'HIGH',
      },
    ],
    rationale:
      'A pipeline that can deploy to production is a path to production that bypasses code review if it is not itself reviewed.',
    remediation:
      'Scope CI credentials narrowly, pin third-party steps, and review pipeline changes as code.',
    references: ['SLSA v1.0 Build track', 'OWASP Top 10 CI/CD Security Risks'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-CONFIG-001',
    version: '1.0.0',
    title: 'Configuration is validated at startup, not discovered at runtime',
    description:
      'Required settings are checked when the process starts, and the process refuses to serve without them.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    emittedRequirements: [
      {
        key: 'config-validation',
        title: 'Missing or invalid configuration prevents startup',
        description:
          'Including secrets, connection strings and any flag that changes security behaviour.',
        priority: 'MUST',
        verification:
          'A test that starts with a missing required setting and asserts the process refuses.',
      },
    ],
    emittedTests: [
      {
        key: 'config-validation-test',
        title: 'Configuration validation test',
        kind: 'UNIT',
        verifies: 'config-validation',
      },
    ],
    rationale:
      'A security setting read lazily is a security setting that is absent until the first request needs it — and a deployment with it missing looks healthy until then.',
    remediation: 'Validate the whole configuration at startup and fail loudly.',
    references: ['OWASP ASVS v4 §14.1.1 Build Process'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-ENV-001',
    version: '1.0.0',
    title: 'Production data does not go into other environments',
    description: 'Development and test environments use synthetic or anonymised data.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    conditions: [
      {
        subject: 'INTAKE',
        key: 'data.types',
        operator: 'INCLUDES_ANY',
        value: ['Personal data', 'Health data', 'Financial data', 'Payment card data'],
      },
    ],
    requiredInputs: ['data.types'],
    emittedRequirements: [
      {
        key: 'no-prod-data-downstream',
        title: 'Non-production environments hold no production personal data',
        description:
          'Synthetic data, or anonymisation that has been checked for re-identification.',
        priority: 'MUST',
        verification: 'A record of how non-production data is generated.',
      },
    ],
    rationale:
      'Non-production environments have weaker access control, wider access lists and less monitoring. Copying production data there multiplies the exposure while removing the protection.',
    remediation:
      'Generate synthetic data for development and test, or anonymise properly and check the result.',
    references: ['UK GDPR Article 5(1)(f) Integrity and confidentiality'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-API-001',
    version: '1.0.0',
    title: 'Public APIs need documented authentication and versioning',
    description:
      'An API with consumers outside the team needs a stated auth model, a versioning policy and a deprecation path.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ['API_BACKEND_PLATFORM'],
    emittedRequirements: [
      {
        key: 'api-contract',
        title: 'The API states how it authenticates and how it changes',
        description:
          'Including how a breaking change is announced and how long old versions are supported.',
        priority: 'MUST',
        verification:
          'Published documentation covering authentication, versioning and deprecation.',
      },
    ],
    rationale:
      'Once consumers depend on an interface, changing it breaks systems you do not control. An undocumented deprecation policy means every change is a breaking one for somebody.',
    remediation:
      'Document the authentication model, the versioning scheme and the deprecation timeline.',
    references: ['OWASP API Security Top 10 API9:2023 Improper Inventory Management'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-MOBILE-001',
    version: '1.0.0',
    title: 'A mobile app cannot keep a secret',
    description:
      'Anything shipped in the binary is readable. API keys and business rules must not depend on being hidden there.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ['MOBILE_APP'],
    emittedRequirements: [
      {
        key: 'no-client-secrets',
        title: 'No secret or authorisation decision lives in the app binary',
        description: 'Every rule that matters is enforced server-side.',
        priority: 'MUST',
        verification: 'A review of what the binary contains, and server-side tests for each rule.',
      },
    ],
    emittedRisks: [
      {
        key: 'binary-extraction',
        title: 'Anything in the app is available to anyone who has it',
        description:
          'Extracting strings from a published binary takes minutes and no special access.',
        likelihood: 'HIGH',
        impact: 'MEDIUM',
      },
    ],
    rationale:
      'A published app is distributed to everyone including the people you are defending against. Obfuscation raises the time cost slightly and changes nothing structurally.',
    remediation: 'Move every secret and every authorisation decision to the server.',
    references: ['OWASP MASVS v2 §RESILIENCE'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-REVIEW-001',
    version: '1.0.0',
    title: 'Security-relevant changes are reviewed by someone else',
    description:
      'Changes to authentication, authorisation, cryptography or data handling need a second reader.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'ORGANIZATION_POLICY',
    emittedGates: [
      {
        gateKey: 'DEVELOPMENT',
        criterion: 'Security-relevant changes have a recorded second review.',
        blocking: true,
      },
    ],
    rationale:
      'These are the changes where a subtle error has the largest consequence and the smallest visible symptom. They are also the ones most likely to be written under pressure.',
    remediation:
      'Require review on the paths that touch authentication, authorisation, crypto and personal data.',
    references: ['OWASP ASVS v4 §1.1.4 Secure Development Lifecycle'],
    activeFrom: ACTIVE,
  }),

  defineRule({
    id: 'SEC-DOS-001',
    version: '1.0.0',
    title: 'Payload size and recursion depth are bounded',
    description: 'Anything parsing external input caps its size and refuses unbounded nesting.',
    category: 'SECURITY',
    severity: 'MANDATORY',
    source: 'LEGAL_SECURITY',
    projectTypeScope: ALL_WEB,
    emittedRequirements: [
      {
        key: 'bounded-parsing',
        title: 'External input has size and depth limits',
        description: 'Checked against the raw bytes before parsing, not after.',
        priority: 'MUST',
        verification: 'Tests sending an oversized payload and a deeply nested one.',
      },
    ],
    emittedTests: [
      {
        key: 'payload-limits-test',
        title: 'Payload size and depth test',
        kind: 'SECURITY',
        verifies: 'bounded-parsing',
      },
    ],
    rationale:
      'Unbounded parsing turns a single request into memory exhaustion, and recursive traversal of attacker-controlled depth into a stack overflow. Both are free to send.',
    remediation:
      'Cap request size before parsing, and use iterative traversal for user-supplied structures.',
    references: [
      'OWASP ASVS v4 §12.1 File Upload',
      'OWASP API Security Top 10 API4:2023 Unrestricted Resource Consumption',
    ],
    activeFrom: ACTIVE,
  }),
];
