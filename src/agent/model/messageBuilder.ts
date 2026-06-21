import type {
  AgentContentInputCapabilities,
  AgentModelMessage,
  AgentRuntimeRequest,
  AgentToolDefinition,
} from "../types";
import { AGENT_PERSONA_INSTRUCTIONS } from "./agentPersona";
import { buildAgentMemoryBlock } from "../store/conversationMemory";
import { getAllSkills } from "../skills";
import type { AgentSkill } from "../skills";
import { classifyWriteNoteDestination } from "../writeNoteDestination";

import { resolveProviderCapabilities } from "../../providers";
import type { ProviderCapabilities } from "../../providers";
import {
  buildNotesDirectoryConfigSection,
  getNotesDirectoryNickname,
} from "../../utils/notesDirectoryConfig";
import { buildRuntimePlatformGuidanceText } from "../../utils/runtimePlatform";
import { formatPaperSourceLabel } from "../../modules/contextPanel/paperAttribution";
import {
  buildQuoteAnchorPromptBlock,
  buildSelectedTextQuoteCitations,
} from "../../modules/contextPanel/quoteCitations";
import {
  buildAgentStableResourceContextBlock,
  type AgentResourceContextPlan,
} from "../context/resourceContextPlan";
import { buildAgentCoverageContextBlock } from "../context/coverageLedger";
import { buildVisibleTurnContextBlock } from "../context/turnContextEnvelope";
import {
  hasAgentContentInputs,
} from "./contentCapabilities";

export function isMultimodalRequestSupported(
  request: AgentRuntimeRequest,
): boolean {
  return hasAgentContentInputs(resolveRequestContentInputs(request));
}

function resolveRequestProviderCapabilities(
  request: AgentRuntimeRequest,
): ProviderCapabilities {
  return resolveProviderCapabilities({
    model: request.model || "",
    protocol: request.providerProtocol,
    authMode: request.authMode,
    apiBase: request.apiBase,
  });
}

export function resolveRequestContentInputs(
  request: AgentRuntimeRequest,
): AgentContentInputCapabilities {
  const capabilities = resolveRequestProviderCapabilities(request);
  return {
    images: capabilities.images,
    pdfDocuments: capabilities.pdf === "native",
    nativeFiles: false,
  };
}

export function stringifyMessageContent(
  content: AgentModelMessage["content"],
): string {
  if (typeof content === "string") return content;
  return content
    .map((part) =>
      part.type === "text"
        ? part.text
        : part.type === "image_url"
          ? "[image]"
          : "[file]",
    )
    .join("\n");
}

/**
 * Keeps the first Q&A pair (for topic continuity) plus the most recent turns.
 * This prevents important first-turn context from being silently dropped when
 * the conversation grows long, while still respecting the total cap.
 */
function selectAgentHistoryWindow(
  history: import("../../utils/llmClient").ChatMessage[],
  maxTotal = 10,
): import("../../utils/llmClient").ChatMessage[] {
  if (history.length <= maxTotal) return history;
  // First pair anchors the conversation topic.
  const firstPair = history.slice(0, 2);
  const tail = history.slice(-(maxTotal - 2));
  // Avoid duplicating the first pair if history is very short.
  const tailStartIndex = history.length - (maxTotal - 2);
  if (tailStartIndex <= 2) return history.slice(-maxTotal);
  return [...firstPair, ...tail];
}

export function normalizeHistoryMessages(
  request: AgentRuntimeRequest,
): AgentModelMessage[] {
  const raw = Array.isArray(request.history) ? request.history : [];
  const windowed = selectAgentHistoryWindow(raw, 10);
  return windowed
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role,
      content: stringifyMessageContent(message.content),
    }));
}

function buildFullUserMessage(
  request: AgentRuntimeRequest,
  options: {
    priorReadBlock?: string;
    coverageBlock?: string;
    memoryBlock?: string;
    turnGuidanceBlock?: string;
    contentInputs?: AgentContentInputCapabilities;
  } = {},
): AgentModelMessage {
  const contextLines: string[] = [];
  const visibleTurnContext = buildVisibleTurnContextBlock(request);
  if (visibleTurnContext) {
    contextLines.push(visibleTurnContext);
  }
  if (request.activeNoteContext) {
    const note = request.activeNoteContext;
    contextLines.push(
      `Current note content for this turn:\n"""\n${note.noteText}\n"""`,
    );
    if (note.noteHtml) {
      contextLines.push(`Original note HTML:\n"""\n${note.noteHtml}\n"""`);
    }
  }
  if (Array.isArray(request.selectedTexts) && request.selectedTexts.length) {
    const selectedTextQuoteAnchors = buildQuoteAnchorPromptBlock(
      buildSelectedTextQuoteCitations(
        request.selectedTexts,
        request.selectedTextSources,
        request.selectedTextPaperContexts,
      ),
    );
    const selectedTextBlock = request.selectedTexts
      .map((entry, index) => {
        const source = request.selectedTextSources?.[index];
        const paperContext = request.selectedTextPaperContexts?.[index];
        const sourceLabel =
          source === "model"
            ? "model response"
            : source === "note"
              ? "Zotero note"
              : source === "note-edit"
                ? "active note editing focus"
                : "PDF reader";
        const sourceMeta =
          source === "pdf" && paperContext
            ? `, paper=${paperContext.title}, source_label=${formatPaperSourceLabel(paperContext)}`
            : "";
        return `Selected text ${index + 1} [source=${sourceLabel}${sourceMeta}]:\n"""\n${entry}\n"""`;
      })
      .join("\n\n");
    contextLines.push(
      [...selectedTextQuoteAnchors, selectedTextBlock]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
  const pdfAttachments = (request.attachments || []).filter(
    (a) =>
      a.category === "pdf" &&
      typeof a.storedPath === "string" &&
      a.storedPath.trim(),
  );
  if (pdfAttachments.length) {
    contextLines.push(
      [
        "Current PDF file location(s):",
        ...pdfAttachments.map((attachment, index) => {
          const title = attachment.name?.trim() || `PDF ${index + 1}`;
          return `- ${title}: ${attachment.storedPath}`;
        }),
        "Use these local file paths when direct PDF access is needed. Do not inline-upload the PDF or convert it to page images in the model input.",
      ].join("\n"),
    );
  }
  const nonPdfAttachments = (request.attachments || []).filter(
    (a) => a.category !== "pdf",
  );
  if (nonPdfAttachments.length) {
    contextLines.push(
      "Current uploaded attachments are available through the registered document tools.",
    );
  }
  if (options.priorReadBlock) {
    contextLines.push(options.priorReadBlock);
  }
  if (options.coverageBlock) {
    contextLines.push(options.coverageBlock);
  }
  if (options.memoryBlock) {
    contextLines.push(options.memoryBlock);
  }
  if (options.turnGuidanceBlock) {
    contextLines.push(options.turnGuidanceBlock);
  }

  const promptText = `${
    contextLines.length ? `${contextLines.join("\n")}\n\n` : ""
  }User request:\n${request.userText}`;
  const screenshots = Array.isArray(request.screenshots)
    ? request.screenshots.filter((entry) => Boolean(entry))
    : [];
  return {
    role: "user",
    content: screenshots.length
      ? `${promptText}\n\n${screenshots.length} screenshot image(s) were selected in Zotero, but agent mode does not inline-send images. Use Zotero tools or the local file/PDF paths shown above when file access is needed.`
      : promptText,
  };
}

function buildUserMessage(
  request: AgentRuntimeRequest,
  resourceContextPlan?: AgentResourceContextPlan,
  options: {
    coverageBlock?: string;
    memoryBlock?: string;
    turnGuidanceBlock?: string;
    contentInputs?: AgentContentInputCapabilities;
  } = {},
): AgentModelMessage {
  return buildFullUserMessage(request, {
    priorReadBlock: resourceContextPlan?.priorReadBlock,
    coverageBlock: options.coverageBlock,
    memoryBlock: options.memoryBlock,
    turnGuidanceBlock: options.turnGuidanceBlock,
    contentInputs: options.contentInputs,
  });
}

type PromptSection = {
  /** Identifies the section in code; not emitted into the prompt text */
  id: string;
  lines: string[];
};

function buildSystemPrompt(sections: PromptSection[]): string {
  return sections
    .flatMap(({ lines }) => lines)
    .filter(Boolean)
    .join("\n\n");
}

function collectToolGuidanceInstructions(
  request: AgentRuntimeRequest,
  tools: AgentToolDefinition<any, any>[],
): string[] {
  const instructions = new Set<string>();
  for (const tool of tools) {
    const guidance = tool.guidance;
    if (!guidance) continue;
    if (!guidance.matches(request)) continue;
    const instruction = guidance.instruction.trim();
    if (instruction) instructions.add(instruction);
  }

  if (!instructions.size) return [];
  return [
    "The following stable tool guidance is provided because the user's message may be relevant to these capabilities. " +
      "Use your judgement: only invoke a tool if it directly addresses what the user is asking for. " +
      "Do NOT invoke a tool just because its guidance appears here — the user's actual intent takes priority.",
    ...instructions,
  ];
}

function formatSkillGuidanceBlock(
  skill: AgentSkill,
  activationSource: string,
): string {
  const lines = [
    `### Skill: ${skill.id}`,
    `Description: ${skill.description || "No description provided."}`,
    `Activation: ${activationSource}`,
    "Instructions:",
    skill.instruction.trim(),
  ];
  return lines.filter(Boolean).join("\n");
}

function collectSkillGuidanceInstructions(
  request: AgentRuntimeRequest,
  matchedSkillIds: ReadonlyArray<string>,
): string[] {
  const blocks: string[] = [];
  const activeSkillIds = new Set(matchedSkillIds);
  const forcedSkillIds = new Set(request.forcedSkillIds || []);
  for (const skill of getAllSkills()) {
    if (!activeSkillIds.has(skill.id)) continue;
    const instruction = skill.instruction.trim();
    if (!instruction) continue;
    blocks.push(
      formatSkillGuidanceBlock(
        skill,
        forcedSkillIds.has(skill.id)
          ? "explicit slash selection"
          : "automatic match",
      ),
    );
  }
  if (!blocks.length) return [];
  return [
    "Active skills for this turn:",
    "Treat each skill below as a separate workflow module. If multiple skills are active, first decide which part of the user's request each skill covers. Prefer explicitly selected slash skills when they are relevant. If skill instructions conflict, follow the user's explicit request and the available tool/safety constraints.",
    ...blocks,
  ];
}

function buildTurnGuidanceBlock(instructions: string[]): string {
  const lines = instructions.map((entry) => entry.trim()).filter(Boolean);
  if (!lines.length) return "";
  return ["Current-turn dynamic agent guidance:", ...lines].join("\n\n");
}

function buildAutoReadInstruction(
  request: AgentRuntimeRequest,
  resourceContextPlan?: AgentResourceContextPlan,
): string {
  const fullTextPapers = request.fullTextPaperContexts || [];
  if (!fullTextPapers.length) return "";
  if (resourceContextPlan?.priorReadBlock) {
    return (
      "TURN RULE: The same full-text paper resources remain in this conversation. " +
      "Reuse the prior paper_read context already in the conversation when it is sufficient. " +
      "Call paper_read({ mode:'targeted', query:'...' }) only if the follow-up asks for evidence that has not already been read."
    );
  }
  return (
    "TURN RULE: Specific paper PDF resources are in scope for this turn. " +
    "Use the local PDF file path provided in the user message as the primary direct-PDF handle. " +
    "Do not eagerly preload the paper by sending PDF page images or extracted PDF text. " +
    "Call `paper_read` only when the user's request requires Zotero-side extraction or targeted evidence that cannot be answered from the path-aware environment."
  );
}

function buildWriteNoteFileInstruction(
  request: AgentRuntimeRequest,
  matchedSkillIds: ReadonlyArray<string>,
): string {
  const activeSkillIds = new Set([
    ...matchedSkillIds,
    ...(request.forcedSkillIds || []),
  ]);
  if (!activeSkillIds.has("write-note")) return "";
  const destination = classifyWriteNoteDestination(
    request.userText,
    getNotesDirectoryNickname(),
  );
  if (destination === "zotero") {
    return (
      "TURN RULE: The user is asking for a Zotero note workflow. Use `note_write` rather than writing an external Markdown file. " +
      "After `note_write` succeeds, do not also call `file_io` or `run_command` unless the user explicitly requested a filesystem output."
    );
  }
  if (destination === "file") {
    return (
      'TURN RULE: The user is asking for an Obsidian/file-based note. Successful completion requires calling `file_io` with `action: "write"` and Markdown content. ' +
      "Do not finish by placing the full note body in chat. If the notes directory is not configured or the target path cannot be resolved, give a brief setup error instead of dumping the note body."
    );
  }
  return "";
}

function buildForcedSkillWholeLibraryInstruction(
  request: AgentRuntimeRequest,
): string {
  if (!request.forcedSkillIds?.length) return "";
  if (request.conversationKind === "paper") return "";
  const hasExplicitContext = Boolean(
    request.selectedPaperContexts?.length ||
    request.fullTextPaperContexts?.length ||
    request.pinnedPaperContexts?.length ||
    request.selectedCollectionContexts?.length ||
    request.selectedTagContexts?.length ||
    request.selectedTextSources?.length ||
    request.attachments?.length ||
    request.screenshots?.length,
  );
  if (hasExplicitContext) return "";
  return (
    "TURN RULE: The user explicitly selected a skill in library chat without selecting a narrower context. " +
    "Treat the intended context as the whole Zotero library, and use library-scoped tools or searches accordingly."
  );
}

function buildRuntimePlatformSection(): string {
  return buildRuntimePlatformGuidanceText();
}

function buildTextOnlyModelInstruction(request: AgentRuntimeRequest): string {
  if (isMultimodalRequestSupported(request)) return "";
  const modelLabel = (request.model || "selected model").trim();
  return (
    `MODEL LIMITATION: ${modelLabel} is treated as text-only in this plugin. ` +
    "Do not rely on screenshots, PDF page images, or image-file visual inspection. " +
    "Use paper_read for extracted Zotero PDF text and file_io only for explicit local file paths. " +
    "If the user asks for information that requires direct visual inspection and only an image is available, state that this model cannot inspect the image directly and answer only from extracted text/captions."
  );
}

export async function buildAgentInitialMessages(
  request: AgentRuntimeRequest,
  tools: AgentToolDefinition<any, any>[],
  matchedSkillIds: ReadonlyArray<string>,
  resourceContextPlan?: AgentResourceContextPlan,
  options: {
    transcriptMessages?: AgentModelMessage[];
    contentInputs?: AgentContentInputCapabilities;
  } = {},
): Promise<AgentModelMessage[]> {
  const memoryBlock = await buildAgentMemoryBlock(request.conversationKey);
  const autoReadInstruction = buildAutoReadInstruction(
    request,
    resourceContextPlan,
  );
  const workflowParityInstructions = [
    buildWriteNoteFileInstruction(request, matchedSkillIds),
    buildForcedSkillWholeLibraryInstruction(request),
  ].filter(Boolean);
  const turnGuidanceBlock = buildTurnGuidanceBlock([
    autoReadInstruction,
    ...workflowParityInstructions,
    ...collectToolGuidanceInstructions(request, tools),
    ...collectSkillGuidanceInstructions(request, matchedSkillIds),
  ]);
  const coverageBlock = buildAgentCoverageContextBlock({
    conversationKey: request.conversationKey,
    request,
  });

  const sections: PromptSection[] = [
    {
      id: "system-override",
      lines: [(request.systemPrompt || "").trim()],
    },
    {
      id: "persona",
      lines: AGENT_PERSONA_INSTRUCTIONS,
    },
    {
      id: "runtime-platform",
      lines: [buildRuntimePlatformSection()],
    },
    {
      id: "model-limitations",
      lines: [buildTextOnlyModelInstruction(request)],
    },
    {
      id: "custom-instructions",
      lines: [(request.customInstructions || "").trim()],
    },
    {
      id: "notes-directory-config",
      lines: [buildNotesDirectoryConfigSection()],
    },
  ];
  const stableResourceBlock =
    resourceContextPlan?.stableContextBlock ||
    buildAgentStableResourceContextBlock(request);

  return [
    {
      role: "system",
      content: buildSystemPrompt(sections),
    },
    ...(stableResourceBlock
      ? [
          {
            role: "system" as const,
            content: stableResourceBlock,
            cachePolicy: "stable-prefix" as const,
          },
        ]
      : []),
    ...(options.transcriptMessages?.length
      ? options.transcriptMessages
      : normalizeHistoryMessages(request)),
    buildUserMessage(request, resourceContextPlan, {
      coverageBlock,
      memoryBlock,
      turnGuidanceBlock,
      contentInputs: options.contentInputs,
    }),
  ];
}
