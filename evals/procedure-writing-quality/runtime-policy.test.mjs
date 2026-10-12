import assert from 'node:assert/strict';
import test from 'node:test';
import { childEnvironment, namespaceArguments } from './runtime-policy.mjs';

test('isolated evaluation children keep configured proxies without inheriting a parent task', () => {
  const environment = childEnvironment({
    https_proxy: 'http://configured-proxy:8080', http_proxy: 'http://configured-proxy:8080',
    all_proxy: 'http://configured-proxy:8080', no_proxy: 'localhost',
    HTTPS_PROXY: 'http://uppercase-proxy:8080',
    CODEX_SESSION_ID: 'parent-session', CODEX_THREAD_ID: 'parent-chat',
    MEMSPHERE_PROJECT: 'production-project', PATH: '/parent/bin'
  }, '/trial/runtime/bin', '/trial/project-home');
  assert.equal(environment.https_proxy, 'http://configured-proxy:8080');
  assert.equal(environment.http_proxy, 'http://configured-proxy:8080');
  assert.equal(environment.all_proxy, 'http://configured-proxy:8080');
  assert.equal(environment.no_proxy, 'localhost');
  assert.equal(environment.HTTPS_PROXY, 'http://uppercase-proxy:8080');
  assert.equal(environment.CODEX_SESSION_ID, undefined);
  assert.equal(environment.CODEX_THREAD_ID, undefined);
  assert.equal(environment.MEMSPHERE_PROJECT, undefined);
  assert.equal(environment.MEMSPHERE_HOME, '/trial/project-home');
  assert.equal(environment.PATH, '/trial/runtime/bin:/usr/bin:/bin');
});

test('evaluation namespaces hide the host temporary directory before exposing their own workspace', () => {
  const args = namespaceArguments([['--bind','/tmp/trial/workspace','/tmp/trial/workspace']], '/tmp/trial/workspace');
  assert(args.indexOf('--tmpfs') < args.indexOf('--bind'));
  assert(args.includes('--unshare-pid'));
  assert(args.includes('--die-with-parent'));
  assert.deepEqual(args.slice(-2), ['--chdir','/tmp/trial/workspace']);
});

test('evaluation namespace preparation refuses to expose the full host root', () => {
  assert.throws(() => namespaceArguments([['--ro-bind','/','/']], '/trial'), /Host root mounts are forbidden/);
  assert.throws(() => namespaceArguments([['--ro-bind','/some-directory','/']], '/trial'), /Host root mounts are forbidden/);
});
