import { Readable } from 'node:stream';

import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type * as ClientS3 from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadFunctionError } from '../errors.js';
import { parseObjectKey } from '../object-key.js';
import { createR2ReplicationStorage } from './r2-replication-storage.js';

const sendMock = vi.fn();

class MockS3Client {
  public readonly send = sendMock;
}

vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof ClientS3>('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: vi.fn(function MockedS3Client(this: MockS3Client) {
      Object.assign(this, new MockS3Client());
    }),
  };
});

const baseConfig = {
  accountId: 'acc',
  bucketName: 'mock-bucket',
  accessKeyId: 'k',
  secretAccessKey: 's',
  maxRetries: 0,
};

const objectKey = parseObjectKey('lot_images/425939177/20260310/638775/195.jpg');

describe('R2ReplicationStorage', () => {
  beforeEach(() => {
    sendMock.mockReset();
    vi.mocked(S3Client).mockClear();
  });

  it('configures the S3 client against the R2 endpoint', () => {
    createR2ReplicationStorage(baseConfig);

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'auto',
        endpoint: 'https://acc.r2.cloudflarestorage.com',
        forcePathStyle: true,
        maxAttempts: 1,
      }),
    );
  });

  it('sends a PutObject command with content metadata', async () => {
    const storage = createR2ReplicationStorage(baseConfig);
    sendMock.mockResolvedValueOnce({});

    await storage.put({
      objectKey,
      bodyFactory: () => Promise.resolve(Readable.from('hello')),
      contentType: 'image/jpeg',
      contentLength: 5,
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const command = sendMock.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'mock-bucket',
      Key: objectKey,
      ContentType: 'image/jpeg',
      ContentLength: 5,
    });
  });

  it('attaches cache-version metadata when provided', async () => {
    const storage = createR2ReplicationStorage(baseConfig);
    sendMock.mockResolvedValueOnce({});

    await storage.put({
      objectKey,
      bodyFactory: () => Promise.resolve(Readable.from('hello')),
      cacheVersion: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      contentType: 'image/jpeg',
      contentLength: 5,
    });

    const command = sendMock.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command.input.Metadata).toEqual({ 'cache-version': '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
  });

  it('maps put failures to r2_unavailable with the underlying status code', async () => {
    const storage = createR2ReplicationStorage(baseConfig);
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('boom'), {
        name: 'InternalError',
        $metadata: { httpStatusCode: 500 },
      }),
    );

    await expect(
      storage.put({
        objectKey,
        bodyFactory: () => Promise.resolve(Readable.from('hello')),
        contentType: 'image/jpeg',
        contentLength: 5,
      }),
    ).rejects.toMatchObject({
      code: 'r2_unavailable',
      status: 503,
      details: { r2Name: 'InternalError', r2StatusCode: 500 },
    });
  });

  it('reopens the object stream for each R2 retry', async () => {
    const storage = createR2ReplicationStorage({ ...baseConfig, maxRetries: 1 });
    const bodyFactory = vi
      .fn<() => Promise<Readable>>()
      .mockResolvedValueOnce(Readable.from('first'))
      .mockResolvedValueOnce(Readable.from('second'));
    sendMock
      .mockRejectedValueOnce(
        Object.assign(new Error('try again'), {
          name: 'InternalError',
          $metadata: { httpStatusCode: 500 },
        }),
      )
      .mockResolvedValueOnce({});

    await storage.put({
      objectKey,
      bodyFactory,
      contentType: 'image/jpeg',
      contentLength: 5,
    });

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(bodyFactory).toHaveBeenCalledTimes(2);
  });

  it('swallows 404 on delete', async () => {
    const storage = createR2ReplicationStorage(baseConfig);
    sendMock.mockRejectedValueOnce(
      Object.assign(new Error('gone'), {
        name: 'NoSuchKey',
        $metadata: { httpStatusCode: 404 },
      }),
    );

    await expect(storage.delete(objectKey)).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
  });

  it('deletes every object under a prefix', async () => {
    const storage = createR2ReplicationStorage(baseConfig);
    sendMock
      .mockResolvedValueOnce({
        Contents: [
          { Key: 'variants/webp/w640/lot_images/425939177/20260310/638775/195/_v/one.webp' },
          { Key: 'variants/webp/w640/lot_images/425939177/20260310/638775/195/_v/two.webp' },
        ],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({});

    await storage.deleteByPrefix('variants/webp/w640/lot_images/425939177/20260310/638775/195/_v/');

    expect(sendMock).toHaveBeenCalledTimes(2);
    const listCommand = sendMock.mock.calls[0]?.[0] as ListObjectsV2Command;
    expect(listCommand).toBeInstanceOf(ListObjectsV2Command);
    expect(listCommand.input).toMatchObject({
      Bucket: 'mock-bucket',
      Prefix: 'variants/webp/w640/lot_images/425939177/20260310/638775/195/_v/',
    });
    const deleteCommand = sendMock.mock.calls[1]?.[0] as DeleteObjectsCommand;
    expect(deleteCommand).toBeInstanceOf(DeleteObjectsCommand);
    expect(deleteCommand.input).toMatchObject({
      Bucket: 'mock-bucket',
      Delete: {
        Objects: [
          {
            Key: 'variants/webp/w640/lot_images/425939177/20260310/638775/195/_v/one.webp',
          },
          {
            Key: 'variants/webp/w640/lot_images/425939177/20260310/638775/195/_v/two.webp',
          },
        ],
        Quiet: true,
      },
    });
  });

  it('does not send a batch delete when a prefix is empty', async () => {
    const storage = createR2ReplicationStorage(baseConfig);
    sendMock.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

    await storage.deleteByPrefix('variants/webp/thumb/empty/_v/');

    expect(sendMock).toHaveBeenCalledOnce();
    expect(sendMock).toHaveBeenCalledWith(expect.any(ListObjectsV2Command));
  });

  it('maps health check failure to r2_unavailable', async () => {
    const storage = createR2ReplicationStorage(baseConfig);
    sendMock.mockRejectedValueOnce(new Error('dns'));

    await expect(storage.healthCheck()).rejects.toBeInstanceOf(UploadFunctionError);
    expect(sendMock).toHaveBeenCalledWith(expect.any(HeadBucketCommand));
  });
});
