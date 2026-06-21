---
id: analyze-figures
description: Analyze figures, tables, and diagrams from papers
version: 4
contexts: single-paper
activation: auto
match: /\b(figure|fig\.?|table|diagram|chart|graph|plot|schematic|illustration)\s*\d/i
match: /\banalyze?\b.*\b(figure|fig\.?|table|diagram|image|chart)\b/i
match: /\b(figure|fig\.?|table|diagram)\b.*\b(about|explain|describe|show|mean|depict)\b/i
match: /\b(what|how|why|can you)\b.*\b(figure|fig\.?|table|diagram|chart)\b/i
---

<!--
  SKILL: Analyze Figures

  This skill activates when you ask about a specific figure, table, or
  diagram in a paper (e.g., "explain Figure 2", "what does Table 1 show?").

  You can customize:
  - Analysis depth: change how the agent interprets visual content
  - PDF visual/text balance: adjust which paper_read mode is preferred
  - Note saving: modify how figure analyses are saved to notes

  Your changes are preserved across plugin updates.
  To reset to default, delete this file — it will be recreated on next restart.
-->

## Analyzing Figures and Tables

When the user asks about a figure, table, or diagram in a paper, use the most efficient path to access it.

### Default workflow

1. `paper_read({ mode:'visual', query:'<figure/table label>' })` to find which page(s) contain it and get the page image for visual analysis.
2. `paper_read({ mode:'targeted', query:'<figure/table label and surrounding discussion>' })` for surrounding discussion text

### Key rules

- **NEVER** use OCR tools, Python scripts, Swift, Tesseract, or shell commands to analyze images. Visual models see images directly.
- **NEVER** attempt to install packages (PIL, cv2, etc.) to process images.
- Always include the figure caption and surrounding context in your analysis, not just the image.
- For tables: use targeted text extraction first, then rendered pages only if layout or visual structure matters.

### Saving figure analysis to notes

When the user asks to save your figure analysis to a note (e.g., "save it", "put that in a note", "create a note", "write to obsidian"), the Write Note skill handles the full workflow. Key rules:

- **Always embed the analyzed figure image** in the note — mandatory, not optional. A note explaining Figure 2 must show Figure 2.
- Place the image at the start of the relevant section, before the explanation text.
- If you analyzed multiple figures, embed all of them.
- If the figure image is not available as a local file artifact, mention that limitation instead of inventing an image path.
