import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintMigrations } from "./migration-lint";

const file = (name: string, sql: string) => ({ name, sql });
const rulesOf = (files: { name: string; sql: string }[]) =>
  lintMigrations(files).map((f) => f.rule);

describe("rls-enabled", () => {
  it("passes when RLS is enabled in the same migration", () => {
    const sql = `
      create table public.notes (id uuid primary key);
      alter table public.notes enable row level security;
    `;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });

  it("passes when RLS is enabled in a later migration", () => {
    const files = [
      file("001.sql", "create table public.notes (id uuid primary key);"),
      file("002.sql", "alter table public.notes enable row level security;"),
    ];
    expect(lintMigrations(files)).toEqual([]);
  });

  it("flags a table that never enables RLS", () => {
    const findings = lintMigrations([
      file("001.sql", "create table public.notes (id uuid primary key);"),
    ]);
    expect(findings).toEqual([
      {
        rule: "rls-enabled",
        file: "001.sql",
        detail: expect.stringContaining("public.notes"),
      },
    ]);
  });

  it("flags RLS enabled only in an earlier migration", () => {
    const files = [
      file("001.sql", "alter table public.notes enable row level security;"),
      file("002.sql", "create table public.notes (id uuid primary key);"),
    ];
    expect(rulesOf(files)).toEqual(["rls-enabled"]);
  });

  it("ignores tables outside the public schema", () => {
    expect(
      lintMigrations([file("001.sql", "create table private.notes (id int);")]),
    ).toEqual([]);
  });
});

describe("definer-search-path", () => {
  const definer = (header: string) => `
    create or replace function public.do_it()
    returns void
    language plpgsql
    security definer
    ${header}
    as $$
    begin
      null;
    end;
    $$;
    revoke all on function public.do_it() from public, anon;
  `;

  it("passes when search_path is pinned in the header", () => {
    expect(
      lintMigrations([file("001.sql", definer("set search_path = ''"))]),
    ).toEqual([]);
  });

  it("flags a security definer function without search_path", () => {
    const findings = lintMigrations([file("001.sql", definer(""))]);
    expect(findings).toEqual([
      {
        rule: "definer-search-path",
        file: "001.sql",
        detail: expect.stringContaining("public.do_it"),
      },
    ]);
  });

  it("does not count a search_path mentioned only in the body", () => {
    const sql = `
      create function public.do_it()
      returns void
      language plpgsql
      security definer
      as $$
      begin
        -- set search_path = ''
        null;
      end;
      $$;
      revoke all on function public.do_it() from public;
    `;
    expect(rulesOf([file("001.sql", sql)])).toEqual(["definer-search-path"]);
  });

  it("ignores security invoker functions", () => {
    const sql = `
      create function public.touch()
      returns trigger
      language plpgsql
      as $$ begin return new; end; $$;
    `;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });

  it("only considers the last definition of a redefined function", () => {
    const bad = definer("");
    const good = definer("set search_path = ''");
    expect(
      lintMigrations([file("001.sql", bad), file("002.sql", good)]),
    ).toEqual([]);
    expect(rulesOf([file("001.sql", good), file("002.sql", bad)])).toEqual([
      "definer-search-path",
    ]);
  });

  it("does not hit the semicolons inside a function body", () => {
    const sql = `
      create function public.two_steps()
      returns void
      language plpgsql
      security definer
      set search_path = ''
      as $$
      begin
        perform 1;
        perform 2;
      end;
      $$;
      revoke all on function public.two_steps() from public;
    `;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });
});

describe("no-anon-table-grants", () => {
  it("passes for authenticated grants and for revokes from anon", () => {
    const sql = `
      revoke all on public.notes from anon, authenticated;
      grant select on public.notes to authenticated;
    `;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });

  it("flags a table grant to anon", () => {
    const findings = lintMigrations([
      file("001.sql", "grant select on public.notes to anon, authenticated;"),
    ]);
    expect(findings).toEqual([
      {
        rule: "no-anon-table-grants",
        file: "001.sql",
        detail: expect.stringContaining("public.notes"),
      },
    ]);
  });

  it("flags a column-level grant to anon", () => {
    const sql = "grant update (a, b) on public.notes to anon;";
    expect(rulesOf([file("001.sql", sql)])).toEqual(["no-anon-table-grants"]);
  });

  it("flags default privileges that grant on tables to anon", () => {
    const sql =
      "alter default privileges in schema public grant select on tables to anon;";
    expect(rulesOf([file("001.sql", sql)])).toEqual(["no-anon-table-grants"]);
  });
});

describe("anon-function-allowlist", () => {
  it("passes for the allowlisted anon function", () => {
    const sql =
      "grant execute on function public.get_invite_preview(text) to anon, authenticated;";
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });

  it("passes for functions granted only to authenticated", () => {
    const sql =
      "grant execute on function public.get_thing() to authenticated;";
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });

  it("flags any other function granted to anon", () => {
    const findings = lintMigrations([
      file(
        "001.sql",
        "grant execute on function public.get_secret(uuid) to anon;",
      ),
    ]);
    expect(findings).toEqual([
      {
        rule: "anon-function-allowlist",
        file: "001.sql",
        detail: expect.stringContaining("public.get_secret"),
      },
    ]);
  });

  it("flags a blanket function grant to anon", () => {
    const sql =
      "grant execute on all functions in schema public to anon, authenticated;";
    expect(rulesOf([file("001.sql", sql)])).toEqual([
      "anon-function-allowlist",
    ]);
  });

  it("reads quoted role names", () => {
    const sql = 'grant execute on function public.get_secret(uuid) to "anon";';
    expect(rulesOf([file("001.sql", sql)])).toEqual([
      "anon-function-allowlist",
    ]);
  });

  it("is not fooled by an allowlisted name in another schema", () => {
    const sql =
      "grant execute on function other.get_invite_preview(text) to anon;";
    expect(rulesOf([file("001.sql", sql)])).toEqual([
      "anon-function-allowlist",
    ]);
  });
});

describe("no-broad-public-execute", () => {
  const fn = `
    create function public.do_it()
    returns void
    language sql
    security definer
    set search_path = ''
    as $$ select 1; $$;
  `;

  it("passes when revoked from public in the same migration", () => {
    const sql = `${fn} revoke all on function public.do_it() from public, anon;`;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });

  it("passes when revoked in a later migration", () => {
    const files = [
      file("001.sql", fn),
      file("002.sql", "revoke all on function public.do_it() from public;"),
    ];
    expect(lintMigrations(files)).toEqual([]);
  });

  it("passes for trigger functions that are revoked", () => {
    const sql = `
      create function public.on_change()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $$ begin return new; end; $$;
      revoke all on function public.on_change() from public, anon, authenticated;
    `;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });

  it("flags a definer function that is never revoked", () => {
    expect(lintMigrations([file("001.sql", fn)])).toEqual([
      {
        rule: "no-broad-public-execute",
        file: "001.sql",
        detail: expect.stringContaining("public.do_it"),
      },
    ]);
  });

  it("flags a revoke that leaves out public", () => {
    const sql = `${fn} revoke all on function public.do_it() from anon;`;
    expect(rulesOf([file("001.sql", sql)])).toEqual([
      "no-broad-public-execute",
    ]);
  });

  it("ignores a security definer function that was dropped", () => {
    const sql = `${fn} drop function public.do_it();`;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });
});

describe("no-using-true", () => {
  it("passes for a scoped policy", () => {
    const sql = `
      create policy "own rows" on public.notes for select to authenticated
        using ((select auth.uid()) = user_id);
    `;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });

  it("flags using (true)", () => {
    const sql = `
      create policy "everyone" on public.notes for select to authenticated
        using (true);
    `;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([
      {
        rule: "no-using-true",
        file: "001.sql",
        detail: expect.stringContaining("everyone"),
      },
    ]);
  });

  it("flags with check (true), in any case or spacing", () => {
    const sql = `
      create policy "anyone writes" on public.notes for insert to authenticated
        WITH CHECK ( true );
    `;
    expect(rulesOf([file("001.sql", sql)])).toEqual(["no-using-true"]);
  });

  it("ignores true appearing in a comment", () => {
    const sql = `
      -- do not use (true) here
      create policy "own rows" on public.notes for select to authenticated
        using ((select auth.uid()) = user_id);
    `;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });
});

describe("attributes after the function body", () => {
  it("sees security definer written after the body", () => {
    const sql = `
      create function public.f() returns int as $$ select 1 $$
        language sql security definer;
      revoke all on function public.f() from public;
    `;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([
      {
        rule: "definer-search-path",
        file: "001.sql",
        detail: expect.stringContaining("public.f"),
      },
    ]);
  });

  it("passes when search_path is pinned after the body", () => {
    const sql = `
      create function public.f() returns int as $$ select 1 $$
        language sql security definer set search_path = '';
      revoke all on function public.f() from public;
    `;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });

  it("runs the revoke rule on a function whose attributes follow the body", () => {
    const sql = `
      create function public.f() returns int as $$ select 1 $$
        language sql security definer set search_path = '';
    `;
    expect(rulesOf([file("001.sql", sql)])).toEqual([
      "no-broad-public-execute",
    ]);
  });

  it("does not count a search_path that appears only in a tagged body", () => {
    const sql = `
      create function public.f() returns void language plpgsql security definer
      as $f1$
      begin
        set search_path = '';
        perform 1;
      end;
      $f1$;
      revoke all on function public.f() from public;
    `;
    expect(rulesOf([file("001.sql", sql)])).toEqual(["definer-search-path"]);
  });

  it("keeps a body with a digit tag and semicolons in one statement", () => {
    const sql = `
      create function public.f() returns void language plpgsql security definer
      set search_path = ''
      as $body2$ begin perform 1; perform 2; end; $body2$;
      revoke all on function public.f() from public;
    `;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });
});

describe("rls-enabled ordering", () => {
  const created = "create table public.notes (id int);";

  it("flags RLS that is disabled again after being enabled", () => {
    const sql = `${created}
      alter table public.notes enable row level security;
      alter table public.notes disable row level security;`;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([
      {
        rule: "rls-enabled",
        file: "001.sql",
        detail: expect.stringContaining("public.notes"),
      },
    ]);
  });

  it("flags a disable in a later migration", () => {
    const files = [
      file(
        "001.sql",
        `${created} alter table public.notes enable row level security;`,
      ),
      file("002.sql", "alter table public.notes disable row level security;"),
    ];
    expect(rulesOf(files)).toEqual(["rls-enabled"]);
  });

  it("passes when RLS is disabled and then enabled again", () => {
    const sql = `${created}
      alter table public.notes disable row level security;
      alter table public.notes enable row level security;`;
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });
});

describe("revoke coverage is ordered", () => {
  const fn = `
    create function public.f() returns int language sql security definer
    set search_path = '' as $$ select 1 $$;
  `;
  const revoke = "revoke all on function public.f() from public;";

  it("flags a function dropped and recreated without a new revoke", () => {
    const files = [
      file("001.sql", `${fn} ${revoke}`),
      file("002.sql", `drop function public.f(); ${fn}`),
    ];
    expect(lintMigrations(files)).toEqual([
      {
        rule: "no-broad-public-execute",
        file: "002.sql",
        detail: expect.stringContaining("public.f"),
      },
    ]);
  });

  it("passes when the recreated function is revoked again", () => {
    const files = [
      file("001.sql", `${fn} ${revoke}`),
      file("002.sql", `drop function public.f(); ${fn} ${revoke}`),
    ];
    expect(lintMigrations(files)).toEqual([]);
  });

  it("keeps the revoke across create or replace", () => {
    const files = [
      file("001.sql", `${fn} ${revoke}`),
      file(
        "002.sql",
        fn.replace("create function", "create or replace function"),
      ),
    ];
    expect(lintMigrations(files)).toEqual([]);
  });

  it("flags a later grant of execute to public", () => {
    const files = [
      file("001.sql", `${fn} ${revoke}`),
      file("002.sql", "grant execute on function public.f() to public;"),
    ];
    expect(rulesOf(files)).toContain("no-broad-public-execute");
  });

  it("flags a revoke that comes before the function is created", () => {
    expect(rulesOf([file("001.sql", `${revoke} ${fn}`)])).toEqual([
      "no-broad-public-execute",
    ]);
  });
});

describe("grants to public", () => {
  it("flags a table grant to public", () => {
    const sql = "grant select on public.notes to public;";
    expect(rulesOf([file("001.sql", sql)])).toEqual(["no-anon-table-grants"]);
  });

  it("flags a quoted public in a role list", () => {
    const sql = 'grant select on public.notes to authenticated, "public";';
    expect(rulesOf([file("001.sql", sql)])).toEqual(["no-anon-table-grants"]);
  });

  it("flags a function grant to public that is not allowlisted", () => {
    const sql = "grant execute on function public.get_secret(uuid) to public;";
    expect(rulesOf([file("001.sql", sql)])).toEqual([
      "anon-function-allowlist",
    ]);
  });

  it("flags a blanket function grant to public", () => {
    const sql = "grant execute on all functions in schema public to public;";
    expect(rulesOf([file("001.sql", sql)])).toEqual([
      "anon-function-allowlist",
    ]);
  });

  it("passes for the allowlisted function granted to public", () => {
    const sql =
      "grant execute on function public.get_invite_preview(text) to public;";
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });
});

describe("function names without argument lists", () => {
  it("flags a grant to anon written without parentheses", () => {
    const sql = "grant execute on function public.get_secret to anon;";
    expect(lintMigrations([file("001.sql", sql)])).toEqual([
      {
        rule: "anon-function-allowlist",
        file: "001.sql",
        detail: expect.stringContaining("public.get_secret"),
      },
    ]);
  });

  it("passes for the allowlisted function without parentheses", () => {
    const sql = "grant execute on function public.get_invite_preview to anon;";
    expect(lintMigrations([file("001.sql", sql)])).toEqual([]);
  });

  it("flags a grant to anon when no function name can be read", () => {
    const sql = "grant execute on function (uuid) to anon;";
    expect(lintMigrations([file("001.sql", sql)])).toEqual([
      {
        rule: "anon-function-allowlist",
        file: "001.sql",
        detail: expect.stringContaining("function (uuid)"),
      },
    ]);
  });

  it("reads a revoke and a drop written without parentheses", () => {
    const fn = `
      create function public.f() returns int language sql security definer
      set search_path = '' as $$ select 1 $$;
    `;
    expect(
      lintMigrations([
        file("001.sql", `${fn} revoke all on function public.f from public;`),
      ]),
    ).toEqual([]);
    expect(
      lintMigrations([file("001.sql", `${fn} drop function public.f;`)]),
    ).toEqual([]);
  });
});

describe("overloaded-function", () => {
  const make = (args: string) => `
    create function public.f(${args}) returns int language sql
    security definer set search_path = '' as $$ select 1 $$;
  `;
  const revokes = `
    revoke all on function public.f(int) from public;
    revoke all on function public.f(text) from public;
  `;

  it("flags one name created with two argument lists", () => {
    const files = [
      file("001.sql", make("a int")),
      file("002.sql", `${make("a text")} ${revokes}`),
    ];
    expect(lintMigrations(files)).toEqual([
      {
        rule: "overloaded-function",
        file: "002.sql",
        detail: expect.stringContaining("public.f"),
      },
    ]);
  });

  it("passes when the same argument list is replaced", () => {
    const files = [
      file(
        "001.sql",
        `${make("a int")} revoke all on function public.f(int) from public;`,
      ),
      file(
        "002.sql",
        make("a int").replace("create function", "create or replace function"),
      ),
    ];
    expect(lintMigrations(files)).toEqual([]);
  });

  it("passes when the old version is dropped before the new one", () => {
    const files = [
      file("001.sql", make("a int")),
      file(
        "002.sql",
        `drop function public.f(int); ${make("a text")} revoke all on function public.f(text) from public;`,
      ),
    ];
    expect(lintMigrations(files)).toEqual([]);
  });
});

describe("real migrations", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(dir, name), "utf8") }));

  it("finds the migration files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("have no lint findings", () => {
    expect(lintMigrations(files)).toEqual([]);
  });

  // The linter must actually see the real statement shapes. Each test below
  // damages a copy of the real migrations in memory and expects the matching
  // finding, so a rule that silently matches nothing would fail here.
  const migration = (suffix: string) => {
    const found = files.find((f) => f.name.endsWith(suffix));
    if (!found) throw new Error(`no migration ending in ${suffix}`);
    return found.name;
  };

  /** Copy of the real files with one file's SQL rewritten; the edit must bite. */
  const mutate = (name: string, edit: (sql: string) => string) =>
    files.map((f) => {
      if (f.name !== name) return f;
      const sql = edit(f.sql);
      expect(sql).not.toBe(f.sql);
      return { name: f.name, sql };
    });

  /** Removes the first `target` found at or after `anchor`. */
  const removeAfter = (sql: string, anchor: string, target: string) => {
    const from = sql.indexOf(anchor);
    expect(from).toBeGreaterThanOrEqual(0);
    const at = sql.indexOf(target, from);
    expect(at).toBeGreaterThanOrEqual(0);
    return sql.slice(0, at) + sql.slice(at + target.length);
  };

  it("flags a table whose enable row level security line is removed", () => {
    const name = migration("_hardening.sql");
    const damaged = mutate(name, (sql) =>
      sql.replace(
        "alter table public.analytics_events enable row level security;",
        "",
      ),
    );
    expect(lintMigrations(damaged)).toEqual([
      {
        rule: "rls-enabled",
        file: name,
        detail: expect.stringContaining("public.analytics_events"),
      },
    ]);
  });

  it("flags RLS removed from a table in an early migration", () => {
    const name = migration("_account_foundation.sql");
    const damaged = mutate(name, (sql) =>
      sql.replace("alter table public.consents enable row level security;", ""),
    );
    expect(lintMigrations(damaged)).toEqual([
      {
        rule: "rls-enabled",
        file: name,
        detail: expect.stringContaining("public.consents"),
      },
    ]);
  });

  it("flags a security definer function whose search_path is removed", () => {
    const name = migration("_hardening.sql");
    const damaged = mutate(name, (sql) =>
      removeAfter(
        sql,
        "create or replace function public.rls_audit()",
        "set search_path = ''",
      ),
    );
    expect(lintMigrations(damaged)).toEqual([
      {
        rule: "definer-search-path",
        file: name,
        detail: expect.stringContaining("public.rls_audit"),
      },
    ]);
  });

  it("judges a redefined function by its last definition only", () => {
    const anchor = "create or replace function public.end_relationship(";
    const early = migration("_partner_synastry.sql");
    const late = migration("_reports_ai.sql");

    // Damaging the superseded Sprint 3 definition changes nothing.
    const superseded = mutate(early, (sql) =>
      removeAfter(sql, anchor, "set search_path = ''"),
    );
    expect(lintMigrations(superseded)).toEqual([]);

    // Damaging the final Sprint 4 definition is caught, and blamed on Sprint 4.
    const final = mutate(late, (sql) =>
      removeAfter(sql, anchor, "set search_path = ''"),
    );
    expect(lintMigrations(final)).toEqual([
      {
        rule: "definer-search-path",
        file: late,
        detail: expect.stringContaining("public.end_relationship"),
      },
    ]);
  });

  it("flags a security definer function whose revoke from public is removed", () => {
    const name = migration("_hardening.sql");
    const damaged = mutate(name, (sql) =>
      sql.replace(
        "revoke all on function public.rls_audit() from public, anon, authenticated;",
        "",
      ),
    );
    expect(lintMigrations(damaged)).toEqual([
      {
        rule: "no-broad-public-execute",
        file: name,
        detail: expect.stringContaining("public.rls_audit"),
      },
    ]);
  });

  it("reads revokes that span several lines and live in other migrations", () => {
    // handle_relationship_member_deleted is revoked on one line in Sprint 4 and
    // on two lines in Sprint 3. Removing the Sprint 4 revoke leaves the Sprint 3
    // one standing; removing both leaves the function exposed.
    const revoke =
      /revoke all on function public\.handle_relationship_member_deleted\(\)\s+from public, anon, authenticated;/;
    const early = migration("_partner_synastry.sql");
    const late = migration("_reports_ai.sql");
    const withoutLate = mutate(late, (sql) => sql.replace(revoke, ""));
    expect(lintMigrations(withoutLate)).toEqual([]);

    const withoutBoth = withoutLate.map((f) =>
      f.name === early ? { ...f, sql: f.sql.replace(revoke, "") } : f,
    );
    expect(withoutBoth.find((f) => f.name === early)?.sql).not.toMatch(revoke);
    expect(lintMigrations(withoutBoth)).toEqual([
      {
        rule: "no-broad-public-execute",
        file: late,
        detail: expect.stringContaining(
          "public.handle_relationship_member_deleted",
        ),
      },
    ]);
  });

  it("flags a multi-line table grant that gains anon", () => {
    const name = migration("_partner_synastry.sql");
    const damaged = mutate(name, (sql) =>
      sql.replace(
        /public\.synastry\s+to authenticated;/,
        "public.synastry to anon, authenticated;",
      ),
    );
    expect(lintMigrations(damaged)).toEqual([
      {
        rule: "no-anon-table-grants",
        file: name,
        detail: expect.stringContaining("public.synastry"),
      },
    ]);
  });

  it("flags a function grant that gains anon outside the allowlist", () => {
    const name = migration("_partner_synastry.sql");
    const damaged = mutate(name, (sql) =>
      sql.replace(
        "grant execute on function public.get_my_relationship() to authenticated;",
        "grant execute on function public.get_my_relationship() to anon, authenticated;",
      ),
    );
    expect(lintMigrations(damaged)).toEqual([
      {
        rule: "anon-function-allowlist",
        file: name,
        detail: expect.stringContaining("public.get_my_relationship"),
      },
    ]);
  });

  it("flags a real policy that is turned into using (true)", () => {
    const name = migration("_account_foundation.sql");
    const damaged = mutate(name, (sql) =>
      sql.replace("using ((select auth.uid()) = id)", "using (true)"),
    );
    expect(lintMigrations(damaged)).toEqual([
      {
        rule: "no-using-true",
        file: name,
        detail: expect.stringContaining(
          "Users can view their own profile".toLowerCase(),
        ),
      },
    ]);
  });
});
