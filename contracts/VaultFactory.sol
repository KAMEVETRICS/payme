// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PayerVault, IERC20} from "./PayerVault.sol";

/// @title VaultFactory
/// @notice Deploys one PayerVault per business. The business's wallet is the vault's
///         owner from the start; whoever calls this gets no rights over the vault. Every
///         vault may hold and pay the factory's tokens (USDC and EURC on Arc).
contract VaultFactory {
    IERC20[] private _tokens;

    event VaultCreated(address indexed owner, address indexed vault, address agent);

    constructor(IERC20[] memory tokens_) {
        _tokens = tokens_;
    }

    function tokens() external view returns (IERC20[] memory) {
        return _tokens;
    }

    /// @param cap The starting cap for each token, in that token's units.
    function createVault(address owner, address agent, uint256 cap, uint256 expiresAt, uint256 payeeDelay)
        external
        returns (PayerVault vault)
    {
        vault = new PayerVault(_tokens, owner, agent, cap, expiresAt, payeeDelay);
        emit VaultCreated(owner, address(vault), agent);
    }
}
