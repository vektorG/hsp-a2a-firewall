// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentReceiptRegistry
/// @notice Append-only settlement receipts written by the authorized recorder.
/// @dev Intentionally dependency-free. Only the deployer (recorded at
///      construction time) may write.
contract AgentReceiptRegistry {
    struct Receipt {
        bytes32 orderIdHash;
        address payer;
        string merchantName;
        address token;
        uint256 amount;
        uint64 settledAt;
    }

    mapping(bytes32 => Receipt) public receipts;

    address public immutable recorder;

    event ReceiptRecorded(
        bytes32 indexed orderIdHash,
        address indexed payer,
        string merchantName,
        address token,
        uint256 amount,
        uint64 settledAt
    );

    error NotRecorder(address caller);
    error ReceiptAlreadyRecorded(bytes32 orderIdHash);

    constructor() {
        recorder = msg.sender;
    }

    modifier onlyRecorder() {
        if (msg.sender != recorder) {
            revert NotRecorder(msg.sender);
        }
        _;
    }

    /// @notice Records a settled payment. One receipt per order id hash.
    function recordReceipt(
        bytes32 orderIdHash,
        string calldata merchantName,
        address token,
        uint256 amount
    ) external onlyRecorder {
        if (receipts[orderIdHash].settledAt != 0) {
            revert ReceiptAlreadyRecorded(orderIdHash);
        }

        uint64 settledAt = uint64(block.timestamp);

        receipts[orderIdHash] = Receipt({
            orderIdHash: orderIdHash,
            payer: msg.sender,
            merchantName: merchantName,
            token: token,
            amount: amount,
            settledAt: settledAt
        });

        emit ReceiptRecorded(
            orderIdHash,
            msg.sender,
            merchantName,
            token,
            amount,
            settledAt
        );
    }
}
