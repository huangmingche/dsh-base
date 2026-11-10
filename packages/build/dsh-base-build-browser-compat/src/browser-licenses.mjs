import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const baseRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const noticeFile = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/iu;

function packageDirectory(id, sourceRoot) {
  if (id.startsWith("\0")) return;
  const path = id.split("?")[0].replaceAll("\\", "/");
  const vendor = sourceRoot.split(sep).join("/") + "/vendor/";
  if (path.startsWith(vendor)) return vendor + path.slice(vendor.length).split("/")[0];
  const marker = "/node_modules/";
  const index = path.lastIndexOf(marker);
  if (index < 0) return;
  const parent = path.slice(0, index + marker.length);
  const [first, second] = path.slice(parent.length).split("/");
  if (!first || first.startsWith(".")) return;
  return parent + (first.startsWith("@") ? first + "/" + second : first);
}

function packageDirectories(moduleIds, sourceRoot) {
  const directories = new Set();
  for (const id of moduleIds) {
    const directory = packageDirectory(id, sourceRoot);
    if (directory) directories.add(directory);
  }
  return directories;
}

function noticeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(file => file.isFile() && noticeFile.test(file.name))
    .map(file => join(directory, file.name));
}

/** The parser is embedded as text and its transitive modules are invisible to Rollup. */
export function spreadsheetLicenseComment(inputs, workingDirectory, sourceRoot, watch) {
  const moduleIds = Object.entries(inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path]) => resolve(workingDirectory, path));
  const texts = new Map();
  function include(name, file) {
    watch(file);
    const text = readFileSync(file, "utf8").trim().replaceAll("\r\n", "\n");
    if (!texts.has(text)) texts.set(text, new Set());
    texts.get(text).add(name);
  }

  // The published FortuneSheet packages omit the license for the spreadsheet UI and styles.
  const fortuneSheet = join(sourceRoot, "packages/client/ui-sidebar-documentpreview/licenses/FortuneSheet.txt");
  include("FortuneSheet", fortuneSheet);
  const supplements = {
    "@fortune-sheet/core@1.0.4": fortuneSheet,
    "@fortune-sheet/react@1.0.4": fortuneSheet,
    // The package omits the LICENSE from nodable/val-parsers at npm gitHead ac48e7ea591da372be023a481875c747535812b3.
    "@nodable/entities@3.1.0": fileURLToPath(new URL("../licenses/nodable-entities-3.1.0.LICENSE", import.meta.url)),
  };
  for (const directory of packageDirectories(moduleIds, sourceRoot)) {
    const manifest = join(directory, "package.json");
    watch(manifest);
    const { name, version } = JSON.parse(readFileSync(manifest, "utf8"));
    const files = noticeFiles(directory);
    if (files.length === 0) {
      const supplement = supplements[`${name}@${version}`];
      if (!supplement) throw new Error(`Missing license text for bundled spreadsheet dependency ${name}@${version}`);
      files.push(supplement);
    }
    for (const file of files) include(name, file);
  }
  return licenseComment(Array.from(texts, ([text, names]) => [...names].sort().join(", ") + "\n" + text));
}

/** Attach the terms for the software shipped to browsers, using only the client module graph. */
export function browserLicenseComment(chunks, sourceRoot) {
  const texts = new Set();
  function include(path) { texts.add(readFileSync(path, "utf8").trim()); }
  include(join(baseRoot, "LICENSE"));
  include(join(sourceRoot, "LICENSE"));
  include(join(baseRoot, "packages/client/dsh-base-client-session-adapter/src/client/assets/cloudflare.LICENSE"));
  include(join(sourceRoot, "packages/client/ui-theme/src/styles/Montserrat-OFL.txt"));
  const moduleIds = Object.values(chunks).flatMap(chunk => chunk.moduleIds);
  for (const directory of packageDirectories(moduleIds, sourceRoot)) {
    const manifest = join(directory, "package.json");
    if (!existsSync(manifest)) continue;
    const files = noticeFiles(directory);
    for (const file of files) include(file);
    if (!files.length) {
      const { name, license } = JSON.parse(readFileSync(manifest, "utf8"));
      if (typeof license === "string") texts.add(name + ": " + license);
    }
  }
  return licenseComment(texts);
}

export function licenseComment(texts) {
  // Line comments preserve license text even when it contains a block-comment terminator.
  const lines = [...new Set(texts)].sort().join("\n\n").split(/\r\n|[\n\r\u2028\u2029]/u);
  return "\n// Third-party software licenses\n" + lines.map(line => "// " + line).join("\n") + "\n";
}
