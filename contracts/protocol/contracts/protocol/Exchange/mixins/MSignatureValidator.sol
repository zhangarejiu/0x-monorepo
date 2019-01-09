/*

  Copyright 2018 ZeroEx Intl.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

*/

pragma solidity ^0.4.24;

import "@0x/contracts-interfaces/contracts/protocol/Exchange/ISignatureValidator.sol";

contract MSignatureValidator is ISignatureValidator {
    event SignatureValidatorApproval(
        address indexed signerAddress, // Address that approves or disapproves a contract to verify signatures.
        address indexed validatorAddress, // Address of signature validator contract.
        bool approved // Approval or disapproval of validator contract.
    );

    // Allowed signature types.
    enum SignatureType {Illegal, Invalid, EIP712, EthSign, Wallet, Validator, PreSigned, NSignatureTypes} // 0x00, default value // 0x01 // 0x02 // 0x03 // 0x04 // 0x05 // 0x06 // 0x07, number of signature types. Always leave at end.

    /// @dev Verifies signature using logic defined by Wallet contract.
    /// @param hash Any 32 byte hash.
    /// @param walletAddress Address that should have signed the given hash
    ///                      and defines its own signature verification method.
    /// @param signature Proof that the hash has been signed by signer.
    /// @return True if the address recovered from the provided signature matches the input signer address.
    function isValidWalletSignature(
        bytes32 hash,
        address walletAddress,
        bytes signature
    ) internal view returns (bool isValid);

    /// @dev Verifies signature using logic defined by Validator contract.
    /// @param validatorAddress Address of validator contract.
    /// @param hash Any 32 byte hash.
    /// @param signerAddress Address that should have signed the given hash.
    /// @param signature Proof that the hash has been signed by signer.
    /// @return True if the address recovered from the provided signature matches the input signer address.
    function isValidValidatorSignature(
        address validatorAddress,
        bytes32 hash,
        address signerAddress,
        bytes signature
    ) internal view returns (bool isValid);
}
