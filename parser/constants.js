import dotenv from "dotenv";
dotenv.config();

export const GLOSSARY_DOC = "1Rm7tN5zTErZq0E4qqAZoNVzClS94Kb_rQOLaViu2p6c";

export const basePath = "https://coda.io/apis/v1/";
export const codaDocID = "fau7sl2hmG";
export const codaDocURL = `${basePath}/docs/${codaDocID}`;
export const tableID = "grid-sync-1059-File";
export const tableURL = `${codaDocURL}/tables/${tableID}`;
export const glossaryTableID = "grid-_pSzs23jmw";
export const glossaryTableURL = `${codaDocURL}/tables/${glossaryTableID}`;
export const codaColumnIDs = {
  docLastEdited: "c-UQjERPXq8o",
  docURL: "c-5qIm4D1QKk",
  initialOrder: "c-PoAylKpEVt",
  lastIngested: "c-Z-xWeQivE_",
  preexistingSuggestionCount: "c-sgnPwFMbn8",
  preexistingSuggestionSize: "c-6DnuBdIZ02",
  relatedAnswerNames: "c-b0YvHsTj0l",
  richText: "c-S6ub6E1V-a",
  suggestionCount: "c-sgnPwFMbn8",
  suggestionSize: "c-6DnuBdIZ02",
  UIID: "c-J0hTr2p6-T",
  status: "c-Gr2GDh30nR",
  commentsCount: "c-kakZoTgC9y",
  alternativePhrasings: "c-bLWz7lnXHG",
  tags: "c-fW9FG_MXY0",

  glossaryWord: "c-QdLiDUKLm0",
  glossaryRichText: "c-KXNjnKWLkC",
  glossaryQuestion: "c-ysnFuCAJ9w",
  glossaryQuestionID: "c-2ovUysMhUF",
  glossaryAliases: "c-UGtluV-1jN",
  glossaryLastIngested: "c-VLIMntWTmG",
};
