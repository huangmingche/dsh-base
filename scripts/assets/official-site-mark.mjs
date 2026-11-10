import { buildContext } from "../build/product-paths.mjs";
/** Build-only literal extraction of the pinned package's stable logo exports.
 * No official implementation is copied, evaluated, or fetched from elsewhere.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { officialPackages, isPackageExported, repoRoot } from '../conformance/lib.mjs';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const posix = path => path.replaceAll('\\', '/');
const executable = target => typeof target === 'string' ? target : target && typeof target === 'object' ? executable(target.import ?? target.default) : undefined;

export function readOfficialSiteMark(productRoot = repoRoot) {
  const { baseRoot: sourceBaseRoot, appRoot } = buildContext(productRoot);
  const ts = createRequire(join(appRoot, 'package.json'))('typescript');
  const sourceFile = path => ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lock = JSON.parse(readFileSync(join(sourceBaseRoot, 'dsh-source.lock.json'), 'utf8'));
  const checkout = resolve(sourceBaseRoot, lock.referencePath);
  assert.equal(execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), lock.commit, 'official asset source must match the pinned commit');
  const packages = officialPackages(productRoot);
  const packageName = '@deepseek-ai/dsh-client-ui-primitives';
  const pkg = packages.get(packageName);
  assert.ok(pkg && isPackageExported(pkg.manifest, '.'), 'FishLogo must remain available through the stable package export');
  const target = executable(pkg.manifest.exports['.']);
  assert.match(target, /^\.\/lib\/.*\.js$/u, 'review stable export source mapping if the pin changes');
  const indexPath = resolve(pkg.directoryPath, target.replace('/lib/', '/src/').replace(/\.js$/u, '.ts'));
  const root = sourceFile(indexPath);
  const constants = new Map();
  const paths = new Set([pkg.path, indexPath]);
  for (const name of ['FISH_LOGO_PATH', 'FISH_LOGO_VIEWBOX']) {
    const exports = root.statements.filter(node => ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)
      && node.exportClause.elements.some(item => item.name.text === name));
    assert.equal(exports.length, 1, `${name} must remain an unambiguous stable named export`);
    const declaration = exports[0];
    assert.ok(declaration.moduleSpecifier && ts.isStringLiteral(declaration.moduleSpecifier));
    const specifier = declaration.moduleSpecifier.text;
    assert.ok(specifier.startsWith('./') && !specifier.split('/').includes('..'), 'stable re-export must stay inside its official package');
    const path = resolve(dirname(indexPath), specifier);
    paths.add(path);
    const binding = declaration.exportClause.elements.find(item => item.name.text === name);
    const localName = binding.propertyName?.text ?? name;
    const variables = sourceFile(path).statements.filter(node => ts.isVariableStatement(node) && node.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword))
      .flatMap(node => node.declarationList.declarations).filter(node => ts.isIdentifier(node.name) && node.name.text === localName);
    assert.equal(variables.length, 1, `${name} must remain an exported constant`);
    const value = variables[0].initializer;
    if (name === 'FISH_LOGO_PATH') {
      assert.ok(value && ts.isStringLiteral(value), 'logo path extraction only accepts a string literal');
      assert.match(value.text, /^[MmZzLlHhVvCcSsQqTtAaEe0-9+.,\s-]+$/u);
      constants.set(name, value.text);
    } else {
      assert.ok(value && ts.isObjectLiteralExpression(value));
      const box = {};
      for (const property of value.properties) {
        assert.ok(ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && ts.isNumericLiteral(property.initializer));
        box[property.name.text] = Number(property.initializer.text);
      }
      assert.deepEqual(Object.keys(box).sort(), ['height', 'width']);
      assert.ok(box.width > 0 && box.height > 0);
      constants.set(name, box);
    }
  }
  // Pin the OG font too: system font substitution would make regeneration
  // dependent on the developer's installed fonts.
  const theme = packages.get('@deepseek-ai/dsh-client-ui-theme');
  const fonts = {};
  for (const weight of ['regular', 'medium']) {
    const subpath = `./src/styles/montserrat-${weight}.woff2`;
    assert.ok(theme && isPackageExported(theme.manifest, subpath), `font source must be exported: ${subpath}`);
    const path = resolve(theme.directoryPath, subpath);
    paths.add(path); fonts[weight] = readFileSync(path).toString('base64');
  }
  paths.add(theme.path);
  paths.add(join(theme.directoryPath, 'src/styles/Montserrat-OFL.txt'));
  const files = Object.fromEntries([...paths].sort().map(path => {
    const bytes = readFileSync(path);
    const committed = execFileSync('git', ['-C', checkout, 'show', `${lock.commit}:${posix(relative(checkout, path))}`]);
    assert.ok(bytes.equals(committed), 'official asset input must be the unmodified pinned file');
    return [posix(relative(sourceBaseRoot, path)), sha256(bytes)];
  }));
  return {
    path: constants.get('FISH_LOGO_PATH'), viewBox: constants.get('FISH_LOGO_VIEWBOX'), fonts,
    source: { package: packageName, export: '.', symbols: [...constants.keys()], repository: lock.repository, tag: lock.tag, commit: lock.commit, license: pkg.manifest.license, files },
  };
}
