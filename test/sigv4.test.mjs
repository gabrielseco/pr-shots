import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodePath, sha256, sign } from '../src/sigv4.mjs';

// "Example: GET Object" from the AWS Signature Version 4 documentation for S3.
test('matches the AWS documentation example', () => {
  const headers = sign({
    method: 'GET',
    url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    headers: { Range: 'bytes=0-9' },
    payloadHash: sha256(''),
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    now: new Date('2013-05-24T00:00:00Z'),
  });

  assert.equal(
    headers.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
  );
});

test('encodes each path segment and keeps the slashes', () => {
  assert.equal(encodePath('a b/c(1)/d+e.png'), 'a%20b/c%281%29/d%2Be.png');
});
