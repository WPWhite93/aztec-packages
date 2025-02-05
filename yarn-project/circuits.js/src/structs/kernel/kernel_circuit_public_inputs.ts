import type { Fr } from '@aztec/foundation/fields';
import { BufferReader, serializeToBuffer } from '@aztec/foundation/serialize';

import { AggregationObject } from '../aggregation_object.js';
import { PartialStateReference } from '../partial_state_reference.js';
import { RevertCode } from '../revert_code.js';
import { RollupValidationRequests } from '../rollup_validation_requests.js';
import { CombinedAccumulatedData } from './combined_accumulated_data.js';
import { CombinedConstantData } from './combined_constant_data.js';

/**
 * Outputs from the public kernel circuits.
 * All Public kernels use this shape for outputs.
 */
export class KernelCircuitPublicInputs {
  constructor(
    /**
     * Aggregated proof of all the previous kernel iterations.
     */
    public aggregationObject: AggregationObject, // Contains the aggregated proof of all previous kernel iterations
    /**
     * Validation requests accumulated from private and public execution to be completed by the rollup.
     */
    public rollupValidationRequests: RollupValidationRequests,
    /**
     * Data accumulated from both public and private circuits.
     */
    public end: CombinedAccumulatedData,
    /**
     * Data which is not modified by the circuits.
     */
    public constants: CombinedConstantData,
    public startState: PartialStateReference,
    /**
     * Flag indicating whether the transaction reverted.
     */
    public revertCode: RevertCode,
  ) {}

  getNonEmptyNullifiers() {
    return this.end.newNullifiers.filter(n => !n.isZero());
  }

  // Note: it is safe to compute this method in typescript
  // because we compute the transaction_fee ourselves in the base rollup.
  // This value must match the value computed in the base rollup,
  // otherwise the content commitment of the block will be invalid.
  get transactionFee(): Fr {
    return this.end.gasUsed
      .computeFee(this.constants.globalVariables.gasFees)
      .add(this.constants.txContext.gasSettings.inclusionFee);
  }

  toBuffer() {
    return serializeToBuffer(
      this.aggregationObject,
      this.rollupValidationRequests,
      this.end,
      this.constants,
      this.startState,
      this.revertCode,
    );
  }

  /**
   * Deserializes from a buffer or reader, corresponding to a write in cpp.
   * @param buffer - Buffer or reader to read from.
   * @returns A new instance of KernelCircuitPublicInputs.
   */
  static fromBuffer(buffer: Buffer | BufferReader): KernelCircuitPublicInputs {
    const reader = BufferReader.asReader(buffer);
    return new KernelCircuitPublicInputs(
      reader.readObject(AggregationObject),
      reader.readObject(RollupValidationRequests),
      reader.readObject(CombinedAccumulatedData),
      reader.readObject(CombinedConstantData),
      reader.readObject(PartialStateReference),
      reader.readObject(RevertCode),
    );
  }

  static empty() {
    return new KernelCircuitPublicInputs(
      AggregationObject.makeFake(),
      RollupValidationRequests.empty(),
      CombinedAccumulatedData.empty(),
      CombinedConstantData.empty(),
      PartialStateReference.empty(),
      RevertCode.OK,
    );
  }

  toString() {
    return this.toBuffer().toString('hex');
  }

  static fromString(str: string) {
    return KernelCircuitPublicInputs.fromBuffer(Buffer.from(str, 'hex'));
  }
}
