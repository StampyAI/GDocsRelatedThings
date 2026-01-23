import { randomUUID } from "crypto";
import { withRetry } from "./utils.js";
import imageSize from "image-size";

const sendRequest = (endpoint, method, body) =>
  withRetry(
    async () => {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/images/${endpoint}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          },
          body,
        }
      );

      if (!response.ok) {
        const responseText = await response.text();
        const error = new Error(`Cloudflare API error: ${response.statusText}`);
        error.status = response.status;
        error.rawHtml = responseText;
        throw error;
      }

      // Check for non-JSON responses
      const contentType = response.headers.get("content-type");
      if (contentType && !contentType.includes("application/json")) {
        const responseText = await response.text();
        const error = new Error(
          `Cloudflare API returned non-JSON response: ${contentType}`
        );
        error.status = response.status;
        error.rawHtml = responseText;
        throw error;
      }

      return response.json();
    },
    `Cloudflare API ${method} to /images/${endpoint.split("?")[0]}`,
    {
      maxRetries: 5,
      baseDelayMs: 5000,
    }
  );

const getImageDimensions = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(
        `Failed to fetch image: ${response.status} ${response.statusText}`
      );
      console.warn(`URL: ${url}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const dimensions = imageSize(buffer);
    return { width: dimensions.width, height: dimensions.height };
  } catch (error) {
    console.warn(`Error getting image dimensions:`, error.message);
    console.warn(`URL: ${url}`);
    return null;
  }
};

const uploadImage = async (url, metadata) => {
  const formData = new FormData();
  formData.append("url", url);
  formData.append("metadata", JSON.stringify(metadata || {}));
  formData.append("requireSignedURLs", "false");

  return sendRequest("v1", "POST", formData).then(
    (data) => data?.result?.variants?.filter((u) => u.includes("/public"))[0]
  );
};

export const replaceImages = async (objects, uiid) => {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) return {};

  const fingerprint = randomUUID();
  const imageDimensions = {};
  let processedCount = 0;
  let skippedCount = 0;

  const updates = Object.entries(objects || {}).map(async ([key, obj]) => {
    const img = obj?.inlineObjectProperties?.embeddedObject;
    if (img) {
      processedCount++;
      const originalUri = img.imageProperties.contentUri;

      // Get dimensions before uploading
      const dimensions = await getImageDimensions(originalUri);

      // Upload to Cloudflare
      const newUri = await uploadImage(originalUri, {
        title: img.title,
        UIID: uiid,
        fingerprint,
      });

      img.imageProperties.contentUri = newUri;

      // Store dimensions mapped by the final URI
      if (dimensions && newUri) {
        imageDimensions[newUri] = dimensions;
      }
    } else {
      skippedCount++;
    }
  });

  await Promise.all(updates);
  console.log(
    `Processed ${processedCount} images, skipped ${skippedCount} inline objects`
  );
  return imageDimensions;
};

export const questionImages = async () => {
  const questions = {};
  let continuationToken = null;
  do {
    const { result, errors } = await sendRequest("v2", "GET");
    continuationToken = result.continuationToken;
    result.images.forEach((img) => {
      const { UIID, fingerprint } = img.meta;
      if (!UIID) {
        console.error(`No UUID found for image ${img.id}`);
        return;
      } else if (!fingerprint) {
        console.error(`No fingerprint found for image ${img.id}`);
        return;
      }
      if (!questions[UIID]) {
        questions[UIID] = {};
      }
      if (!questions[UIID][fingerprint]) {
        questions[UIID][fingerprint] = [];
      }
      questions[UIID][fingerprint].push(img);
    });
  } while (continuationToken);
  return questions;
};

export const deleteImage = async (id) => {
  try {
    return await sendRequest(`v1/${id}`, "DELETE");
  } catch (error) {
    // 404 means the image is already gone, which is the desired outcome
    if (error.status === 404) {
      return { success: true };
    }
    throw error;
  }
};
