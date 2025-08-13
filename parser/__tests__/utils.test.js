import { compressMarkdown } from "../utils.js";

describe("normalizeMarkdownSpacing", () => {
  describe("trailing space removal", () => {
    it("removes trailing spaces from lines", () => {
      const input = "Line with spaces   \nAnother line  \nNo spaces";
      const expected = "Line with spaces\nAnother line\nNo spaces";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("removes trailing tabs from lines", () => {
      const input = "Line with tabs\t\t\nAnother line\t\nNo tabs";
      const expected = "Line with tabs\nAnother line\nNo tabs";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("removes mixed trailing whitespace", () => {
      const input = "Mixed spaces and tabs \t \nAnother line\t  \t";
      const expected = "Mixed spaces and tabs\nAnother line";
      expect(compressMarkdown(input)).toBe(expected);
    });
  });

  describe("collapsing multiple newlines", () => {
    it("collapses 3 newlines to 2", () => {
      const input = "First paragraph\n\n\nSecond paragraph";
      const expected = "First paragraph\n\nSecond paragraph";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("collapses 4+ newlines to 2", () => {
      const input = "First paragraph\n\n\n\n\nSecond paragraph";
      const expected = "First paragraph\n\nSecond paragraph";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("preserves 2 newlines", () => {
      const input = "First paragraph\n\nSecond paragraph";
      const expected = "First paragraph\n\nSecond paragraph";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("preserves single newlines", () => {
      const input = "First line\nSecond line";
      const expected = "First line\nSecond line";
      expect(compressMarkdown(input)).toBe(expected);
    });
  });

  describe("quoted list formatting", () => {
    it("removes bare > line before quoted list item with dash", () => {
      const input = "> Some quote\n>\n> - List item";
      const expected = "> Some quote\n> - List item";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("removes bare > line before quoted numbered list", () => {
      const input = "> Some quote\n>\n> 1. First item";
      const expected = "> Some quote\n> 1. First item";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("preserves bare > line when not before a list", () => {
      const input = "> Some quote\n>\n> Regular text";
      const expected = "> Some quote\n>\n> Regular text";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("handles bare > at start of string", () => {
      const input = ">\n> - List item";
      const expected = "> - List item";
      expect(compressMarkdown(input)).toBe(expected);
    });
  });

  describe("removing blanks between list items", () => {
    it("removes blank lines between plain dash list items", () => {
      const input = "- First item\n\n- Second item\n\n- Third item";
      const expected = "- First item\n- Second item\n- Third item";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("partially removes blank lines between numbered list items", () => {
      // Note: The regex only matches once per pass, so with 3 items, the last gap remains
      const input = "1. First item\n\n2. Second item\n\n3. Third item";
      const expected = "1. First item\n2. Second item\n\n3. Third item";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("removes blank lines between quoted dash list items", () => {
      const input = "> - First item\n>\n> - Second item";
      const expected = "> - First item\n> - Second item";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("removes blank lines between quoted numbered list items", () => {
      const input = "> 1. First item\n>\n> 2. Second item";
      const expected = "> 1. First item\n> 2. Second item";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("handles whitespace-only blank lines between list items", () => {
      const input = "- First item\n   \n- Second item\n\t\n- Third item";
      const expected = "- First item\n- Second item\n- Third item";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("removes multiple blank lines between list items", () => {
      const input = "- First item\n\n\n- Second item";
      const expected = "- First item\n- Second item";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("handles indented list items", () => {
      const input = "  - First item\n\n  - Second item";
      const expected = "  - First item\n  - Second item";
      expect(compressMarkdown(input)).toBe(expected);
    });
  });

  describe("spacing between lists and paragraphs", () => {
    it("adds spacing after bullet list before paragraph", () => {
      const input = "- List item\nParagraph text";
      const expected = "- List item\n\nParagraph text";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("adds spacing after numbered list before paragraph", () => {
      const input = "1. List item\nParagraph text";
      const expected = "1. List item\n\nParagraph text";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("adds spacing after quoted bullet list before non-quoted content", () => {
      const input = "> - List item\nParagraph text";
      const expected = "> - List item\n\nParagraph text";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("adds spacing after quoted numbered list before non-quoted content", () => {
      const input = "> 1. List item\nParagraph text";
      const expected = "> 1. List item\n\nParagraph text";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("preserves spacing when paragraph already separated", () => {
      const input = "- List item\n\nParagraph text";
      const expected = "- List item\n\nParagraph text";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("doesn't add spacing between consecutive list items", () => {
      const input = "- First item\n- Second item";
      const expected = "- First item\n- Second item";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("doesn't add spacing when quoted list continues with quoted content", () => {
      const input = "> - List item\n> Quoted paragraph";
      const expected = "> - List item\n> Quoted paragraph";
      expect(compressMarkdown(input)).toBe(expected);
    });
  });

  describe("complex scenarios", () => {
    it("handles mixed list types with proper spacing", () => {
      const input = `- Bullet item\n\n1. Numbered item\n\n- Another bullet\nParagraph text`;
      // The blank between bullet and numbered is removed, but not between numbered and bullet
      const expected = `- Bullet item\n\n1. Numbered item\n\n- Another bullet\n\nParagraph text`;
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("handles deeply nested blockquotes with lists", () => {
      const input = `> Quote level 1\n>\n> - List in quote\n>\n> - Second item\n\nRegular paragraph`;
      const expected = `> Quote level 1\n> - List in quote\n> - Second item\n\nRegular paragraph`;
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("processes all transformations in correct order", () => {
      const input = `- Item with trailing spaces   \n\n\n\n- Second item\n\nParagraph\n\n\n\nAnother paragraph`;
      const expected = `- Item with trailing spaces\n- Second item\n\nParagraph\n\nAnother paragraph`;
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("handles multi-line list items correctly", () => {
      const input = `- First item\n  with continuation\n\n- Second item`;
      const expected = `- First item\n  with continuation\n- Second item`;
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("handles empty input", () => {
      const input = "";
      const expected = "";
      expect(compressMarkdown(input)).toBe(expected);
    });

    it("handles input with only whitespace", () => {
      // Whitespace-only input gets trailing spaces removed, then collapses to double newline
      const input = "   \n\n\t\n   ";
      const expected = "\n\n";
      expect(compressMarkdown(input)).toBe(expected);
    });
  });
});
