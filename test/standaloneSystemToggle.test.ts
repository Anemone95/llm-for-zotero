import { assert } from "chai";
import { describe, it } from "mocha";
import {
  findReusableConversationDraft,
  findReusableStandaloneDraft,
  isReusableConversationDraft,
  isReusableStandaloneDraft,
} from "../src/modules/contextPanel/standaloneConversationResolution";
import type { ConversationSystem } from "../src/shared/types";

describe("standalone system toggle", function () {
  it("does not force a fresh conversation by default", function () {
    const calls: ConversationSystem[] = [];
    const switchConversationSystem = async (
      nextSystem: ConversationSystem,
      options?: { forceFresh?: boolean },
    ) => {
      assert.isUndefined(options?.forceFresh);
      calls.push(nextSystem);
    };

    void switchConversationSystem("codex");
    assert.deepEqual(calls, ["codex"]);
  });

  it("does not reuse an active empty Codex global draft when forced fresh", function () {
    const draft = {
      conversationKey: 5_000_000_001,
      kind: "global",
      libraryID: 1,
      userTurnCount: 0,
    };

    assert.isFalse(
      isReusableStandaloneDraft({
        forceFresh: true,
        summary: draft,
        kind: "global",
        libraryID: 1,
      }),
    );
    assert.isTrue(
      isReusableStandaloneDraft({
        forceFresh: false,
        summary: draft,
        kind: "global",
        libraryID: 1,
      }),
    );
  });

  it("does not reuse an active empty Codex paper draft when forced fresh", function () {
    const draft = {
      conversationKey: 6_000_000_001,
      kind: "paper",
      libraryID: 1,
      userTurnCount: 0,
    };

    assert.isFalse(
      isReusableStandaloneDraft({
        forceFresh: true,
        summary: draft,
        kind: "paper",
      }),
    );
    assert.isTrue(
      isReusableStandaloneDraft({
        forceFresh: false,
        summary: draft,
        kind: "paper",
      }),
    );
  });

  it("does not reuse listed empty drafts when forced fresh", function () {
    const drafts = [
      {
        conversationKey: 5_000_000_010,
        kind: "global",
        libraryID: 1,
        userTurnCount: 1,
      },
      {
        conversationKey: 5_000_000_011,
        kind: "global",
        libraryID: 1,
        userTurnCount: 0,
      },
    ];

    assert.isNull(
      findReusableStandaloneDraft({
        forceFresh: true,
        summaries: drafts,
      }),
    );
    assert.equal(
      findReusableStandaloneDraft({
        forceFresh: false,
        summaries: drafts,
      })?.conversationKey,
      5_000_000_011,
    );
  });

  it("keeps implicit side-panel Codex global draft reuse scoped to the current library", function () {
    const drafts = [
      {
        conversationKey: 5_000_000_010,
        kind: "global",
        libraryID: 2,
        userTurnCount: 0,
      },
      {
        conversationKey: 5_000_000_011,
        kind: "global",
        libraryID: 1,
        userTurnCount: 0,
      },
    ];

    assert.isNull(
      findReusableConversationDraft({
        forceFresh: true,
        summaries: drafts,
        kind: "global",
        libraryID: 1,
      }),
    );
    assert.equal(
      findReusableConversationDraft({
        forceFresh: false,
        summaries: drafts,
        kind: "global",
        libraryID: 1,
      })?.conversationKey,
      5_000_000_011,
    );
  });

  it("prevents side-panel forced fresh from reusing Codex paper draft catalog rows", function () {
    const draft = {
      conversationKey: 6_000_000_011,
      kind: "paper",
      libraryID: 1,
      userTurnCount: 0,
    };

    assert.isFalse(
      isReusableConversationDraft({
        forceFresh: true,
        summary: draft,
        kind: "paper",
      }),
    );
    assert.isTrue(
      isReusableConversationDraft({
        forceFresh: false,
        summary: draft,
        kind: "paper",
      }),
    );
    assert.isFalse(
      isReusableConversationDraft({
        forceFresh: false,
        summary: null,
        kind: "paper",
      }),
    );
  });
});
