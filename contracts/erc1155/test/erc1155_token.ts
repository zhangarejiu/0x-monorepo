import {
    chaiSetup,
    constants,
    expectTransactionFailedAsync,
    expectTransactionFailedWithoutReasonAsync,
    LogDecoder,
    provider,
    txDefaults,
    web3Wrapper,
} from '@0x/contracts-test-utils';
import { BlockchainLifecycle } from '@0x/dev-utils';
import { RevertReason } from '@0x/types';
import { BigNumber } from '@0x/utils';
import * as chai from 'chai';
import { LogWithDecodedArgs } from 'ethereum-types';
import * as _ from 'lodash';

import {
    artifacts,
    DummyERC1155ReceiverContract,
    DummyERC1155ReceiverTokenReceivedEventArgs,
    DummyERC1155TokenContract,
    //DummyERC1155TokenTransferEventArgs,
    InvalidERC1155ReceiverContract,
    ERC1155TransferSingleEventArgs,
    DummyERC1155ReceiverBatchTokenReceivedEventArgs,
} from '../src';

import { Erc1155Wrapper } from './utils/erc1155_wrapper';

chaiSetup.configure();
const expect = chai.expect;
const blockchainLifecycle = new BlockchainLifecycle(web3Wrapper);
// tslint:disable:no-unnecessary-type-assertion
describe('ERC1155Token', () => {
    const DUMMY_FUNGIBLE_TOKEN_URI = 'FUN';
    const DUMMY_FUNGIBLE_TOKEN_IS_FUNGIBLE = false;
    const DUMMY_NONFUNGIBLE_TOKEN_URI = 'NOFUN';
    const DUMMY_NONFUNGIBLE_TOKEN_IS_FUNGIBLE = true;

    let owner: string;
    let spender: string;
    const spenderInitialBalance = new BigNumber(500);
    const receiverInitialBalance = new BigNumber(0);
    let token: DummyERC1155TokenContract;
    let erc1155Receiver: DummyERC1155ReceiverContract;
    let invalidERC1155Receiver: InvalidERC1155ReceiverContract;
    let logDecoder: LogDecoder;
    const tokenId = new BigNumber(1);
    let dummyNft: BigNumber;
    const nftOwnerBalance = new BigNumber(1);
    const nftNotOwnerBalance = new BigNumber(0);
    let erc1155Wrapper: Erc1155Wrapper;

    let dummyFungibleTokenType: BigNumber;
    let dummyNonFungibleTokenType: BigNumber;

    before(async () => {
        await blockchainLifecycle.startAsync();
    });
    after(async () => {
        await blockchainLifecycle.revertAsync();
    });
    before(async () => {
        const accounts = await web3Wrapper.getAvailableAddressesAsync();
        owner = accounts[0];
        spender = accounts[1];
        token = await DummyERC1155TokenContract.deployFrom0xArtifactAsync(
            artifacts.DummyERC1155Token,
            provider,
            txDefaults,
            constants.DUMMY_TOKEN_NAME,
            constants.DUMMY_TOKEN_SYMBOL,
        );
        erc1155Receiver = await DummyERC1155ReceiverContract.deployFrom0xArtifactAsync(
            artifacts.DummyERC1155Receiver,
            provider,
            txDefaults,
        );
        // create wrapper & mint erc1155 tokens
        erc1155Wrapper = new Erc1155Wrapper(token, provider, owner);
        dummyFungibleTokenType = await erc1155Wrapper.mintFungibleTokenAsync(spender, spenderInitialBalance);
        [dummyNonFungibleTokenType, dummyNft] = await erc1155Wrapper.mintNonFungibleTokenAsync(spender);
    });
    beforeEach(async () => {
        await blockchainLifecycle.startAsync();
    });
    afterEach(async () => {
        await blockchainLifecycle.revertAsync();
    });
    describe('safeTransferFrom', () => {
        it('should transfer fungible token if called by token owner', async () => {
            // setup test parameters
            const from = spender;
            const to = erc1155Receiver.address;
            const fromIdx = 0;
            const toIdx = 1;
            const participatingOwners = [from, to];
            const participatingTokens = [dummyFungibleTokenType, dummyFungibleTokenType];
            const tokenTypesToTransfer = [dummyFungibleTokenType];
            const valueToTransfer = new BigNumber(200);
            const valuesToTransfer = [valueToTransfer];
            const callbackData = constants.NULL_BYTES;
            // check balances before transfer
            const balancesBeforeTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesBeforeTransfer[fromIdx]).to.be.bignumber.equal(spenderInitialBalance);
            expect(balancesBeforeTransfer[toIdx]).to.be.bignumber.equal(receiverInitialBalance);
            // execute transfer
            await erc1155Wrapper.safeTransferFromAsync(
                from,
                to,
                tokenTypesToTransfer[0],
                valuesToTransfer[0],
                callbackData,
            );
            // check balances after transfer
            const balancesAfterTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesAfterTransfer[fromIdx]).to.be.bignumber.equal(
                balancesBeforeTransfer[fromIdx].minus(valueToTransfer),
            );
            expect(balancesAfterTransfer[toIdx]).to.be.bignumber.equal(
                balancesBeforeTransfer[toIdx].plus(valueToTransfer),
            );
        });
        it('should transfer non-fungible token if called by token owner', async () => {
            // setup test parameters
            const from = spender;
            const to = erc1155Receiver.address;
            const fromIdx = 0;
            const toIdx = 1;
            const participatingOwners = [from, to];
            const participatingTokens = [dummyNft, dummyNft];
            const tokenTypesToTransfer = [dummyNft];
            const valueToTransfer = new BigNumber(1);
            const valuesToTransfer = [valueToTransfer];
            const callbackData = constants.NULL_BYTES;
            // check balances before transfer
            const balancesBeforeTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesBeforeTransfer[fromIdx]).to.be.bignumber.equal(nftOwnerBalance);
            expect(balancesBeforeTransfer[toIdx]).to.be.bignumber.equal(nftNotOwnerBalance);
            // execute transfer
            await erc1155Wrapper.safeTransferFromAsync(
                from,
                to,
                tokenTypesToTransfer[0],
                valuesToTransfer[0],
                callbackData,
            );
            // check balances after transfer
            const balancesAfterTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesAfterTransfer[fromIdx]).to.be.bignumber.equal(nftNotOwnerBalance);
            expect(balancesAfterTransfer[toIdx]).to.be.bignumber.equal(nftOwnerBalance);
        });
        it('should trigger callback if transferring to a contract', async () => {
            // setup test parameters
            const from = spender;
            const to = erc1155Receiver.address;
            const fromIdxFungible = 0;
            const toIdxFungible = 1;
            const fromIdxNonFungible = 2;
            const toIdxNonFungible = 3;
            const participatingOwners = [from, to, from, to];
            const participatingTokens = [dummyFungibleTokenType, dummyFungibleTokenType, dummyNft, dummyNft];
            const tokenTypesToTransfer = [dummyFungibleTokenType, dummyNft];
            const fungibleValueToTransfer = new BigNumber(200);
            const nonFungibleValueToTransfer = new BigNumber(1);
            const valuesToTransfer = [fungibleValueToTransfer, nonFungibleValueToTransfer];
            const callbackData = '0x01020304';
            // check balances before transfer
            const balancesBeforeTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesBeforeTransfer[fromIdxFungible]).to.be.bignumber.equal(spenderInitialBalance);
            expect(balancesBeforeTransfer[toIdxFungible]).to.be.bignumber.equal(receiverInitialBalance);
            expect(balancesBeforeTransfer[fromIdxNonFungible]).to.be.bignumber.equal(nftOwnerBalance);
            expect(balancesBeforeTransfer[toIdxNonFungible]).to.be.bignumber.equal(nftNotOwnerBalance);
            // execute transfer
            const tx = await erc1155Wrapper.safeTransferFromAsync(
                from,
                to,
                tokenTypesToTransfer[0],
                valuesToTransfer[0],
                callbackData,
            );
            expect(tx.logs.length).to.be.equal(2);
            const receiverLog = tx.logs[1] as LogWithDecodedArgs<DummyERC1155ReceiverTokenReceivedEventArgs>;
            // check callback logs
            expect(receiverLog.args.operator).to.be.equal(from);
            expect(receiverLog.args.from).to.be.equal(from);
            expect(receiverLog.args.tokenId).to.be.bignumber.equal(tokenTypesToTransfer[0]);
            expect(receiverLog.args.tokenValue).to.be.bignumber.equal(valuesToTransfer[0]);
            expect(receiverLog.args.data).to.be.deep.equal(callbackData);
            // check balances after transfer
            const balancesAfterTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesAfterTransfer[fromIdxFungible]).to.be.bignumber.equal(
                balancesBeforeTransfer[fromIdxFungible].minus(fungibleValueToTransfer),
            );
            expect(balancesAfterTransfer[toIdxFungible]).to.be.bignumber.equal(
                balancesBeforeTransfer[toIdxFungible].plus(fungibleValueToTransfer),
            );
        });
    });
    describe('batchSafeTransferFrom', () => {
        it('should transfer fungible tokens if called by token owner', async () => {
            // setup test parameters
            const from = spender;
            const to = erc1155Receiver.address;
            const fromIdx = 0;
            const toIdx = 1;
            const participatingOwners = [from, to];
            const participatingTokens = [dummyFungibleTokenType, dummyFungibleTokenType];
            const tokenTypesToTransfer = [dummyFungibleTokenType];
            const valueToTransfer = new BigNumber(200);
            const valuesToTransfer = [valueToTransfer];
            const callbackData = constants.NULL_BYTES;
            // check balances before transfer
            const balancesBeforeTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesBeforeTransfer[fromIdx]).to.be.bignumber.equal(spenderInitialBalance);
            expect(balancesBeforeTransfer[toIdx]).to.be.bignumber.equal(receiverInitialBalance);
            // execute transfer
            await erc1155Wrapper.safeBatchTransferFromAsync(
                from,
                to,
                tokenTypesToTransfer,
                valuesToTransfer,
                callbackData,
            );
            // check balances after transfer
            const balancesAfterTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesAfterTransfer[fromIdx]).to.be.bignumber.equal(
                balancesBeforeTransfer[fromIdx].minus(valueToTransfer),
            );
            expect(balancesAfterTransfer[toIdx]).to.be.bignumber.equal(
                balancesBeforeTransfer[toIdx].plus(valueToTransfer),
            );
        });
        it('should transfer non-fungible token if called by token owner', async () => {
            // setup test parameters
            const from = spender;
            const to = erc1155Receiver.address;
            const fromIdx = 0;
            const toIdx = 1;
            const participatingOwners = [from, to];
            const participatingTokens = [dummyNft, dummyNft];
            const tokenTypesToTransfer = [dummyNft];
            const valueToTransfer = new BigNumber(1);
            const valuesToTransfer = [valueToTransfer];
            const callbackData = constants.NULL_BYTES;
            // check balances before transfer
            const balancesBeforeTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesBeforeTransfer[fromIdx]).to.be.bignumber.equal(nftOwnerBalance);
            expect(balancesBeforeTransfer[toIdx]).to.be.bignumber.equal(nftNotOwnerBalance);
            // execute transfer
            await erc1155Wrapper.safeBatchTransferFromAsync(
                from,
                to,
                tokenTypesToTransfer,
                valuesToTransfer,
                callbackData,
            );
            // check balances after transfer
            const balancesAfterTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesAfterTransfer[fromIdx]).to.be.bignumber.equal(nftNotOwnerBalance);
            expect(balancesAfterTransfer[toIdx]).to.be.bignumber.equal(nftOwnerBalance);
        });
        it('should transfer mix of fungible / non-fungible tokens if called by token owner', async () => {
            // setup test parameters
            const from = spender;
            const to = erc1155Receiver.address;
            const fromIdxFungible = 0;
            const toIdxFungible = 1;
            const fromIdxNonFungible = 2;
            const toIdxNonFungible = 3;
            const participatingOwners = [from, to, from, to];
            const participatingTokens = [dummyFungibleTokenType, dummyFungibleTokenType, dummyNft, dummyNft];
            const tokenTypesToTransfer = [dummyFungibleTokenType, dummyNft];
            const fungibleValueToTransfer = new BigNumber(200);
            const nonFungibleValueToTransfer = new BigNumber(1);
            const valuesToTransfer = [fungibleValueToTransfer, nonFungibleValueToTransfer];
            const callbackData = constants.NULL_BYTES;
            // check balances before transfer
            const balancesBeforeTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesBeforeTransfer[fromIdxFungible]).to.be.bignumber.equal(spenderInitialBalance);
            expect(balancesBeforeTransfer[toIdxFungible]).to.be.bignumber.equal(receiverInitialBalance);
            expect(balancesBeforeTransfer[fromIdxNonFungible]).to.be.bignumber.equal(nftOwnerBalance);
            expect(balancesBeforeTransfer[toIdxNonFungible]).to.be.bignumber.equal(nftNotOwnerBalance);
            // execute transfer
            await erc1155Wrapper.safeBatchTransferFromAsync(
                from,
                to,
                tokenTypesToTransfer,
                valuesToTransfer,
                callbackData,
            );
            // check balances after transfer
            const balancesAfterTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesAfterTransfer[fromIdxFungible]).to.be.bignumber.equal(
                balancesBeforeTransfer[fromIdxFungible].minus(fungibleValueToTransfer),
            );
            expect(balancesAfterTransfer[toIdxFungible]).to.be.bignumber.equal(
                balancesBeforeTransfer[toIdxFungible].plus(fungibleValueToTransfer),
            );
            expect(balancesAfterTransfer[fromIdxNonFungible]).to.be.bignumber.equal(nftNotOwnerBalance);
            expect(balancesAfterTransfer[toIdxNonFungible]).to.be.bignumber.equal(nftOwnerBalance);
        });
        it('should trigger callback if transferring to a contract', async () => {
            // setup test parameters
            const from = spender;
            const to = erc1155Receiver.address;
            const fromIdxFungible = 0;
            const toIdxFungible = 1;
            const fromIdxNonFungible = 2;
            const toIdxNonFungible = 3;
            const participatingOwners = [from, to, from, to];
            const participatingTokens = [dummyFungibleTokenType, dummyFungibleTokenType, dummyNft, dummyNft];
            const tokenTypesToTransfer = [dummyFungibleTokenType, dummyNft];
            const fungibleValueToTransfer = new BigNumber(200);
            const nonFungibleValueToTransfer = new BigNumber(1);
            const valuesToTransfer = [fungibleValueToTransfer, nonFungibleValueToTransfer];
            const callbackData = '0x01020304';
            // check balances before transfer
            const balancesBeforeTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesBeforeTransfer[fromIdxFungible]).to.be.bignumber.equal(spenderInitialBalance);
            expect(balancesBeforeTransfer[toIdxFungible]).to.be.bignumber.equal(receiverInitialBalance);
            expect(balancesBeforeTransfer[fromIdxNonFungible]).to.be.bignumber.equal(nftOwnerBalance);
            expect(balancesBeforeTransfer[toIdxNonFungible]).to.be.bignumber.equal(nftNotOwnerBalance);
            // execute transfer
            const tx = await erc1155Wrapper.safeBatchTransferFromAsync(
                from,
                to,
                tokenTypesToTransfer,
                valuesToTransfer,
                callbackData,
            );
            expect(tx.logs.length).to.be.equal(2);
            const receiverLog = tx.logs[1] as LogWithDecodedArgs<
                DummyERC1155ReceiverBatchTokenReceivedEventArgs
            >;
            // check callback logs
            expect(receiverLog.args.operator).to.be.equal(from);
            expect(receiverLog.args.from).to.be.equal(from);
            expect(receiverLog.args.tokenIds.length).to.be.equal(2);
            expect(receiverLog.args.tokenIds[0]).to.be.bignumber.equal(tokenTypesToTransfer[0]);
            expect(receiverLog.args.tokenIds[1]).to.be.bignumber.equal(tokenTypesToTransfer[1]);
            expect(receiverLog.args.tokenValues.length).to.be.equal(2);
            expect(receiverLog.args.tokenValues[0]).to.be.bignumber.equal(valuesToTransfer[0]);
            expect(receiverLog.args.tokenValues[1]).to.be.bignumber.equal(valuesToTransfer[1]);
            expect(receiverLog.args.data).to.be.deep.equal(callbackData);
            // check balances after transfer
            const balancesAfterTransfer = await erc1155Wrapper.getBalancesAsync(
                participatingOwners,
                participatingTokens,
            );
            expect(balancesAfterTransfer[fromIdxFungible]).to.be.bignumber.equal(
                balancesBeforeTransfer[fromIdxFungible].minus(fungibleValueToTransfer),
            );
            expect(balancesAfterTransfer[toIdxFungible]).to.be.bignumber.equal(
                balancesBeforeTransfer[toIdxFungible].plus(fungibleValueToTransfer),
            );
            expect(balancesAfterTransfer[fromIdxNonFungible]).to.be.bignumber.equal(nftNotOwnerBalance);
            expect(balancesAfterTransfer[toIdxNonFungible]).to.be.bignumber.equal(nftOwnerBalance);
        });
        it('should throw if transfer reverts', async () => {
            // setup test parameters
            const from = spender;
            const to = erc1155Receiver.address;
            const fromIdx = 0;
            const toIdx = 1;
            const participatingOwners = [from, to];
            const participatingTokens = [dummyFungibleTokenType, dummyFungibleTokenType];
            const tokenTypesToTransfer = [dummyFungibleTokenType];
            const valueToTransfer = spenderInitialBalance.plus(1);
            const valuesToTransfer = [valueToTransfer];
            const callbackData = constants.NULL_BYTES;
            // execute transfer
            await expectTransactionFailedAsync(
                token.safeBatchTransferFrom.sendTransactionAsync(
                    from,
                    to,
                    tokenTypesToTransfer,
                    valuesToTransfer,
                    callbackData,
                    { from },
                ),
                RevertReason.Uint256Underflow
            );
        });
        it('should throw if callback reverts', async () => {
            // setup test parameters
            const from = spender;
            const to = erc1155Receiver.address;
            const tokenTypesToTransfer = [dummyFungibleTokenType];
            const valueToTransfer = new BigNumber(200);
            const valuesToTransfer = [valueToTransfer];
            const callbackData = constants.NULL_BYTES;
            // set receiver to reject balances
            const shouldRejectTransfer = true;
            await web3Wrapper.awaitTransactionSuccessAsync(
                await erc1155Receiver.setRejectTransferFlag.sendTransactionAsync(
                    shouldRejectTransfer,
                    { to },
                ),
                constants.AWAIT_TRANSACTION_MINED_MS,
            );
             // execute transfer
             await expectTransactionFailedAsync(
                token.safeBatchTransferFrom.sendTransactionAsync(
                    from,
                    to,
                    tokenTypesToTransfer,
                    valuesToTransfer,
                    callbackData,
                    { from },
                ),
                RevertReason.TransferRejected
            );
        });
    });
});
// tslint:enable:no-unnecessary-type-assertion
