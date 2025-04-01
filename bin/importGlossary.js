import { setTimeout } from "timers/promises";
import { decode } from "html-entities";
import {
  codaDelete,
  getAnswers,
  getGlossary,
  updateGlossary,
} from "../parser/coda.js";
import { parseElement } from "../parser/parser.js";
import { getDocsClient, getGoogleDoc } from "../parser/gdrive.js";
import { tableURL, GLOSSARY_DOC } from "../parser/constants.js";
import { logError } from "../parser/utils.js";
import { replaceImages } from "../parser/cloudflare.js";

// Process command line arguments
const args = process.argv.slice(2);
const updateImages = args.includes("--update-images");

const syncApply = (items, func) =>
  items.reduce(async (previousPromise, item) => {
    const previousResults = await previousPromise;
    
    try {
      // Always add a small delay between operations to avoid immediate rate limiting
      // This small delay is just to space out requests, not the full exponential backoff
      await setTimeout(500);
      
      // If item has needsUpdate=false flag, skip the API call completely
      if (item.needsUpdate === false) {
        const phrase = decode(item.row.term.trim());
        console.log(`-> ${phrase} (Skipped - already up to date)`);
        return [...previousResults, { updated: false, succeeded: true, skipped: true }];
      }
      
      // Try to process the item
      let retryCount = 0;
      let success = false;
      let result;
      
      while (!success && retryCount < 5) {
        try {
          // On first attempt, no additional delay
          if (retryCount > 0) {
            // Only apply exponential backoff on retries
            const baseDelay = 10000; // Start with 10 seconds instead of 5
            // Exponential backoff: 10s, 20s, 40s, 80s, 160s
            const delay = baseDelay * Math.pow(2, retryCount - 1);
            console.log(`Waiting ${delay/1000}s before retry attempt ${retryCount + 1}`);
            await setTimeout(delay);
          }
          
          result = await func(item);
          success = true;
        } catch (err) {
          console.log(`Attempt ${retryCount + 1} failed: ${err.message}`);
          retryCount++;
          if (retryCount >= 5) {
            throw err;
          }
        }
      }
      
      return [...previousResults, result];
    } catch (err) {
      console.error("Failed after all retry attempts:", err.message);
      return [...previousResults, { updated: false, succeeded: false, skipped: false }];
    }
  }, Promise.resolve([]));

const setGlossary = async (metadata) => {
  // Extract data from metadata
  const { row, existingEntry } = metadata;
  const { term, aliases, definition, answer, image } = row;
  const phrase = decode(term.trim());
  
  try {
    const imgMatch = image?.match(/!\[\]\((.*?)\)/);
    const newImage = imgMatch && imgMatch[1];
    
    // Skip updates if already determined in pre-scan
    if (metadata.existsInCoda && !metadata.needsUpdate) {
      console.log(`  (No changes needed for "${phrase}")`);
      return { updated: false, succeeded: true, skipped: true };
    }
    
    // Proceed with update if entry doesn't exist or needs updates
    const imageToUpdate = updateImages ? newImage : undefined;
    
    const res = await updateGlossary(
      phrase,
      answer?.answerName || "",
      answer?.UIID || "",
      definition,
      aliases,
      imageToUpdate
    );

    if (res.status === 429) {
      // Rate limit hit, throw error to trigger retry with exponential backoff
      throw new Error("Rate limit exceeded (429)");
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
    
    // If we got here, the update was successful
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

const extractDocId = (link) => {
  const regex =
    /\s*?\(https:\/\/docs\.google\.com\/document\/(?:u\/)?(?:0\/)?d\/([^\/]*?)\//;
  try {
    return link.match(regex)[1];
  } catch (err) {
    return null;
  }
};

const gdocsClient = await getDocsClient();
const doc = await getGoogleDoc({ docID: GLOSSARY_DOC }, gdocsClient);
await replaceImages(doc.inlineObjects, GLOSSARY_DOC);
const documentContext = {
  footnotes: doc.footnotes || {},
  namedStyles: doc.namedStyles,
  inlineObjects: doc.inlineObjects,
};

const table = doc.body.content.filter(({ table }) => table)[0];

const allAnswers = await getAnswers(tableURL);
const gdocToUIID = Object.fromEntries(
  allAnswers.map((answer) => [answer.docID, answer])
);
const getAnswer = ({ question }) => gdocToUIID[extractDocId(question)];
const stripFormatting = (row) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.replaceAll("*", ""), v])
  );

const rows = parseElement(documentContext)(table)
  .map(stripFormatting)
  .filter((row) => Boolean(row.term.trim()) && Boolean(row.definition.trim()))
  .map((row) => ({
    ...row,
    answer: getAnswer(row),
  }));

// Get existing glossary entries first to avoid unnecessary updates
const existingGlossary = await getGlossary();
console.log(`\nFound ${existingGlossary.length} existing entries in Coda glossary`);

// Display basic overview of what we're working with
console.log(`Using ${existingGlossary.length} entries from Coda glossary and ${rows.length} entries from Google Doc`);
// Image URLs change for apparently no reason, so most of the time we want to ignore them
console.log(`Image updates are ${updateImages ? 'ENABLED' : 'DISABLED'} (use --update-images flag to enable)`);

// Pre-analyze which entries need updates to optimize processing
const rowsWithMetadata = rows.map((row, index) => {
  const phrase = decode(row.term.trim());
  
  // Normalize terms for comparison
  const normalized = phrase.toLowerCase().trim();
  
  // First, try exact match
  let existingEntry = existingGlossary.find(entry => 
    entry.word.toLowerCase().trim() === normalized
  );
  
  // If exact match fails, try alternative matching strategies
  if (!existingEntry) {
    // Try ignoring non-alphanumeric characters
    const simplifiedNormalized = normalized.replace(/[^a-z0-9]/g, '');
    existingEntry = existingGlossary.find(entry => {
      const simplifiedWord = entry.word.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
      return simplifiedWord === simplifiedNormalized;
    });
  }
  
  if (existingEntry) {
    // Only check fields that make sense to update
    // For definitions, normalize whitespace before comparing
    const codaDef = existingEntry.richText || "";
    const gdocDef = row.definition || "";
    const codaDefNormalized = codaDef.replace(/\s+/g, " ").trim();
    const gdocDefNormalized = gdocDef.replace(/\s+/g, " ").trim();
    const definitionDifferent = codaDefNormalized !== gdocDefNormalized;
    
    // For aliases, only consider it different if both exist and are different
    // Also normalize whitespace in aliases
    const codaAliases = existingEntry.aliases || "";
    const gdocAliases = row.aliases || "";
    const codaAliasesNormalized = codaAliases.replace(/\s+/g, " ").trim();
    const gdocAliasesNormalized = gdocAliases.replace(/\s+/g, " ").trim();
    const aliasesDifferent = codaAliasesNormalized !== gdocAliasesNormalized && 
                            (codaAliasesNormalized || gdocAliasesNormalized); // Ignore if both empty
    
    // By default, don't check images
    let imageDifferent = false;
    let newImage;
    
    // Only process images if update-images flag is provided
    if (updateImages) {
      const imgMatch = row.image?.match(/!\[\]\((.*?)\)/);
      newImage = imgMatch && imgMatch[1];
      
      // Check if images are different
      const existingImage = existingEntry.image || "";
      const newImageNormalized = newImage || "";
      imageDifferent = Boolean(newImageNormalized) && existingImage !== newImageNormalized;
    }
    
    // Determine if update is needed
    const needsUpdate = definitionDifferent || aliasesDifferent || imageDifferent;
    
    // Only show detailed debugging info if DEBUG env var is set
    if (needsUpdate && process.env.DEBUG) {
      console.log(`\nDetailed debugging for "${phrase}":`);
      
      if (definitionDifferent) {
        console.log(`  Definition differs and will be updated`);
      }
      
      if (aliasesDifferent) {
        console.log(`  Aliases differ and will be updated`);
      }
      
      if (imageDifferent) {
        console.log(`  Image differs and will be updated`);
      }
    }
      
    return { 
      row, 
      existingGlossary,
      needsUpdate: needsUpdate,
      existsInCoda: true,
      existingEntry
    };
  }
  
  return { 
    row, 
    existingGlossary,
    needsUpdate: true, // New entry needs to be created
    existsInCoda: false 
  };
});

// Count and report entries needing updates
const entriesNeedingUpdate = rowsWithMetadata.filter(r => r.needsUpdate).length;
const skippableEntries = rowsWithMetadata.filter(r => !r.needsUpdate).length;

console.log(`\nAnalysis before processing:`);
console.log(`- ${skippableEntries} entries can be skipped (no changes needed)`);
console.log(`- ${entriesNeedingUpdate} entries need to be created or updated`);

// Update all glossary entries and track successfully updated terms
const updateResults = await syncApply(
  rowsWithMetadata,
  async (metadata) => await setGlossary(metadata)
);

// Summarize the results
const skipped = updateResults.filter(r => r.skipped).length;
const updated = updateResults.filter(r => r.updated).length;
const failed = updateResults.filter(r => !r.succeeded).length;

console.log(`\nGlossary update summary:`);
console.log(`- ${skipped} entries skipped (no changes needed)`);
console.log(`- ${updated} entries updated or added`);
console.log(`- ${failed} entries failed to update`);
console.log(`- ${rows.length} total entries in Google Doc`);

// Only proceed with deletion if ALL entries were successfully updated
const allSuccessful = updateResults.every(result => result.succeeded);

if (allSuccessful) {
  console.log("\nAll entries were successfully processed. Checking for outdated entries to remove...");
  
  // Remove any items that are in Coda but not in the Gdoc
  // Use a more comprehensive normalization to avoid issues with apostrophes and special chars
  const terms = rows.map(({ term }) => {
    const decoded = decode(term.trim());
    let normalized = decoded.toLowerCase().trim();
    
    // Handle common special cases that cause comparison issues
    // Replace apostrophes with empty string for consistent matching
    normalized = normalized.replace(/['']s\b/g, "s"); // Replace "'s" and "'s" with "s"
    normalized = normalized.replace(/['']/g, ""); // Remove all apostrophes
    
    return normalized;
  });
  
  // Debug log to see what terms we're considering valid (for debugging)
  if (process.env.DEBUG) {
    console.log("\nTerms from Google Doc (keeping these):");
    console.log(terms.sort().join("\n"));
  }
  
  // Identify entries to delete with details on why
  const entriesToDelete = existingGlossary.filter(({ word }) => {
    // Use same normalization strategy for Coda entries
    let normalizedWord = word.toLowerCase().trim();
    normalizedWord = normalizedWord.replace(/['']s\b/g, "s");
    normalizedWord = normalizedWord.replace(/['']/g, "");
    
    // First try exact match
    let found = terms.includes(normalizedWord);
    
    // If not found, try a more flexible match
    if (!found) {
      found = terms.some(term => {
        const simplifiedTerm = term.replace(/[^a-z0-9]/g, "");
        const simplifiedWord = normalizedWord.replace(/[^a-z0-9]/g, "");
        return simplifiedTerm === simplifiedWord;
      });
    }
    
    const shouldDelete = !found;
    
    if (shouldDelete) {
      console.log(`Will delete "${word}" - not found in Google Doc`);
    }
    
    return shouldDelete;
  });
  
  console.log(`\nIdentified ${entriesToDelete.length} entries to delete from ${existingGlossary.length} total in Coda`);
  
  if (entriesToDelete.length > 0) {
    const deleteResults = await syncApply(
      entriesToDelete,
      ({ href, word }) => {
        console.log(" -> Deleting ", word);
        return codaDelete(href);
      }
    );
    
    console.log(`\nDeletion complete: removed ${deleteResults.filter(Boolean).length} entries`);
  } else {
    console.log("\nNo entries to delete - all Coda glossary items match entries in the Google Doc.");
  }
} else {
  console.log("\nSkipping deletion step because some updates failed.");
  console.log("Please run the script again later after rate limits reset.");
  console.log("No entries will be removed until all updates succeed.");
}
