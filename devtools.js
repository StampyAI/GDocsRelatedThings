import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { getDocsClient } from "./parser/gdrive.js";
import { parseDoc } from "./parser/parser.js";

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
        const docs = await getDocsClient();
        const doc = (await docs.documents.get({ documentId })).data;

        console.log(JSON.stringify(doc, null, 2));
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
        const docs = await getDocsClient();
        const doc = (await docs.documents.get({ documentId })).data;

        console.log((await parseDoc(doc)).md);
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
