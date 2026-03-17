async function main(): Promise<void> {
  const thresholds: string[] = [];

  for (let level = 0; level <= 100; level += 1) {
    if (level === 0) {
      thresholds.push("0");
      continue;
    }

    thresholds.push(Math.floor(20 * Math.pow(level, 2.2)).toString());
  }

  console.log("Level thresholds (20 * level^2.2):");
  console.log(JSON.stringify(thresholds));
  console.log(`Lv.1: ${thresholds[1]}`);
  console.log(`Lv.5: ${thresholds[5]}`);
  console.log(`Lv.10: ${thresholds[10]}`);
  console.log(`Lv.20: ${thresholds[20]}`);
  console.log(`Lv.50: ${thresholds[50]}`);
  console.log(`Lv.100: ${thresholds[100]}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
