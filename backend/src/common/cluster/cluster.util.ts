import cluster from "node:cluster";

export function getWorkerId(): number | null {
  if (!cluster.isWorker || cluster.worker === undefined) {
    return null;
  }
  return cluster.worker.id;
}

export function isPrimaryWorker(): boolean {
  if (!cluster.isWorker) {
    return true;
  }
  return cluster.worker?.id === 1;
}

export function shouldRunBackgroundWorker(maxWorkers = 0): boolean {
  if (!cluster.isWorker) {
    return true;
  }
  if (maxWorkers <= 0) {
    return true;
  }
  const workerId = cluster.worker?.id ?? 0;
  return workerId > 0 && workerId <= maxWorkers;
}
