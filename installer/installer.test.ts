/** The installer's files are well formed (#26). The build itself runs with `pnpm --filter @safecontext/installer build`. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = import.meta.dirname;
const shellScripts = [
  "payload/bin/safecontext",
  "payload/uninstall.sh",
  "scripts/preinstall",
  "scripts/postinstall",
];

describe("installer files", () => {
  it.each(shellScripts)("%s is valid sh", (file) => {
    expect(() =>
      execFileSync("/bin/sh", ["-n", join(here, file)]),
    ).not.toThrow();
  });

  it.runIf(process.platform === "darwin")(
    "the LaunchAgent and entitlements are valid plists",
    () => {
      for (const file of [
        "payload/LaunchAgents/com.safecontext.agent.plist",
        "entitlements.plist",
      ]) {
        expect(() =>
          execFileSync("/usr/bin/plutil", ["-lint", join(here, file)]),
        ).not.toThrow();
      }
    },
  );

  it("the LaunchAgent runs the installed command, and the postinstall links the same path", () => {
    const plist = readFileSync(
      join(here, "payload/LaunchAgents/com.safecontext.agent.plist"),
      "utf8",
    );
    const post = readFileSync(join(here, "scripts/postinstall"), "utf8");
    expect(plist).toContain(
      "<string>/Library/Application Support/SafeContext/bin/safecontext</string>",
    );
    expect(post).toContain('app="/Library/Application Support/SafeContext"');
    expect(post).toContain(
      'ln -sf "$app/bin/safecontext" /usr/local/bin/safecontext',
    );
  });

  it("the Homebrew formula has every placeholder the build fills in", () => {
    const formula = readFileSync(join(here, "homebrew/safecontext.rb"), "utf8");
    for (const p of ["{{version}}", "{{sha256}}", "{{tarball}}"])
      expect(formula).toContain(p);
    expect(formula).toContain('run [opt_bin/"safecontext", "run"]');
  });
});
