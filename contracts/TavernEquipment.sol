// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract TavernEquipment is ERC1155, AccessControl, ReentrancyGuard {
    bytes32 public constant ADMIN_ROLE = DEFAULT_ADMIN_ROLE;
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant GUILD_ROLE = keccak256("GUILD_ROLE");

    enum Category {
        EQUIPMENT,
        TITLE,
        GUILD_DECORATION,
        SPECIAL,
        CONTRIBUTOR
    }

    enum Rarity {
        COMMON,
        UNCOMMON,
        RARE,
        EPIC,
        LEGENDARY,
        MYTHIC
    }

    enum Slot {
        NONE,
        HEAD,
        BODY,
        WEAPON,
        SHIELD,
        CLOAK,
        ACCESSORY
    }

    struct ItemDef {
        Category category;
        Rarity rarity;
        Slot slot;
        uint256 maxSupply;
        bool soulbound;
        bool active;
        string name;
    }

    struct EquipmentLoadout {
        uint256 head;
        uint256 body;
        uint256 weapon;
        uint256 shield;
        uint256 cloak;
        uint256 accessory;
    }

    mapping(uint256 => ItemDef) public items;
    mapping(uint256 => uint256) public totalMinted;
    mapping(uint256 => uint256[]) private _levelRewards;
    mapping(address => EquipmentLoadout) private _loadouts;
    mapping(address => uint256) public activeTitle;

    uint256 public itemCount;

    event ItemRegistered(
        uint256 indexed tokenId,
        Category category,
        Rarity rarity,
        Slot slot,
        uint256 maxSupply,
        bool soulbound,
        string name
    );
    event ItemActiveSet(uint256 indexed tokenId, bool active);
    event ItemMinted(address indexed to, uint256 indexed tokenId, uint256 totalMinted);
    event LevelRewardsSet(uint256 indexed level, uint256 count);
    event Equipped(address indexed user, uint256 indexed tokenId, Slot slot);
    event Unequipped(address indexed user, Slot slot);
    event TitleEquipped(address indexed user, uint256 indexed tokenId);
    event BaseUriUpdated(string newUri);

    constructor(string memory baseUri) ERC1155(baseUri) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function registerItem(
        uint256 tokenId,
        Category category,
        Rarity rarity,
        Slot slot,
        uint256 maxSupply,
        bool soulbound,
        string calldata name
    ) external onlyRole(ADMIN_ROLE) {
        _registerItem(tokenId, category, rarity, slot, maxSupply, soulbound, name);
    }

    function registerItemBatch(
        uint256[] calldata tokenIds,
        Category[] calldata categories,
        Rarity[] calldata rarities,
        Slot[] calldata slots,
        uint256[] calldata maxSupplies,
        bool[] calldata soulbounds,
        string[] calldata names
    ) external onlyRole(ADMIN_ROLE) {
        uint256 length = tokenIds.length;
        require(
            length == categories.length
                && length == rarities.length
                && length == slots.length
                && length == maxSupplies.length
                && length == soulbounds.length
                && length == names.length,
            "Length mismatch"
        );

        for (uint256 i = 0; i < length;) {
            _registerItem(
                tokenIds[i],
                categories[i],
                rarities[i],
                slots[i],
                maxSupplies[i],
                soulbounds[i],
                names[i]
            );
            unchecked {
                ++i;
            }
        }
    }

    function setItemActive(uint256 tokenId, bool active) external onlyRole(ADMIN_ROLE) {
        require(bytes(items[tokenId].name).length > 0, "Item not found");
        items[tokenId].active = active;
        emit ItemActiveSet(tokenId, active);
    }

    function setURI(string calldata newUri) external onlyRole(ADMIN_ROLE) {
        _setURI(newUri);
        emit BaseUriUpdated(newUri);
    }

    function setLevelRewards(uint256 level, uint256[] calldata tokenIds) external onlyRole(ADMIN_ROLE) {
        delete _levelRewards[level];
        uint256 length = tokenIds.length;
        for (uint256 i = 0; i < length;) {
            require(bytes(items[tokenIds[i]].name).length > 0, "Reward item missing");
            _levelRewards[level].push(tokenIds[i]);
            unchecked {
                ++i;
            }
        }
        emit LevelRewardsSet(level, length);
    }

    function mintLevelReward(address to, uint256 newLevel) external onlyRole(MINTER_ROLE) nonReentrant {
        uint256[] storage rewards = _levelRewards[newLevel];
        uint256 length = rewards.length;

        for (uint256 i = 0; i < length;) {
            _mintItemIfEligible(to, rewards[i]);
            unchecked {
                ++i;
            }
        }
    }

    function mintGuildReward(address to, uint256 tokenId) external onlyRole(GUILD_ROLE) nonReentrant {
        _mintItem(to, tokenId);
    }

    function adminMint(address to, uint256 tokenId) external onlyRole(ADMIN_ROLE) nonReentrant {
        _mintItem(to, tokenId);
    }

    function equip(uint256 tokenId) external {
        require(balanceOf(msg.sender, tokenId) > 0, "Not owned");
        ItemDef storage item = items[tokenId];
        require(item.active, "Item not active");
        require(item.category == Category.EQUIPMENT, "Not equipment");

        if (item.slot == Slot.HEAD) {
            _loadouts[msg.sender].head = tokenId;
        } else if (item.slot == Slot.BODY) {
            _loadouts[msg.sender].body = tokenId;
        } else if (item.slot == Slot.WEAPON) {
            _loadouts[msg.sender].weapon = tokenId;
        } else if (item.slot == Slot.SHIELD) {
            _loadouts[msg.sender].shield = tokenId;
        } else if (item.slot == Slot.CLOAK) {
            _loadouts[msg.sender].cloak = tokenId;
        } else if (item.slot == Slot.ACCESSORY) {
            _loadouts[msg.sender].accessory = tokenId;
        } else {
            revert("Invalid slot");
        }

        emit Equipped(msg.sender, tokenId, item.slot);
    }

    function unequip(Slot slot) external {
        if (slot == Slot.HEAD) {
            _loadouts[msg.sender].head = 0;
        } else if (slot == Slot.BODY) {
            _loadouts[msg.sender].body = 0;
        } else if (slot == Slot.WEAPON) {
            _loadouts[msg.sender].weapon = 0;
        } else if (slot == Slot.SHIELD) {
            _loadouts[msg.sender].shield = 0;
        } else if (slot == Slot.CLOAK) {
            _loadouts[msg.sender].cloak = 0;
        } else if (slot == Slot.ACCESSORY) {
            _loadouts[msg.sender].accessory = 0;
        } else {
            revert("Invalid slot");
        }

        emit Unequipped(msg.sender, slot);
    }

    function equipTitle(uint256 tokenId) external {
        require(balanceOf(msg.sender, tokenId) > 0, "Not owned");
        ItemDef storage item = items[tokenId];
        require(item.active, "Item not active");
        require(item.category == Category.TITLE, "Not a title");

        activeTitle[msg.sender] = tokenId;
        emit TitleEquipped(msg.sender, tokenId);
    }

    function getItem(uint256 tokenId) external view returns (ItemDef memory) {
        return items[tokenId];
    }

    function getLevelRewards(uint256 level) external view returns (uint256[] memory) {
        return _levelRewards[level];
    }

    function getLoadout(address user) external view returns (EquipmentLoadout memory) {
        return _loadouts[user];
    }

    function getActiveTitle(address user) external view returns (uint256 tokenId, string memory name) {
        tokenId = activeTitle[user];
        if (tokenId == 0) {
            return (0, "");
        }

        return (tokenId, items[tokenId].name);
    }

    function getRemainingSupply(uint256 tokenId) external view returns (uint256) {
        ItemDef storage item = items[tokenId];
        if (item.maxSupply == 0) {
            return type(uint256).max;
        }

        if (totalMinted[tokenId] >= item.maxSupply) {
            return 0;
        }

        return item.maxSupply - totalMinted[tokenId];
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl, ERC1155)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 length = ids.length;
            for (uint256 i = 0; i < length;) {
                require(!items[ids[i]].soulbound, "Soulbound: non-transferable");
                unchecked {
                    ++i;
                }
            }
        }

        super._update(from, to, ids, values);
    }

    function _registerItem(
        uint256 tokenId,
        Category category,
        Rarity rarity,
        Slot slot,
        uint256 maxSupply,
        bool soulbound,
        string calldata name
    ) internal {
        require(tokenId != 0, "Token zero");
        require(bytes(name).length > 0, "Name empty");
        require(bytes(items[tokenId].name).length == 0, "Item exists");
        if (category != Category.EQUIPMENT) {
            require(slot == Slot.NONE, "Non-equipment slot");
        } else {
            require(slot != Slot.NONE, "Equipment slot required");
        }

        items[tokenId] = ItemDef({
            category: category,
            rarity: rarity,
            slot: slot,
            maxSupply: maxSupply,
            soulbound: soulbound,
            active: true,
            name: name
        });
        unchecked {
            itemCount += 1;
        }

        emit ItemRegistered(tokenId, category, rarity, slot, maxSupply, soulbound, name);
    }

    function _mintItem(address to, uint256 tokenId) internal {
        require(to != address(0), "Receiver zero");
        ItemDef storage item = items[tokenId];
        require(bytes(item.name).length > 0, "Item not found");
        require(item.active, "Item not active");
        require(item.maxSupply == 0 || totalMinted[tokenId] < item.maxSupply, "Max supply reached");
        require(balanceOf(to, tokenId) == 0, "Already owns item");

        unchecked {
            totalMinted[tokenId] += 1;
        }
        _mint(to, tokenId, 1, "");
        emit ItemMinted(to, tokenId, totalMinted[tokenId]);
    }

    function _mintItemIfEligible(address to, uint256 tokenId) internal {
        ItemDef storage item = items[tokenId];
        if (
            to == address(0)
                || bytes(item.name).length == 0
                || !item.active
                || balanceOf(to, tokenId) > 0
                || (item.maxSupply != 0 && totalMinted[tokenId] >= item.maxSupply)
        ) {
            return;
        }

        unchecked {
            totalMinted[tokenId] += 1;
        }
        _mint(to, tokenId, 1, "");
        emit ItemMinted(to, tokenId, totalMinted[tokenId]);
    }
}
