import { MAX_ENCRYPTED_LOGS_PER_TX, MAX_UNENCRYPTED_LOGS_PER_TX } from '@aztec/circuits.js';
import { sha256Trunc } from '@aztec/foundation/crypto';
import { BufferReader, prefixBufferWithLength } from '@aztec/foundation/serialize';

import isEqual from 'lodash.isequal';

import { type EncryptedL2Log } from './encrypted_l2_log.js';
import { EncryptedFunctionL2Logs, type FunctionL2Logs, UnencryptedFunctionL2Logs } from './function_l2_logs.js';
import { type UnencryptedL2Log } from './unencrypted_l2_log.js';

/**
 * Data container of logs emitted in 1 tx.
 */
export abstract class TxL2Logs<TLog extends UnencryptedL2Log | EncryptedL2Log> {
  constructor(
    /** * An array containing logs emitted in individual function invocations in this tx. */
    public readonly functionLogs: FunctionL2Logs<TLog>[],
  ) {}

  /**
   * Serializes logs into a buffer.
   * @returns A buffer containing the serialized logs.
   */
  public toBuffer(): Buffer {
    const serializedFunctionLogs = this.functionLogs.map(logs => logs.toBuffer());
    // Concatenate all serialized function logs into a single buffer and prefix it with 4 bytes for its total length.
    return prefixBufferWithLength(Buffer.concat(serializedFunctionLogs));
  }

  /**
   * Get the total length of serialized data.
   * @returns Total length of serialized data.
   */
  public getSerializedLength(): number {
    return this.functionLogs.reduce((acc, logs) => acc + logs.getSerializedLength(), 0) + 4;
  }

  /** Gets the total number of logs. */
  public getTotalLogCount() {
    return this.functionLogs.reduce((acc, logs) => acc + logs.logs.length, 0);
  }

  /**
   * Adds function logs to the existing logs.
   * @param functionLogs - The function logs to add
   * @remarks Used by sequencer to append unencrypted logs emitted in public function calls.
   */
  public addFunctionLogs(functionLogs: FunctionL2Logs<TLog>[]) {
    this.functionLogs.push(...functionLogs);
  }

  /**
   * Convert a TxL2Logs class object to a plain JSON object.
   * @returns A plain object with TxL2Logs properties.
   */
  public toJSON() {
    return {
      functionLogs: this.functionLogs.map(log => log.toJSON()),
    };
  }

  /**
   * Unrolls logs from this tx.
   * @returns Unrolled logs.
   */
  public unrollLogs(): TLog[] {
    return this.functionLogs.flatMap(functionLog => functionLog.logs);
  }

  /**
   * Checks if two TxL2Logs objects are equal.
   * @param other - Another TxL2Logs object to compare with.
   * @returns True if the two objects are equal, false otherwise.
   */
  public equals(other: TxL2Logs<TLog>): boolean {
    return isEqual(this, other);
  }

  /**
   * Computes logs hash as is done in the kernel and app circuits.
   * @param logs - Logs to be hashed.
   * @returns The hash of the logs.
   * Note: This is a TS implementation of `computeKernelLogsHash` function in Decoder.sol. See that function documentation
   *       for more details.
   */
  public hash(): Buffer {
    if (this.unrollLogs().length == 0) {
      return Buffer.alloc(32);
    }

    let flattenedLogs = Buffer.alloc(0);
    for (const logsFromSingleFunctionCall of this.unrollLogs()) {
      flattenedLogs = Buffer.concat([flattenedLogs, logsFromSingleFunctionCall.hash()]);
    }
    // pad the end of logs with 0s
    // NB - This assumes MAX_ENCRYPTED_LOGS_PER_TX == MAX_UNENCRYPTED_LOGS_PER_TX
    for (let i = 0; i < MAX_ENCRYPTED_LOGS_PER_TX - this.unrollLogs().length; i++) {
      flattenedLogs = Buffer.concat([flattenedLogs, Buffer.alloc(32)]);
    }

    return sha256Trunc(flattenedLogs);
  }
}

export class UnencryptedTxL2Logs extends TxL2Logs<UnencryptedL2Log> {
  /** Creates an empty instance. */
  public static empty() {
    return new UnencryptedTxL2Logs([]);
  }

  /**
   * Deserializes logs from a buffer.
   * @param buf - The buffer containing the serialized logs.
   * @param isLengthPrefixed - Whether the buffer is prefixed with 4 bytes for its total length.
   * @returns A new L2Logs object.
   */
  public static fromBuffer(buf: Buffer | BufferReader, isLengthPrefixed = true): UnencryptedTxL2Logs {
    const reader = BufferReader.asReader(buf);

    // If the buffer is length prefixed use the length to read the array. Otherwise, the entire buffer is consumed.
    const logsBufLength = isLengthPrefixed ? reader.readNumber() : -1;
    const serializedFunctionLogs = reader.readBufferArray(logsBufLength);

    const functionLogs = serializedFunctionLogs.map(logs => UnencryptedFunctionL2Logs.fromBuffer(logs, false));
    return new UnencryptedTxL2Logs(functionLogs);
  }

  /**
   * Creates a new `TxL2Logs` object with `numCalls` function logs and `numLogsPerCall` logs in each invocation.
   * @param numCalls - The number of function calls in the tx.
   * @param numLogsPerCall - The number of logs emitted in each function call.
   * @param logType - The type of logs to generate.
   * @returns A new `TxL2Logs` object.
   */
  public static random(numCalls: number, numLogsPerCall: number): UnencryptedTxL2Logs {
    if (numCalls * numLogsPerCall > MAX_UNENCRYPTED_LOGS_PER_TX) {
      throw new Error(
        `Trying to create ${numCalls * numLogsPerCall} logs for one tx (max: ${MAX_UNENCRYPTED_LOGS_PER_TX})`,
      );
    }
    const functionLogs: UnencryptedFunctionL2Logs[] = [];
    for (let i = 0; i < numCalls; i++) {
      functionLogs.push(UnencryptedFunctionL2Logs.random(numLogsPerCall));
    }
    return new UnencryptedTxL2Logs(functionLogs);
  }

  /**
   * Convert a plain JSON object to a TxL2Logs class object.
   * @param obj - A plain TxL2Logs JSON object.
   * @returns A TxL2Logs class object.
   */
  public static fromJSON(obj: any) {
    const functionLogs = obj.functionLogs.map((log: any) => UnencryptedFunctionL2Logs.fromJSON(log));
    return new UnencryptedTxL2Logs(functionLogs);
  }
}

export class EncryptedTxL2Logs extends TxL2Logs<EncryptedL2Log> {
  /** Creates an empty instance. */
  public static empty() {
    return new EncryptedTxL2Logs([]);
  }

  /**
   * Deserializes logs from a buffer.
   * @param buf - The buffer containing the serialized logs.
   * @param isLengthPrefixed - Whether the buffer is prefixed with 4 bytes for its total length.
   * @returns A new L2Logs object.
   */
  public static fromBuffer(buf: Buffer | BufferReader, isLengthPrefixed = true): EncryptedTxL2Logs {
    const reader = BufferReader.asReader(buf);

    // If the buffer is length prefixed use the length to read the array. Otherwise, the entire buffer is consumed.
    const logsBufLength = isLengthPrefixed ? reader.readNumber() : -1;
    const serializedFunctionLogs = reader.readBufferArray(logsBufLength);

    const functionLogs = serializedFunctionLogs.map(logs => EncryptedFunctionL2Logs.fromBuffer(logs, false));
    return new EncryptedTxL2Logs(functionLogs);
  }

  /**
   * Creates a new `TxL2Logs` object with `numCalls` function logs and `numLogsPerCall` logs in each invocation.
   * @param numCalls - The number of function calls in the tx.
   * @param numLogsPerCall - The number of logs emitted in each function call.
   * @param logType - The type of logs to generate.
   * @returns A new `TxL2Logs` object.
   */
  public static random(numCalls: number, numLogsPerCall: number): EncryptedTxL2Logs {
    if (numCalls * numLogsPerCall > MAX_ENCRYPTED_LOGS_PER_TX) {
      throw new Error(
        `Trying to create ${numCalls * numLogsPerCall} logs for one tx (max: ${MAX_ENCRYPTED_LOGS_PER_TX})`,
      );
    }
    const functionLogs: EncryptedFunctionL2Logs[] = [];
    for (let i = 0; i < numCalls; i++) {
      functionLogs.push(EncryptedFunctionL2Logs.random(numLogsPerCall));
    }
    return new EncryptedTxL2Logs(functionLogs);
  }

  /**
   * Convert a plain JSON object to a TxL2Logs class object.
   * @param obj - A plain TxL2Logs JSON object.
   * @returns A TxL2Logs class object.
   */
  public static fromJSON(obj: any) {
    const functionLogs = obj.functionLogs.map((log: any) => EncryptedFunctionL2Logs.fromJSON(log));
    return new EncryptedTxL2Logs(functionLogs);
  }
}
