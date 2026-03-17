import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ethers } from "ethers";

import {
  buildCatalog,
  categoryEnumValue,
  rarityEnumValue,
  slotEnumValue,
  ROOT_DIR
} from "./nft/shared";

const BATCH_SIZE = 30;
const OUTPUT_PATH = path.join(ROOT_DIR, "scripts", "register-nft-items.calldata.json");

async function main(): Promise<void> {
  const catalog = await buildCatalog();
  const iface = new ethers.Interface([
    "function registerItemBatch(uint256[] tokenIds,uint8[] categories,uint8[] rarities,uint8[] slots,uint256[] maxSupplies,bool[] soulbounds,string[] names)"
  ]);

  const batches = [];

  for (let start = 0; start < catalog.length; start += BATCH_SIZE) {
    const items = catalog.slice(start, start + BATCH_SIZE);
    const payload = {
      tokenIds: items.map((item) => item.tokenId),
      categories: items.map((item) => categoryEnumValue(item.category)),
      rarities: items.map((item) => rarityEnumValue(item.rarity)),
      slots: items.map((item) => slotEnumValue(item.slot)),
      maxSupplies: items.map((item) => item.maxSupply.toString()),
      soulbounds: items.map((item) => item.soulbound),
      names: items.map((item) => item.name)
    };

    const calldata = iface.encodeFunctionData("registerItemBatch", [
      payload.tokenIds,
      payload.categories,
      payload.rarities,
      payload.slots,
      payload.maxSupplies,
      payload.soulbounds,
      payload.names
    ]);

    batches.push({
      batch: batches.length + 1,
      startTokenId: items[0]?.tokenId ?? null,
      endTokenId: items[items.length - 1]?.tokenId ?? null,
      count: items.length,
      calldata,
      ...payload
    });
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(
    OUTPUT_PATH,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalItems: catalog.length,
        batchSize: BATCH_SIZE,
        batches
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(`Generated ${batches.length} registerItemBatch payloads at ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
