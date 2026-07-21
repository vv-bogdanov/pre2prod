export class Pre2prodError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Pre2prodError";
  }
}

export class ProtocolError extends Pre2prodError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProtocolError";
  }
}

export class TurnFailedError extends Pre2prodError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TurnFailedError";
  }
}

export class PhaseFailedError extends Pre2prodError {
  public constructor(
    public readonly phaseId: string,
    message: string,
  ) {
    super(message);
    this.name = "PhaseFailedError";
  }
}
