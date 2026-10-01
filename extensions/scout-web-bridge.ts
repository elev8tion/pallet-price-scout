type Bridge = {
  ask?: (question: string, choices?: string[]) => Promise<string | undefined>;
  artifact?: (input: { title: string; kind: string; content: string }) => Promise<{ artifactId: string }>;
  submitFindings?: (input: Record<string, unknown>) => Promise<{ artifactId: string }>;
};

declare global {
  // The worker owns this narrow, process-local bridge. It is never exposed to the browser.
  // eslint-disable-next-line no-var
  var __palletScoutWebBridge: Bridge | undefined;
}

const text = (value: string) => ({ content: [{ type: "text", text: value }] });

export default function scoutWebBridge(pi: any) {
  pi.registerTool({
    name: "ui_ask",
    label: "Ask in browser",
    description: "Ask the browser user a question and wait for an explicit response.",
    parameters: {
      type: "object",
      properties: { question: { type: "string" }, choices: { type: "array", items: { type: "string" } } },
      required: ["question"],
      additionalProperties: false,
    },
    promptSnippet: "ask the browser user for an explicit decision",
    async execute(_toolCallId: string, params: { question: string; choices?: string[] }) {
      const answer = await globalThis.__palletScoutWebBridge?.ask?.(params.question, params.choices);
      return answer === undefined ? { ...text("Browser response was cancelled or unavailable."), isError: true } : text(answer);
    },
  });
  pi.registerTool({
    name: "scout_submit_findings",
    label: "Submit sorted scout findings",
    description: "Submit the researched pallet findings so the app can validate, sort, crop, and display them.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        subtitle: { type: "string" },
        coord_scale_w: { type: "number" },
        coord_scale_h: { type: "number" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" }, name: { type: "string" }, brand: { type: "string" },
              category: { type: "string" }, coords: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
              price: { type: "number" }, status: { type: "string" }, retailer: { type: "string" },
              source_url: { type: "string" }, description: { type: "string" },
            },
            required: ["id", "name", "coords"],
            additionalProperties: true,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    },
    promptSnippet: "submit all researched findings after sorting them by price",
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const submit = globalThis.__palletScoutWebBridge?.submitFindings;
      if (!submit) return { ...text("Finding submission is unavailable."), isError: true };
      try {
        const result = await submit(params);
        return text(`Sorted findings published as ${result.artifactId}.`);
      } catch (error) {
        return { ...text(error instanceof Error ? error.message : String(error)), isError: true };
      }
    },
  });
  pi.registerTool({
    name: "ui_display_artifact",
    label: "Display browser artifact",
    description: "Publish a bounded artifact to the Pallet Price Scout browser workspace.",
    parameters: {
      type: "object",
      properties: { title: { type: "string" }, kind: { type: "string", enum: ["block", "markdown", "svg", "table"] }, content: { type: "string" } },
      required: ["title", "kind", "content"],
      additionalProperties: false,
    },
    promptSnippet: "publish the generated report artifact in the browser workspace",
    async execute(_toolCallId: string, params: { title: string; kind: string; content: string }) {
      if (params.content.length > 2_000_000) return { ...text("Artifact exceeds the 2 MB browser limit."), isError: true };
      const artifact = await globalThis.__palletScoutWebBridge?.artifact?.(params);
      return artifact ? text(`Artifact ${artifact.artifactId} is available in the browser.`) : { ...text("Artifact persistence is unavailable."), isError: true };
    },
  });
}
