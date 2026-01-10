export enum MongoErrorCode {
  DuplicateKey = 11000,
  WriteConflict = 112,
  TransactionAborted = 251,
}

export interface MongoDBError extends Error {
  code?: number;
  codeName?: string;
  hasErrorLabel?(label: string): boolean;
}

export function isMongoDBError(error: unknown): error is MongoDBError {
  if (!(error instanceof Error)) return false;
  const mongoError = error as MongoDBError;
  return (
    mongoError.code !== undefined ||
    mongoError.codeName !== undefined ||
    mongoError.hasErrorLabel !== undefined
  );
}

export function isDuplicateKeyError(error: unknown): boolean {
  if (!isMongoDBError(error)) return false;
  return error.code === MongoErrorCode.DuplicateKey;
}

export function isTransientTransactionError(error: unknown): boolean {
  if (!isMongoDBError(error)) return false;

  return (
    error.hasErrorLabel?.('TransientTransactionError') ||
    error.code === MongoErrorCode.WriteConflict ||
    error.code === MongoErrorCode.TransactionAborted ||
    error.codeName === 'WriteConflict' ||
    error.message?.includes('WriteConflict') ||
    false
  );
}
