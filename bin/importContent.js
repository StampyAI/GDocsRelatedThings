import parse from "../parser/main.js";
import { logError } from "../parser/utils.js";

try {
  const { failed, succeeded } = await parse();
  console.info(`Proccessed ${failed + succeeded} answers, ${failed} failed`);
  process.exit(failed == 0 ? 0 : 1);
} catch (e) {
  await logError(e.message, {});
  process.exit(1);
}
