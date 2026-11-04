import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeAcceptanceBrowser } from '../../../apps/web/scripts/acceptance-config.mjs';

async function inheritedPipes() {
  // Real child/grandchild descriptors reproduce macOS Chrome updater behavior:
  // the browser exits, but its descendant still owns the same output pipes.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {spawn} from 'node:child_process';
    const descendant = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
      {stdio:['ignore',process.stdout,process.stderr],detached:true});
    descendant.unref();
    process.send(descendant.pid);
    process.on('message', () => process.exit(0));
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const [descendant] = await once(child, 'message');
  let closed = false;
  const close = once(child, 'close').then(() => { closed = true; });
  return { child, closed: () => closed, close,
    cleanup() { try { process.kill(descendant, 'SIGTERM'); } catch {} if (child.exitCode === null) child.kill(); child.stdout.destroy(); child.stderr.destroy(); },
  };
}

test('browser cleanup waits for real process exit then releases inherited pipes', async () => {
  const fixture = await inheritedPipes();
  try {
    assert.equal(fixture.child.stdout.destroyed, false);
    await closeAcceptanceBrowser({ process: () => fixture.child, async close() {
      assert.equal(fixture.child.stdout.destroyed, false, 'live browser diagnostics must remain readable');
      fixture.child.send('quit');
      await fixture.close;
    } });
    assert.equal(fixture.child.exitCode, 0);
    assert.equal(fixture.closed(), true);
    assert.equal(fixture.child.stdout.destroyed, true);
  } finally { fixture.cleanup(); }
});

test('browser cleanup handles an already exited process and propagates close failures', async () => {
  const fixture = await inheritedPipes();
  try {
    const exited = once(fixture.child, 'exit'); fixture.child.send('quit'); await exited;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(fixture.closed(), false, 'inherited pipes reproduce the hanging ChildProcess close');
    await closeAcceptanceBrowser({ process: () => fixture.child, close: () => fixture.close });
    assert.equal(fixture.closed(), true);
  } finally { fixture.cleanup(); }
  await assert.rejects(closeAcceptanceBrowser({ process: () => null, async close() { throw new Error('actual browser failure'); } }), /actual browser failure/);
  await closeAcceptanceBrowser(undefined);
});
