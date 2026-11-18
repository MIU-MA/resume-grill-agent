import { z } from "zod";

export type Operation = {
  name: string;
  description: string;
  schema: z.ZodObject;
  run: (args: unknown) => unknown;
  readOnly: boolean;
};

export type OperationModule = {
  tools: Operation[];
  snapshot?: () => Record<string, unknown>;
  history?: () => unknown[];
};

export function operationModule(
  register: (tool: typeof defineOperation) => void,
) {
  const tools: Operation[] = [];
  const add: typeof defineOperation = (...args) => {
    const operation = defineOperation(...args);
    tools.push(operation);
    return operation;
  };
  register(add);
  return tools;
}

function defineOperation<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: Shape,
  run: (args: z.output<z.ZodObject<Shape>>) => unknown,
  readOnly = false,
): Operation {
  const schema = z.object(shape).strict();
  return {
    name,
    description,
    schema,
    run: (args) => run(schema.parse(args)),
    readOnly,
  };
}
