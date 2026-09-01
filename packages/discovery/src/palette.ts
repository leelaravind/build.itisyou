/**
 * The command palette.
 *
 * §42 ends with a sentence that is the whole specification: *"Command palette is not a security
 * bypass."*
 *
 * It is worth saying why that needs stating. A palette is built by wiring commands to the functions
 * behind buttons, and the buttons already had their permission checks — in the *rendering*. A palette
 * that lists commands from a static array and dispatches them directly has quietly removed every one
 * of those checks, and it looks completely normal while doing it.
 *
 * So two rules hold here:
 *
 * **A command the user cannot run is not listed.** Not greyed out — absent. A disabled entry for
 * "Approve release" tells somebody a release exists and that approval is a thing that happens here,
 * which is the same disclosure a search result would be.
 *
 * **A command that needs confirmation still needs it.** The palette is a faster way to reach an
 * action, never a way to reach it with fewer questions. Archiving a project through a palette
 * archives it exactly as thoroughly as archiving it through a button.
 *
 * Contract: gap-spec §42, §7.4 (permissions matrix).
 */

import { can, type AccessContext, type Permission } from '@govintel/db/rbac';

/* -------------------------------------------------------------------------- */
/* Commands                                                                   */
/* -------------------------------------------------------------------------- */

export const COMMAND_KINDS = ['NAVIGATE', 'CREATE', 'DESTRUCTIVE'] as const;

export type CommandKind = (typeof COMMAND_KINDS)[number];

export interface Command {
  readonly id: string;
  /** What the user types or reads. */
  readonly label: string;
  readonly kind: CommandKind;
  /** The permission required. Every command has one; there is no unguarded command. */
  readonly permission: Permission;
  /** Extra words that should match this command, so people find it by what they call it. */
  readonly aliases: readonly string[];
  /**
   * Whether running this needs a confirmation step.
   *
   * The palette cannot skip it. A command reached through a palette runs through exactly the same
   * path as one reached through a button, which is what "not a security bypass" means in practice.
   */
  readonly confirms: boolean;
  /** Required when `confirms`. What the user is being asked to accept. */
  readonly confirmationAsks?: string;
}

/**
 * §42's list, plus the ones the rest of the platform actually has.
 *
 * Every entry names a permission. There is deliberately no command without one — a palette entry
 * with no permission is the bypass, and making the field required means adding a command forces
 * somebody to decide who may run it.
 */
export const COMMANDS: readonly Command[] = [
  {
    id: 'go-to-project',
    label: 'Go to project',
    kind: 'NAVIGATE',
    permission: 'project:read',
    aliases: ['open project', 'switch project'],
    confirms: false,
  },
  {
    id: 'open-task',
    label: 'Open task',
    kind: 'NAVIGATE',
    permission: 'project:read',
    aliases: ['find task', 'go to work'],
    confirms: false,
  },
  {
    id: 'create-task',
    label: 'Create task',
    kind: 'CREATE',
    permission: 'project:edit',
    aliases: ['new task', 'add work'],
    confirms: false,
  },
  {
    id: 'create-risk',
    label: 'Create risk',
    kind: 'CREATE',
    permission: 'project:edit',
    aliases: ['new risk', 'raise risk'],
    confirms: false,
  },
  {
    id: 'open-budget',
    label: 'Open budget',
    kind: 'NAVIGATE',
    permission: 'budget:read',
    aliases: ['money', 'cost', 'spend'],
    confirms: false,
  },
  {
    id: 'open-requirements',
    label: 'Open requirements',
    kind: 'NAVIGATE',
    permission: 'requirements:read',
    aliases: ['specs', 'scope'],
    confirms: false,
  },
  {
    id: 'open-gates',
    label: 'Open quality gates',
    kind: 'NAVIGATE',
    permission: 'gate:read',
    aliases: ['gates', 'release readiness', 'checks'],
    confirms: false,
  },
  {
    id: 'create-change-request',
    label: 'Create change request',
    kind: 'CREATE',
    permission: 'change_request:create',
    aliases: ['propose change', 'raise cr'],
    confirms: false,
  },
  {
    id: 'search-documents',
    label: 'Search documents',
    kind: 'NAVIGATE',
    permission: 'documents:read',
    aliases: ['find document', 'docs'],
    confirms: false,
  },
  {
    id: 'archive-project',
    label: 'Archive project',
    kind: 'DESTRUCTIVE',
    permission: 'project:archive',
    aliases: ['close project', 'finish project'],
    confirms: true,
    confirmationAsks:
      'Archiving makes this project read-only for everybody. It is not deletion and it is not reversible from the product. Archiving as *completed* additionally claims the closure criteria were met.',
  },
  {
    id: 'export-project',
    label: 'Export project',
    kind: 'DESTRUCTIVE',
    permission: 'project:export',
    aliases: ['download', 'take a copy'],
    confirms: true,
    confirmationAsks:
      'An export leaves this system with everything you can currently read in it, and nothing here can control what happens to it afterwards.',
  },
];

/* -------------------------------------------------------------------------- */
/* Filtering                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The commands this user may actually run.
 *
 * Absent rather than disabled. A greyed-out "Approve release" tells somebody a release exists and
 * that approval happens here — the same disclosure a search result would be, delivered by a control
 * they cannot press.
 */
export function availableTo(context: AccessContext): readonly Command[] {
  return COMMANDS.filter((command) => can(context, command.permission));
}

/**
 * Commands matching what the user has typed, most relevant first.
 *
 * Filtering happens before matching, for the same reason it does in search: a ranking computed over
 * commands the user cannot run lets the invisible set influence what they see.
 */
export function matchCommands(context: AccessContext, typed: string): readonly Command[] {
  const available = availableTo(context);
  const query = typed.trim().toLowerCase();

  if (query === '') return available;

  return available
    .map((command) => ({ command, score: commandScore(command, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.command.id.localeCompare(b.command.id))
    .map((entry) => entry.command);
}

function commandScore(command: Command, query: string): number {
  const label = command.label.toLowerCase();

  if (label.startsWith(query)) return 100;
  if (label.includes(query)) return 50;

  // Aliases score lower than the label but still match, so somebody who calls it "money" finds the
  // budget without having to learn what this product calls it.
  if (command.aliases.some((alias) => alias.includes(query))) return 25;

  return 0;
}

/* -------------------------------------------------------------------------- */
/* Running                                                                    */
/* -------------------------------------------------------------------------- */

export const PALETTE_REFUSALS = ['NOT_PERMITTED', 'NEEDS_CONFIRMATION', 'UNKNOWN_COMMAND'] as const;

export type PaletteRefusal = (typeof PALETTE_REFUSALS)[number];

export type Outcome =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly refusal: PaletteRefusal; readonly reason: string };

/**
 * Decide whether a command may run.
 *
 * Re-checks the permission rather than trusting that the command came from a filtered list. The list
 * is a rendering; this is the decision, and a palette that trusted its own list would be exactly the
 * bypass §42 forbids — an attacker does not have to use the list.
 */
export function run(context: AccessContext, commandId: string, confirmed: boolean): Outcome {
  const command = COMMANDS.find((c) => c.id === commandId);

  if (command === undefined) {
    return {
      ok: false,
      refusal: 'UNKNOWN_COMMAND',
      reason: `${commandId} is not a command.`,
    };
  }

  if (!can(context, command.permission)) {
    /*
     * Re-checked here even though `availableTo` already filtered.
     *
     * That filter shapes what is displayed. This is the authorisation. A palette that relied on its
     * own list would be authorising by rendering, and nobody attacking it would use the list.
     */
    return {
      ok: false,
      refusal: 'NOT_PERMITTED',
      reason: `Running "${command.label}" needs ${command.permission}.`,
    };
  }

  if (command.confirms && !confirmed) {
    return {
      ok: false,
      refusal: 'NEEDS_CONFIRMATION',
      reason:
        command.confirmationAsks ??
        'This needs confirming, and the palette is a faster way to reach an action rather than a way to reach it with fewer questions.',
    };
  }

  return { ok: true, command };
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

export const PALETTE_DEFECTS = [
  'COMMAND_WITHOUT_PERMISSION',
  'DESTRUCTIVE_WITHOUT_CONFIRMATION',
  'CONFIRMATION_WITHOUT_A_QUESTION',
] as const;

export type PaletteDefect = (typeof PALETTE_DEFECTS)[number];

export interface PaletteFinding {
  readonly defect: PaletteDefect;
  readonly commandId: string;
  readonly summary: string;
  readonly why: string;
}

/**
 * Whether the catalogue itself is safe.
 *
 * Run as a test, so adding a destructive command without a confirmation fails the build rather than
 * shipping. The most likely way §42's rule gets broken is not a deliberate bypass — it is somebody
 * adding a fifteenth command in a hurry.
 */
export function checkCommands(commands: readonly Command[]): readonly PaletteFinding[] {
  const findings: PaletteFinding[] = [];

  for (const command of commands) {
    if (command.kind === 'DESTRUCTIVE' && !command.confirms) {
      findings.push({
        defect: 'DESTRUCTIVE_WITHOUT_CONFIRMATION',
        commandId: command.id,
        summary: `${command.label} is destructive and asks nothing first.`,
        why: 'A palette is used at speed, from a keyboard, often by somebody who typed three letters and pressed enter. That is precisely the context in which an irreversible action needs a question.',
      });
    }

    if (command.confirms && (command.confirmationAsks ?? '').trim() === '') {
      findings.push({
        defect: 'CONFIRMATION_WITHOUT_A_QUESTION',
        commandId: command.id,
        summary: `${command.label} confirms without saying what it is asking.`,
        why: 'A confirmation that does not say what will happen trains people to press yes, and after that it is a keystroke rather than a decision.',
      });
    }
  }

  return findings;
}
