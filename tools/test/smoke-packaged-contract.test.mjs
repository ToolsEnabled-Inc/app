import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APP_EXE,
  APP_MARKER,
  DEFAULT_PORTS,
  main,
} from '../smoke-packaged.mjs';

function fakeChild(pid = 424242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

async function packagedFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'smoke-packaged-contract-'));
  await writeFile(join(dir, APP_EXE), 'not a real executable');
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function harness(overrides = {}) {
  const spawns = [];
  const terminations = [];
  const child = fakeChild();

  const spawn = (...args) => {
    spawns.push(args);
    return child;
  };
  const terminateProcessTree = async (...args) => {
    terminations.push(args);
  };

  return {
    child,
    spawns,
    terminations,
    dependencies: {
      spawn,
      terminateProcessTree,
      getWindowTitle: async () => '',
      fetch: async () => response(APP_MARKER),
      timeoutMs: 40,
      pollIntervalMs: 1,
      requestTimeoutMs: 5,
      ports: [4601],
      log: () => {},
      ...overrides,
    },
  };
}

test('C1 - refuses a nonexistent directory and a directory without an executable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smoke-packaged-contract-c1-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const missing = join(root, 'does-not-exist');
  const empty = join(root, 'empty');
  await mkdir(empty);

  for (const directory of [missing, empty]) {
    let spawnCalls = 0;
    await assert.rejects(
      main(directory, {
        spawn: () => {
          spawnCalls += 1;
          return fakeChild();
        },
      }),
      (error) => {
        assert.match(error.message, new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        return true;
      },
    );
    assert.equal(spawnCalls, 0, `must not spawn for invalid directory ${directory}`);
  }
});

test('C2 - terminates every child tree on success, timeout, dependency error, and repeated request rejection', async (t) => {
  await t.test('success', async (t) => {
    const dir = await packagedFixture(t);
    const h = harness();

    await main(dir, h.dependencies);

    assert.equal(h.spawns.length, 1);
    assert.ok(h.terminations.length > 0, 'success path must terminate the child tree');
  });

  await t.test('timeout before any port binds', async (t) => {
    const dir = await packagedFixture(t);
    const h = harness({
      fetch: async () => {
        throw new Error('connection refused');
      },
      timeoutMs: 20,
    });

    await assert.rejects(main(dir, h.dependencies));

    assert.equal(h.spawns.length, 1);
    assert.ok(h.terminations.length > 0, 'timeout path must terminate the child tree');
  });

  await t.test('injected dependency throws mid-flight', async (t) => {
    const dir = await packagedFixture(t);
    const h = harness({
      log: () => {
        throw new Error('injected logger exploded');
      },
    });

    await assert.rejects(main(dir, h.dependencies), /injected logger exploded/i);

    assert.equal(h.spawns.length, 1);
    assert.ok(h.terminations.length > 0, 'dependency-error path must terminate the child tree');
  });

  await t.test('request dependency rejects repeatedly', async (t) => {
    const dir = await packagedFixture(t);
    let requests = 0;
    const h = harness({
      fetch: async () => {
        requests += 1;
        throw new Error('probe rejected');
      },
      timeoutMs: 25,
    });

    await assert.rejects(main(dir, h.dependencies));

    assert.ok(requests >= 2, `expected repeated probes, observed ${requests}`);
    assert.equal(h.spawns.length, 1);
    assert.ok(h.terminations.length > 0, 'request-rejection path must terminate the child tree');
  });
});

test('C3 - spawn explicitly sets detached to false', async (t) => {
  const dir = await packagedFixture(t);
  const h = harness();

  await main(dir, h.dependencies);

  assert.equal(h.spawns.length, 1);
  const options = h.spawns[0][2];
  assert.ok(Object.hasOwn(options, 'detached'), 'spawn options must explicitly contain detached');
  assert.equal(options.detached, false);
});

test("C4 - spawn environment sets MC_SMOKE_HEADLESS to the exact string '1'", async (t) => {
  const dir = await packagedFixture(t);
  const h = harness();

  await main(dir, h.dependencies);

  assert.equal(h.spawns.length, 1);
  assert.equal(h.spawns[0][2].env.MC_SMOKE_HEADLESS, '1');
});

test('C5 - spawn environment removes ELECTRON_RUN_AS_NODE', async (t) => {
  const dir = await packagedFixture(t);
  const h = harness();
  const previous = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = previous;
  });

  await main(dir, h.dependencies);

  assert.equal(h.spawns.length, 1);
  assert.equal(
    Object.hasOwn(h.spawns[0][2].env, 'ELECTRON_RUN_AS_NODE'),
    false,
    'spawn environment must omit ELECTRON_RUN_AS_NODE',
  );
});

test('C6 - a responding port without the Mission Control title marker is rejected', async (t) => {
  const dir = await packagedFixture(t);
  const h = harness({
    fetch: async () => response('<html><title>Some Other Service</title></html>'),
    timeoutMs: 20,
  });

  await assert.rejects(main(dir, h.dependencies));

  assert.ok(h.terminations.length > 0);
});

test('C7 - probes the complete 4601-4609 range and accepts a real app on port 4609', async (t) => {
  const dir = await packagedFixture(t);
  const probedPorts = [];
  const h = harness({
    ports: DEFAULT_PORTS,
    fetch: async (url) => {
      const port = Number(new URL(url).port);
      probedPorts.push(port);
      if (port === 4609) return response(APP_MARKER);
      throw new Error('connection refused');
    },
  });

  const result = await main(dir, h.dependencies);

  assert.deepEqual(probedPorts.slice(0, 9), [4601, 4602, 4603, 4604, 4605, 4606, 4607, 4608, 4609]);
  assert.equal(result.port, 4609);
  assert.ok(h.terminations.length > 0);
});

test('C8 - a child that never binds exhausts the configured timeout budget', async (t) => {
  const dir = await packagedFixture(t);
  const timeoutMs = 40000;
  const pollIntervalMs = 250;
  let virtualNow = 0;
  const sleepCalls = [];
  const h = harness({
    fetch: async () => {
      throw new Error('connection refused');
    },
    timeoutMs,
    pollIntervalMs,
    findExistingInstances: async () => [],
    makeSmokeProfileDirectory: async () => join(dir, 'virtual-profile'),
    removeSmokeProfileDirectory: async () => {},
    now: () => virtualNow,
    sleep: async (ms) => {
      sleepCalls.push(ms);
      virtualNow += ms;
    },
  });

  await assert.rejects(main(dir, h.dependencies));

  assert.ok(
    virtualNow >= timeoutMs,
    `virtual clock advanced only ${virtualNow}ms of the ${timeoutMs}ms timeout budget`,
  );
  assert.ok(
    virtualNow <= timeoutMs + pollIntervalMs,
    `virtual clock overshot the timeout budget by ${virtualNow - timeoutMs}ms`,
  );
  assert.ok(
    sleepCalls.every((ms) => ms === pollIntervalMs),
    `expected every sleep to be ${pollIntervalMs}ms, observed ${sleepCalls.join(', ')}`,
  );
  const expectedPolls = timeoutMs / pollIntervalMs;
  assert.ok(
    Math.abs(sleepCalls.length - expectedPolls) <= 1,
    `expected about ${expectedPolls} poll iterations, observed ${sleepCalls.length}`,
  );
  assert.ok(h.terminations.length > 0);
});

test('C9 - failures identify the directory or the port range and timeout', async (t) => {
  await t.test('directory failure names the directory', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'smoke-packaged-contract-c9-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const missing = join(root, 'missing-packaged-app');

    await assert.rejects(main(missing, { spawn: () => fakeChild() }), (error) => {
      assert.ok(error.message.includes(missing), `failure did not name directory: ${error.message}`);
      assert.ok(error.message.trim().toLowerCase() !== 'failed');
      return true;
    });
  });

  await t.test('timeout failure names the range and configured timeout', async (t) => {
    const dir = await packagedFixture(t);
    const timeoutMs = 20;
    const h = harness({
      ports: DEFAULT_PORTS,
      fetch: async () => {
        throw new Error('connection refused');
      },
      timeoutMs,
    });

    await assert.rejects(main(dir, h.dependencies), (error) => {
      assert.match(error.message, /4601/);
      assert.match(error.message, /4609/);
      assert.match(error.message, new RegExp(`(?:timeout[^0-9]*${timeoutMs}|${timeoutMs}[^0-9]*ms)`, 'i'));
      assert.ok(error.message.trim().toLowerCase() !== 'failed');
      return true;
    });
  });
});
