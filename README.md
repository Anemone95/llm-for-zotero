# llm-for-zotero custom build

This project is derived from
[yilewang/llm-for-zotero](https://github.com/yilewang/llm-for-zotero).

This repository keeps the original Zotero LLM plugin as the base and carries a
small set of local changes for testing a customized workflow.

## Changes in this build

1. Fixed WebChat code block rendering.

   In WebChat mode, code blocks returned from GPT web could fail to render or
   fail to appear correctly when saved back into Zotero. This build adjusts the
   markdown/code-block rendering path so GPT web responses with fenced code
   blocks are shown and exported correctly.

2. Changed Code Agent PDF handling.

   In Code Agent mode, this build no longer sends extracted paper text or paper
   images directly to the model. Instead, it sends only the current paper PDF's
   local file path, so the agent can access the PDF by location when needed
   without eagerly uploading text or page images.

## Build

```bash
npm install
npm run build
```

The generated Zotero add-on is:

```text
.scaffold/build/llm-for-zotero.xpi
```

## Install

In Zotero, open `Tools` -> `Add-ons` -> gear icon -> `Install Add-on From File`,
then select `.scaffold/build/llm-for-zotero.xpi`.
