# Stampy parser utils

These are utilities used to import answers from Google Drive into Coda.
Coda is used as the central database for the Stampy project. It has an integration with Gdocs, where
it will automatically detect new documents and add a row for them in the Answers table. The Coda sync
process doesn't import the actual content of the Gdocs, only their metadata. This repo contains tools
to do the actual import of the content to Coda, along with additional formatting of the data.

# Setup

Make sure you have node installed, then run `npm install`.

## Configuration

The project pulls and pushes data from Gdocs and Coda. It also can (optionally) notify Discord about certain
things. For this to work, it requires authentication keys etc. to be available via env variables. These can
(and probably should) be provided via an `.env` file. The following vars should be set for things to have a
change of working:

- `CODA_TOKEN` - used to get RW access to the Coda table
- `GCLOUD_CREDENTIALS` - used to access Google Cloud. This can be skipped, if a valid `credentials.json` file is provided instead

### Coda

Create a [Coda token](https://coda.io/account) with RW access to the Answers table and set the `CODA_TOKEN` variable.

### Google Docs

This one is quite complicated. And may also change, since it's Google...

1. Set up a Google Cloud Platform (GCP) project and enable the Google Docs API. You can follow
   the instructions in the official documentation [here](https://developers.google.com/docs/api/quickstart/nodejs#step_1_turn_on_the).

2. Create a service account and download the service account key JSON file. You can follow the instructions in the official documentation [here](https://developers.google.com/docs/api/quickstart/nodejs#step_2_create_a_project_and_enable_the_api).

3. Either save the downloaded file as `credentials.json`, or set `GCLOUD_CREDENTIALS=` to its contents (without newlines)

4. Once the new project is created, click the hamburger menu in the top left corner of the page and select "APIs & Services" > "Dashboard".

5. Click the "+ ENABLE APIS AND SERVICES" button at the top of the page.

6. Search for "Google Docs API" in the search bar and select it from the results.

7. Click the "ENABLE" button to enable the API for your project.

8. Repeat steps 5-7 to enable "Google Drive API"

### Discord

These are totally optional. If not provided, any logging to Discord will be skipped.

- `DISCORD_ERROR` - a secret webhook for a channel to which errors should be logged
- `DISCORD_FEED` - a secret webhook for a channel to which questions with hanging comments should be logged

# Running

`node bin/importContent.js`

# Dev Testing Scripts

For the below, a useful google doc for testing is the
[Example with all the formatting](https://docs.google.com/document/d/10g6U9SL0CBy__wCBTib7_WhB3S3aaFt7Fx1vVgCzg2I/edit?tab=t.0).
It has document id `10g6U9SL0CBy__wCBTib7_WhB3S3aaFt7Fx1vVgCzg2I`.

## Fetch and Parse a Single Document
The `devtool.js` script can be run using node.js to either fetch the JSON or the parsed markdown for a google doc. See the script for parameter details.

## Git diff changes
The `dev-output-diff.sh` bash script can be run to do a git diff of document to visualize how changes in a feature branch will affect the parsed markdown.
