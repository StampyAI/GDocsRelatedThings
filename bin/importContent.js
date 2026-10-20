import parse from "../parser/main.js";
import { logError } from "../parser/utils.js";

try {
  const { failed, succeeded, failedNames } = await parse();
  console.info(`Processed ${failed + succeeded} answers, ${failed} failed`);
  failedNames.forEach((name) => console.info(`  failed: ${name}`));
  process.exit(failed == 0 ? 0 : 1);
} catch (e) {
  await logError(e.message, {});
  process.exit(1);
}
