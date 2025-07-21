export class InvalidNodeAmountException extends Error {
  constructor(msg: string) {
    super(msg);

    Object.setPrototypeOf(this, InvalidNodeAmountException.prototype);
  }
}
export class ClusterRequiresControlPlanes extends Error {
  constructor(msg: string) {
    super(msg);

    Object.setPrototypeOf(this, InvalidNodeAmountException.prototype);
  }
}
