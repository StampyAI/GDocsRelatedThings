import { replaceGdocLinks } from "../main.js";

describe("replaceGdocLinks", () => {
  test.each([
    "https://docs.google.com/document/d/123",
    "https://docs.google.com/document/d/123/",
    "https://docs.google.com/document/d/123/edit",
    "https://docs.google.com/document/d/123/edit/",
    "https://docs.google.com/document/d/123/edit?usp=drivesdk",
    "https://docs.google.com/document/d/123/edit?usp=drivesdk",
  ])("Gdoc urls get transformed", (url) => {
    const result = replaceGdocLinks(`A link [here](${url})`, [
      {
        docID: "123",
        UIID: "90Q3",
        answerName: "blee",
        "c-Gr2GDh30nR": "Live on site",
      },
    ]);
    expect(result).toEqual("A link [here](/questions/90Q3/blee)");
  });

  it("strips whitespace", () => {
    const result = replaceGdocLinks(
      `A link [here](      https://docs.google.com/document/d/123      )`,
      [
        {
          docID: "123",
          UIID: "90Q3",
          answerName: "blee",
          "c-Gr2GDh30nR": "Live on site",
        },
      ]
    );
    expect(result).toEqual("A link [here](/questions/90Q3/blee)");
  });

  it("ignores gdoc urls that aren't markdown links", () => {
    const text =
      "Check for more info at https://docs.google.com/document/d/123";
    const result = replaceGdocLinks(text, [
      { docID: "123", "c-J0hTr2p6-T": "90Q3" },
    ]);
    expect(result).toEqual(text);
  });
});
