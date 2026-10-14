export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export class ValidationError extends WorkflowError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
