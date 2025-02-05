import { type Wallet } from '@aztec/aztec.js';
import { ChildContract, ParentContract } from '@aztec/noir-contracts.js';

import { setup } from './fixtures/utils.js';

describe('e2e_static_calls', () => {
  let wallet: Wallet;
  let parentContract: ParentContract;
  let childContract: ChildContract;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    ({ teardown, wallet } = await setup());
    parentContract = await ParentContract.deploy(wallet).send().deployed();
    childContract = await ChildContract.deploy(wallet).send().deployed();

    // We create a note in the set, such that later reads doesn't fail due to get_notes returning 0 notes
    await childContract.methods.private_set_value(42n, wallet.getCompleteAddress().address).send().wait();
  });

  afterAll(() => teardown());

  describe('parent calls child', () => {
    it('performs legal private to private static calls', async () => {
      await parentContract.methods
        .private_static_call(childContract.address, childContract.methods.private_get_value.selector, [
          42n,
          wallet.getCompleteAddress().address,
        ])
        .send()
        .wait();
    });

    it('performs legal (nested) private to private static calls', async () => {
      await parentContract.methods
        .private_nested_static_call(childContract.address, childContract.methods.private_get_value.selector, [
          42n,
          wallet.getCompleteAddress().address,
        ])
        .send()
        .wait();
    });

    it('performs legal public to public static calls', async () => {
      await parentContract.methods
        .public_static_call(childContract.address, childContract.methods.pub_get_value.selector, [42n])
        .send()
        .wait();
    });

    it('performs legal (nested) public to public static calls', async () => {
      await parentContract.methods
        .public_nested_static_call(childContract.address, childContract.methods.pub_get_value.selector, [42n])
        .send()
        .wait();
    });

    it('performs legal enqueued public static calls', async () => {
      await parentContract.methods
        .enqueue_static_call_to_pub_function(childContract.address, childContract.methods.pub_get_value.selector, [42n])
        .send()
        .wait();
    });

    it('performs legal (nested) enqueued public static calls', async () => {
      await parentContract.methods
        .enqueue_static_nested_call_to_pub_function(
          childContract.address,
          childContract.methods.pub_get_value.selector,
          [42n],
        )
        .send()
        .wait();
    });

    it('fails when performing illegal private to private static calls', async () => {
      await expect(
        parentContract.methods
          .private_static_call(childContract.address, childContract.methods.private_set_value.selector, [
            42n,
            wallet.getCompleteAddress().address,
          ])
          .send()
          .wait(),
      ).rejects.toThrow('Static call cannot create new notes, emit L2->L1 messages or generate logs');
    });

    it('fails when performing illegal (nested) private to private static calls', async () => {
      await expect(
        parentContract.methods
          .private_nested_static_call(childContract.address, childContract.methods.private_set_value.selector, [
            42n,
            wallet.getCompleteAddress().address,
          ])
          .send()
          .wait(),
      ).rejects.toThrow('Static call cannot create new notes, emit L2->L1 messages or generate logs');
    });

    it('fails when performing illegal public to public static calls', async () => {
      await expect(
        parentContract.methods
          .public_static_call(childContract.address, childContract.methods.pub_set_value.selector, [42n])
          .send()
          .wait(),
      ).rejects.toThrow('Static call cannot update the state, emit L2->L1 messages or generate logs');
    });

    it('fails when performing illegal (nested) public to public static calls', async () => {
      await expect(
        parentContract.methods
          .public_nested_static_call(childContract.address, childContract.methods.pub_set_value.selector, [42n])
          .send()
          .wait(),
      ).rejects.toThrow('Static call cannot update the state, emit L2->L1 messages or generate logs');
    });

    it('fails when performing illegal enqueued public static calls', async () => {
      await expect(
        parentContract.methods
          .enqueue_static_call_to_pub_function(childContract.address, childContract.methods.pub_set_value.selector, [
            42n,
          ])
          .send()
          .wait(),
      ).rejects.toThrow('Static call cannot update the state, emit L2->L1 messages or generate logs');
    });

    it('fails when performing illegal (nested) enqueued public static calls', async () => {
      await expect(
        parentContract.methods
          .enqueue_static_nested_call_to_pub_function(
            childContract.address,
            childContract.methods.pub_set_value.selector,
            [42n],
          )
          .send()
          .wait(),
      ).rejects.toThrow('Static call cannot update the state, emit L2->L1 messages or generate logs');
    });
  });
});
