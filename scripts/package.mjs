// Build the XPI uploaded to AMO, refusing anything that could ship more than
// the extension itself:
//
// - The payload is an allowlist derived from manifest.json (manifest, background
//   and content scripts, styles, icons). Nothing else is ever zipped.
// - The tree must be clean, and files come from the commit (`git archive HEAD`),
//   not the working tree, so the XPI is exactly a known commit. git's zip
//   entries carry no local owner, permissions or file-system metadata.
// - Every shipped file is scanned for developer PII: absolute home/toolchain
//   paths, and the local user name, git name and git email (read at run time,
//   so they never appear in this repo).
// - The finished zip is listed back and must contain exactly the allowlist.
//
// Usage: node scripts/package.mjs   (writes web-ext-artifacts/<slug>-<version>.zip)
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const fail = (msg) => {
  console.error(`package: ${msg}`);
  process.exit(1);
};

const dirty = git("status", "--porcelain").trimEnd();
if (dirty) fail(`working tree is dirty; commit or stash first, so the XPI is exactly HEAD:\n${dirty}`);

// The allowlist, from the committed manifest: every file it names, the local
// files those HTML pages load, and _locales/ when the manifest is localised.
const manifest = JSON.parse(git("show", "HEAD:manifest.json"));
const tracked = new Set(git("ls-files", "-z").split("\0").filter(Boolean));
const payload = new Set(["manifest.json"]);
const add = (f) => typeof f === "string" && f && payload.add(f.replace(/^\.?\//, ""));
const icons = (v) => (typeof v === "string" ? add(v) : Object.values(v ?? {}).forEach(add));
const bg = manifest.background ?? {};
[...(bg.scripts ?? []), bg.page, bg.service_worker].forEach(add);
for (const cs of manifest.content_scripts ?? []) [...(cs.js ?? []), ...(cs.css ?? [])].forEach(add);
icons(manifest.icons);
for (const key of ["browser_action", "page_action", "action", "sidebar_action"]) {
  const a = manifest[key];
  if (!a) continue;
  [a.default_popup, a.default_panel].forEach(add);
  icons(a.default_icon);
}
add(manifest.options_ui?.page);
add(manifest.options_page);
Object.values(manifest.chrome_url_overrides ?? {}).forEach(add);
for (const w of manifest.web_accessible_resources ?? []) (typeof w === "string" ? [w] : w.resources ?? []).forEach(add);
if (manifest.default_locale) for (const f of tracked) if (f.startsWith("_locales/")) add(f);
for (const page of [...payload].filter((f) => f.endsWith(".html"))) {
  const dir = page.includes("/") ? page.slice(0, page.lastIndexOf("/") + 1) : "";
  for (const [, ref] of git("show", `HEAD:${page}`).matchAll(/\b(?:src|href)=["']([^"'#?:]+)["']/g)) {
    add(ref.startsWith("/") ? ref.slice(1) : dir + ref);
  }
}
const globbed = [...payload].filter((f) => f.includes("*"));
if (globbed.length) fail(`wildcards in the manifest can't be allowlisted; list the files: ${globbed.join(", ")}`);
const files = [...payload].sort();

const untracked = files.filter((f) => !tracked.has(f));
if (untracked.length) fail(`manifest references files not committed: ${untracked.join(", ")}`);

// PII scan of exactly what ships. A path counts only at the start of a token
// (or after file://), so web URLs such as https://x.com/home/ don't trip it.
const DEV_PATH = /(?:^|[\s"'`(=:,[]|file:\/\/)(?:\/Users\/|\/home\/[a-z]|\/opt\/homebrew|[A-Z]:\\Users\\)/;
const ident = (cmd) => {
  try {
    return git("config", cmd).trim();
  } catch {
    return "";
  }
};
// Each identifier counts only as a whole word, so a user name like "sam"
// doesn't trip on "sample".
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const personal = [userInfo().username, ident("user.name"), ident("user.email")]
  .filter((s) => s && s.length >= 3)
  .map((s) => new RegExp(`(?<![\\p{L}\\p{N}_])${escape(s)}(?![\\p{L}\\p{N}_])`, "iu"));
const hits = [];
for (const f of files) {
  git("show", `HEAD:${f}`)
    .split("\n")
    .forEach((line, i) => {
      if (DEV_PATH.test(line) || personal.some((p) => p.test(line))) hits.push(`  ${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
}
if (hits.length) fail(`developer paths or personal identifiers in shipped files:\n${hits.join("\n")}`);

const slug = manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const out = `web-ext-artifacts/${slug}-${manifest.version}.zip`;
mkdirSync(resolve(root, "web-ext-artifacts"), { recursive: true });
rmSync(resolve(root, out), { force: true });
git("archive", "--format=zip", "-o", out, "HEAD", "--", ...files);

// Read the zip back: exactly the allowlist, nothing more or less.
const listed = execFileSync("unzip", ["-Z1", resolve(root, out)], { encoding: "utf8" })
  .split("\n")
  .filter((e) => e && !e.endsWith("/")) // git adds entries for directories
  .sort();
if (listed.join("\n") !== files.join("\n")) {
  rmSync(resolve(root, out), { force: true });
  fail(`zip contents differ from the allowlist:\n  zip: ${listed.join(", ")}\n  allowlist: ${files.join(", ")}`);
}

const commit = git("rev-parse", "--short", "HEAD").trim();
console.log(`package: wrote ${out} from ${commit}\n  ${files.join("\n  ")}`);
console.log("Next: upload to AMO, which runs Mozilla's linter on it.");
