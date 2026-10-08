'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { railwayOperatorClient } = require('../payments/railway-operator');

const env = { TASKMALL_RAILWAY_PROJECT_ID: '11111111-1111-1111-1111-111111111111',
  TASKMALL_RAILWAY_SERVICE_ID: '22222222-2222-2222-2222-222222222222',
  TASKMALL_RAILWAY_ENVIRONMENT_ID: '33333333-3333-3333-3333-333333333333', TASKMALL_RAILWAY_CLI_FILE: 'test-cli' };

test('Railway collection transport keeps credentials remote and preserves request bytes', async () => {
  const calls = [];
  const operator = railwayOperatorClient(env, async (cli, args, options) => {
    assert.equal(cli, 'test-cli');
    assert.deepEqual(args.slice(0, 8), ['ssh', '-p', env.TASKMALL_RAILWAY_PROJECT_ID, '-s', env.TASKMALL_RAILWAY_SERVICE_ID, '-e', env.TASKMALL_RAILWAY_ENVIRONMENT_ID, '--']);
    assert.equal(options.timeout, 30000);
    const match = args[8].match(/Buffer\.from\("([A-Za-z0-9+/=]+)"/);
    const source = Buffer.from(match[1], 'base64').toString('utf8');
    assert.ok(!source.includes('a'.repeat(43)), 'Operator credential must not be embedded in the remote command');
    let output;
    const context = { process: { env: { RAILWAY_PROJECT_ID: env.TASKMALL_RAILWAY_PROJECT_ID,
      RAILWAY_SERVICE_ID: env.TASKMALL_RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID: env.TASKMALL_RAILWAY_ENVIRONMENT_ID,
      PORT: '8080', TASKMALL_OPERATOR_TOKEN: 'a'.repeat(43) } }, AbortSignal,
      console: { log: value => { output = value; } }, fetch: async (url, options) => {
        calls.push({ url, options });
        assert.equal(options.headers.Authorization, 'Bearer ' + 'a'.repeat(43));
        return { status: 200, json: async () => ({ collections: [] }) };
      } };
    await vm.runInNewContext(source, context);
    return { stdout: output };
  });
  assert.deepEqual(await operator('collections'), { collections: [] });
  const transaction = { raw_data: { note: "quotes ' and \" are preserved" } };
  await operator('collections/00000000-0000-0000-0000-000000000000/record', { transaction });
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { transaction });
});

test('Railway transport rejects unsafe identities and routes before invoking the CLI', async () => {
  assert.throws(() => railwayOperatorClient({}), /IDENTITY_REQUIRED/);
  let count = 0;
  const operator = railwayOperatorClient(env, async () => { count++; return { stdout: '{}' }; });
  for (const route of ['../../wallet', "collections';process.exit(0)", 'withdrawals/invalid/approve', 'collections?token=secret']) {
    await assert.rejects(operator(route, {}), /ROUTE_NOT_ALLOWED/);
  }
  await assert.rejects(operator('collections/plan', { huge: 'x'.repeat(1_000_001) }), /REQUEST_TOO_LARGE/);
  await assert.rejects(operator('collections/plan', null), /INVALID_BODY/);
  assert.equal(count, 0);
});

test('remote service identity mismatch never invokes the operator API', async () => {
  let requested = false;
  const operator = railwayOperatorClient(env, async (cli, args) => {
    const match = args[8].match(/Buffer\.from\("([A-Za-z0-9+/=]+)"/);
    let output;
    await vm.runInNewContext(Buffer.from(match[1], 'base64').toString('utf8'), {
      process: { env: {} }, console: { log: value => { output = value; } },
      fetch: () => { requested = true; throw new Error('Must not be called'); }
    });
    return { stdout: output };
  });
  await assert.rejects(operator('collections'), /UNAVAILABLE/);
  assert.equal(requested, false);
});

test('Railway transport fails closed without printing provider errors or credentials', async () => {
  const failed = railwayOperatorClient(env, async () => { throw new Error('MYSQL_URL=secret'); });
  await assert.rejects(failed('collections'), /^Error: RAILWAY_OPERATOR_UNAVAILABLE$/);
  const rejected = railwayOperatorClient(env, async () => ({ stdout: JSON.stringify({ status: 403, result: { error: 'OPERATOR_AUTH_REQUIRED' } }) }));
  await assert.rejects(rejected('collections'), /OPERATOR_AUTH_REQUIRED/);
  const unsafe = railwayOperatorClient(env, async () => ({ stdout: JSON.stringify({ status: 500, result: { error: 'private key: secret' } }) }));
  await assert.rejects(unsafe('collections'), /^Error: RAILWAY_OPERATOR_REQUEST_FAILED$/);
});
