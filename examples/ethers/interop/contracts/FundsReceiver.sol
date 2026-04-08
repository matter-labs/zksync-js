// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract FundsReceiver {
    // Receive messages coming from other chains.
    function receiveMessage(
        bytes32, // Unique identifier
        bytes calldata, // ERC-7930 address
        bytes calldata // payload
    ) external payable returns (bytes4) {
        // Check that it is coming from a trusted caller - interop handler.
        require(
            msg.sender == address(0x000000000000000000000000000000000001000E),
            "message must come from interop handler"
        );
        // Return the function selector to acknowledge receipt
        return this.receiveMessage.selector;
    }
}
