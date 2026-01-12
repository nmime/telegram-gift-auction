/**
 * E2E Test Runner using @nestia/e2e
 *
 * Run with: npm run test:e2e
 */
import { DynamicExecutor } from "@nestia/e2e";
import api from "../src/api";

function calculateElapsed(startedAt: string, completedAt: string): number {
  return new Date(completedAt).getTime() - new Date(startedAt).getTime();
}

async function main(): Promise<void> {
  const connection: api.IConnection = {
    host: `http://localhost:${process.env.PORT ?? 3001}`,
    headers: {
      Authorization: "",
    },
  };

  // First, authenticate to get a token
  try {
    const authResult = await api.functional.api.auth.login(connection, {
      username: `e2e_test_${Date.now()}`,
    });
    connection.headers = {
      Authorization: `Bearer ${authResult.accessToken}`,
    };
    console.log("Authenticated for e2e tests");
  } catch (error) {
    console.warn("Auth failed, running tests without authentication:", error);
  }

  const report = await DynamicExecutor.validate({
    prefix: "test",
    location: `${__dirname}/features/features/api/automated`,
    parameters: () => [connection],
    onComplete: (exec) => {
      const elapsed = calculateElapsed(exec.started_at, exec.completed_at);
      console.log(`  - ${exec.name}: ${exec.error ? "FAIL" : "OK"} (${elapsed}ms)`);
    },
  });

  const failures = report.executions.filter((e) => e.error !== null);

  console.log("\n================================");
  console.log(`Total: ${report.executions.length} tests`);
  console.log(`Passed: ${report.executions.length - failures.length}`);
  console.log(`Failed: ${failures.length}`);
  console.log(`Time: ${report.time.toLocaleString("en-US", { maximumFractionDigits: 2 })}ms`);
  console.log("================================\n");

  if (failures.length > 0) {
    console.log("Failed tests:");
    for (const fail of failures) {
      console.log(`  - ${fail.name}:`);
      console.log(`    ${fail.error}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
