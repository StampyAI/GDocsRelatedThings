import parse from "../parser/main.js";
import { logError } from "../parser/utils.js";

try {
  await parse();
} catch (e) {
  await logError(e.message, {});
  process.exit(1);
}
