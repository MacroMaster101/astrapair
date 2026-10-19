/**
 * Static lint for Supabase migrations. It reads SQL text only and uses plain
 * regexes over a statement split that understands comments, quotes and
 * dollar-quoted function bodies. It is a guard rail for the security rules the
 * database relies on, not a SQL parser.
 *
 * Statements are replayed in the order the migrations apply, so the last
 * definition, the last row level security setting and the last revoke or grant
 * win. Functions are matched by schema and name; a name created with two
 * argument lists is reported as `overloaded-function` for a human to check.
 * Grants to `public` are treated like grants to `anon`.
 *
 * Known limits: dynamic SQL inside `do` blocks and function bodies is not
 * inspected, and `create procedure` is not checked.
 */

export type MigrationFile = { name: string; sql: string };

export type LintFinding = { rule: string; file: string; detail: string };

/** Functions that anonymous (signed-out) callers may execute. */
export const ANON_FUNCTION_ALLOWLIST: readonly string[] = [
  "public.get_invite_preview",
];

type Statement = { file: string; fileIndex: number; text: string };

/**
 * Splits SQL into statements on `;` outside comments, quotes and dollar-quoted
 * bodies. Comments are dropped; whitespace is collapsed and text lower-cased.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  const flush = () => {
    const text = current.replace(/\s+/g, " ").trim().toLowerCase();
    if (text) statements.push(text);
    current = "";
  };

  // Copies sql[i..] through the first occurrence of `end` at or after `from`.
  const copyThrough = (end: string, from: number) => {
    const close = sql.indexOf(end, from);
    const stop = close === -1 ? sql.length : close + end.length;
    current += sql.slice(i, stop);
    i = stop;
  };

  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);

    if (two === "--") {
      const newline = sql.indexOf("\n", i);
      i = newline === -1 ? sql.length : newline;
      current += " ";
    } else if (two === "/*") {
      const close = sql.indexOf("*/", i + 2);
      i = close === -1 ? sql.length : close + 2;
      current += " ";
    } else if (ch === "'") {
      // A doubled quote inside a string reads as close-then-reopen, which is
      // equivalent for our purposes.
      copyThrough("'", i + 1);
    } else if (ch === '"') {
      copyThrough('"', i + 1);
    } else if (ch === "$") {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i))?.[0];
      if (tag) copyThrough(tag, i + tag.length);
      else {
        current += ch;
        i += 1;
      }
    } else if (ch === ";") {
      flush();
      i += 1;
    } else {
      current += ch;
      i += 1;
    }
  }
  flush();
  return statements;
}

/** Lower-case identifier with quotes removed; unqualified names mean public. */
function qualify(identifier: string): string {
  const name = identifier.replace(/"/g, "");
  return name.includes(".") ? name : `public.${name}`;
}

/** Role names from a comma-separated list, lower-case with quotes removed. */
function roleList(list: string): string[] {
  return list.split(",").map((r) => r.trim().replace(/"/g, ""));
}

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Qualified names in a list of functions. The argument list is optional
 * (`public.f(text), public.g`), as Postgres allows when a name is unique.
 */
function functionNames(list: string): string[] {
  return splitTopLevel(list)
    .map((item) => /^([\w."]+)/.exec(item.trim())?.[1])
    .filter((name): name is string => Boolean(name))
    .map(qualify);
}

/** The statement with every dollar-quoted body cut out. */
function withoutBodies(text: string): string {
  return text.replace(/\$([a-z_]\w*)?\$[\s\S]*?\$\1\$/g, " ");
}

/** The text between the parenthesis at `open` and its partner. */
function parenthesised(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    if (text[i] === ")") depth -= 1;
    if (depth === 0) return text.slice(open + 1, i).replace(/\s*,\s*/g, ",");
  }
  return text.slice(open + 1);
}

function parse(files: MigrationFile[]): Statement[] {
  return files.flatMap((f, fileIndex) =>
    splitStatements(f.sql).map((text) => ({ file: f.name, fileIndex, text })),
  );
}

type Grant = {
  file: string;
  privileges: string;
  target: string;
  roles: string[];
};

/** Parses `grant <privileges> on <target> to <roles>`, default privileges too. */
function parseGrant(s: Statement): Grant | undefined {
  if (!s.text.startsWith("grant ") && !s.text.startsWith("alter default")) {
    return undefined;
  }
  const m =
    /(?:^|\s)grant\s+(.+?)\s+on\s+(.+?)\s+to\s+(.+?)(?:\s+with grant option)?$/.exec(
      s.text,
    );
  if (!m) return undefined;
  return {
    file: s.file,
    privileges: m[1],
    target: m[2],
    roles: roleList(m[3]),
  };
}

const isFunctionTarget = (target: string) =>
  /^(function\b|functions$|all functions\b)/.test(target);

/** Roles whose grants make an object reachable by signed-out callers. */
const openRoles = (g: Grant) =>
  g.roles.filter((r) => r === "anon" || r === "public");

type FunctionState = {
  file: string;
  /** The statement without its body: attributes may come before or after it. */
  header: string;
  /** Normalised argument list, used to spot overloads. */
  signature: string;
  /** True while execute is revoked from public since the last (re)creation. */
  revoked: boolean;
};

/**
 * Replays function statements in the order they are applied. Gives the final
 * state of each function, and a finding for any name created with two
 * different argument lists (overloads are not tracked, so a human looks).
 */
function trackFunctions(statements: Statement[]): {
  functions: Map<string, FunctionState>;
  findings: LintFinding[];
} {
  const functions = new Map<string, FunctionState>();
  const findings: LintFinding[] = [];

  for (const s of statements) {
    const created = /^create (or replace )?function ([\w."]+)\s*\(/.exec(
      s.text,
    );
    if (created) {
      const name = qualify(created[2]);
      const signature = parenthesised(s.text, created[0].length - 1);
      const prior = functions.get(name);
      if (prior && prior.signature !== signature) {
        findings.push({
          rule: "overloaded-function",
          file: s.file,
          detail: `${name} is created with more than one argument list (${prior.signature || "none"} and ${signature || "none"}); overloads are not tracked, check by hand`,
        });
      }
      // Replacing keeps the existing privileges; a fresh function gets the
      // default execute-for-public grant back.
      const keepsPrivileges = Boolean(
        created[1] && prior && prior.signature === signature,
      );
      functions.set(name, {
        file: s.file,
        header: withoutBodies(s.text),
        signature,
        revoked: keepsPrivileges && Boolean(prior?.revoked),
      });
      continue;
    }

    const dropped =
      /^drop function (?:if exists )?(.+?)(?: cascade| restrict)?$/.exec(
        s.text,
      );
    if (dropped) {
      for (const name of functionNames(dropped[1])) functions.delete(name);
      continue;
    }

    const revoke =
      /^revoke (?:all|execute)(?: privileges)? on function (.+?) from (.+?)(?: cascade| restrict)?$/.exec(
        s.text,
      );
    if (revoke) {
      if (roleList(revoke[2]).includes("public")) {
        for (const name of functionNames(revoke[1])) {
          const state = functions.get(name);
          if (state) state.revoked = true;
        }
      }
      continue;
    }

    const grant = parseGrant(s);
    if (grant && grant.roles.includes("public")) {
      if (grant.target.startsWith("function ")) {
        for (const name of functionNames(grant.target.slice(9))) {
          const state = functions.get(name);
          if (state) state.revoked = false;
        }
      } else if (grant.target.startsWith("all functions")) {
        for (const state of functions.values()) state.revoked = false;
      }
    }
  }
  return { functions, findings };
}

const isDefiner = (def: FunctionState) =>
  def.header.includes("security definer");

function rlsEnabled(statements: Statement[]): LintFinding[] {
  // Replay in order: the last enable or disable decides, and a table has to
  // end up enabled.
  const tables = new Map<
    string,
    { file: string; enabled: boolean; disabled: boolean }
  >();
  for (const s of statements) {
    const created =
      /^create (?:unlogged )?table (if not exists )?([\w."]+)/.exec(s.text);
    if (created) {
      const name = qualify(created[2]);
      if (!name.startsWith("public.")) continue;
      if (created[1] && tables.has(name)) continue;
      tables.set(name, { file: s.file, enabled: false, disabled: false });
      continue;
    }
    const altered =
      /^alter table (?:only )?(?:if exists )?([\w."]+) (enable|disable) row level security/.exec(
        s.text,
      );
    if (altered) {
      const table = tables.get(qualify(altered[1]));
      if (table) {
        table.enabled = altered[2] === "enable";
        table.disabled = altered[2] === "disable";
      }
      continue;
    }
    const dropped =
      /^drop table (?:if exists )?(.+?)(?: cascade| restrict)?$/.exec(s.text);
    if (dropped) {
      for (const name of functionNames(dropped[1])) tables.delete(name);
    }
  }

  const findings: LintFinding[] = [];
  for (const [name, table] of tables) {
    if (table.enabled) continue;
    findings.push({
      rule: "rls-enabled",
      file: table.file,
      detail: table.disabled
        ? `${name} has row level security disabled`
        : `${name} is created without row level security enabled`,
    });
  }
  return findings;
}

function definerSearchPath(
  functions: Map<string, FunctionState>,
): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const [name, def] of functions) {
    if (isDefiner(def) && !def.header.includes("set search_path")) {
      findings.push({
        rule: "definer-search-path",
        file: def.file,
        detail: `${name} is security definer without set search_path`,
      });
    }
  }
  return findings;
}

/** Grants (including default-privilege grants) that reach anon or public. */
function openGrants(statements: Statement[]): Grant[] {
  return statements
    .map(parseGrant)
    .filter((g): g is Grant => g !== undefined && openRoles(g).length > 0);
}

function noAnonTableGrants(grants: Grant[]): LintFinding[] {
  return grants
    .filter((g) => !isFunctionTarget(g.target))
    .map((g) => ({
      rule: "no-anon-table-grants",
      file: g.file,
      detail: `grant ${g.privileges} on ${g.target} to ${openRoles(g).join(", ")}`,
    }));
}

function anonFunctionAllowlist(grants: Grant[]): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const g of grants.filter((g) => isFunctionTarget(g.target))) {
    const to = openRoles(g).join(", ");
    const names = g.target.startsWith("function ")
      ? functionNames(g.target.slice("function ".length))
      : [];
    // A target that yields no function name must not pass unseen.
    const unparsed = names.length === 0 ? [g.target] : [];
    for (const name of [...names, ...unparsed]) {
      if (!ANON_FUNCTION_ALLOWLIST.includes(name)) {
        findings.push({
          rule: "anon-function-allowlist",
          file: g.file,
          detail: `${name} is granted to ${to} but is not on the allowlist`,
        });
      }
    }
  }
  return findings;
}

function noBroadPublicExecute(
  functions: Map<string, FunctionState>,
): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const [name, def] of functions) {
    if (name.startsWith("public.") && isDefiner(def) && !def.revoked) {
      findings.push({
        rule: "no-broad-public-execute",
        file: def.file,
        detail: `${name} is security definer and is not revoked from public since it was last created`,
      });
    }
  }
  return findings;
}

function noUsingTrue(statements: Statement[]): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const s of statements) {
    const m = /^(?:create|alter) policy ("[^"]*"|\S+)(.*)$/.exec(s.text);
    if (!m) continue;
    // Test only the clauses, not the policy name.
    if (
      /\b(?:using|with check)\s*\(\s*(?:\(\s*)*true\s*(?:\)\s*)*\)/.test(m[2])
    ) {
      findings.push({
        rule: "no-using-true",
        file: s.file,
        detail: `policy ${m[1]} uses an always-true condition`,
      });
    }
  }
  return findings;
}

/** Lints migrations given in the order they are applied. */
export function lintMigrations(files: MigrationFile[]): LintFinding[] {
  const statements = parse(files);
  const { functions, findings: overloads } = trackFunctions(statements);
  const grants = openGrants(statements);

  return [
    ...rlsEnabled(statements),
    ...definerSearchPath(functions),
    ...noAnonTableGrants(grants),
    ...anonFunctionAllowlist(grants),
    ...noBroadPublicExecute(functions),
    ...noUsingTrue(statements),
    ...overloads,
  ];
}
