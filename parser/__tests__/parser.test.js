import { jest } from "@jest/globals";
import fetchMock from "jest-fetch-mock";
import {
  parseDoc,
  getTag,
  parseParagraph,
  parsetextRun,
  parserichLink,
  parseinlineObjectElement,
  parsehorizontalRule,
  parsefootnoteReference,
  parseElement,
} from "../parser.js";

fetchMock.enableMocks();

describe("getTag", () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it("Footnotes are handled correctly", async () => {
    const mockResponse = {
      data: {
        tag: {
          result: {
            description: {
              markdown: `This is a test ^[\\[123\\]](#fn0f5x8s34vee)^.
123.  ^**[^](#fnref0f5x8s34vee)**^\n    \n    And this is a footnote`,
            },
          },
        },
      },
    };
    fetchMock.mockResponse(JSON.stringify(mockResponse));

    const result = await getTag("https://bla.bla", "test");

    expect(result).toEqual(
      "This is a test [^0f5x8s34vee].\n[^0f5x8s34vee]: And this is a footnote"
    );
  });

  it("should return empty string for invalid input", async () => {
    const mockResponse = { data: {} };
    fetchMock.mockResponse(JSON.stringify(mockResponse));

    const result = await getTag("https://bla.bla", "test");

    expect(result).toEqual("");
  });
});

describe("parsetextRun", () => {
  it("should return empty string for newline or empty content", () => {
    const textRun = { content: "\n", textStyle: {} };
    expect(parsetextRun(textRun)).toBe("");

    const emptyRun = { content: "", textStyle: {} };
    expect(parsetextRun(emptyRun)).toBe("");
  });

  it("should format bold text", () => {
    const textRun = { content: "Hello World", textStyle: { bold: true } };
    expect(parsetextRun(textRun)).toBe("**Hello World**");
  });

  it("should format italic text", () => {
    const textRun = { content: "Hello World", textStyle: { italic: true } };
    expect(parsetextRun(textRun)).toBe("*Hello World*");
  });

  it("should format italic and bold text", () => {
    const textRun = {
      content: "Hello World",
      textStyle: { italic: true, bold: true },
    };
    expect(parsetextRun(textRun)).toBe("***Hello World***");
  });

  it("should format linked text", () => {
    const textRun = {
      content: "Google",
      textStyle: { link: { url: "https://www.google.com" } },
    };
    expect(parsetextRun(textRun)).toBe("[Google](https://www.google.com)");
  });

    it("should format linked text which is empty", () => {
        const textRun = {
            content: "  ",
            textStyle: { link: { url: "https://www.google.com" } },
        };
        expect(parsetextRun(textRun)).toBe("[  ](https://www.google.com)");
    });

  it("should handle leading and trailing whitespace", () => {
    const textRun = {
      content: "  Hello World  ",
      textStyle: { bold: true },
    };
    expect(parsetextRun(textRun)).toBe("  **Hello World**  ");
  });
});

describe("parsefootnoteReference", () => {
  it("should return a string with footnoteId enclosed in square brackets", () => {
    const result = parsefootnoteReference({ footnoteId: "abc123" });
    expect(result).toBe("[^abc123]");
  });
});

describe("parseinlineObjectElement", () => {
  it("should return a markdown image with description and title if available", () => {
    const object = {
      inlineObjectId: "123",
    };
    const context = {
      documentContext: {
        inlineObjects: {
          123: {
            inlineObjectProperties: {
              embeddedObject: {
                imageProperties: {
                  contentUri: "https://example.com/image.jpg",
                },
                description: "An image",
                title: "Title",
              },
            },
          },
        },
      },
    };
    const result = parseinlineObjectElement(object, context);
    expect(result).toBe("\n![An image](https://example.com/image.jpg Title)\n");
  });

  it("should return a markdown image with only description if title not available", () => {
    const object = {
      inlineObjectId: "123",
    };
    const context = {
      documentContext: {
        inlineObjects: {
          123: {
            inlineObjectProperties: {
              embeddedObject: {
                imageProperties: {
                  contentUri: "https://example.com/image.jpg",
                },
                description: "An image",
              },
            },
          },
        },
      },
    };
    const result = parseinlineObjectElement(object, context);
    expect(result).toBe("\n![An image](https://example.com/image.jpg)\n");
  });
});

describe("parsehorizontalRule", () => {
  it("should return a string of three underscores", () => {
    const result = parsehorizontalRule();
    expect(result).toBe("___");
  });
});

describe("parseElement", () => {
  const element = {
    textRun: { textStyle: {}, content: "Hello world" },
    startIndex: 0,
    endIndex: 11,
  };

  it("returns empty string for suggested insertions", () => {
    const elementWithSuggestion = {
      ...element,
      textRun: { ...element.textRun, suggestedInsertionIds: ["abc123"] },
    };
    expect(parseElement({})(elementWithSuggestion)).toEqual("");
  });

  it("returns parsed Markdown for suggested deletions", () => {
    const elementWithSuggestion = {
      ...element,
      textRun: { ...element.textRun, suggestedDeletionIds: ["abc123"] },
    };
    expect(parseElement({})(elementWithSuggestion)).toEqual("Hello world");
  });

  it("updates suggestion sizes correctly", () => {
    const elementWithInsertion = {
      ...element,
      textRun: { ...element.textRun, suggestedInsertionIds: ["abc123"] },
    };
    const elementWithDeletion = {
      ...element,
      textRun: { ...element.textRun, suggestedDeletionIds: ["def456"] },
    };
    const context = { documentContext: { suggestions: new Map() } };
    parseElement(context)(elementWithInsertion);
    parseElement(context)(elementWithInsertion);
    parseElement(context)(elementWithDeletion);
    expect(context.documentContext.suggestions.get("abc123")).toEqual({
      insertions: 22,
      deletions: 0,
    });
    expect(context.documentContext.suggestions.get("def456")).toEqual({
      insertions: 0,
      deletions: 11,
    });
  });
});

describe("parseParagraph", () => {
  const documentContext = {
    lists: {
      "list-id": {
        listProperties: {
          nestingLevels: [
            { glyphSymbol: "•" },
            { glyphSymbol: "◦" },
            { glyphSymbol: "▪" },
          ],
        },
      },
    },
  };

  const paragraph = {
    elements: [
      { textRun: { content: "Hello, " } },
      { textRun: { content: "world!" } },
    ],
    paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
  };

  it("should return a plain paragraph without any formatting", () => {
    const result = parseParagraph(documentContext)(paragraph);
    expect(result).toEqual("Hello, world!");
  });

  it("should return a heading", () => {
    const heading = {
      ...paragraph,
      paragraphStyle: { namedStyleType: "HEADING_1" },
    };
    const result = parseParagraph(documentContext)(heading);
    expect(result).toEqual("# Hello, world!");
  });

  it("should return a heading with a list item", () => {
    const heading = {
      ...paragraph,
      paragraphStyle: { namedStyleType: "HEADING_1" },
      bullet: { nestingLevel: 1, listId: "list-id" },
    };
    const result = parseParagraph(documentContext)(heading);
    expect(result).toEqual("    - # Hello, world!");
  });

  it("should return an unordered list item", () => {
    const listItem = {
      ...paragraph,
      bullet: { nestingLevel: 1, listId: "list-id" },
    };
    const result = parseParagraph(documentContext)(listItem);
    expect(result).toEqual("    - Hello, world!");
  });

  it("should return an ordered list item", () => {
    const listItem = {
      ...paragraph,
      bullet: { nestingLevel: 1, listId: "list-id" },
    };
    documentContext.lists["list-id"].listProperties.nestingLevels[1].glyphType =
      "DECIMAL";
    const result = parseParagraph(documentContext)(listItem);
    expect(result).toEqual("    1. Hello, world!");
  });
});
