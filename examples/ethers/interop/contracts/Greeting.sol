// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Greeting {
    string public message;
    bytes public lastSender;

    constructor() {
        message = "initialized";
        lastSender = "";
    }

    // ERC-7930 receiveMessage function
    // Receive messages coming from other chains.
    function receiveMessage(
        bytes32, // Unique identifier
        bytes calldata sender, // ERC-7930 address
        bytes calldata payload
    ) external payable returns (bytes4) {
        // Check that it is coming from a trusted caller - interop handler.
        require(
            msg.sender == address(0x000000000000000000000000000000000001000E),
            "message must come from interop handler"
        );

        // Decode the payload to extract the greeting message

        string memory newMessage = abi.decode(payload, (string));
        message = newMessage;
        lastSender = sender;

        // Return the function selector to acknowledge receipt
        return this.receiveMessage.selector;
    }
}
