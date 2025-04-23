import { tableURL, codaColumnIDs, glossaryTableURL } from "./constants.js";

export const getDocIDFromLink = (docLink) =>
  docLink.match(/https:\/\/\w+.google.com\/(\w+\/)+(?<docID>[_-\w]{25,}).*/)
    ?.groups?.docID || null;

const codaRequest = async (url, options = { headers: {} }) =>
  fetch(encodeURI(url), {
    timeout: 5000,
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${process.env.CODA_TOKEN}`,
    },
  });

const getRows = async (tableURL) => {
  let queryURL = `${tableURL}/rows`;

  // Coda only sends a limited number of rows at a time, so track whether we've retrieved all of them yet
  let isScanComplete = false;
  let rows = [];

  // Check if we're in a test environment - jest-fetch-mock doesn't set content-type headers properly
  const isTestEnvironment = process.env.NODE_ENV === "test" || !!global.jest;

  while (isScanComplete === false) {
    try {
      const response = await codaRequest(queryURL);

      // Only check content-type in non-test environments
      if (!isTestEnvironment) {
        // Check if content type is JSON, if not, try to get the HTML for debugging
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          console.warn(`Unexpected content type from Coda API: ${contentType}`);

          // Get the raw response to diagnose the issue
          const rawText = await response.text();

          // Create a new error with the HTML content attached
          const parseError = new SyntaxError(
            `Unexpected token, received non-JSON response with content type: ${contentType}`
          );
          parseError.rawHtml = rawText;
          parseError.status = response.status;
          parseError.url = queryURL;
          throw parseError;
        }
      }

      // If we reach here, proceed with JSON parsing
      let responseData;
      try {
        responseData = await response.json();
      } catch (parseError) {
        // Skip content-type checks in test environment
        if (isTestEnvironment) {
          throw parseError;
        }

        // If JSON parsing fails, try to get the text content for debugging
        const rawText = await response
          .text()
          .catch(() => "Unable to get response text");

        // Create enhanced error with the HTML content attached
        const enhancedError = new SyntaxError(
          `Failed to parse JSON: ${parseError.message}`
        );
        enhancedError.rawHtml = rawText;
        enhancedError.status = response.status;
        enhancedError.url = queryURL;
        throw enhancedError;
      }

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
    } catch (error) {
      // Skip detailed error logging in test environment
      if (!isTestEnvironment) {
        console.error(`Error fetching rows from ${queryURL}: ${error.message}`);
      }

      // If this is already our custom error with HTML attached, just rethrow it
      if (error.rawHtml) {
        throw error;
      }

      // Otherwise wrap the error with more context
      const wrappedError = new Error(
        `Failed to fetch rows from Coda: ${error.message}`
      );
      wrappedError.originalError = error;
      wrappedError.url = queryURL;
      throw wrappedError;
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
  image
) =>
  codaUpsert(
    `${glossaryTableURL}/rows/`,
    {
      glossaryWord,
      glossaryQuestion: questionId,
      glossaryQuestionID: questionUIId,
      glossaryRichText: md,
      glossaryAliases: aliases,
      glossaryLastIngested: new Date().toISOString(),
      glossaryImage: image || undefined,
    },
    ["glossaryWord"]
  );
