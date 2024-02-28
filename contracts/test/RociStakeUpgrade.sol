// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../RociStake.sol";

contract RociStakeUpgrade is RociStake {
    function version() external pure returns (string memory) {
        return "v2";
    }
}
