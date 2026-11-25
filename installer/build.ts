/**
 * Builds the Safe Context agent for macOS (Apple Silicon), issue #26:
 *
 *   dist/SafeContext-<version>.pkg                     for IT to push with Jamf, Kandji and similar
 *   dist/safecontext-<version>-darwin-arm64.tar.gz     the same files, for the Homebrew formula
 *   dist/safecontext.rb                                that formula, with the tarball's checksum
 *
 *   pnpm --filter @safecontext/installer build [--version 0.1.0] [--node /path/to/node]
 *
 * Inside: Node.js 24 (by default the one running this script), the agent bundled into two files,
 * ONNX Runtime for this platform only, the sc-extract helper, the tier 1 model (checked against
 * ml/models.lock.json; run `pnpm models:pull` first) and the tier 2 prompt files.
 *
 * Unsigned unless these are set (Joe's Apple Developer ID):
 *   SC_SIGN_APP        "Developer ID Application: …"  signs node, the add-on and the helper
 *   SC_SIGN_INSTALLER  "Developer ID Installer: …"    signs the .pkg
 *   SC_NOTARY_PROFILE  a `xcrun notarytool store-credentials` profile: notarizes and staples the .pkg
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { build } from "esbuild";

const here = import.meta.dirname;
const repo = join(here, "..");
const agentDir = join(repo, "apps/agent");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const version =
  flag("--version") ??
  (
    JSON.parse(readFileSync(join(here, "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
const nodeBin = flag("--node") ?? process.execPath;

const out = join(here, "build");
const root = join(out, "root"); // what the .pkg installs, relative to /
const app = join(root, "Library/Application Support/SafeContext");
const dist = join(here, "dist");

const run = (file: string, argv: string[], opts: { cwd?: string } = {}) =>
  execFileSync(file, argv, { stdio: "inherit", ...opts });
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const step = (text: string) => console.log(`\n▸ ${text}`);

function checkPlatform() {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("Build on an Apple Silicon Mac");
  const v = execFileSync(nodeBin, ["--version"], { encoding: "utf8" }).trim();
  if (!v.startsWith("v24."))
    throw new Error(`Node.js 24 is needed (${nodeBin} is ${v})`);
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("--version must look like 1.2.3");
}

async function bundleAgent() {
  step("Bundling the agent");
  await build({
    entryPoints: {
      agent: join(agentDir, "src/index.ts"),
      cli: join(agentDir, "src/cli.ts"),
    },
    outdir: join(app, "lib"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    // The native add-on stays a package next to the bundle (it loads its binary by path).
    external: ["onnxruntime-node"],
    // Some dependencies are CommonJS and call require().
    banner: {
      js: "import { createRequire as __scRequire } from 'node:module'; const require = __scRequire(import.meta.url);",
    },
    legalComments: "linked",
    logLevel: "warning",
  });
}

/** onnxruntime-node and what it needs at run time, with only the macOS arm64 binaries. */
function copyOnnxRuntime() {
  step("Copying ONNX Runtime (macOS arm64 only)");
  const req = createRequire(join(agentDir, "package.json"));
  const ort = dirname(req.resolve("onnxruntime-node/package.json"));
  // Its one run-time dependency. It doesn't export package.json, so find its folder from its entry.
  let common = dirname(
    createRequire(join(ort, "package.json")).resolve("onnxruntime-common"),
  );
  while (!existsSync(join(common, "package.json"))) common = dirname(common);
  const modules = join(app, "lib/node_modules");
  cpSync(ort, join(modules, "onnxruntime-node"), {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const rel = relative(ort, src);
      if (rel.startsWith("node_modules") || rel.startsWith("script"))
        return false;
      const m = /^bin\/napi-v\d+\/([^/]+)(?:\/([^/]+))?/.exec(rel);
      return (
        !m || (m[1] === "darwin" && (m[2] === undefined || m[2] === "arm64"))
      );
    },
  });
  cpSync(common, join(modules, "onnxruntime-common"), {
    recursive: true,
    dereference: true,
  });
}

function copyExtract() {
  step("Building sc-extract");
  run("pnpm", ["--filter", "@safecontext/agent", "build:extract"], {
    cwd: repo,
  });
  copyFileSync(
    join(agentDir, "native/bin/sc-extract"),
    join(app, "bin/sc-extract"),
  );
  chmodSync(join(app, "bin/sc-extract"), 0o755);
}

/** The pinned tier 1 model, each file checked against ml/models.lock.json. */
function copyModel() {
  step("Copying the tier 1 model");
  const lock = JSON.parse(
    readFileSync(join(repo, "ml/models.lock.json"), "utf8"),
  ) as {
    artifacts: Array<{
      name: string;
      local_dir: string;
      files: Array<{ path: string; sha256: string }>;
    }>;
  };
  const entry = lock.artifacts.find((a) => a.name === "tier1-onnx");
  if (!entry) throw new Error("ml/models.lock.json has no tier1-onnx entry");
  const from = join(repo, "ml", entry.local_dir);
  const to = join(app, "models/tier1");
  mkdirSync(to, { recursive: true });
  for (const file of entry.files) {
    const src = join(from, file.path);
    if (!existsSync(src))
      throw new Error(`${src} is missing: run \`pnpm models:pull\` first`);
    if (sha256(src) !== file.sha256)
      throw new Error(`${file.path} doesn't match ml/models.lock.json`);
    mkdirSync(dirname(join(to, file.path)), { recursive: true });
    copyFileSync(src, join(to, file.path));
  }
}

function copyRest() {
  step("Copying Node.js, prompts and scripts");
  copyFileSync(nodeBin, join(app, "bin/node"));
  chmodSync(join(app, "bin/node"), 0o755);
  cpSync(join(repo, "ml/prompts/tier2"), join(app, "prompts/tier2"), {
    recursive: true,
  });
  copyFileSync(
    join(here, "payload/bin/safecontext"),
    join(app, "bin/safecontext"),
  );
  chmodSync(join(app, "bin/safecontext"), 0o755);
  copyFileSync(join(here, "payload/uninstall.sh"), join(app, "uninstall.sh"));
  chmodSync(join(app, "uninstall.sh"), 0o755);
  writeFileSync(join(app, "VERSION"), `${version}\n`);
  mkdirSync(join(root, "Library/LaunchAgents"), { recursive: true });
  copyFileSync(
    join(here, "payload/LaunchAgents/com.safecontext.agent.plist"),
    join(root, "Library/LaunchAgents/com.safecontext.agent.plist"),
  );
}

/** Every Mach-O binary in the app, for signing. */
function binaries(): string[] {
  const found = execFileSync(
    "/usr/bin/find",
    [
      app,
      "-type",
      "f",
      "(",
      "-name",
      "*.node",
      "-o",
      "-name",
      "*.dylib",
      "-o",
      "-perm",
      "+111",
      ")",
    ],
    {
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter(Boolean);
  return found.filter((f) =>
    execFileSync("/usr/bin/file", ["-b", f], { encoding: "utf8" }).includes(
      "Mach-O",
    ),
  );
}

function signApp() {
  const identity = process.env.SC_SIGN_APP;
  if (!identity) {
    console.log(
      "\n! SC_SIGN_APP not set: binaries stay unsigned (fine for testing, not for release)",
    );
    return;
  }
  step("Signing binaries");
  for (const file of binaries()) {
    const entitlements = file.endsWith("/bin/node")
      ? ["--entitlements", join(here, "entitlements.plist")]
      : [];
    run("/usr/bin/codesign", [
      "--force",
      "--timestamp",
      "--options",
      "runtime",
      ...entitlements,
      "--sign",
      identity,
      file,
    ]);
  }
}

function buildPkg(): string {
  step("Building the .pkg");
  mkdirSync(dist, { recursive: true });
  const pkg = join(dist, `SafeContext-${version}.pkg`);
  const signing = process.env.SC_SIGN_INSTALLER
    ? ["--sign", process.env.SC_SIGN_INSTALLER, "--timestamp"]
    : [];
  run("/usr/bin/pkgbuild", [
    "--root",
    root,
    "--identifier",
    "com.safecontext.agent",
    "--version",
    version,
    "--scripts",
    join(here, "scripts"),
    "--install-location",
    "/",
    ...signing,
    pkg,
  ]);
  if (!signing.length)
    console.log("! SC_SIGN_INSTALLER not set: the .pkg is unsigned");
  const profile = process.env.SC_NOTARY_PROFILE;
  if (profile && signing.length) {
    step("Notarizing");
    run("/usr/bin/xcrun", [
      "notarytool",
      "submit",
      pkg,
      "--keychain-profile",
      profile,
      "--wait",
    ]);
    run("/usr/bin/xcrun", ["stapler", "staple", pkg]);
  }
  return pkg;
}

/** The Homebrew tarball (the app folder as `safecontext/`) and the formula pointing at it. */
function buildHomebrew(): string {
  step("Building the Homebrew tarball and formula");
  const name = `safecontext-${version}-darwin-arm64.tar.gz`;
  const tarball = join(dist, name);
  // uninstall.sh is for the .pkg; Homebrew removes its own files (`brew uninstall`).
  run("/usr/bin/tar", [
    "-czf",
    tarball,
    "-C",
    join(app, ".."),
    "--exclude",
    "SafeContext/uninstall.sh",
    "-s",
    "/^SafeContext/safecontext/",
    "SafeContext",
  ]);
  const formula = readFileSync(join(here, "homebrew/safecontext.rb"), "utf8")
    .replaceAll("{{version}}", version)
    .replaceAll("{{sha256}}", sha256(tarball))
    .replaceAll("{{tarball}}", name);
  writeFileSync(join(dist, "safecontext.rb"), formula);
  return tarball;
}

checkPlatform();
rmSync(out, { recursive: true, force: true });
mkdirSync(join(app, "bin"), { recursive: true });
await bundleAgent();
copyOnnxRuntime();
copyExtract();
copyModel();
copyRest();
signApp();
const pkg = buildPkg();
const tarball = buildHomebrew();
const mb = (p: string) => `${Math.round(statSync(p).size / 1e6)} MB`;
console.log(
  `\nDone.\n  ${relative(repo, pkg)} (${mb(pkg)})\n  ${relative(repo, tarball)} (${mb(tarball)})\n  ${relative(repo, join(dist, "safecontext.rb"))}`,
);
