import { type AccountWallet, AztecAddress, Fr, type PXE } from '@aztec/aztec.js';
import { CompleteAddress, GeneratorIndex, type PartialAddress, Point, deriveKeys } from '@aztec/circuits.js';
import { poseidon2Hash } from '@aztec/foundation/crypto';
import { KeyRegistryContract, TestContract } from '@aztec/noir-contracts.js';
import { getCanonicalKeyRegistryAddress } from '@aztec/protocol-contracts/key-registry';

import { jest } from '@jest/globals';

import { publicDeployAccounts, setup } from './fixtures/utils.js';

const TIMEOUT = 100_000;

const SHARED_MUTABLE_DELAY = 5;

describe('Key Registry', () => {
  let keyRegistry: KeyRegistryContract;

  let pxe: PXE;
  let testContract: TestContract;
  jest.setTimeout(TIMEOUT);

  let wallets: AccountWallet[];

  let teardown: () => Promise<void>;

  // TODO(#5834): use AztecAddress.compute or smt
  const {
    masterNullifierPublicKey,
    masterIncomingViewingPublicKey,
    masterOutgoingViewingPublicKey,
    masterTaggingPublicKey,
    publicKeysHash,
  } = deriveKeys(Fr.random());
  const partialAddress: PartialAddress = Fr.random();
  let account: AztecAddress;

  beforeAll(async () => {
    ({ teardown, pxe, wallets } = await setup(3));
    keyRegistry = await KeyRegistryContract.at(getCanonicalKeyRegistryAddress(), wallets[0]);

    testContract = await TestContract.deploy(wallets[0]).send().deployed();

    await publicDeployAccounts(wallets[0], wallets.slice(0, 2));

    // TODO(#5834): use AztecAddress.compute or smt
    account = AztecAddress.fromField(
      poseidon2Hash([publicKeysHash, partialAddress, GeneratorIndex.CONTRACT_ADDRESS_V1]),
    );
  });

  const crossDelay = async () => {
    for (let i = 0; i < SHARED_MUTABLE_DELAY; i++) {
      // We send arbitrary tx to mine a block
      await testContract.methods.emit_unencrypted(0).send().wait();
    }
  };

  afterAll(() => teardown());

  describe('failure cases', () => {
    it('throws when address preimage check fails', async () => {
      const keys = [
        masterNullifierPublicKey,
        masterIncomingViewingPublicKey,
        masterOutgoingViewingPublicKey,
        masterTaggingPublicKey,
      ];

      // We randomly invalidate some of the keys
      keys[Math.floor(Math.random() * keys.length)] = Point.random();

      await expect(
        keyRegistry
          .withWallet(wallets[0])
          .methods.register(AztecAddress.fromField(account), partialAddress, keys[0], keys[1], keys[2], keys[3])
          .send()
          .wait(),
      ).rejects.toThrow('Computed address does not match supplied address');
    });

    it('should fail when we try to rotate keys for another address without authwit', async () => {
      await expect(
        keyRegistry
          .withWallet(wallets[0])
          .methods.rotate_nullifier_public_key(wallets[1].getAddress(), Point.random(), Fr.ZERO)
          .send()
          .wait(),
      ).rejects.toThrow('Assertion failed: Message not authorized by account');
    });

    it('fresh key lib fails for non-existent account', async () => {
      // Should fail as the contract is not registered in key registry

      const randomAddress = AztecAddress.random();
      const randomMasterNullifierPublicKey = Point.random();

      await expect(
        testContract.methods.test_nullifier_key_freshness(randomAddress, randomMasterNullifierPublicKey).send().wait(),
      ).rejects.toThrow(`Cannot satisfy constraint 'computed_address.eq(address)'`);
    });
  });

  it('fresh key lib succeeds for non-registered account available in PXE', async () => {
    // TODO(#5834): Make this not disgusting
    const newAccountKeys = deriveKeys(Fr.random());
    const newAccountPartialAddress = Fr.random();
    const newAccount = AztecAddress.fromField(
      poseidon2Hash([newAccountKeys.publicKeysHash, newAccountPartialAddress, GeneratorIndex.CONTRACT_ADDRESS_V1]),
    );
    const newAccountCompleteAddress = CompleteAddress.create(
      newAccount,
      newAccountKeys.masterIncomingViewingPublicKey,
      newAccountPartialAddress,
    );

    await pxe.registerRecipient(newAccountCompleteAddress, [
      newAccountKeys.masterNullifierPublicKey,
      newAccountKeys.masterIncomingViewingPublicKey,
      newAccountKeys.masterOutgoingViewingPublicKey,
      newAccountKeys.masterTaggingPublicKey,
    ]);

    // Should succeed as the account is now registered as a recipient in PXE
    await testContract.methods
      .test_nullifier_key_freshness(newAccount, newAccountKeys.masterNullifierPublicKey)
      .send()
      .wait();
  });

  describe('key registration flow', () => {
    it('registers', async () => {
      await keyRegistry
        .withWallet(wallets[0])
        .methods.register(
          account,
          partialAddress,
          masterNullifierPublicKey,
          masterIncomingViewingPublicKey,
          masterOutgoingViewingPublicKey,
          masterTaggingPublicKey,
        )
        .send()
        .wait();

      // We check if our registered nullifier key is equal to the key obtained from the getter by
      // reading our registry contract from the test contract. We expect this to fail because the change has not been applied yet
      const emptyNullifierPublicKeyX = await testContract.methods
        .test_shared_mutable_private_getter_for_registry_contract(1, account)
        .simulate();

      expect(new Fr(emptyNullifierPublicKeyX)).toEqual(Fr.ZERO);

      // We check it again after a delay and expect that the change has been applied and consequently the assert is true
      await crossDelay();

      const nullifierPublicKeyX = await testContract.methods
        .test_shared_mutable_private_getter_for_registry_contract(1, account)
        .simulate();

      expect(new Fr(nullifierPublicKeyX)).toEqual(masterNullifierPublicKey.x);
    });

    // Note: This test case is dependent on state from the previous one
    it('key lib succeeds for registered account', async () => {
      // Should succeed as the account is registered in key registry from tests before
      await testContract.methods.test_nullifier_key_freshness(account, masterNullifierPublicKey).send().wait();
    });
  });

  describe('key rotation flows', () => {
    const firstNewMasterNullifierPublicKey = Point.random();
    const secondNewMasterNullifierPublicKey = Point.random();

    it('rotates npk_m', async () => {
      await keyRegistry
        .withWallet(wallets[0])
        .methods.rotate_nullifier_public_key(wallets[0].getAddress(), firstNewMasterNullifierPublicKey, Fr.ZERO)
        .send()
        .wait();

      // We check if our rotated nullifier key is equal to the key obtained from the getter by reading our registry
      // contract from the test contract. We expect this to fail because the change has not been applied yet
      const emptyNullifierPublicKeyX = await testContract.methods
        .test_shared_mutable_private_getter_for_registry_contract(1, wallets[0].getAddress())
        .simulate();

      expect(new Fr(emptyNullifierPublicKeyX)).toEqual(Fr.ZERO);

      // We check it again after a delay and expect that the change has been applied and consequently the assert is true
      await crossDelay();

      const nullifierPublicKeyX = await testContract.methods
        .test_shared_mutable_private_getter_for_registry_contract(1, wallets[0].getAddress())
        .simulate();

      expect(new Fr(nullifierPublicKeyX)).toEqual(firstNewMasterNullifierPublicKey.x);
    });

    it(`rotates npk_m with authwit`, async () => {
      const action = keyRegistry
        .withWallet(wallets[1])
        .methods.rotate_nullifier_public_key(wallets[0].getAddress(), secondNewMasterNullifierPublicKey, Fr.ZERO);

      await wallets[0]
        .setPublicAuthWit({ caller: wallets[1].getCompleteAddress().address, action }, true)
        .send()
        .wait();

      await action.send().wait();

      // We get the old nullifier key as the change has not been applied yet
      const oldNullifierPublicKeyX = await testContract.methods
        .test_shared_mutable_private_getter_for_registry_contract(1, wallets[0].getAddress())
        .simulate();

      expect(new Fr(oldNullifierPublicKeyX)).toEqual(firstNewMasterNullifierPublicKey.x);

      await crossDelay();

      // We get the new nullifier key as the change has been applied
      const newNullifierPublicKeyX = await testContract.methods
        .test_shared_mutable_private_getter_for_registry_contract(1, wallets[0].getAddress())
        .simulate();

      expect(new Fr(newNullifierPublicKeyX)).toEqual(secondNewMasterNullifierPublicKey.x);
    });

    it('fresh key lib gets new key after rotation', async () => {
      // Change has been applied hence should succeed now
      await testContract.methods
        .test_nullifier_key_freshness(wallets[0].getAddress(), secondNewMasterNullifierPublicKey)
        .send()
        .wait();
    });
  });
});
