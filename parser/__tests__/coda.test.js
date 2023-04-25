import { jest } from "@jest/globals";
import fetch from "jest-fetch-mock";
import { getAnswers, getDocIDFromLink, updateAnswer } from "../coda.js";
import { codaColumnIDs } from "../constants.js";

fetch.enableMocks();

describe("getDocIDFromLink", () => {
  test("returns the correct doc ID for a valid Google Docs link", () => {
    const docLink =
      "https://docs.google.com/document/d/1234567890abcdefghijklmnopqrstuvwxyz";
    const expectedDocID = "1234567890abcdefghijklmnopqrstuvwxyz";
    expect(getDocIDFromLink(docLink)).toBe(expectedDocID);
  });

  test("returns null for an invalid Google Docs link", () => {
    const docLink = "https://google.com";
    expect(getDocIDFromLink(docLink)).toBeNull();
  });

  test("returns null for a non-Google Docs link", () => {
    const docLink = "https://example.com";
    expect(getDocIDFromLink(docLink)).toBeNull();
  });
});

describe("getAnswers", () => {
  const makeAnswer = (id, { docID, UIID, name, ...rest }) => {
    const padded = `${docID ?? id}`.padStart(30, "0");
    return {
      id: `${id}`,
      name: name ?? `Answer ${id}`,
      values: {
        [codaColumnIDs.UIID]: `${UIID ?? id}`,
        [codaColumnIDs.docURL]: `https://docs.google.com/document/d/${padded}/edit`,
        ...rest,
      },
    };
  };

  beforeEach(() => {
    fetch.resetMocks();
  });

  it("should return an array of answer objects", async () => {
    fetch.mockResponseOnce(JSON.stringify({ items: [1, 2].map(makeAnswer) }));

    const result = await getAnswers("https://coda.io/table-url");

    expect(result).toEqual([
      {
        codaID: "1",
        answerName: "Answer 1",
        docID: "000000000000000000000000000001",
        [codaColumnIDs.UIID]: "1",
        [codaColumnIDs.docURL]:
          "https://docs.google.com/document/d/000000000000000000000000000001/edit",
      },
      {
        codaID: "2",
        answerName: "Answer 2",
        docID: "000000000000000000000000000002",
        [codaColumnIDs.UIID]: "2",
        [codaColumnIDs.docURL]:
          "https://docs.google.com/document/d/000000000000000000000000000002/edit",
      },
    ]);
  });

  it("malformed rows are skipped", async () => {
    fetch.mockResponseOnce(JSON.stringify({ items: [1, -1].map(makeAnswer) }));

    const result = await getAnswers("https://coda.io/table-url");

    expect(result).toEqual([
      {
        codaID: "1",
        answerName: "Answer 1",
        docID: "000000000000000000000000000001",
        [codaColumnIDs.UIID]: "1",
        [codaColumnIDs.docURL]:
          "https://docs.google.com/document/d/000000000000000000000000000001/edit",
      },
    ]);
  });

  it("should handle pagination", async () => {
    fetch
      .mockResponseOnce(
        JSON.stringify({
          items: [1, 2].map(makeAnswer),
          nextPageLink: "https://coda.io/next-page",
        })
      )
      .mockResponseOnce(
        JSON.stringify({ items: [3, 4].map(makeAnswer), nextPageLink: null })
      );

    const result = await getAnswers("https://coda.io/table-url");

    expect(result).toEqual(
      [1, 2, 3, 4].map((i) => ({
        codaID: `${i}`,
        answerName: `Answer ${i}`,
        docID: `00000000000000000000000000000${i}`,
        [codaColumnIDs.UIID]: `${i}`,
        [codaColumnIDs.docURL]: `https://docs.google.com/document/d/00000000000000000000000000000${i}/edit`,
      }))
    );
  });
});

describe("updateAnswer", () => {
  // Set up fetch mock before each test
  beforeEach(() => {
    fetch.resetMocks();
    process.env.CODA_TOKEN = "fake-token";
  });

  test("updates answer with correct payload", async () => {
    const id = 123;
    const md = "Updated answer";
    const relatedAnswerNames = ["Answer 1", "Answer 2"];
    const suggestionCount = 5;
    const suggestionSize = 10;
    const mockDate = new Date("2022-01-01T00:00:00.000Z");
    jest.spyOn(global, "Date").mockImplementation(() => mockDate);

    const expectedPayload = JSON.stringify({
      row: {
        cells: [
          {
            column: codaColumnIDs.relatedAnswerNames,
            value: relatedAnswerNames,
          },
          {
            column: codaColumnIDs.lastIngested,
            value: mockDate.toISOString(),
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
    });

    fetch.mockResponseOnce("", { status: 200 });

    await updateAnswer(
      id,
      md,
      relatedAnswerNames,
      suggestionCount,
      suggestionSize
    );

    expect(fetch.mock.calls[0]).toEqual([
      "https://coda.io/apis/v1//docs/fau7sl2hmG/tables/grid-sync-1059-File/rows/123",
      {
        method: "put",
        muteHttpExceptions: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer fake-token",
        },
        body: expectedPayload,
      },
    ]);
  });

  test("throws an error if fetch fails", async () => {
    const id = 123;
    const md = "Updated answer";
    const relatedAnswerNames = ["Answer 1", "Answer 2"];
    const suggestionCount = 5;
    const suggestionSize = 10;

    const expectedError = new Error("Failed to update answer");

    fetch.mockRejectOnce(expectedError);

    await expect(
      updateAnswer(id, md, relatedAnswerNames, suggestionCount, suggestionSize)
    ).rejects.toEqual(expectedError);
  });
});
