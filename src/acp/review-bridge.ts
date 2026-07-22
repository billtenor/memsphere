import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer, createConnection, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ArtifactReviewAnchor, ArtifactReviewVoteValue } from "../artifact-review.js";
import {
  appendArtifactReviewAgentComment,
  markArtifactReviewAgentCliReady,
  readArtifactReviewForIdentity,
  submitArtifactReviewAgentAssignment,
  type ArtifactReviewAgentContext
} from "../run/store.js";
import { agentReviewCliProtocolVersion } from "./cli-runtime.js";
import { buildAgentReviewContract } from "./review-contract.js";

const maxBridgeRequestBytes = 1024 * 1024;

export type AgentReviewBridgeBinding = {
  runsRoot: string;
  runId: string;
  reviewId: string;
  roundId: string;
  assignmentId: string;
  identityId: string;
  attemptId: string;
  configPath: string;
  workspaceRoot: string;
};

type BridgeRequest = {
  protocolVersion: number;
  capability: string;
  assignmentId: string;
  operation: "artifact_show" | "artifact_contract_show" | "assignment_show" | "comment" | "submit";
  handshake?: {
    configPath: string;
    workspaceRoot: string;
  };
  body?: string;
  anchor?: ArtifactReviewAnchor;
  vote?: ArtifactReviewVoteValue;
  summary?: string;
};

type BridgeResponse = { ok: true; value: unknown } | { ok: false; error: string };

export type AgentReviewBridge = {
  endpoint: string;
  capability: string;
  env: Record<string, string>;
  waitForSubmission(): Promise<void>;
  close(): Promise<void>;
};

export async function createAgentReviewBridge(binding: AgentReviewBridgeBinding): Promise<AgentReviewBridge> {
  const capability = randomBytes(32).toString("base64url");
  let resolveSubmission: (() => void) | undefined;
  const submission = new Promise<void>((resolveSubmissionPromise) => {
    resolveSubmission = resolveSubmissionPromise;
  });
  const socketDirectory = join(tmpdir(), `memsphere-review-${process.pid}-${randomBytes(6).toString("hex")}`);
  const endpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\memsphere-review-${process.pid}-${randomBytes(8).toString("hex")}`
    : join(socketDirectory, "bridge.sock");
  if (process.platform !== "win32") await mkdir(socketDirectory, { recursive: true, mode: 0o700 });
  const server = createServer((socket) => {
    let raw = "";
    let handled = false;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      if (handled) return;
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBridgeRequestBytes) socket.destroy(new Error("review bridge request is too large"));
      if (!raw.includes("\n")) return;
      handled = true;
      const line = raw.slice(0, raw.indexOf("\n"));
      let submitted = false;
      void handleBridgeRequest(binding, capability, line, () => { submitted = true; })
        .then((response) => socket.end(`${JSON.stringify(response)}\n`, () => {
          if (submitted) resolveSubmission?.();
        }))
        .catch((error) => socket.end(`${JSON.stringify({ ok: false, error: formatError(error) } satisfies BridgeResponse)}\n`));
    });
  });
  await listen(server, endpoint);
  return {
    endpoint,
    capability,
    env: {
      MEMSPHERE_REVIEW_ENDPOINT: endpoint,
      MEMSPHERE_REVIEW_CAPABILITY: capability,
      MEMSPHERE_REVIEW_RUN_ID: binding.runId,
      MEMSPHERE_REVIEW_ASSIGNMENT_ID: binding.assignmentId,
      MEMSPHERE_CONFIG_PATH: resolve(binding.configPath),
      MEMSPHERE_WORKSPACE_ROOT: resolve(binding.workspaceRoot)
    },
    waitForSubmission: () => submission,
    close: async () => {
      await closeServer(server);
      if (process.platform !== "win32") await rm(socketDirectory, { recursive: true, force: true });
    }
  };
}

export async function requestAgentReviewBridge(input: Omit<BridgeRequest, "protocolVersion" | "capability" | "assignmentId" | "handshake">): Promise<unknown> {
  const endpoint = requiredEnv("MEMSPHERE_REVIEW_ENDPOINT");
  const capability = requiredEnv("MEMSPHERE_REVIEW_CAPABILITY");
  const assignmentId = requiredEnv("MEMSPHERE_REVIEW_ASSIGNMENT_ID");
  const request: BridgeRequest = {
    ...input,
    protocolVersion: agentReviewCliProtocolVersion,
    capability,
    assignmentId,
    handshake: {
      configPath: requiredEnv("MEMSPHERE_CONFIG_PATH"),
      workspaceRoot: requiredEnv("MEMSPHERE_WORKSPACE_ROOT")
    }
  };
  const response = await sendBridgeRequest(endpoint, request);
  if (!response.ok) throw new Error(response.error);
  return response.value;
}

async function handleBridgeRequest(
  binding: AgentReviewBridgeBinding,
  capability: string,
  raw: string,
  markSubmitted: () => void
): Promise<BridgeResponse> {
  const request = JSON.parse(raw) as BridgeRequest;
  if (request.protocolVersion !== agentReviewCliProtocolVersion) throw new Error("cli_version_mismatch");
  if (request.capability !== capability) throw new Error("review capability is invalid");
  if (request.assignmentId !== binding.assignmentId) throw new Error("review assignment does not match this Session");
  if (!request.handshake) throw new Error("review_session_handshake_failed: handshake is missing");
  if (resolve(request.handshake.configPath) !== resolve(binding.configPath)) throw new Error("cli_config_mismatch");
  if (resolve(request.handshake.workspaceRoot) !== resolve(binding.workspaceRoot)) throw new Error("cli_workspace_mismatch");
  await markArtifactReviewAgentCliReady({
    runsRoot: binding.runsRoot,
    reviewId: binding.reviewId,
    roundId: binding.roundId,
    identityId: binding.identityId,
    attemptId: binding.attemptId
  });

  if (request.operation === "artifact_show") {
    return { ok: true, value: await agentReviewArtifactPayload(binding) };
  }

  if (request.operation === "artifact_contract_show") {
    return { ok: true, value: await agentReviewArtifactContractPayload(binding) };
  }

  if (request.operation === "assignment_show") {
    return { ok: true, value: await agentReviewAssignmentDetailPayload(binding) };
  }

  if (request.operation === "comment") {
    if (!request.body?.trim()) throw new Error("Artifact Review Comment body must not be empty");
    const context = await appendArtifactReviewAgentComment({
      runsRoot: binding.runsRoot,
      reviewId: binding.reviewId,
      roundId: binding.roundId,
      identityId: binding.identityId,
      attemptId: binding.attemptId,
      body: request.body,
      anchor: request.anchor
    });
    return { ok: true, value: agentAssignmentReceipt(context, "comment") };
  }

  if (!request.vote) throw new Error("Artifact Review vote is required");
  const context = await submitArtifactReviewAgentAssignment({
    runsRoot: binding.runsRoot,
    reviewId: binding.reviewId,
    roundId: binding.roundId,
    identityId: binding.identityId,
    attemptId: binding.attemptId,
    vote: request.vote,
    summary: request.summary
  });
  markSubmitted();
  return { ok: true, value: agentAssignmentReceipt(context, "submit") };
}

async function agentReviewArtifactPayload(binding: AgentReviewBridgeBinding): Promise<unknown> {
  const context = await readArtifactReviewForIdentity({
    runsRoot: binding.runsRoot,
    reviewId: binding.reviewId,
    roundId: binding.roundId,
    identityId: binding.identityId
  });
  const submission = context.review.submissions.find((candidate) => candidate.id === context.round.submissionId);
  if (!submission) throw new Error(`Artifact Review Submission not found: ${context.round.submissionId}`);
  const artifact = submission.artifact;
  const value = artifact.storage === "file" && artifact.path
    ? await readFile(join(binding.runsRoot, artifact.path), "utf8")
    : artifact.value;
  return {
    artifact: {
      name: artifact.name,
      type: artifact.type,
      format: artifact.format,
      final: artifact.final,
      storage: artifact.storage ?? (artifact.path ? "file" : "inline"),
      value,
      fields: artifact.fields,
      fileName: artifact.fileName,
      filePath: artifact.path ? resolve(binding.runsRoot, artifact.path) : undefined,
      contentType: artifact.contentType,
      validation: artifact.validation
    },
    revisionSummary: submission.revisionSummary
  };
}

async function agentReviewArtifactContractPayload(binding: AgentReviewBridgeBinding): Promise<unknown> {
  const context = await readArtifactReviewForIdentity({
    runsRoot: binding.runsRoot,
    reviewId: binding.reviewId,
    roundId: binding.roundId,
    identityId: binding.identityId
  });
  return buildAgentReviewContract(context);
}

async function agentReviewAssignmentDetailPayload(binding: AgentReviewBridgeBinding): Promise<unknown> {
  const context = await readArtifactReviewForIdentity({
    runsRoot: binding.runsRoot,
    reviewId: binding.reviewId,
    roundId: binding.roundId,
    identityId: binding.identityId
  });
  return {
    status: context.assignment.status,
    binding: context.assignment.binding,
    roles: context.assignment.roleIds.map((roleId) => context.run.controlPlane?.roles[roleId]?.name ?? roleId),
    permissions: context.assignment.permissions,
    comments: context.assignment.submitted?.comments ?? context.assignment.draft.comments,
    vote: context.assignment.submitted?.vote,
    summary: context.assignment.submitted?.summary
  };
}

function agentAssignmentReceipt(
  context: ArtifactReviewAgentContext,
  operation: "comment" | "submit"
): unknown {
  return {
    reviewId: context.review.id,
    reviewRoundId: context.round.id,
    assignmentId: context.assignment.id,
    status: context.assignment.status,
    vote: context.assignment.submitted?.vote,
    commentCount: context.assignment.draft.comments.length,
    completed: operation === "submit",
    message: operation === "submit"
      ? "Assignment submitted successfully. Stop now; do not submit again."
      : "Comment saved."
  };
}

async function sendBridgeRequest(endpoint: string, request: BridgeRequest): Promise<BridgeResponse> {
  return new Promise<BridgeResponse>((resolveResponse, rejectResponse) => {
    const socket = createConnection(endpoint);
    let raw = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => { raw += chunk; });
    socket.once("end", () => {
      try {
        resolveResponse(JSON.parse(raw.trim()) as BridgeResponse);
      } catch (error) {
        rejectResponse(error);
      }
    });
    socket.once("error", (error) => rejectResponse(new Error(`review_channel_unreachable: ${error.message}`)));
  });
}

async function listen(server: Server, endpoint: string): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(endpoint, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Agent Review Session environment is missing ${name}`);
  return value;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
