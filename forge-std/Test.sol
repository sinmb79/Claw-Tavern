// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../ds-test/test.sol";
import "./Vm.sol";

abstract contract Test is DSTest {
    address private constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));
    Vm internal constant vm = Vm(VM_ADDRESS);

    function bound(uint256 x, uint256 min, uint256 max) public pure returns (uint256 result) {
        require(min <= max, "bound: min > max");

        unchecked {
            uint256 size = max - min + 1;
            if (size == 0) {
                return x;
            }
            return min + (x % size);
        }
    }

    function assertFalse(bool condition) internal {
        assertTrue(!condition);
    }

    function assertFalse(bool condition, string memory err) internal {
        assertTrue(!condition, err);
    }

    function assertEq(uint256 a, uint256 b) internal {
        if (a != b) {
            fail();
        }
    }

    function assertEq(uint256 a, uint256 b, string memory err) internal {
        if (a != b) {
            fail(err);
        }
    }

    function assertEq(address a, address b) internal {
        if (a != b) {
            fail();
        }
    }

    function assertEq(address a, address b, string memory err) internal {
        if (a != b) {
            fail(err);
        }
    }

    function fail(string memory) internal virtual {
        fail();
    }
}
