import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readVersion(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')).version;
}

const version = readVersion('../package.json');
assert.equal(typeof version, 'string', 'The product version is required');
assert.equal(readVersion('../apps/web/package.json'), version, 'Root and default Web app versions must match');

if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(process.env.GITHUB_REF_NAME, `dsh-base-v${version}`, 'Release tag must match the product version');
}
