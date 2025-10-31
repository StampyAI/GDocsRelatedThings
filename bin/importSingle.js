import { getAnswers } from "../parser/coda.js";
import { tableURL } from "../parser/constants.js";
import { logError } from "../parser/utils.js";
import { getDocsClient, getDriveClient } from "../parser/gdrive.js";
import { makeAnswerProcessor } from "../parser/main.js";

const importSingle = async () => {
  const docID = process.argv[2];

  if (!docID) {
    console.error("Usage: node bin/importSingle.js <google-doc-id>");
    console.error(
      "Example: node bin/importSingle.js 1wmTcYVZ-LTFykOsY-NFHJkxF-8KmFIzbFcknLfVDrzI"
    );
    process.exit(1);
  }

  console.info(`Fetching all answers from Coda...`);
  const allAnswers = await getAnswers(tableURL);

  if (allAnswers.length === 0) {
    throw new Error("No answers found!");
  }

  console.info(`Searching for document ID: ${docID}`);
  const answer = allAnswers.find((a) => a.docID === docID);

  if (!answer) {
    console.error(`No answer found with document ID: ${docID}`);
    process.exit(1);
  }

  console.info(`Found: "${answer.answerName}"`);
  console.info(`Processing...`);

  const gdocsClient = await getDocsClient();
  const gdriveClient = await getDriveClient();
  const answerProcessor = makeAnswerProcessor(
    allAnswers,
    gdocsClient,
    gdriveClient
  );

  try {
    const success = await answerProcessor(answer);

    if (success) {
      console.info(`✓ Successfully processed "${answer.answerName}"`);
      process.exit(0);
    } else {
      console.error(`✗ Failed to process "${answer.answerName}"`);
      process.exit(1);
    }
  } catch (err) {
    await logError(err.message, answer);
    console.error(`✗ Error processing "${answer.answerName}":`, err.message);
    process.exit(1);
  }
};

try {
  await importSingle();
} catch (e) {
  await logError(e.message, {});
  console.error(e);
  process.exit(1);
}
