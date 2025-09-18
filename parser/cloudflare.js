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
        const error = new Error(`Cloudflare API error: ${response.statusText}`);
        error.status = response.status;
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
        `Failed to fetch image for dimensions: ${response.statusText}`
      );
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const dimensions = imageSize(buffer);
    return { width: dimensions.width, height: dimensions.height };
  } catch (error) {
    console.warn(`Error getting image dimensions for ${url}:`, error.message);
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

  const updates = Object.entries(objects || {}).map(async ([key, obj]) => {
    const img = obj?.inlineObjectProperties?.embeddedObject;
    if (img) {
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
    }
  });

  await Promise.all(updates);
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

export const deleteImage = async (id) => sendRequest(`v1/${id}`, "DELETE");
