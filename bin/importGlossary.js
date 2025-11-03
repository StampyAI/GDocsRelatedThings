import { decode } from "html-entities";
import {
  codaDelete,
  getAnswers,
  getGlossary,
  updateGlossary,
} from "../parser/coda.js";
import { getDocsClient, getGoogleDoc } from "../parser/gdrive.js";
import { tableURL, GLOSSARY_DOC } from "../parser/constants.js";
import { logError, withRetry } from "../parser/utils.js";
import { replaceImages } from "../parser/cloudflare.js";
import imageSize from "image-size";

// --------------------------------------------------------------------------
// Configuration and Utilities
// --------------------------------------------------------------------------

// Process command line arguments
const args = process.argv.slice(2);
const updateImages = args.includes("--update-images");

// Configuration constant
const OPERATION_SPACING_MS = 1000; // Delay between operations (1 second)

/**
 * Fetches image dimensions from a URL
 * @param {string} url - Image URL
 * @returns {Promise<{width: number, height: number} | null>} - Image dimensions or null
 */
const getImageDimensions = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(
        `Failed to fetch image: ${response.status} ${response.statusText}`
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

/**
 * Updates a glossary entry in Coda
 * @param {Object} metadata - Entry metadata with comparison results
 * @returns {Promise<Object>} - Result of the update operation
 */
const setGlossary = async (metadata) => {
  // Extract data from metadata
  const { row, existingEntry } = metadata;
  const { term, aliases, definition, answer } = row;
  const phrase = decode(term.trim());

  try {
    // Use the already parsed image from metadata
    const newImage = metadata.parsedImage;

    // Skip updates if already determined in pre-scan
    if (metadata.existsInCoda && !metadata.needsUpdate) {
      return { updated: false, succeeded: true, skipped: true };
    }

    // Configure image update logic
    const existingImage = metadata.existingEntry?.image || "";
    const shouldUpdateImage = existingImage === "" || updateImages;
    const imageToUpdate = shouldUpdateImage ? newImage : undefined;

    const res = await updateGlossary(
      phrase,
      answer?.answerName || "",
      answer?.UIID || "",
      definition,
      aliases,
      imageToUpdate,
      shouldUpdateImage ? metadata.imageDimensions : undefined
    );

    if (res.status === 429) {
      // Rate limit hit, throw error to trigger retry with exponential backoff
      const error = new Error("Rate limit exceeded (429)");
      error.status = 429;
      throw error;
    }
    if (res.status === 502) {
      // A lot of these get returned, but they're not really a problem on this side, so just ignore them
    } else if (res.status > 300) {
      await logError(
        `Could not update glossary item: ${res.statusText}`,
        answer
      );
      return { updated: false, succeeded: false, skipped: false };
    }

    // Log success message
    if (existingEntry) {
      console.log(`  (Updated "${phrase}" in Coda)`);
    } else {
      console.log(`  (Added "${phrase}" as new entry)`);
    }
  } catch (err) {
    // If it's a rate limit error, rethrow to trigger the retry mechanism
    if (err.message === "Rate limit exceeded (429)") {
      throw err;
    }
    await logError(`Could not update glossary item: ${err}`, answer);
    return { updated: false, succeeded: false, skipped: false };
  }
  return { updated: true, succeeded: true, skipped: false };
};

/**
 * Extracts Google Doc ID from a link
 * @param {string} link - Google Doc link
 * @returns {string|null} - Document ID or null if not found
 */
const extractDocId = (link) => {
  const regex =
    /\s*?\(https:\/\/docs\.google\.com\/document\/(?:u\/)?(?:0\/)?d\/([^\/]*?)\//;
  try {
    return link.match(regex)[1];
  } catch (err) {
    return null;
  }
};

/**
 * Normalizes terms for comparison by standardizing format and removing irrelevant characters
 * @param {string} term - Term to normalize
 * @returns {string} - Normalized term with only letters, numbers, and slashes
 */
const normalizeTerm = (term) => {
  // Decode HTML entities and convert to lowercase
  const decoded = decode(term).toLowerCase();

  // Keep only letters, numbers, and slashes (/ and \), removing all other characters
  // This makes matching more reliable by ignoring differences in:
  // - Spaces and punctuation (e.g., "AI Safety" vs "AI-Safety")
  // - Special characters and apostrophes (e.g., "Prisoner's" vs "Prisoners")
  // - Formatting variations that don't affect meaning
  return decoded.replace(/[^a-z0-9\/\\]/g, "");
};

// --------------------------------------------------------------------------
// Main Script Execution
// --------------------------------------------------------------------------

async function main() {
  console.log("Fetching data from Google Doc and Coda...");

  // Check for Cloudflare credentials if updating images
  if (updateImages && !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error("\nCannot update images without Cloudflare credentials.");
    console.error(
      "The --update-images flag requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN."
    );
    console.error("These are only available in GitHub Actions.\n");
    process.exit(1);
  }

  // Fetch Google Doc
  const gdocsClient = await getDocsClient();
  const doc = await getGoogleDoc({ docID: GLOSSARY_DOC }, gdocsClient);

  // Upload any new/changed images to Cloudflare (updates doc.inlineObjects in place)
  if (updateImages) {
    await replaceImages(doc.inlineObjects, GLOSSARY_DOC);
  }

  const documentContext = {
    footnotes: doc.footnotes || {},
    namedStyles: doc.namedStyles,
    inlineObjects: doc.inlineObjects,
  };

  const table = doc.body.content.filter(({ table }) => table)[0];

  // Get answer data for linking
  const allAnswers = await getAnswers(tableURL);
  const gdocToUIID = Object.fromEntries(
    allAnswers.map((answer) => [answer.docID, answer])
  );
  const getAnswer = ({ question }) => gdocToUIID[extractDocId(question)];
  const stripFormatting = (row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.replaceAll("*", ""), v])
    );

  // Parse rows from Google Doc (skip header row)
  const rows = table.table.tableRows
    .slice(1)
    .map((row) => {
      const getValue = (cell) =>
        cell.content?.[0]?.paragraph?.elements
          ?.map((el) => el.textRun?.content || "")
          .join("") || "";

      return {
        term: getValue(row.tableCells[0]),
        aliases: getValue(row.tableCells[1]),
        question: getValue(row.tableCells[2]),
        definition: getValue(row.tableCells[3]),
        image: getValue(row.tableCells[4]),
      };
    })
    .map(stripFormatting)
    .filter(
      (row) => Boolean(row.term?.trim()) && Boolean(row.definition?.trim())
    )
    .map((row) => ({
      ...row,
      answer: getAnswer(row),
    }));

  // Fetch image dimensions for glossary images
  const imageDimensions = {};
  if (updateImages) {
    const imageUrls = rows
      .map((row) => row.image?.match(/!\[\]\((.*?)\)/)?.[1])
      .filter(Boolean);
    const uniqueUrls = [...new Set(imageUrls)];

    console.log(
      `Fetching dimensions for ${uniqueUrls.length} unique images...`
    );

    for (const url of uniqueUrls) {
      const dimensions = await getImageDimensions(url);
      if (dimensions) {
        imageDimensions[url] = dimensions;
      }
    }

    console.log(
      `Successfully captured ${
        Object.keys(imageDimensions).length
      } image dimensions`
    );
  }

  documentContext.imageDimensions = imageDimensions;

  // Get existing glossary entries
  const existingGlossary = await getGlossary();

  console.log(
    `\nFound ${existingGlossary.length} existing entries in Coda glossary`
  );
  console.log(`Found ${rows.length} entries in Google Doc`);
  console.log(
    `Image updates are ${
      updateImages ? "ENABLED" : "DISABLED"
    } (use --update-images flag to enable)`
  );

  // --------------------------------------------------------------------------
  // Compare Entries and Determine Actions
  // --------------------------------------------------------------------------

  console.log("\nAnalyzing entries for changes...");

  // Pre-process normalization for all glossary entries (performance optimization)
  const normalizedGlossary = existingGlossary.map((entry) => ({
    ...entry,
    normalizedWord: normalizeTerm(entry.word),
  }));

  const rowsWithMetadata = rows.map((row) => {
    const phrase = decode(row.term.trim());

    // Normalize terms for comparison
    const normalizedPhrase = normalizeTerm(phrase);

    // Find entry using pre-normalized values (much faster lookup)
    const existingEntry = normalizedGlossary.find(
      (entry) => entry.normalizedWord === normalizedPhrase
    );

    // Parse the image URL from markdown format
    const imgMatch = row.image?.match(/!\[\]\((.*?)\)/);
    const newImage = imgMatch?.[1];

    // Get image dimensions if available
    const dimensions = newImage
      ? documentContext.imageDimensions[newImage]
      : null;

    // If no existing entry found, mark as new
    if (!existingEntry) {
      return {
        row,
        needsUpdate: true,
        existsInCoda: false,
        parsedImage: newImage,
        imageDimensions: dimensions,
      };
    }

    // Compare definition content (normalize whitespace)
    const codaDef = existingEntry.richText || "";
    const gdocDef = row.definition || "";
    const codaDefNormalized = codaDef.replace(/\s+/g, " ").trim();
    const gdocDefNormalized = gdocDef.replace(/\s+/g, " ").trim();
    const definitionDifferent = codaDefNormalized !== gdocDefNormalized;

    // Compare aliases (normalize whitespace)
    const codaAliases = existingEntry.aliases || "";
    const gdocAliases = row.aliases || "";
    const codaAliasesNormalized = codaAliases.replace(/\s+/g, " ").trim();
    const gdocAliasesNormalized = gdocAliases.replace(/\s+/g, " ").trim();
    const aliasesDifferent =
      codaAliasesNormalized !== gdocAliasesNormalized &&
      (codaAliasesNormalized || gdocAliasesNormalized); // Ignore if both empty

    // Compare images (conditional on flag)
    let imageDifferent = false;
    const existingImage = existingEntry.image || "";
    const newImageNormalized = newImage || "";

    if (existingImage === "") {
      // If there's no existing image, always consider adding a new one
      imageDifferent = Boolean(newImageNormalized);
    } else {
      // If there is an existing image, update if:
      // 1. --update-images flag is provided AND
      // 2. (URL is different OR we have new dimensions to add)
      const hasNewDimensions =
        dimensions && dimensions.width && dimensions.height;
      imageDifferent =
        updateImages &&
        Boolean(newImageNormalized) &&
        (existingImage !== newImageNormalized || hasNewDimensions);
    }

    // Determine if update is needed
    const needsUpdate =
      definitionDifferent || aliasesDifferent || imageDifferent;

    return {
      row,
      needsUpdate,
      existsInCoda: true,
      existingEntry,
      parsedImage: newImage,
      imageDimensions: dimensions,
    };
  });

  // Count and report entries needing updates
  const entriesNeedingUpdate = rowsWithMetadata.filter(
    (r) => r.needsUpdate
  ).length;
  const skippableEntries = rowsWithMetadata.filter(
    (r) => !r.needsUpdate
  ).length;

  console.log(`Analysis results:`);
  console.log(
    `- ${skippableEntries} entries can be skipped (no changes needed)`
  );
  console.log(
    `- ${entriesNeedingUpdate} entries need to be created or updated`
  );

  // --------------------------------------------------------------------------
  // Define Processing Function and Update Entries
  // --------------------------------------------------------------------------

  console.log("\nUpdating glossary entries...");

  /**
   * Sequentially applies a function to an array of items with spacing between operations
   * @param {Array} items - Items to process
   * @param {Function} func - Function to apply to each item
   * @returns {Promise<Array>} - Results of processing
   */
  const syncApply = (items, func) =>
    items.reduce(async (previousPromise, item) => {
      const previousResults = await previousPromise;

      // Skip API calls for items that don't need updates
      if (item.needsUpdate === false) {
        return [
          ...previousResults,
          { updated: false, succeeded: true, skipped: true },
        ];
      }

      try {
        // Add a delay between API operations to avoid rate limiting
        await new Promise((resolve) =>
          setTimeout(resolve, OPERATION_SPACING_MS)
        );

        // Process the item with our central withRetry utility
        const result = await withRetry(
          async () => func(item),
          `Update glossary for "${(item.row?.term || "unknown").trim()}"`
        );

        return [...previousResults, result];
      } catch (err) {
        console.error("Failed after all retry attempts:", err.message);
        return [
          ...previousResults,
          { updated: false, succeeded: false, skipped: false },
        ];
      }
    }, Promise.resolve([]));

  // Update all glossary entries and track results
  const updateResults = await syncApply(
    rowsWithMetadata,
    async (metadata) => await setGlossary(metadata)
  );

  // Summarize the results
  const skipped = updateResults.filter((r) => r.skipped).length;
  const updated = updateResults.filter((r) => r.updated).length;
  const failed = updateResults.filter((r) => !r.succeeded).length;

  console.log(`\nGlossary update summary:`);
  console.log(`- ${skipped} entries skipped (no changes needed)`);
  console.log(`- ${updated} entries updated or added`);
  console.log(`- ${failed} entries failed to update`);
  console.log(`- ${rows.length} total entries in Google Doc`);

  // Only proceed with deletion if ALL entries were successfully updated
  if (!updateResults.every((result) => result.succeeded)) {
    console.log("\nSkipping deletion step because some updates failed.");
    console.log("Please run the script again later after rate limits reset.");
    console.log("No entries will be removed until all updates succeed.");
    return;
  }

  // --------------------------------------------------------------------------
  // Delete Outdated Entries
  // --------------------------------------------------------------------------

  console.log("\nChecking for outdated entries to remove...");

  // Normalize all terms from Google Doc for comparison - create a Set for O(1) lookups
  const normalizedTermsSet = new Set(
    rows.map(({ term }) => normalizeTerm(term))
  );

  // Debug log for troubleshooting
  if (process.env.DEBUG) {
    console.log("\nTerms from Google Doc (keeping these):");
    console.log([...normalizedTermsSet].sort().join("\n"));
  }

  // Identify entries to delete (use the already normalized values from before)
  const entriesToDelete = normalizedGlossary.filter((entry) => {
    // Check if the normalized word matches any normalized term - O(1) lookup with Set
    const found = normalizedTermsSet.has(entry.normalizedWord);
    const shouldDelete = !found;

    if (shouldDelete) {
      console.log(`Will delete "${entry.word}" - not found in Google Doc`);
    }

    return shouldDelete;
  });

  console.log(
    `\nIdentified ${entriesToDelete.length} entries to delete from ${existingGlossary.length} total in Coda`
  );

  if (entriesToDelete.length > 0) {
    const deleteResults = await syncApply(entriesToDelete, ({ href, word }) => {
      console.log(" -> Deleting ", word);
      return codaDelete(href);
    });

    console.log(
      `\nDeletion complete: removed ${
        deleteResults.filter(Boolean).length
      } entries`
    );
  } else {
    console.log(
      "\nNo entries to delete - all Coda glossary items match entries in the Google Doc."
    );
  }
}

// Run the main function
main().catch((error) => {
  console.error("Error in glossary import process:", error);

  // Special handling for JSON parse errors that might indicate HTML responses
  if (
    error instanceof SyntaxError &&
    error.message.includes("Unexpected token")
  ) {
    console.error(
      "Received non-JSON response. This might be an HTML error page."
    );

    // If we have the raw response text, log it for diagnosis
    if (error.rawHtml) {
      console.error("HTML response received:");
      console.error("----------------------------------------");
      console.error(error.rawHtml.substring(0, 2000)); // Log first 2000 chars to avoid excessive output
      console.error("----------------------------------------");
    }
  }

  process.exit(1);
});
