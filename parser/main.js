import { getAnswers, updateAnswer } from "./coda.js";
import { compressMarkdown, sendToDiscord, logError } from "./utils.js";
import { parseDoc } from "./parser.js";
import { getDocsClient, getGoogleDoc } from "./gdrive.js";
import {
  basePath,
  codaDocID,
  codaDocURL,
  tableID,
  tableURL,
  codaColumnIDs,
} from "./constants.js";

const parseAllAnswerDocs = async () => {
  const allAnswers = await getAnswers(tableURL);
  if (allAnswers.length == 0) throw new Error("No answers found!");

  const gdocsClient = await getDocsClient();

  allAnswers
    // .filter(({ answerName }) => answerName === "Example with all the formatting")  // Limiting the search for testing purposes
    // .filter((row) => row["c-Gr2GDh30nR"] != "Live on site")
    .filter((answer) => {
      const lastIngestDateString = answer[codaColumnIDs.lastIngested];
      const lastIngestDate = new Date(lastIngestDateString);
      const lastDocEditDate = new Date(answer[codaColumnIDs.docLastEdited]);

      return (
        lastIngestDateString === "" ||
        lastDocEditDate > lastIngestDate ||
        answer.answerName === "Example with all the formatting" ||
        lastIngestDate < new Date("2023-02-11 15:00") // To force a full purge of Docs-sourced data in Coda, set this time to just a minute before "now" and let it run. Don't update the time between runs if one times out, otherwise it'll restart. Just set the time once and let the script run as many time as it needs to in order to finish.
      );
    })
    .forEach(async (answer, i, filteredAnswers) => {
      console.info(`-> ${answer.answerName}`);
      const doc = await getGoogleDoc(answer.docID, gdocsClient);
      if (!doc) {
        console.info(`skipping "${answer.answerName}"`);
        return;
      }
      // At this point we have a huge blob of JSON that looks kinda like:
      // https://gist.github.com/ChrisRimmer/a2a702fe86b5251c235b22c8f4d0e2b4
      let { md, relatedAnswerDocIDs, suggestionCount, suggestionSize } =
        parseDoc(doc);
      md = compressMarkdown(md);

      // Keep only doc IDs which actually have matching answers
      const validRelatedAnswers = relatedAnswerDocIDs.filter(
        // Search for answers with the doc ID we're looking for
        (relatedAnswerDocID) => {
          return allAnswers.some((a) => {
            return a.docID === relatedAnswerDocID;
          });
        }
      );

      const relatedAnswerNames = validRelatedAnswers.map(
        (relatedAnswerDocID) =>
          allAnswers.find((a) => a.docID === relatedAnswerDocID).answerName
      );

      const response = await updateAnswer(
        answer.codaID,
        md,
        relatedAnswerNames,
        suggestionCount,
        suggestionSize
      );

      if (response.status === 202) {
        console.log(
          `Submitted update to Coda for answer "${answer.answerName}" with google doc ID ${answer.docID}`
        );

        if (
          (suggestionSize !== answer[codaColumnIDs.suggestionSize] ||
            suggestionCount !== answer[codaColumnIDs.suggestionCount]) &&
          (suggestionSize > 0 || suggestionCount > 0)
        ) {
          await sendToDiscord(
            {
              content: `There ${
                suggestionCount > 1 ? "are" : "is"
              } ${suggestionCount} open suggestion${
                suggestionCount > 1 ? "s" : ""
              } on the Google Doc for the question "${
                answer.answerName
              }" - does anyone have a minute to review ${
                suggestionCount > 1 ? "them" : "it"
              }?`,
              embeds: [
                {
                  title: answer.answerName,
                  url: answer[codaColumnIDs.docURL],
                  fields: {
                    "Number of suggestions": `Was ${
                      answer[codaColumnIDs.suggestionCount] || 0
                    }, now ${suggestionCount}`,
                    "Total size of suggestions": `Was ${
                      answer[codaColumnIDs.suggestionSize] || 0
                    }, now ${suggestionSize}`,
                  },
                },
              ],
            },
            false
          );
        }
      } else if (response.status === 429) {
      } else if (response.statusText.includes("Row edit of size")) {
        await logError(
          `Markdown was too large for Coda at ${md.length} bytes`,
          {
            answer,
          }
        );
      } else {
        await logError(`HTTP ${response.status} response from Coda`, {
          answer,
        });
      }

      // Make sure the answer's document is in the correct folder
      // TODO: get this working
      // moveAnswer(answer)
    });
};

export default parseAllAnswerDocs;
