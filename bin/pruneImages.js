import parse from "../parser/main.js";
import { logError } from "../parser/utils.js";
import { questionImages, deleteImage } from "../parser/cloudflare.js";

const deleteOldVersions = ([uiid, versions]) =>
  Object.values(versions)
    .sort((a, b) => (a[0].uploaded < b[0].uploaded ? 1 : -1))
    .slice(1)
    .map((imgs) => imgs.map(({ id }) => id))
    .flat()
    .map(deleteImage);

try {
  const questions = await questionImages();
  const responses = await Promise.all(
    Object.entries(questions).map(deleteOldVersions).flat()
  );

  const succeeded = responses.filter((res) => res.success).length;
  const total = responses.length;
  console.info(`Proccessed ${total} answers, ${total - succeeded} failed`);
  process.exit(total - succeeded);
} catch (e) {
  await logError(e.message, {});
  process.exit(1);
}
