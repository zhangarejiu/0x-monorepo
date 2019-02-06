import { devConstants, web3Factory } from '@0x/dev-utils';
import { Web3Wrapper } from '@0x/web3-wrapper';
import { Provider } from 'ethereum-types';

const txDefaults = {
    from: devConstants.TESTRPC_FIRST_ADDRESS,
    gas: devConstants.GAS_LIMIT,
};
const provider: Provider = web3Factory.getRpcProvider({
    shouldUseInProcessGanache: false,
    rpcUrl: 'https://mainnet.infura.io/v3/e2c067d9717e492091d1f1d7a2ec55aa',
});
const web3Wrapper = new Web3Wrapper(provider);

export { provider, web3Wrapper, txDefaults };
