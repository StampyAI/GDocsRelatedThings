import { tableURL, codaColumnIDs } from "./constants.js";

export const getDocIDFromLink = (docLink) =>
  docLink.match(/https:\/\/\w+.google.com\/(\w+\/)+(?<docID>[_-\w]{25,}).*/)
    ?.groups?.docID || null;

const codaRequest = async (url, options = { headers: {} }) =>
  fetch(encodeURI(url), {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${process.env.CODA_TOKEN}`,
    },
  });

// Returns a list of tuples, each looking like [answer ID from coda, answer document ID fromn GDocs]
export const getAnswers = async (tableURL) => {
  let queryURL = `${tableURL}/rows`;

  // Coda only sends a limited number of rows at a time, so track whether we've retrieved all of them yet
  let isScanComplete = false;
  let rows = [];
  while (isScanComplete === false) {
    const { items: answerBatch, nextPageLink = null } = await codaRequest(
      queryURL
    ).then((r) => r.json());
    if (answerBatch) rows = rows.concat(answerBatch);

    // If there are more rows we haven't yet retrieved, Coda gives us a link we can access to get the next page
    if (nextPageLink) {
      queryURL = nextPageLink;
      // If that link isn't provided, we can assume we've retrieved all rows
    } else {
      isScanComplete = true;
    }
  }

  return (
    rows
      // There are some malformed rows in the table thanks to the Coda / GDocs pack. These are manually set to have a UI ID of -1 so we can filter them out
      .filter((row) => row.values[codaColumnIDs.UIID] !== "-1")
      // do some transformations to keep the data we use downstream and discard what we don't
      .map((row) => ({
        codaID: row.id,
        answerName: row.name,
        docID: getDocIDFromLink(row.values[codaColumnIDs.docURL]),
        ...row.values,
      }))
      // The gdocs -> Coda integration also imports folders as new rows. So manually discard them here :/
      .filter(
        (row) => !["In progress", "Live on site"].includes(row.answerName)
      )
  );
};

export const updateAnswer = async (
  id,
  md,
  relatedAnswerNames,
  suggestionCount,
  suggestionSize
) => {
  const rowURL = `${tableURL}/rows/${id}`;
  const payload = {
    row: {
      cells: [
        {
          column: codaColumnIDs.relatedAnswerNames,
          value: relatedAnswerNames,
        },
        {
          column: codaColumnIDs.lastIngested,
          value: new Date().toISOString(),
        },
        {
          column: codaColumnIDs.richText,
          value: md,
        },
        {
          column: codaColumnIDs.preexistingSuggestionCount,
          value: suggestionCount,
        },
        {
          column: codaColumnIDs.preexistingSuggestionSize,
          value: suggestionSize,
        },
      ],
    },
  };

  return codaRequest(rowURL, {
    method: "put",
    muteHttpExceptions: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};
