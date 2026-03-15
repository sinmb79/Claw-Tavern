// SPDX-License-Identifier: Unlicense
pragma solidity >=0.6.0 <0.9.0;

contract DSTest {
    event log(string);
    event logs(bytes);
    event log_address(address);
    event log_bytes32(bytes32);
    event log_int(int256);
    event log_uint(uint256);
    event log_bytes(bytes);
    event log_string(string);
    event log_named_address(string key, address val);
    event log_named_bytes32(string key, bytes32 val);
    event log_named_decimal_int(string key, int256 val, uint256 decimals);
    event log_named_decimal_uint(string key, uint256 val, uint256 decimals);
    event log_named_int(string key, int256 val);
    event log_named_uint(string key, uint256 val);
    event log_named_bytes(string key, bytes val);
    event log_named_string(string key, string val);

    bool public IS_TEST = true;

    function fail() internal virtual {
        assert(false);
    }

    function assertTrue(bool condition) internal virtual {
        if (!condition) {
            fail();
        }
    }

    function assertTrue(bool condition, string memory) internal virtual {
        assertTrue(condition);
    }
}
