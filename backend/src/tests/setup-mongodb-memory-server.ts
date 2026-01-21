/**
 * Setup script for MongoDB Memory Server
 * Ensures binary is downloaded before tests run
 */

import { MongoMemoryServer } from 'mongodb-memory-server';

export async function setupMongodbMemoryServer(): Promise<void> {
  if (process.env.CI) {
    try {
      console.log('Predownloading MongoDB Memory Server binary for CI...');
      await MongoMemoryServer.create({
        instance: {
          port: 0,
        },
      }).then(async (mongod) => {
        await mongod.stop();
        console.log('MongoDB Memory Server binary predownloaded successfully');
      });
    } catch (error) {
      console.error('Failed to predownload MongoDB Memory Server:', error);
      // Don't fail CI, tests will handle their own setup
    }
  }
}

setupMongodbMemoryServer().catch(console.error);
