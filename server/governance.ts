import type { LicenseRecord } from './types.ts';

export type GovernanceOperation = 'retrieval' | 'training' | 'commercial';

const licenseRegistry = new Map<string, LicenseRecord>();

export function registerLicenseRecord(record: LicenseRecord): LicenseRecord {
  const existing = licenseRegistry.get(record.documentId);
  const next: LicenseRecord = {
    ...record,
    version: existing ? existing.version + 1 : record.version || 1,
    updatedAt: new Date().toISOString(),
  };
  licenseRegistry.set(record.documentId, next);
  return next;
}

export function getLicenseRecord(documentId: string): LicenseRecord | undefined {
  return licenseRegistry.get(documentId);
}

export function listLicenseRecords(): LicenseRecord[] {
  return Array.from(licenseRegistry.values());
}

export function verifyLicenseRecord(
  documentId: string,
  updates: Partial<
    Pick<LicenseRecord, 'verified' | 'commercialUseAllowed' | 'trainingAllowed' | 'license'>
  >
): LicenseRecord | undefined {
  const existing = licenseRegistry.get(documentId);
  if (!existing) return undefined;
  const updated: LicenseRecord = {
    ...existing,
    ...updates,
    version: existing.version + 1,
    updatedAt: new Date().toISOString(),
  };
  licenseRegistry.set(documentId, updated);
  return updated;
}

export function eligibleForOperation(
  record: LicenseRecord,
  operation: GovernanceOperation
): boolean {
  if (!record.verified) {
    return false;
  }
  if (operation === 'training') {
    return record.trainingAllowed;
  }
  if (operation === 'commercial') {
    return record.commercialUseAllowed;
  }
  if (operation === 'retrieval') {
    return true;
  }
  return false;
}

export function inferLicensePolicy(licenseStr: string): {
  commercialUseAllowed: boolean;
  trainingAllowed: boolean;
  verifiedByDefault: boolean;
} {
  const norm = licenseStr.toUpperCase();
  if (
    norm.includes('CC0') ||
    norm.includes('MIT') ||
    norm.includes('APACHE-2.0') ||
    norm.includes('CC-BY-4.0') ||
    norm.includes('CC-BY-3.0') ||
    norm.includes('CC-BY')
  ) {
    const isNonCommercial = norm.includes('NC');
    const isNoDerivatives = norm.includes('ND');
    return {
      commercialUseAllowed: !isNonCommercial,
      trainingAllowed: !isNoDerivatives,
      verifiedByDefault: true,
    };
  }
  return {
    commercialUseAllowed: false,
    trainingAllowed: false,
    verifiedByDefault: false,
  };
}
