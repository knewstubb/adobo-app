export interface AdoCredentials {
  org: string;
  project: string;
  team: string;
  pat: string;
}

const CRED_KEY = "ado_credentials";

export function getCredentials(): AdoCredentials | null {
  try {
    const raw = localStorage.getItem(CRED_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AdoCredentials;
  } catch {
    return null;
  }
}

export function setCredentials(creds: AdoCredentials): void {
  localStorage.setItem(CRED_KEY, JSON.stringify(creds));
}

export function clearCredentials(): void {
  localStorage.removeItem(CRED_KEY);
}

export function hasCredentials(): boolean {
  return localStorage.getItem(CRED_KEY) !== null;
}
