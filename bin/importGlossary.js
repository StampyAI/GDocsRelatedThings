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

const syncApply = (items, func) =>
  items.reduce(async (previousPromise, item) => {
    const previousResults = await previousPromise;
    try {
      let retryCount = 0;
      let success = false;
      let result;
      
      while (!success && retryCount < 5) {
        const baseDelay = 5000;
        // Exponential backoff: 5s, 10s, 20s, 40s, 80s
        const delay = baseDelay * Math.pow(2, retryCount);
        console.log(`Waiting ${delay/1000}s before next request`);
        await setTimeout(delay);
        
        try {
          result = await func(item);
          success = true;
        } catch (err) {
          console.error(`Attempt ${retryCount + 1} failed:`, err);
          retryCount++;
          if (retryCount >= 5) {
            throw err;
          }
        }
      }
      
      return [...previousResults, result];
    } catch (err) {
      console.error(err);
      return [...previousResults, false];
    }
  }, Promise.resolve([]));

const setGlossary = async ({ term, aliases, definition, answer, image }) => {
  const phrase = decode(term.trim());
  console.log(`-> ${phrase}`);
  try {
    const imgMatch = image?.match(/!\[\]\((.*?)\)/);
    const res = await updateGlossary(
      phrase,
      answer?.answerName || "",
      answer?.UIID || "",
      definition,
      aliases,
      imgMatch && imgMatch[1]
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
      return false;
    }
  } catch (err) {
    // If it's a rate limit error, rethrow to trigger the retry mechanism
    if (err.message === "Rate limit exceeded (429)") {
      throw err;
    }
    await logError(`Could not update glossary item: ${err}`, answer);
    return false;
  }
  return true;
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

// Update all glossary entries
syncApply(rows, setGlossary);

// Remove any items that are in Coda but not in the Gdoc
const terms = rows.map(({ term }) => term.toLowerCase());
syncApply(
  (await getGlossary()).filter(
    ({ word }) => !terms.includes(word.toLowerCase())
  ),
  ({ href, word }) => {
    console.log(" -> Deleting ", word);
    return codaDelete(href);
  }
);
