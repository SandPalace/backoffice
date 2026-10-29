import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertBlobKey, isValidBucket } from '../src/blobstore.mjs'

test('keys and buckets: .., absolute paths and invalid names are rejected', () => {
  for (const bad of ['../x', 'a/../b', '/abs', 'a\\b', '', 'a/./b']) assert.throws(() => assertBlobKey(bad), /Invalid key/, bad)
  assert.equal(assertBlobKey('outputs/T-1/a b.md'), 'outputs/T-1/a b.md')
  assert.ok(isValidBucket('ws-default') && isValidBucket('ws-cliente-2'))
  for (const b of ['ws', 'WS-x', 'ws_x', '-ws', 'ws-', 'a'.repeat(64)]) assert.equal(isValidBucket(b), false, b)
})
