import { setTimeout } from "timers/promises";
import { decode } from "html-entities";
import { getAnswers, updateGlossary } from "../parser/coda.js";
import { parseElement } from "../parser/parser.js";
import { getDocsClient, getGoogleDoc } from "../parser/gdrive.js";
import { tableURL, GLOSSARY_DOC } from "../parser/constants.js";
import { logError } from "../parser/utils.js";

const setGlossary = async ({ term, aliases, definition, answer }) => {
  const phrase = decode(term.trim());
  console.log(`-> ${phrase}`);
  try {
    const res = await updateGlossary(
      phrase,
      answer?.answerName || "",
      answer?.UIID || "",
      definition,
      aliases
    );
    if (res.status > 300) {
      await logError(`Could not update glossary item: ${res.statusText}`);
      return false;
    }
  } catch (err) {
    await logError(`Could not update glossary item: ${err}`);
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

// Use this ugly magic loop thingy to run them sequentially
rows.reduce(async (previousPromise, item) => {
    const previousResults = await previousPromise;
    try {
        await setTimeout(1000);
        return [...previousResults, await setGlossary(item)];
    } catch (err) {
        console.error(err);
        return [...previousResults, false];
    }
}, Promise.resolve([]));
