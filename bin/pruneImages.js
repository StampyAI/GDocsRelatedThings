import parse from "../parser/main.js";
import { logError, withRetry } from "../parser/utils.js";
import { questionImages, deleteImage } from "../parser/cloudflare.js";

const deleteOldVersions = ([uiid, versions]) =>
  Object.values(versions)
    .sort((a, b) => (a[0].uploaded < b[0].uploaded ? 1 : -1))
    .slice(1)
    .map((imgs) => imgs.map(({ id }) => id))
    .flat()
    .map(async (id) => {
      try {
        return await withRetry(() => deleteImage(id), `Delete image ${id}`);
      } catch (error) {
        console.error(`Failed to delete image ${id}: ${error.message}`);
        throw error;
      }
    });

try {
  const questions = await withRetry(questionImages, "Fetch question images");
  const responses = await Promise.all(
    Object.entries(questions).map(deleteOldVersions).flat()
  );

  const succeeded = responses.filter((res) => res.success).length;
  const total = responses.length;
  console.info(`Processed ${total} answers, ${total - succeeded} failed`);
  process.exit(total - succeeded);
} catch (e) {
  await logError(e.message, {});
  process.exit(1);
}
