import type { AppConfig } from "./config.js";
import { PostgresRepository } from "./postgres-repository.js";
import { JsonRepository } from "./repository.js";
import type { SacFlowRepository } from "./repository-contract.js";

export function createRepository(config: AppConfig): SacFlowRepository {
  if (config.persistence.driver === "json") {
    return new JsonRepository(config.persistence.jsonFile);
  }

  return new PostgresRepository({
    connectionString: config.persistence.postgresUrl!,
    encryptionKey: config.persistence.postgresEncryptionKey!,
    organizationSlug: config.persistence.postgresOrganizationSlug,
    organizationName: config.persistence.postgresOrganizationName,
    seedDemoOnEmpty: config.persistence.postgresSeedDemo,
  });
}
