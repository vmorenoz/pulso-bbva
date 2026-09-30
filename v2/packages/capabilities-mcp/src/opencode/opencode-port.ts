import type { PluginInput } from "@opencode-ai/plugin";
import type { Part, Session } from "@opencode-ai/sdk";

export type ObservedNativeCall = {
  status: "pending" | "running" | "completed" | "error" | "missing" | "unknown";
  parentSessionId: string;
  parentCallId: string;
  metadataParentSessionId?: string;
  childSessionId?: string;
  specialist?: string;
  model?: { providerId: string; modelId: string };
  background: boolean;
  output?: string;
  metadataObserved: boolean;
};

export type ObservedChild = {
  id: string;
  parentId?: string;
};
export type ObservedChildResult = {
  output: string;
  completedAt: number;
};

export type OpenCodeTransportOperation =
  | "observeCall"
  | "readChild"
  | "readChildResult"
  | "abortChild";

export type SanitizedOpenCodeError = {
  className: string;
  message: string;
  code?: string;
  status?: number;
  cause?: SanitizedOpenCodeError;
};

export type OpenCodeTransportFailure = SanitizedOpenCodeError & {
  operation: OpenCodeTransportOperation;
};

const maximumErrorDepth = 2;
const maximumErrorMessageBytes = 4_096;
const sensitiveErrorValue =
  /((?:api[_ -]?key|authorization|bearer|token|secret|password)=?)([^\s,;]+)/gi;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizedText = (value: unknown) =>
  String(value)
    .replace(sensitiveErrorValue, "$1[REDACTED]")
    .slice(0, maximumErrorMessageBytes);

const optionalText = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? sanitizedText(value)
    : undefined;

const sanitizedError = (error: unknown, depth = 0): SanitizedOpenCodeError => {
  if (!isRecord(error) && !(error instanceof Error))
    return { className: typeof error, message: sanitizedText(error) };
  const values = error instanceof Error ? error : error;
  const record = isRecord(values) ? values : {};
  const status =
    typeof record.status === "number" && Number.isInteger(record.status)
      ? record.status
      : undefined;
  const cause =
    depth < maximumErrorDepth && "cause" in record && record.cause !== undefined
      ? sanitizedError(record.cause, depth + 1)
      : undefined;
  return {
    className:
      error instanceof Error && error.name
        ? error.name
        : typeof record.name === "string"
          ? sanitizedText(record.name)
          : "Error",
    message: sanitizedText(
      error instanceof Error ? error.message : (record.message ?? error),
    ),
    ...(optionalText(record.code) ? { code: optionalText(record.code) } : {}),
    ...(status === undefined ? {} : { status }),
    ...(cause ? { cause } : {}),
  };
};

/** SDK failures cross the port only as bounded, secret-safe transport evidence. */
export class OpenCodeTransportError extends Error {
  readonly failure: OpenCodeTransportFailure;

  constructor(operation: OpenCodeTransportOperation, error: unknown) {
    const evidence = sanitizedError(error);
    super(`OpenCode ${operation} failed: ${evidence.message}`);
    this.name = "OpenCodeTransportError";
    this.failure = { operation, ...evidence };
  }
}

export const transportFailureOf = (error: unknown) =>
  error instanceof OpenCodeTransportError ? error.failure : undefined;

export interface OpenCodeTransport {
  observeCall(
    parentSessionId: string,
    parentCallId: string,
  ): Promise<ObservedNativeCall>;
  readChild(childSessionId: string): Promise<ObservedChild | undefined>;
  readChildResult?(
    childSessionId: string,
  ): Promise<ObservedChildResult | undefined>;
  abortChild(childSessionId: string): Promise<void>;
}

const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;

const metadataFrom = (part: Extract<Part, { type: "tool" }>) => {
  if (part.state.status === "completed" || part.state.status === "running")
    return part.state.metadata;
  if (part.state.status === "error") return part.state.metadata;
  return part.metadata;
};

/** The only module that translates OpenCode's public SDK structures. */
export class OpenCodePort implements OpenCodeTransport {
  constructor(private readonly client: PluginInput["client"]) {}

  async observeCall(
    parentSessionId: string,
    parentCallId: string,
  ): Promise<ObservedNativeCall> {
    let response: Awaited<
      ReturnType<PluginInput["client"]["session"]["messages"]>
    >;
    try {
      response = await this.client.session.messages({
        path: { id: parentSessionId },
      });
    } catch (error) {
      throw new OpenCodeTransportError("observeCall", error);
    }
    if (!response.data)
      return {
        status: "unknown",
        parentSessionId,
        parentCallId,
        background: false,
        metadataObserved: false,
      };
    const part = response.data
      .flatMap((message) => message.parts)
      .reverse()
      .find(
        (candidate): candidate is Extract<Part, { type: "tool" }> =>
          candidate.type === "tool" && candidate.callID === parentCallId,
      );
    if (!part)
      return {
        status: "missing",
        parentSessionId,
        parentCallId,
        background: false,
        metadataObserved: false,
      };
    const metadata = metadataFrom(part);
    const values = isRecord(metadata) ? metadata : {};
    const model = isRecord(values.model)
      ? {
          providerId: text(values.model.providerID),
          modelId: text(values.model.modelID),
        }
      : undefined;
    const completeModel =
      model?.providerId && model.modelId
        ? { providerId: model.providerId, modelId: model.modelId }
        : undefined;
    const status = part.state.status;
    return {
      status,
      parentSessionId,
      parentCallId,
      metadataParentSessionId: text(values.parentSessionId),
      childSessionId: text(values.sessionId),
      specialist: text(values.agent),
      model: completeModel,
      background: values.background === true,
      output: status === "completed" ? part.state.output : undefined,
      metadataObserved: Boolean(values.parentSessionId || values.sessionId),
    };
  }

  async readChild(childSessionId: string): Promise<ObservedChild | undefined> {
    let response: Awaited<ReturnType<PluginInput["client"]["session"]["get"]>>;
    try {
      response = await this.client.session.get({
        path: { id: childSessionId },
      });
    } catch (error) {
      throw new OpenCodeTransportError("readChild", error);
    }
    const child: Session | undefined = response.data;
    if (!child) return undefined;
    return { id: child.id, parentId: child.parentID };
  }

  async readChildResult(childSessionId: string) {
    let response: Awaited<
      ReturnType<PluginInput["client"]["session"]["messages"]>
    >;
    try {
      response = await this.client.session.messages({
        path: { id: childSessionId },
      });
    } catch (error) {
      throw new OpenCodeTransportError("readChildResult", error);
    }
    for (const message of [...(response.data ?? [])].reverse()) {
      if (
        message.info.role !== "assistant" ||
        message.info.time.completed === undefined
      )
        continue;
      for (const part of [...message.parts].reverse())
        if (part.type === "text" && part.text.includes('<pulso-result v="2">'))
          return {
            output: part.text,
            completedAt: message.info.time.completed,
          };
    }
    return undefined;
  }

  async abortChild(childSessionId: string) {
    try {
      await this.client.session.abort({ path: { id: childSessionId } });
    } catch (error) {
      throw new OpenCodeTransportError("abortChild", error);
    }
  }
}
