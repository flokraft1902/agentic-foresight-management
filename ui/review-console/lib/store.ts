import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { AuditEvent, ReviewCase, ReviewDecision, ReviewStatus } from "@/lib/types";

const dataDir = path.join(process.cwd(), "data");
const casesFile = path.join(dataDir, "review-cases.json");
const auditFile = path.join(dataDir, "audit-log.json");

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function getAllCases(): Promise<ReviewCase[]> {
  const cases = await readJsonFile<ReviewCase[]>(casesFile);
  return [...cases].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getCaseById(caseId: string): Promise<ReviewCase | undefined> {
  const cases = await readJsonFile<ReviewCase[]>(casesFile);
  return cases.find((entry) => entry.caseId === caseId);
}

export async function upsertCase(newCase: ReviewCase): Promise<void> {
  const cases = await readJsonFile<ReviewCase[]>(casesFile);
  const idx = cases.findIndex((entry) => entry.caseId === newCase.caseId);
  if (idx === -1) {
    cases.push(newCase);
  } else {
    cases[idx] = newCase;
  }
  await writeJsonFile(casesFile, cases);
}

export async function appendAuditEvent(event: AuditEvent): Promise<void> {
  const events = await readJsonFile<AuditEvent[]>(auditFile);
  events.push(event);
  await writeJsonFile(auditFile, events);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function applyDecision(params: {
  caseId: string;
  decision: ReviewDecision;
  reviewer: string;
  comment?: string;
  correctedDecision?: Record<string, unknown>;
}): Promise<ReviewCase> {
  const current = await getCaseById(params.caseId);
  if (!current) {
    throw new Error(`Case not found: ${params.caseId}`);
  }

  let nextStatus: ReviewStatus;
  switch (params.decision) {
    case "approve":
      nextStatus = "approved";
      break;
    case "correct":
      nextStatus = "corrected";
      break;
    case "reject":
      nextStatus = "rejected";
      break;
    default:
      throw new Error("Unsupported decision");
  }

  const updated: ReviewCase = {
    ...current,
    reviewStatus: nextStatus,
    reviewer: params.reviewer,
    reviewComment: params.comment,
    decision: params.correctedDecision ?? current.decision,
    updatedAt: nowIso(),
  };

  await upsertCase(updated);
  await appendAuditEvent({
    id: newId("audit"),
    at: nowIso(),
    caseId: params.caseId,
    action: params.decision,
    reviewer: params.reviewer,
    comment: params.comment,
    diff: params.correctedDecision,
  });

  return updated;
}
