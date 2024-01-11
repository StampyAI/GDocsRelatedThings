import { jest } from "@jest/globals";
import fetchMock from "jest-fetch-mock";
import {
  parseDoc,
  fetchExternalContent,
  getTag,
  parseParagraph,
  parsetextRun,
  parserichLink,
  parseinlineObjectElement,
  parsehorizontalRule,
  parsefootnoteReference,
  parseElement,
  mergeSameElements,
} from "../parser.js";

fetchMock.enableMocks();

const makeText = (content) => ({
  paragraph: {
    elements: [{ textRun: { content, textStyle: {} } }],
    paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
  },
});

const makeLink = (uri) => ({
  paragraph: { elements: [{ richLink: { richLinkProperties: { uri } } }] },
});

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
              markdown: `This is an example LW tag content (see mockResponse) ^[\\[123\\]](#fn0f5x8s34vee)^.
123.  ^**[^](#fnref0f5x8s34vee)**^\n    \n    And this is a footnote`,
            },
          },
        },
      },
    };
    fetchMock.mockResponse(JSON.stringify(mockResponse));

    const result = await getTag("https://bla.bla", "test");

    expect(result).toEqual(
      "This is an example LW tag content (see mockResponse) [^0f5x8s34vee].\n[^0f5x8s34vee]: And this is a footnote"
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

  it.each([
    [{ red: 0.31, green: 0.31, blue: 0.31 }],
    [{ red: 0.4, green: 0.4, blue: 0.4 }],
    [{ red: 0.5, green: 0.5, blue: 0.5 }],
    // Try some with a bit of variance
    [{ red: 0.5, green: 0.491, blue: 0.501 }],
  ])(
    "should return empty string for grey text with rgbColor = %p",
    (rgbColor) => {
      const textRun = {
        content: "bla bla bla",
        textStyle: { foregroundColor: { color: { rgbColor } } },
      };
      expect(parsetextRun(textRun)).toBe("");
    }
  );

  it.each([
    // really dark grey or explicit black isn't removed
    [{ red: 0.01, green: 0.01, blue: 0.01 }],
    [{ red: 0.0, green: 0.0, blue: 0.0 }],
    // really light grey or white isn't removed
    [{ red: 0.99, green: 0.99, blue: 0.99 }],
    [{ red: 1.0, green: 1.0, blue: 1.0 }],
    // non gray is removed
    [{ red: 0.5, green: 0.0, blue: 0.5 }],
    [{ red: 0.1, green: 0.5, blue: 0.8 }],
  ])(
    "should not return empty string for non text with rgbColor = %p",
    (rgbColor) => {
      const textRun = {
        content: "bla bla bla",
        textStyle: { foregroundColor: { color: { rgbColor } } },
      };
      expect(parsetextRun(textRun)).toBe("bla bla bla");
    }
  );

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
    expect(result).toBe(
      '\n![An image](https://example.com/image.jpg "Title")\n'
    );
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

  it("should handle empty paragraphs", () => {
    const result = parseParagraph(documentContext)({
      elements: [
        { textRun: { content: "  \n \n " } },
        { textRun: { content: "" } },
      ],
      paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
    });
    expect(result).toEqual("");
  });

  it("should paragraphs that are suggestions", () => {
    const result = parseParagraph(documentContext)({
      elements: [
        {
          textRun: {
            content: "This is a suggestion",
            suggestedInsertionIds: ["1"],
          },
        },
        { textRun: { content: "As is this", suggestedInsertionIds: ["2"] } },
      ],
      paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
    });
    expect(result).toEqual("");
  });

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
    documentContext.orderedList=1;
    documentContext.lists["list-id"].listProperties.nestingLevels[1].glyphType =
      "DECIMAL";
    const result = parseParagraph(documentContext)(listItem);
    expect(result).toEqual("    1. Hello, world!");
  });
});

describe("parseDoc", () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it("parses a document without footnotes or related answers", async () => {
    const doc = {
      body: {
        content: [makeText("This is some text"), { table: {} }],
      },
    };
    const result = await parseDoc(doc);

    expect(result.md).toEqual("This is some text\n\n");
    expect(result.relatedAnswerDocIDs).toEqual([]);
    expect(result.suggestionCount).toEqual(0);
    expect(result.suggestionSize).toEqual(0);
  });

  it("removes everything after the related block", async () => {
    const doc = {
      body: {
        content: [
          makeText("This is some text"),
          makeText("Related\n"),
          makeLink("https://docs.google.com/document/d/123"),
          makeText("This will be ignored"),
          makeText("This too will be ignored"),
        ],
      },
      footnotes: {},
      lists: {},
    };
    const result = await parseDoc(doc);

    expect(result.md).toEqual("This is some text\n\n");
    expect(result.relatedAnswerDocIDs).toEqual(["123"]);
    expect(result.suggestionCount).toEqual(0);
    expect(result.suggestionSize).toEqual(0);
  });

  it("handles all types of related items", async () => {
    const textLink = makeText("other related answer");
    textLink.paragraph.elements[0].textRun.textStyle.link = {
      url: "https://docs.google.com/document/d/125",
    };
    const doc = {
      body: {
        content: [
          makeText("This is some text"),
          makeText("Related\n"),
          makeLink("https://docs.google.com/document/d/123"),
          textLink,
          // non valid google doc links will be ignored
          makeLink("https://not.google.link/document/d/129"),
          makeText("Not a link, so ignored"),
        ],
      },
      footnotes: {},
      lists: {},
    };
    const result = await parseDoc(doc);

    expect(result.md).toEqual("This is some text\n\n");
    expect(result.relatedAnswerDocIDs).toEqual(["123", "125"]);
    expect(result.suggestionCount).toEqual(0);
    expect(result.suggestionSize).toEqual(0);
  });

  it("handles non standard related blocks", async () => {
    const doc = {
      body: {
        content: [
          makeText("This is some text"),
          makeText("    \n\n    Related    \n"),
          makeLink("https://docs.google.com/document/d/123"),
          makeText("This will be ignored"),
          makeText("This too will be ignored"),
        ],
      },
      footnotes: {},
      lists: {},
    };
    const result = await parseDoc(doc);

    expect(result.md).toEqual("This is some text\n\n");
    expect(result.relatedAnswerDocIDs).toEqual(["123"]);
    expect(result.suggestionCount).toEqual(0);
    expect(result.suggestionSize).toEqual(0);
  });

  it("handles alternative phrasings", async () => {
    const doc = {
      body: {
        content: [
          makeText("This is some text"),
          makeText("    \n\n    Alternative phrasings    \n"),
          makeText("some other way of saying things"),
          makeText("bla bla bla"),
        ],
      },
      footnotes: {},
      lists: {},
    };
    const result = await parseDoc(doc);

    expect(result.md).toEqual("This is some text\n\n");
    expect(result.alternativePhrasings).toEqual([
      "some other way of saying things",
      "bla bla bla",
    ]);
    expect(result.suggestionCount).toEqual(0);
    expect(result.suggestionSize).toEqual(0);
  });

  it("handles alternative phrasings even when after related section", async () => {
    const doc = {
      body: {
        content: [
          makeText("This is some text"),
          makeText("    \n\n    Related    \n"),
          makeLink("https://docs.google.com/document/d/123"),
          makeText("This will be ignored"),
          makeText("    \n\n    Alternative phrasings    \n"),
          makeText("some other way of saying things"),
          makeText("bla bla bla"),
        ],
      },
      footnotes: {},
      lists: {},
    };
    const result = await parseDoc(doc);

    expect(result.md).toEqual("This is some text\n\n");
    expect(result.relatedAnswerDocIDs).toEqual(["123"]);
    expect(result.alternativePhrasings).toEqual([
      "some other way of saying things",
      "bla bla bla",
    ]);
    expect(result.suggestionCount).toEqual(0);
    expect(result.suggestionSize).toEqual(0);
  });

  it("ignores things that aren't paragraphs", async () => {
    const doc = {
      body: {
        content: [
          makeText("This is some text"),
          { bla: "bla" },
          makeText("Related\n"),
        ],
      },
      footnotes: {},
      lists: {},
    };
    const result = await parseDoc(doc);

    expect(result.md).toEqual("This is some text\n\n");
    expect(result.relatedAnswerDocIDs).toEqual([]);
    expect(result.suggestionCount).toEqual(0);
    expect(result.suggestionSize).toEqual(0);
  });

  it("parses a document with footnotes and related answers", async () => {
    const doc = {
      body: {
        content: [
          makeText("This is some text"),
          {
            footnote: {
              content: [makeText("This is a footnote")],
            },
          },
          makeText("Related\n"),
          makeLink("https://docs.google.com/document/d/123"),
        ],
      },
      footnotes: {
        1: {
          content: [makeText("This is a footnote")],
        },
      },
      lists: {
        1: {},
      },
    };
    const result = await parseDoc(doc);

    expect(result.md).toEqual("This is some text\n\n[^1]:This is a footnote");
    expect(result.relatedAnswerDocIDs).toEqual(["123"]);
    expect(result.suggestionCount).toEqual(0);
    expect(result.suggestionSize).toEqual(0);
  });

  const mockResponse = {
    data: {
      tag: {
        result: {
          description: {
            markdown: `This is an example LW tag content (see mockResponse)`,
          },
        },
      },
    },
  };

  it("parses a document with a LessWrong tag", async () => {
    const doc = {
      body: {
        content: [makeText("https://www.lesswrong.com/tag/some-tag")],
      },
    };

    fetchMock.mockResponse(JSON.stringify(mockResponse));
    const result = await parseDoc(doc);

    expect(result.md).toEqual(
      "This is an example LW tag content (see mockResponse)"
    );
    expect(result.relatedAnswerDocIDs).toEqual([]);
  });

  it("parses a document with an Effective Altruism Forum tag", async () => {
    const doc = {
      body: {
        content: [
          makeText("https://forum.effectivealtruism.org/topics/some-tag"),
        ],
      },
    };
    fetchMock.mockResponse(JSON.stringify(mockResponse));
    const result = await parseDoc(doc);

    expect(result.md).toEqual(
      "This is an example LW tag content (see mockResponse)"
    );
    expect(result.relatedAnswerDocIDs).toEqual([]);
  });

  it("parses a document with a LessWrong tag if the link is anywhere in the first paragraph", async () => {
    const doc = {
      body: {
        content: [
          makeText(
            "Bla bla bla, check https://www.lesswrong.com/tag/some-tag for more info"
          ),
        ],
      },
    };

    fetchMock.mockResponse(JSON.stringify(mockResponse));
    const result = await parseDoc(doc);

    expect(result.md).toEqual(
      "This is an example LW tag content (see mockResponse)"
    );
    expect(result.relatedAnswerDocIDs).toEqual([]);
  });

  it("doesn't parse a document as a LW tag if it contains other stuff than the URL", async () => {
    const doc = {
      body: {
        content: [
          makeText("https://www.lesswrong.com/tag/some-tag"),
          makeText(
            "This will cause it to be shown as is, rather than fetching the content"
          ),
        ],
      },
    };

    const result = await parseDoc(doc);

    expect(result.md).toEqual(
      "https://www.lesswrong.com/tag/some-tag\n\nThis will cause it to be shown as is, rather than fetching the content\n\n"
    );
    expect(result.relatedAnswerDocIDs).toEqual([]);
  });
});

describe("fetchExternalContent", () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  const mockResponse = {
    data: {
      tag: {
        result: {
          description: {
            markdown: `This is an example LW tag content (see mockResponse)`,
          },
        },
      },
    },
  };

  it("returns null for empty paragraphs", async () => {
    const paragraphs = [];
    const result = await fetchExternalContent(paragraphs);
    expect(result).toBeNull();
  });

  it("returns null for paragraphs with no text", async () => {
    const paragraphs = [makeText("").paragraph];
    const result = await fetchExternalContent(paragraphs);
    expect(result).toBeNull();
  });

  it("returns null when multiple paragraphs provided", async () => {
    const paragraphs = [
      makeText("This will not fetch https://www.lesswrong.com/tag/some-tag.")
        .paragraph,
      makeText(
        "Having additional paragraphs means that the contents should be shown, rather than fetching stuff from LW"
      ).paragraph,
    ];
    const result = await fetchExternalContent(paragraphs);
    expect(result).toBeNull();
  });

  it("calls getLWTag for lesswrong.com tags", async () => {
    const paragraphs = [
      makeText(
        "Can be found at https://www.lesswrong.com/tag/some-tag. This should suffice to extract the link"
      ).paragraph,
    ];
    fetchMock.mockResponse(JSON.stringify(mockResponse));
    const result = await fetchExternalContent(paragraphs);
    expect(result).toEqual(
      "This is an example LW tag content (see mockResponse)"
    );
  });

  it("calls getEAFTag for EAF tags", async () => {
    const paragraphs = [
      makeText(
        "Check out this post on https://forum.effectivealtruism.org/topics/ea-fund"
      ).paragraph,
    ];
    fetchMock.mockResponse(JSON.stringify(mockResponse));
    const result = await fetchExternalContent(paragraphs);
    expect(result).toEqual(
      "This is an example LW tag content (see mockResponse)"
    );
  });

  it("returns null for unknown tag URLs", async () => {
    const paragraphs = [
      makeText("Read up about this at https://bla.bla.com").paragraph,
    ];
    const result = await fetchExternalContent(paragraphs);
    expect(result).toBeNull();
  });

  it("parses a document with a LessWrong tag and a related section", async () => {
    const paragraphs = [
      makeText("https://www.lesswrong.com/tag/some-tag").paragraph,
      makeText("\n").paragraph,
      makeText("  ").paragraph,
      makeText("").paragraph,
      { elements: [{}] },
    ];
    fetchMock.mockResponse(JSON.stringify(mockResponse));
    const result = await fetchExternalContent(paragraphs);
    expect(result).toEqual(
      "This is an example LW tag content (see mockResponse)"
    );
  });

  it("ignores comments and suggested edits", async () => {
    const paragraphs = [
      makeText("https://www.lesswrong.com/tag/some-tag").paragraph,
      {
        elements: [
          {
            textRun: {
              content: "This is a suggested change",
              textStyle: {},
              suggestedInsertionIds: ["suggest.wxvy2fk80chl"],
            },
          },
        ],
        paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
      },
      {
        elements: [
          {
            textRun: {
              content: "This is a different suggested change",
              textStyle: {},
              suggestedInsertionIds: ["suggest.sadasdasd"],
            },
          },
        ],
        paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
      },
    ];
    fetchMock.mockResponse(JSON.stringify(mockResponse));
    const result = await fetchExternalContent(paragraphs);
    expect(result).toEqual(
      "This is an example LW tag content (see mockResponse)"
    );
  });
});

describe("mergeSameElements", () => {
  const makeElement = (text, url) => {
    const elem = {
      startIndex: 1,
      endIndex: 3,
      textRun: {
        content: text,
        textStyle: {
          baselineOffset: "NONE",
        },
      },
    };
    if (url) {
      elem.textRun.textStyle.link = { url };
    }
    return elem;
  };

  it("Items without links aren't touched", async () => {
    const elements = [
      makeElement("Bla "),
      makeElement("bla"),
      makeElement(" "),
      makeElement("bla"),
    ];
    expect(mergeSameElements(elements)).toEqual(elements);
  });

  it("Non consequent links aren't touched", async () => {
    const elements = [
      makeElement("Bla ", "http://bla.com"),
      makeElement("bla"),
      makeElement(" ", "http://bla.com"),
      makeElement("bla"),
    ];
    expect(mergeSameElements(elements)).toEqual(elements);
  });

  it("Consequent links that are different aren't touched", async () => {
    const elements = [
      makeElement("Bla ", "http://bla.com"),
      makeElement("bla", "http://ble.ble"),
      makeElement(" ", "http://bla.com"),
      makeElement("bla"),
    ];
    expect(mergeSameElements(elements)).toEqual(elements);
  });

  it("Consequent links that are the same get merged", async () => {
    const elements = [
      makeElement("Bla ", "http://bla.com"),
      makeElement("bla", "http://bla.com"),
      makeElement(" ", "http://bla.com"),
      makeElement("bla"),
    ];
    expect(mergeSameElements(elements)).toEqual([
      makeElement("Bla bla ", "http://bla.com"),
      makeElement("bla"),
    ]);
  });
});
