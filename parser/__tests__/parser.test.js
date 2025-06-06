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
  makeBulletOrderMap,
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
        tags: {
          results: [
            {
              description: {
                markdown: `This is an example LW tag content (see mockResponse) ^[\\[123\\]](#fn0f5x8s34vee)^.
123.  ^**[^](#fnref0f5x8s34vee)**^\n    \n    And this is a footnote`,
              },
            },
          ],
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
  const getParagraph = (startIndex, runCount) => {
    const elements = [];
    for (let i = 0; i < runCount; i++) {
      elements.push({
        startIndex: startIndex + i,
        textRun: {
          content: i % 2 == 0 ? "Hello, " : "world!",
        },
      });
    }
    return {
      elements,
      paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
    };
  };
  const paragraph = getParagraph(1, 2);

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
      bullet: { listId: "list-id" },
    };
    const context = {
      ...documentContext,
      lists: {
        "list-id": {
          listProperties: {
            nestingLevels: [{ glyphType: "DECIMAL" }],
          },
        },
      },
      getBulletOrderNumber: makeBulletOrderMap([listItem]),
    };
    const result = parseParagraph(context)(listItem);
    expect(result).toEqual("1. Hello, world!");
  });

  it("should parse a list with several items", () => {
    const paragraphCount = 2;
    const paragraphs = [];
    for (let i = 0; i < paragraphCount; i++) {
      const runCount = 2;
      const paragraph = getParagraph(i * runCount + 1, runCount);
      const listItem = {
        ...paragraph,
        bullet: { listId: "list-id" },
      };
      paragraphs.push(listItem);
    }
    const context = {
      ...documentContext,
      lists: {
        "list-id": {
          listProperties: {
            nestingLevels: [{ glyphType: "DECIMAL" }],
          },
        },
      },
      getBulletOrderNumber: makeBulletOrderMap(paragraphs),
    };
    const parseWithContext = parseParagraph(context, paragraphs);
    const result1 = parseWithContext(paragraphs[0]);
    expect(result1).toEqual("1. Hello, world!");
    const result2 = parseWithContext(paragraphs[1]);
    expect(result2).toEqual("2. Hello, world!");
  });

  it("should parse multiple lists", () => {
    const paragraphCount = 2;
    const paragraphs = [];
    for (let i = 0; i < paragraphCount; i++) {
      const runCount = 2;
      const paragraph = getParagraph(i * runCount + 1, runCount);
      const listItem = {
        ...paragraph,
        bullet: { listId: "list-id-" + i },
      };
      paragraphs.push(listItem);
    }
    const decimalList = {
      listProperties: {
        nestingLevels: [{ glyphType: "DECIMAL" }],
      },
    };
    const context = {
      ...documentContext,
      lists: {
        "list-id-0": decimalList,
        "list-id-1": decimalList,
      },
      getBulletOrderNumber: makeBulletOrderMap(paragraphs),
    };
    const parseWithContext = parseParagraph(context, paragraphs);
    const result1 = parseWithContext(paragraphs[0]);
    expect(result1).toEqual("1. Hello, world!");
    const result2 = parseWithContext(paragraphs[1]);
    expect(result2).toEqual("1. Hello, world!");
  });

  it("should parse a list with a nested item", () => {
    const paragraphCount = 2;
    const paragraphs = [];
    for (let i = 0; i < paragraphCount; i++) {
      const runCount = 2;
      const paragraph = getParagraph(i * runCount + 1, runCount);
      const listItem = {
        ...paragraph,
        bullet: { listId: "list-id" },
      };
      if (i >= 1) {
        listItem.bullet.nestingLevel = i;
      }
      paragraphs.push(listItem);
    }
    const context = {
      ...documentContext,
      lists: {
        "list-id": {
          listProperties: {
            nestingLevels: [{ glyphType: "DECIMAL" }, { glyphType: "DECIMAL" }],
          },
        },
      },
      getBulletOrderNumber: makeBulletOrderMap(paragraphs),
    };
    const parseWithContext = parseParagraph(context, paragraphs);
    const result1 = parseWithContext(paragraphs[0]);
    expect(result1).toEqual("1. Hello, world!");
    const result2 = parseWithContext(paragraphs[1]);
    const nestingSpacer = "    ";
    expect(result2).toEqual(nestingSpacer + "1. Hello, world!");
  });

  it("should format indented text as block quotes", () => {
    const indentedParagraph = {
      elements: [{ textRun: { content: "This is an indented quote" } }],
      paragraphStyle: {
        namedStyleType: "NORMAL_TEXT",
        indentStart: { magnitude: 36 }, // Standard indentation button level
      },
    };
    const result = parseParagraph(documentContext)(indentedParagraph);
    expect(result).toEqual("> This is an indented quote");
  });

  it("should not format text with small indentation as block quotes", () => {
    const slightlyIndentedParagraph = {
      elements: [{ textRun: { content: "This has small indentation" } }],
      paragraphStyle: {
        namedStyleType: "NORMAL_TEXT",
        indentStart: { magnitude: 10 }, // Below our threshold of 18
      },
    };
    const result = parseParagraph(documentContext)(slightlyIndentedParagraph);
    expect(result).toEqual("This has small indentation");
  });

  it("should handle multiline block quotes", () => {
    const multilineParagraph = {
      elements: [
        { textRun: { content: "First line\nSecond line\nThird line" } },
      ],
      paragraphStyle: {
        namedStyleType: "NORMAL_TEXT",
        indentStart: { magnitude: 36 },
      },
    };
    const result = parseParagraph(documentContext)(multilineParagraph);
    expect(result).toEqual("> First line\n> Second line\n> Third line");
  });

  it("should handle block quotes with other formatting", () => {
    const formattedParagraph = {
      elements: [
        {
          textRun: {
            content: "Bold quote",
            textStyle: { bold: true },
          },
        },
      ],
      paragraphStyle: {
        namedStyleType: "NORMAL_TEXT",
        indentStart: { magnitude: 36 },
      },
    };
    const result = parseParagraph(documentContext)(formattedParagraph);
    expect(result).toEqual("> **Bold quote**");
  });
});

describe("parseDoc", () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it("ensures proper spacing between paragraphs and list items", async () => {
    // Create a simple doc with a list - giving unique startIndex values for each paragraph element
    const doc = {
      body: {
        content: [
          {
            paragraph: {
              elements: [
                { startIndex: 100, textRun: { content: "Regular paragraph" } },
              ],
            },
          },
          {
            paragraph: {
              elements: [
                { startIndex: 200, textRun: { content: "First bullet" } },
              ],
              bullet: { listId: "list1", nestingLevel: 0 },
            },
          },
          {
            paragraph: {
              elements: [
                { startIndex: 300, textRun: { content: "Second bullet" } },
              ],
              bullet: { listId: "list1", nestingLevel: 0 },
            },
          },
          {
            paragraph: {
              elements: [
                { startIndex: 400, textRun: { content: "Another paragraph" } },
              ],
            },
          },
        ],
      },
      lists: {
        list1: {
          listProperties: {
            nestingLevels: [{ glyphSymbol: "-" }],
          },
        },
      },
      footnotes: {},
    };

    // Process the document
    const result = await parseDoc(doc);

    // Verify bullet points have correct markup
    expect(result.md).toContain("- First bullet");
    expect(result.md).toContain("- Second bullet");

    // Verify paragraphs and lists have double newlines
    expect(result.md).toContain("Regular paragraph\n\n- First bullet");
    expect(result.md).toContain("Second bullet\n\nAnother paragraph");
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
      tags: {
        results: [
          {
            description: {
              markdown: `This is an example LW tag content (see mockResponse)`,
            },
          },
        ],
      },
    },
  };

  it("parses a document with a LessWrong tag", async () => {
    const doc = {
      body: {
        content: [makeText("https://www.lesswrong.com/w/some-tag")],
      },
    };

    fetchMock.mockResponse(JSON.stringify(mockResponse));
    const result = await parseDoc(doc);

    expect(result.md).toEqual(
      "<i>This text was automatically imported from [a tag on LessWrong](https://www.lesswrong.com/w/some-tag).</i>\n\n" +
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
      "<i>This text was automatically imported from [a tag on the EA Forum](https://forum.effectivealtruism.org/topics/some-tag).</i>\n\n" +
        "This is an example LW tag content (see mockResponse)"
    );
    expect(result.relatedAnswerDocIDs).toEqual([]);
  });

  it("doesn't parse a document as a LW tag if it contains other stuff than the URL", async () => {
    const doc = {
      body: {
        content: [
          makeText("https://www.lesswrong.com/w/some-tag"),
          makeText(
            "This will cause it to be shown as is, rather than fetching the content"
          ),
        ],
      },
    };

    const result = await parseDoc(doc);

    expect(result.md).toEqual(
      "https://www.lesswrong.com/w/some-tag\n\nThis will cause it to be shown as is, rather than fetching the content\n\n"
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
      tags: {
        results: [
          {
            description: {
              markdown: `This is an example LW tag content (see mockResponse)`,
            },
          },
        ],
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

  it("returns null for unknown tag URLs", async () => {
    const paragraphs = [
      makeText("Read up about this at https://bla.bla.com").paragraph,
    ];
    const result = await fetchExternalContent(paragraphs);
    expect(result).toBeNull();
  });

  it("parses a document with a LessWrong tag and a related section", async () => {
    const paragraphs = [
      makeText("https://www.lesswrong.com/w/some-tag").paragraph,
      makeText("\n").paragraph,
      makeText("  ").paragraph,
      makeText("").paragraph,
      { elements: [{}] },
    ];
    fetchMock.mockResponse(JSON.stringify(mockResponse));
    const result = await fetchExternalContent(paragraphs);
    expect(result).toEqual({
      content: "This is an example LW tag content (see mockResponse)",
      sourceName: "LessWrong",
      sourceUrl: "https://www.lesswrong.com/w/some-tag",
    });
  });

  it("ignores comments and suggested edits", async () => {
    const paragraphs = [
      makeText("https://www.lesswrong.com/w/some-tag").paragraph,
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
    expect(result).toEqual({
      content: "This is an example LW tag content (see mockResponse)",
      sourceName: "LessWrong",
      sourceUrl: "https://www.lesswrong.com/w/some-tag",
    });
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
