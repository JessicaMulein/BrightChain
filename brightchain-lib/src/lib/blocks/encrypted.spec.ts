import { randomBytes } from 'crypto';
import { BrightChainMember } from '../brightChainMember';
import { EmailString } from '../emailString';
import { EncryptedBlockMetadata } from '../encryptedBlockMetadata';
import { BlockDataType } from '../enumerations/blockDataType';
import { BlockSize } from '../enumerations/blockSizes';
import { BlockType } from '../enumerations/blockType';
import { BlockValidationErrorType } from '../enumerations/blockValidationErrorType';
import MemberType from '../enumerations/memberType';
import { EphemeralBlockMetadata } from '../ephemeralBlockMetadata';
import { BlockValidationError } from '../errors/block';
import { ChecksumMismatchError } from '../errors/checksumMismatch';
import { GuidV4 } from '../guid';
import { IEncryptedBlock } from '../interfaces/encryptedBlock';
import { IMemberWithMnemonic } from '../interfaces/memberWithMnemonic';
import { StaticHelpersChecksum } from '../staticHelpers.checksum';
import { StaticHelpersECIES } from '../staticHelpers.ECIES';
import { ChecksumBuffer } from '../types';
import { EncryptedBlock } from './encrypted';

// Test class that properly implements abstract methods
class TestEncryptedBlock extends EncryptedBlock implements IEncryptedBlock {
  // Remove encryptedLength override to use base class implementation

  public static override async from(
    type: BlockType,
    dataType: BlockDataType,
    blockSize: BlockSize,
    data: Buffer,
    checksum: ChecksumBuffer,
    creator?: BrightChainMember | GuidV4,
    dateCreated?: Date,
    actualDataLength?: number,
    canRead = true,
    canPersist = true,
  ): Promise<TestEncryptedBlock> {
    // Validate data length
    if (data.length < StaticHelpersECIES.eciesOverheadLength) {
      throw new BlockValidationError(
        BlockValidationErrorType.DataLengthTooShort,
      );
    }

    // Total data length must not exceed block size
    if (data.length > (blockSize as number)) {
      throw new BlockValidationError(
        BlockValidationErrorType.DataLengthExceedsCapacity,
      );
    }

    // For encrypted blocks with known actual data length:
    // 1. The actual data length must not exceed available capacity
    // 2. The total encrypted length must not exceed block size
    if (actualDataLength !== undefined) {
      const availableCapacity =
        (blockSize as number) - StaticHelpersECIES.eciesOverheadLength;
      if (actualDataLength > availableCapacity) {
        throw new BlockValidationError(
          BlockValidationErrorType.DataLengthExceedsCapacity,
        );
      }
    }

    // Create final data buffer filled with random data
    const finalData = randomBytes(blockSize as number);

    // Copy data into the final buffer, preserving the full block size
    data.copy(finalData, 0, 0, Math.min(data.length, blockSize as number));

    // Calculate and validate checksum on the final data
    const computedChecksum = StaticHelpersChecksum.calculateChecksum(finalData);
    if (checksum && !computedChecksum.equals(checksum)) {
      throw new ChecksumMismatchError(computedChecksum, checksum);
    }
    const finalChecksum = checksum ?? computedChecksum;

    const metadata = new EphemeralBlockMetadata(
      blockSize,
      type,
      BlockDataType.EncryptedData,
      actualDataLength ?? data.length - StaticHelpersECIES.eciesOverheadLength,
      true,
      creator,
      dateCreated ?? new Date(),
    );

    return new TestEncryptedBlock(
      type,
      dataType,
      finalData,
      finalChecksum,
      EncryptedBlockMetadata.fromEphemeralBlockMetadata(metadata),
      canRead,
      canPersist,
    );
  }
}

describe('EncryptedBlock', () => {
  // Increase timeout for all tests
  jest.setTimeout(15000);

  // Shared test data
  let creator: IMemberWithMnemonic;
  const defaultBlockSize = BlockSize.Small;
  const testDate = new Date(Date.now() - 1000); // 1 second ago

  const getEffectiveSize = (size: BlockSize) => size as number; // For encrypted blocks, use full block size since overhead is in data

  const createEncryptedData = (size: number): Buffer => {
    // Create a full-sized buffer with random data
    const finalData = randomBytes(size);

    // Set ECIES header components
    finalData[0] = 0x04; // Set ECIES public key prefix
    // Rest of the buffer is already random data which serves as:
    // - Rest of public key (64 bytes after 0x04)
    // - IV (16 bytes)
    // - Auth tag (16 bytes)
    // - Encrypted data + padding (remaining bytes)

    return finalData;
  };

  const createTestBlock = async (
    options: Partial<{
      blockSize: BlockSize;
      data: Buffer;
      checksum: ChecksumBuffer;
      creator: BrightChainMember | GuidV4;
      dateCreated: Date;
      actualDataLength: number;
      canRead: boolean;
    }> = {},
  ) => {
    const blockSize = options.blockSize || defaultBlockSize;
    const data = options.data || createEncryptedData(blockSize as number);
    const checksum =
      options.checksum ?? StaticHelpersChecksum.calculateChecksum(data);

    return TestEncryptedBlock.from(
      BlockType.EncryptedOwnedDataBlock,
      BlockDataType.EncryptedData,
      blockSize,
      data,
      checksum,
      options.creator || creator.member,
      options.dateCreated || testDate,
      options.actualDataLength,
    );
  };

  beforeAll(() => {
    creator = BrightChainMember.newMember(
      MemberType.User,
      'Test User',
      new EmailString('test@example.com'),
    );
  });

  describe('basic functionality', () => {
    it('should construct and validate correctly', async () => {
      const data = createEncryptedData(defaultBlockSize as number);
      const block = await createTestBlock({ data });

      expect(block.blockSize).toBe(defaultBlockSize);
      expect(block.blockType).toBe(BlockType.EncryptedOwnedDataBlock);
      expect(block.blockDataType).toBe(BlockDataType.EncryptedData);
      // Don't compare data directly since it includes random padding
      expect(block.data.length).toBe(defaultBlockSize as number);
      expect(
        block.data.subarray(0, StaticHelpersECIES.eciesOverheadLength),
      ).toEqual(data.subarray(0, StaticHelpersECIES.eciesOverheadLength));
      expect(block.canRead).toBe(true);
      expect(block.encrypted).toBe(true);
    });

    it('should handle encryption metadata correctly', async () => {
      const data = createEncryptedData(defaultBlockSize as number);
      const block = await createTestBlock({ data });

      // Check header components
      expect(block.ephemeralPublicKey.length).toBe(
        StaticHelpersECIES.publicKeyLength,
      );
      expect(block.iv.length).toBe(StaticHelpersECIES.ivLength);
      expect(block.authTag.length).toBe(StaticHelpersECIES.authTagLength);

      // Check header layout
      expect(block.layerHeaderData.length).toBe(
        StaticHelpersECIES.eciesOverheadLength,
      );
      expect(block.layerHeaderData).toEqual(
        data.subarray(0, StaticHelpersECIES.eciesOverheadLength),
      );
    });

    it('should handle payload correctly', async () => {
      const data = createEncryptedData(defaultBlockSize as number);
      const block = await createTestBlock({
        data,
        actualDataLength:
          (defaultBlockSize as number) - StaticHelpersECIES.eciesOverheadLength,
      });

      // Payload should be everything after the header up to block size
      expect(block.payload.length).toBe(
        (defaultBlockSize as number) - StaticHelpersECIES.eciesOverheadLength,
      );
      expect(block.payloadLength).toBe(defaultBlockSize as number);
      expect(block.metadata.lengthWithoutPadding).toBe(
        (defaultBlockSize as number) - StaticHelpersECIES.eciesOverheadLength,
      );
    });
  });

  describe('size handling', () => {
    it('should handle various block sizes', async () => {
      const sizes = [
        BlockSize.Message,
        BlockSize.Tiny,
        BlockSize.Small,
        BlockSize.Medium,
        BlockSize.Large,
        BlockSize.Huge,
      ];

      for (const size of sizes) {
        const data = createEncryptedData(size as number);
        const block = await createTestBlock({ blockSize: size, data });
        expect(block.data.length).toBe(size as number);
        expect(block.capacity).toBe(
          (size as number) - StaticHelpersECIES.eciesOverheadLength,
        );
      }
    });

    it('should reject invalid sizes', async () => {
      // Test data too short for header
      const tooShortData = randomBytes(
        StaticHelpersECIES.eciesOverheadLength - 1,
      );
      await expect(createTestBlock({ data: tooShortData })).rejects.toThrow(
        BlockValidationError,
      );
      await expect(
        createTestBlock({ data: tooShortData }),
      ).rejects.toMatchObject({
        reason: BlockValidationErrorType.DataLengthTooShort,
      });

      // Test oversized data
      const tooLargeData = createEncryptedData(
        (defaultBlockSize as number) + 1,
      );
      await expect(createTestBlock({ data: tooLargeData })).rejects.toThrow(
        BlockValidationError,
      );
      await expect(
        createTestBlock({ data: tooLargeData }),
      ).rejects.toMatchObject({
        reason: BlockValidationErrorType.DataLengthExceedsCapacity,
      });
    });

    it('should validate actual data length', async () => {
      const data = createEncryptedData(defaultBlockSize as number);
      const tooLargeActualLength =
        (defaultBlockSize as number) -
        StaticHelpersECIES.eciesOverheadLength +
        1;

      await expect(
        createTestBlock({ data, actualDataLength: tooLargeActualLength }),
      ).rejects.toThrow(BlockValidationError);
      await expect(
        createTestBlock({ data, actualDataLength: tooLargeActualLength }),
      ).rejects.toMatchObject({
        reason: BlockValidationErrorType.DataLengthExceedsCapacity,
      });
    });
  });

  describe('validation', () => {
    it('should detect data corruption', async () => {
      // Create original data and get its checksum
      const data = createEncryptedData(defaultBlockSize as number);
      const checksum = StaticHelpersChecksum.calculateChecksum(data);

      // Create corrupted data by modifying the original
      const corruptedData = Buffer.from(data);
      corruptedData[0]++; // Corrupt the header to ensure validation fails

      // Calculate corrupted checksum before the test
      const corruptedChecksum =
        StaticHelpersChecksum.calculateChecksum(corruptedData);

      // Verify block creation fails with corrupted data and check error details
      const error = await createTestBlock({
        data: corruptedData,
        checksum,
      }).catch((e) => e);

      expect(error).toBeInstanceOf(ChecksumMismatchError);
      expect(error instanceof ChecksumMismatchError).toBe(true);
      // The error constructor takes (expected, computed) so the properties are:
      // error.expected = checksum (the one we passed in)
      // error.checksum = corruptedChecksum (the one computed from corrupted data)
      expect(error.expected.toString('hex')).toBe(checksum.toString('hex'));
      expect(error.checksum.toString('hex')).toBe(
        corruptedChecksum.toString('hex'),
      );
    });

    it('should reject future dates', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 1);

      await expect(
        createTestBlock({ dateCreated: futureDate }),
      ).rejects.toMatchObject({
        reason: BlockValidationErrorType.FutureCreationDate,
      });
    });
  });

  describe('encryption handling', () => {
    it('should handle encrypted data correctly', async () => {
      const originalData = randomBytes(
        getEffectiveSize(defaultBlockSize) -
          StaticHelpersECIES.eciesOverheadLength,
      );
      const encryptedData = createEncryptedData(defaultBlockSize as number);
      const block = await createTestBlock({
        data: encryptedData,
        actualDataLength: originalData.length,
      });

      expect(block.encrypted).toBe(true);
      expect(block.data.length).toBe(defaultBlockSize as number);
      expect(block.payload.length).toBe(
        (defaultBlockSize as number) - StaticHelpersECIES.eciesOverheadLength,
      );
      expect(block.metadata.lengthWithoutPadding).toBe(originalData.length);
    });

    it('should calculate overhead correctly', async () => {
      const block = await createTestBlock();
      expect(block.totalOverhead).toBe(StaticHelpersECIES.eciesOverheadLength);
      expect(block.capacity).toBe(
        (defaultBlockSize as number) - StaticHelpersECIES.eciesOverheadLength,
      );
    });
  });
});
