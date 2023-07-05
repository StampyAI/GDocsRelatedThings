import { getAnswers, updateAnswer } from "./coda.js";
import { compressMarkdown, sendToDiscord, logError } from "./utils.js";
import { parseDoc } from "./parser.js";
import {
  getDocsClient,
  getDriveClient,
  getGoogleDoc,
  getGoogleDocComments,
  moveAnswer,
} from "./gdrive.js";
import {
  basePath,
  codaDocID,
  codaDocURL,
  tableID,
  tableURL,
  codaColumnIDs,
} from "./constants.js";

const makeDiscordMessage = (
  answer,
  suggestionCount,
  suggestionSize,
  commentsCount
) => {
  const updateTypes = [];
  const fields = {};

  const pluralise = (text, count) =>
    `${count > 1 ? "are" : "is"} ${count} ${text}${count > 1 ? "s" : ""}`;

  if (suggestionCount > 0) {
    updateTypes.push(pluralise("open suggestion", suggestionCount));

    fields["Number of suggestions"] = `Was ${
      answer[codaColumnIDs.suggestionCount] || 0
    }, now ${suggestionCount}`;
    fields["Total size of suggestions"] = `Was ${
      answer[codaColumnIDs.suggestionSize] || 0
    }, now ${suggestionSize}`;
  }
  if (commentsCount > 0) {
    updateTypes.push(pluralise("unresolved comment", commentsCount));

    fields["Number of unresolved comments"] = commentsCount || 0;
  }

  const content = `There ${updateTypes.join(
    " and "
  )} on the Google Doc for the question "${
    answer.answerName
  }" - does anyone have a minute to review ${
    suggestionCount > 1 ? "them" : "it"
  }?`;

  return {
    content,
    embeds: [
      {
        title: answer.answerName,
        url: answer[codaColumnIDs.docURL],
        fields,
      },
    ],
  };
};

const saveAnswer = async (
  answer,
  md,
  relatedAnswerNames,
  suggestionCount,
  suggestionSize,
  commentsCount,
  alternativePhrasings
) => {
  let response;
  try {
    response = await updateAnswer(
      answer.codaID,
      md,
      relatedAnswerNames,
      suggestionCount,
      suggestionSize,
      commentsCount,
      alternativePhrasings
    );
  } catch (err) {
    logError("Error while saving to Coda", answer, { message: err.cause });
    return false;
  }

  if (response.status === 202) {
    const hasNewSuggestions =
      (suggestionSize !== answer[codaColumnIDs.suggestionSize] ||
        suggestionCount !== answer[codaColumnIDs.suggestionCount]) &&
      (suggestionSize > 0 || suggestionCount > 0);
    const hasNewComments =
      commentsCount != answer[codaColumnIDs.commentsCount] && commentsCount > 0;

    if (hasNewSuggestions || hasNewComments) {
      await sendToDiscord(
        makeDiscordMessage(
          answer,
          suggestionCount,
          suggestionSize,
          commentsCount
        ),
        false
      );
    }
  } else if (response.status === 429) {
    // This is fine - Coda sometimes returns this, but later lets it through. It's not a problem
    // if an answer gets updated a bit later
  } else if (response.statusText.includes("Row edit of size")) {
    await logError(
      `Markdown was too large for Coda at ${md.length} bytes`,
      answer
    );
    return false;
  } else {
    const error = await response.json();
    await logError(
      `HTTP ${response.status} response from Coda for "${answer.answerName}: ${error.message}"`,
      answer
    );
    return false;
  }
  return true;
};

export const replaceGdocLinks = (md, allAnswers) =>
  allAnswers.reduce(
    (md, answer) =>
      md.replaceAll(
        new RegExp(
          `\\(\\s*?https://docs.google.com/document/(u/)?(0/)?d/${answer.docID}[^)]*?\\)`,
          "g"
        ),
        `(/?state=${answer[codaColumnIDs.UIID]})`
      ),
    md
  );

const makeAnswerProcessor =
  (allAnswers, gdocsClient, gdriveClient) => async (answer) => {
    console.info(`-> ${answer.answerName}`);
    const doc = await getGoogleDoc(answer, gdocsClient);
    if (!doc) {
      console.info(`skipping "${answer.answerName}"`);
      return false;
    }
    // At this point we have a huge blob of JSON that looks kinda like:
    // https://gist.github.com/ChrisRimmer/a2a702fe86b5251c235b22c8f4d0e2b4
    let parsed;
    try {
      parsed = await parseDoc(doc);
    } catch (err) {
      logError("Error while parsing contents", answer, err);
      return false;
    }
    let {
      md,
      relatedAnswerDocIDs,
      suggestionCount,
      suggestionSize,
      alternativePhrasings,
    } = parsed;
    md = compressMarkdown(md);
    md = replaceGdocLinks(md, allAnswers);

    // Keep only doc IDs which actually have matching answers
    const validRelatedAnswers = relatedAnswerDocIDs.filter(
      // Search for answers with the doc ID we're looking for
      (relatedAnswerDocID) => {
        return allAnswers.some((a) => {
          return a.docID === relatedAnswerDocID;
        });
      }
    );
    const uniqueAlternatives = [
      ...new Set(
        alternativePhrasings.concat(
          (answer[codaColumnIDs.alternativePhrasings] || "").split("\n")
        )
      ),
    ].map((i) => i.trim());

    const relatedAnswerNames = validRelatedAnswers.map(
      (relatedAnswerDocID) =>
        allAnswers.find((a) => a.docID === relatedAnswerDocID).answerName
    );

    const comments = await getGoogleDocComments(answer, gdriveClient);
    const commentsCount =
      comments?.comments?.filter((c) => !c.resolved).length || 0;

    const isSaved = await saveAnswer(
      answer,
      md,
      relatedAnswerNames,
      suggestionCount,
      suggestionSize,
      commentsCount,
      uniqueAlternatives
    );
    if (!isSaved) return false;

    // Make sure the answer's document is in the correct folder
    return await moveAnswer(gdriveClient, answer);
  };

const parseAllAnswerDocs = async () => {
  const allAnswers = await getAnswers(tableURL);
  if (allAnswers.length == 0) throw new Error("No answers found!");

  const gdocsClient = await getDocsClient();
  const gdriveClient = await getDriveClient();
  const answerProcessor = makeAnswerProcessor(
    allAnswers,
    gdocsClient,
    gdriveClient
  );

  const results = await allAnswers
    // .filter(({ answerName }) => answerName === "Example with all the formatting")  // Limiting the search for testing purposes
    // .filter((row) => row["c-Gr2GDh30nR"] != "Live on site")
    .filter((answer) => {
      const lastIngestDateString = answer[codaColumnIDs.lastIngested];
      const lastIngestDate = new Date(lastIngestDateString);
      const lastDocEditDate = new Date(answer[codaColumnIDs.docLastEdited]);
      const status = answer[codaColumnIDs.status];
      const needsUpdate =
        lastIngestDateString === "" ||
        lastDocEditDate > lastIngestDate ||
        answer.answerName === "Example with all the formatting" ||
        Boolean(process.env.PARSE_ALL);
      return (
        !["Withdrawn", "Marked for deletion", "Uncategorized"].includes(status) && needsUpdate
      );
    })
    // Process the answers serially, as otherwise Google and Coda will complain that the script is hammering them
    // too often. The `fetch()` is asynchronous, hence the magic with promises here
    .reduce(async (previousPromise, answer) => {
      const previousResults = await previousPromise;
      try {
        return [...previousResults, await answerProcessor(answer)];
      } catch (err) {
        console.error(err);
        return [...previousResults, false];
      }
    }, Promise.resolve([]));

  return {
    succeeded: results.filter((i) => i).length,
    failed: results.filter((i) => !i).length,
  };
};

export default parseAllAnswerDocs;
