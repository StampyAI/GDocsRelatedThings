import { tableURL, codaColumnIDs, glossaryTableURL } from "./constants.js";
import { withRetry } from "./utils.js";

export const getDocIDFromLink = (docLink) =>
  docLink.match(/https:\/\/\w+.google.com\/(\w+\/)+(?<docID>[_-\w]{25,}).*/)
    ?.groups?.docID || null;

const codaRequest = async (url, options = { headers: {} }) =>
  withRetry(async () => {
    const response = await fetch(encodeURI(url), {
      timeout: 5000,
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${process.env.CODA_TOKEN}`,
      },
    });

    // Check for non-JSON responses (e.g., HTML error pages) and trigger retry
    const contentType = response.headers.get("content-type");
    const isTestEnvironment = process.env.NODE_ENV === "test" || !!global.jest;
    if (
      !isTestEnvironment &&
      contentType &&
      !contentType.includes("application/json")
    ) {
      // Read the response body to capture error details for debugging
      const responseText = await response.text();
      const error = new Error(
        `Coda API returned non-JSON response: ${contentType}`
      );
      error.status = response.status;
      error.rawHtml = responseText;
      throw error;
    }

    return response;
  }, `Coda API request to ${url.split("?")[0]}`); // Log URL without query params

const getRows = async (tableURL) => {
  let queryURL = `${tableURL}/rows`;

  // Coda only sends a limited number of rows at a time, so track whether we've retrieved all of them yet
  let isScanComplete = false;
  let rows = [];

  while (isScanComplete === false) {
    const response = await codaRequest(queryURL);
    const responseData = await response.json();

    const answerBatch = responseData.items;
    const nextPageLink = responseData.nextPageLink;

    if (answerBatch) rows = rows.concat(answerBatch);

    // If there are more rows we haven't yet retrieved, Coda gives us a link we can access to get the next page
    if (nextPageLink) {
      queryURL = nextPageLink;
      // If that link isn't provided, we can assume we've retrieved all rows
    } else {
      isScanComplete = true;
    }
  }
  return rows;
};

// Returns a list of tuples, each looking like [answer ID from coda, answer document ID fromn GDocs]
export const getAnswers = async (tableURL) => {
  return (
    (await getRows(tableURL))
      // There are some malformed rows in the table thanks to the Coda / GDocs pack. These are manually set to have a UI ID of -1 so we can filter them out
      .filter((row) => row.values[codaColumnIDs.UIID] !== "-1")
      // do some transformations to keep the data we use downstream and discard what we don't
      .map((row) => ({
        codaID: row.id,
        answerName: row.name,
        docID: getDocIDFromLink(row.values[codaColumnIDs.docURL]),
        UIID: row.values[codaColumnIDs.UIID],
        tags: row.values[codaColumnIDs.tags]?.split(","),
        ...row.values,
      }))
      // The gdocs -> Coda integration also imports folders as new rows. So manually discard them here :/
      .filter(
        (row) => !["In progress", "Live on site"].includes(row.answerName)
      )
  );
};

export const getGlossary = async () => {
  return (await getRows(glossaryTableURL)).map((row) => ({
    id: row.id,
    href: row.href,
    word: row.values[codaColumnIDs.glossaryWord],
    richText: row.values[codaColumnIDs.glossaryRichText],
    question: row.values[codaColumnIDs.glossaryQuestion],
    questionId: row.values[codaColumnIDs.glossaryQuestionID],
    aliases: row.values[codaColumnIDs.glossaryAliases],
    lastIngested: row.values[codaColumnIDs.glossaryLastIngested],
    image: row.values[codaColumnIDs.glossaryImage],
  }));
};

const codaMutate = async (url, method, payload) =>
  codaRequest(url, {
    method,
    muteHttpExceptions: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const codaDelete = async (url) =>
  codaRequest(url, { method: "delete", muteHttpExceptions: true });

export const codaUpdate = async (url, values) =>
  codaMutate(url, "put", {
    row: {
      cells: Object.entries(values).map(([k, v]) => ({
        column: codaColumnIDs[k],
        value: v,
      })),
    },
  });

export const codaUpsert = async (url, values, keyColumns) =>
  codaMutate(url, "post", {
    rows: [
      {
        cells: Object.entries(values).map(([k, v]) => ({
          column: codaColumnIDs[k],
          value: v,
        })),
      },
    ],
    keyColumns: keyColumns.map((k) => codaColumnIDs[k]),
  });

export const updateAnswer = async (
  id,
  md,
  relatedAnswerNames,
  suggestionCount,
  suggestionSize,
  commentsCount,
  alternativePhrasings,
  banners,
  uiid
) =>
  codaUpdate(`${tableURL}/rows/${id}`, {
    relatedAnswerNames: relatedAnswerNames,
    richText: md,
    preexistingSuggestionCount: suggestionCount,
    preexistingSuggestionSize: suggestionSize,
    commentsCount: commentsCount,
    alternativePhrasings: (alternativePhrasings || []).join("\n"),
    lastIngested: new Date().toISOString(),
    banners: banners,
    UIID: uiid,
  });

export const updateGlossary = async (
  glossaryWord,
  questionId,
  questionUIId,
  md,
  aliases,
  image,
  imageDimensions
) => {
  // Require image dimensions if image is provided
  let imageData = undefined;
  if (image) {
    if (!imageDimensions) {
      throw new Error(
        `Image dimensions required for glossary entry: ${glossaryWord}`
      );
    }
    imageData = JSON.stringify({
      url: image,
      width: imageDimensions.width,
      height: imageDimensions.height,
    });
  }

  return codaUpsert(
    `${glossaryTableURL}/rows/`,
    {
      glossaryWord,
      glossaryQuestion: questionId,
      glossaryQuestionID: questionUIId,
      glossaryRichText: md,
      glossaryAliases: aliases,
      glossaryLastIngested: new Date().toISOString(),
      glossaryImage: imageData,
    },
    ["glossaryWord"]
  );
};
