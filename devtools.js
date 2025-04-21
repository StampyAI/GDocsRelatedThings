import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { getDocsClient } from "./parser/gdrive.js";
import { parseDoc } from "./parser/parser.js";
import { compressMarkdown } from "./parser/utils.js";

const getDocJSON = async (documentId) => {
  const docsClient = await getDocsClient();
  return (await docsClient.documents.get({ documentId })).data;
};

yargs(hideBin(process.argv))
  .usage("Usage: $0 <command> [options]")
  .command(
    "json <googleDocID>",
    "Get the JSON for an answer doc",
    async ({
      argv: {
        _: [_, documentId],
      },
    }) => {
      try {
        const docJSON = await getDocJSON(documentId);

        console.log(JSON.stringify(docJSON, null, 2));
      } catch (e) {
        if (e.code === 404) {
          console.error("Invalid doc ID");
        }
      }
    }
  )
  .command(
    "md <googleDocID>",
    "Get the rendered Markdown for an answer doc",
    async ({
      argv: {
        _: [_, documentId],
      },
    }) => {
      try {
        const docJSON = await getDocJSON(documentId);
        // Get the markdown content
        let md = (await parseDoc(docJSON)).md;
        
        // Apply the same fixes from compressMarkdown in utils.js
        md = compressMarkdown(md);
        
        console.log(md);
      } catch (e) {
        if (e.code === 404) {
          console.error("Invalid doc ID");
        } else {
          console.error(e);
        }
      }
    }
  )
  .help("h")
  .alias("h", "help").argv;
